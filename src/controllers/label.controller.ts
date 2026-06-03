import { Request, Response } from 'express';
import archiver from 'archiver';
import { isValidObjectId } from 'mongoose';
import Order, { IOrder } from '../models/Order';
import User from '../models/User';
import Label, { ILabel } from '../models/Label';
import LabelBatch from '../models/LabelBatch';
import {
  createShipStationLabelForOrder,
  applyShipFromAndInsuranceToOrder,
  getShipStationOrder,
  CreateLabelForOrderPayload,
  ShipStationLabelAddress,
  ShipStationLabelWeight,
} from '../services/shipstationLabel.service';
import {
  getWarehouseById,
  getWarehouseByName,
  listWarehouses,
} from '../services/shipstationWarehouse.service';
import { uploadPdfToDrive } from '../services/googleDrive.service';

const DEFAULT_DIMENSIONS = { length: 15, width: 10, height: 5, units: 'inches' };

// Ship From / origin warehouse used on every created label. ShipStation
// requires a valid origin (FedEx validates it), so we pull the address from the
// matching warehouse rather than hand-entered env values. Prefer the numeric
// warehouseId (stable across renames); fall back to matching by name.
const SHIP_FROM_WAREHOUSE_ID = parseInt(process.env.SHIP_FROM_WAREHOUSE_ID || '', 10);
const SHIP_FROM_WAREHOUSE_NAME = process.env.SHIP_FROM_WAREHOUSE_NAME || 'Belleville';

interface InputRow {
  poNumber?: string;
  orderNumber?: string;
}

interface PreparedSku {
  sku?: string;
  quantity?: number;
}

interface PreparedRow {
  poNumber: string;
  orderNumber: string;
  found: boolean;
  orderId?: number;
  customerName?: string;
  qty?: number;
  skus?: PreparedSku[];
  shipFromSummary?: string;
  shipFrom?: ShipStationLabelAddress;
  warehouseId?: number;
  shipToSummary?: string;
  shipTo?: ShipStationLabelAddress;
  propertyType?: 'residential' | 'commercial';
  carrierCode?: string;
  serviceCode?: string;
  packageCode?: string;
  insuranceProvider?: string;
  shipDate?: string;
  weight?: ShipStationLabelWeight;
  dimensions?: typeof DEFAULT_DIMENSIONS;
  error?: string;
}

function formatShipDate(date?: Date): string {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function resolveWeight(order: IOrder): ShipStationLabelWeight {
  // Weight rule: 4 (pounds) × total quantity ordered.
  // e.g. qty 2 -> value 8, units "pounds". Each order line has at least qty 1.
  const totalQty = (order.items || []).reduce(
    (sum, item) => sum + (item.quantity || 1),
    0
  );
  return { value: 4 * totalQty, units: 'pounds' };
}

function resolveServiceCode(residential: boolean): string {
  return residential ? 'amazon_fedex_home_delivery' : 'amazon_fedex_ground';
}

interface ResolvedShipFrom {
  address: ShipStationLabelAddress;
  warehouseId?: number;
  warehouseName?: string;
}

function buildShipFromFromEnv(): ShipStationLabelAddress {
  return {
    name: process.env.SHIP_FROM_NAME || '',
    company: process.env.SHIP_FROM_COMPANY || 'Belleville',
    street1: process.env.SHIP_FROM_STREET1 || '',
    street2: process.env.SHIP_FROM_STREET2 || '',
    city: process.env.SHIP_FROM_CITY || '',
    state: process.env.SHIP_FROM_STATE || '',
    postalCode: process.env.SHIP_FROM_POSTAL_CODE || '',
    country: process.env.SHIP_FROM_COUNTRY || '',
    phone: process.env.SHIP_FROM_PHONE || '',
    residential: false,
  };
}

/**
 * Resolves the Ship From address + warehouseId from the named ShipStation
 * warehouse (e.g. "Belleville"). Falls back to env-based values if the
 * warehouse can't be fetched/found so label creation never hard-fails here.
 */
async function resolveShipFrom(): Promise<ResolvedShipFrom> {
  try {
    const warehouse = Number.isFinite(SHIP_FROM_WAREHOUSE_ID)
      ? await getWarehouseById(SHIP_FROM_WAREHOUSE_ID)
      : await getWarehouseByName(SHIP_FROM_WAREHOUSE_NAME);
    const origin = warehouse?.originAddress;
    if (warehouse && origin) {
      return {
        address: {
          name: origin.name || '',
          company: origin.company || '',
          street1: origin.street1 || '',
          street2: origin.street2 || '',
          street3: origin.street3 || '',
          city: origin.city || '',
          state: origin.state || '',
          postalCode: origin.postalCode || '',
          country: origin.country || 'US',
          phone: origin.phone || '',
          residential: false,
        },
        warehouseId: warehouse.warehouseId,
        warehouseName: warehouse.warehouseName,
      };
    }
  } catch (e) {
    const selector = Number.isFinite(SHIP_FROM_WAREHOUSE_ID)
      ? `id ${SHIP_FROM_WAREHOUSE_ID}`
      : `"${SHIP_FROM_WAREHOUSE_NAME}"`;
    console.error(
      `[Labels] Failed to resolve ${selector} warehouse — falling back to env Ship From: ${(e as Error).message}`
    );
  }
  return { address: buildShipFromFromEnv() };
}

function buildShipTo(order: IOrder): ShipStationLabelAddress {
  const s = order.shipTo || {};
  return {
    name: s.name || '',
    company: s.company || '',
    street1: s.street1 || '',
    street2: s.street2 || '',
    street3: s.street3 || '',
    city: s.city || '',
    state: s.state || '',
    postalCode: s.postalCode || '',
    country: s.country || 'US',
    phone: s.phone || '',
    residential: Boolean(s.residential),
  };
}

async function prepareRow(input: InputRow): Promise<PreparedRow> {
  const poNumber = (input.poNumber || '').trim();
  const orderNumber = (input.orderNumber || '').trim();

  const base: PreparedRow = { poNumber, orderNumber, found: false };

  if (!poNumber || !orderNumber) {
    base.error = 'Both PO# and Order# are required.';
    return base;
  }

  const order = await Order.findOne({ orderNumber }).sort({ orderDate: -1 });

  if (!order) {
    base.error = `Order #${orderNumber} not found.`;
    return base;
  }

  const residential = Boolean(order.shipTo?.residential);
  const totalQty = (order.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
  const skus = (order.items || []).map((item) => ({
    sku: item.sku,
    quantity: item.quantity || 1,
  }));
  const { address: shipFrom, warehouseId } = await resolveShipFrom();
  const shipTo = buildShipTo(order);
  const shipFromSummary = [shipFrom.city, shipFrom.state, shipFrom.postalCode]
    .filter(Boolean)
    .join(', ');
  const shipToSummary = [shipTo.city, shipTo.state, shipTo.postalCode]
    .filter(Boolean)
    .join(', ');

  return {
    poNumber,
    orderNumber,
    found: true,
    orderId: order.orderId,
    customerName: order.shipTo?.name,
    qty: totalQty,
    skus,
    shipFromSummary,
    shipFrom,
    warehouseId,
    shipToSummary,
    shipTo,
    propertyType: residential ? 'residential' : 'commercial',
    carrierCode: 'amazon_shipping',
    serviceCode: resolveServiceCode(residential),
    packageCode: 'package',
    insuranceProvider: 'none',
    shipDate: formatShipDate(order.shipByDate),
    weight: resolveWeight(order),
    dimensions: DEFAULT_DIMENSIONS,
  };
}

const NO_INSURANCE = { provider: 'none', insureShipment: false, insuredValue: 0 } as const;

/**
 * Builds the body for POST /orders/createlabelfororder. We buy the label
 * against the existing Amazon order (prepared.orderId) — this is required for
 * Amazon Buy Shipping ("amazon_shipping"), which only works when the label is
 * tied to a real Amazon order.
 *
 * NOTE: createlabelfororder ignores advancedOptions/insuranceOptions sent here —
 * it uses whatever is saved on the order. We still include them for clarity and
 * record-keeping, but the actual Ship From (Belleville) and "no insurance" are
 * enforced by syncOrderShippingDefaults() *before* this label is purchased.
 */
function buildOrderPayload(prepared: PreparedRow): CreateLabelForOrderPayload {
  return {
    orderId: prepared.orderId as number,
    carrierCode: prepared.carrierCode || 'amazon_shipping',
    serviceCode: prepared.serviceCode || 'amazon_fedex_ground',
    packageCode: prepared.packageCode || 'package',
    confirmation: 'none',
    shipDate: prepared.shipDate || formatShipDate(),
    weight: prepared.weight || { value: 1, units: 'pounds' },
    dimensions: prepared.dimensions || DEFAULT_DIMENSIONS,
    insuranceOptions: { ...NO_INSURANCE },
    internationalOptions: null,
    ...(prepared.warehouseId
      ? { advancedOptions: { warehouseId: prepared.warehouseId } }
      : {}),
  };
}

/**
 * Forces the order's Ship From warehouse (Belleville) and disables insurance
 * directly on the ShipStation order, because createlabelfororder reads those
 * from the saved order rather than from the label request. Must run before
 * buying the label. Throws on failure so we never silently buy a label that
 * ships from the wrong origin or carries unwanted insurance.
 */
async function syncOrderShippingDefaults(prepared: PreparedRow): Promise<void> {
  if (!prepared.orderId) return;
  await applyShipFromAndInsuranceToOrder(prepared.orderId, prepared.warehouseId, {
    ...NO_INSURANCE,
  });
}

/**
 * Process 1 — resolve the imported PO#/Order# rows into reviewable label details.
 */
export const prepareLabels = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows: InputRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (rows.length === 0) {
      res.status(400).json({ message: 'No rows provided. Import a CSV with PO# and Order# columns.' });
      return;
    }

    const prepared = await Promise.all(rows.map(prepareRow));
    res.json({ data: prepared });
  } catch (error) {
    res.status(500).json({ message: 'Failed to prepare labels', error: (error as Error).message });
  }
};

/**
 * Process 2 — create the shipping labels via ShipStation, persist them, and
 * upload each renamed PDF (PO#.pdf) to the user's Google Drive folder.
 */
export const createLabels = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows: InputRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (rows.length === 0) {
      res.status(400).json({ message: 'No rows provided.' });
      return;
    }

    const userId = req.user?.id;
    const user = userId
      ? await User.findById(userId).select('+googleRefreshToken +googleAccessToken')
      : null;

    const driveCreds = {
      refreshToken: user?.googleRefreshToken,
      accessToken: user?.googleAccessToken,
    };
    const driveFolderId = user?.driveFolderId;
    const driveConnected = Boolean(user?.googleRefreshToken);

    const results = [];

    for (const input of rows) {
      const prepared = await prepareRow(input);

      if (!prepared.found) {
        const failed = await Label.create({
          poNumber: prepared.poNumber,
          orderNumber: prepared.orderNumber,
          status: 'failed',
          error: prepared.error,
          createdBy: user?.email,
          createdByUserId: userId,
        });
        results.push({
          labelId: failed._id,
          poNumber: prepared.poNumber,
          orderNumber: prepared.orderNumber,
          status: 'failed' as const,
          error: prepared.error,
        });
        continue;
      }

      const payload = buildOrderPayload(prepared);

      try {
        await syncOrderShippingDefaults(prepared);
        const ssResponse = await createShipStationLabelForOrder(payload);

        const label = new Label({
          poNumber: prepared.poNumber,
          orderNumber: prepared.orderNumber,
          orderId: prepared.orderId,
          status: 'created',
          qty: prepared.qty,
          skus: prepared.skus,
          carrierCode: prepared.carrierCode,
          serviceCode: prepared.serviceCode,
          packageCode: prepared.packageCode,
          shipDate: prepared.shipDate,
          propertyType: prepared.propertyType,
          weight: prepared.weight,
          dimensions: prepared.dimensions,
          requestPayload: payload as unknown as Record<string, unknown>,
          shipmentId: ssResponse.shipmentId,
          shipmentCost: ssResponse.shipmentCost,
          insuranceCost: ssResponse.insuranceCost,
          trackingNumber: ssResponse.trackingNumber,
          labelData: ssResponse.labelData,
          formData: ssResponse.formData,
          createdBy: user?.email,
          createdByUserId: userId,
        });

        // Upload renamed PDF (PO#.pdf) to Google Drive.
        let driveError: string | undefined;
        if (ssResponse.labelData) {
          if (driveConnected) {
            try {
              const fileName = `${prepared.poNumber}.pdf`;
              const uploaded = await uploadPdfToDrive(
                driveCreds,
                fileName,
                ssResponse.labelData,
                driveFolderId
              );
              label.driveFileId = uploaded.id;
              label.driveFileName = uploaded.name;
              label.driveFileLink = uploaded.webViewLink || undefined;
            } catch (e) {
              driveError = (e as Error).message;
            }
          } else {
            driveError = 'Google Drive is not connected. Configure it in Settings.';
          }
        }

        await label.save();

        results.push({
          labelId: label._id,
          poNumber: label.poNumber,
          orderNumber: label.orderNumber,
          status: 'created' as const,
          shipmentId: label.shipmentId,
          shipmentCost: label.shipmentCost,
          insuranceCost: label.insuranceCost,
          trackingNumber: label.trackingNumber,
          driveFileLink: label.driveFileLink,
          driveFileName: label.driveFileName,
          driveError,
        });
      } catch (e) {
        const message = (e as Error).message;
        const failed = await Label.create({
          poNumber: prepared.poNumber,
          orderNumber: prepared.orderNumber,
          orderId: prepared.orderId,
          status: 'failed',
          carrierCode: prepared.carrierCode,
          serviceCode: prepared.serviceCode,
          shipDate: prepared.shipDate,
          propertyType: prepared.propertyType,
          weight: prepared.weight,
          dimensions: prepared.dimensions,
          requestPayload: payload as unknown as Record<string, unknown>,
          error: message,
          createdBy: user?.email,
          createdByUserId: userId,
        });
        results.push({
          labelId: failed._id,
          poNumber: prepared.poNumber,
          orderNumber: prepared.orderNumber,
          status: 'failed' as const,
          error: message,
        });
      }
    }

    res.json({ data: results });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create labels', error: (error as Error).message });
  }
};

interface DriveCreds {
  refreshToken?: string;
  accessToken?: string;
}

async function resolveDriveContext(userId?: string) {
  const user = userId
    ? await User.findById(userId).select('+googleRefreshToken +googleAccessToken')
    : null;
  return {
    user,
    driveCreds: {
      refreshToken: user?.googleRefreshToken,
      accessToken: user?.googleAccessToken,
    } as DriveCreds,
    driveFolderId: user?.driveFolderId,
    driveConnected: Boolean(user?.googleRefreshToken),
  };
}

/**
 * Creates the ShipStation label for a single (drafted) Label document, uploads
 * the renamed PDF to Drive, and persists the result onto the same document.
 * Returns a per-row result summary.
 */
async function createLabelForRecord(
  label: ILabel,
  drive: { creds: DriveCreds; folderId?: string; connected: boolean }
) {
  const prepared = await prepareRow({
    poNumber: label.poNumber,
    orderNumber: label.orderNumber,
  });

  if (!prepared.found) {
    label.status = 'failed';
    label.error = prepared.error;
    await label.save();
    return {
      labelId: label._id,
      poNumber: label.poNumber,
      orderNumber: label.orderNumber,
      status: 'failed' as const,
      error: prepared.error,
    };
  }

  const payload = buildOrderPayload(prepared);

  try {
    await syncOrderShippingDefaults(prepared);
    const ssResponse = await createShipStationLabelForOrder(payload);

    label.orderId = prepared.orderId;
    label.status = 'created';
    label.found = true;
    label.customerName = prepared.customerName;
    label.qty = prepared.qty;
    label.skus = prepared.skus;
    label.shipFrom = prepared.shipFrom;
    label.shipTo = prepared.shipTo;
    label.insuranceProvider = prepared.insuranceProvider;
    label.carrierCode = prepared.carrierCode;
    label.serviceCode = prepared.serviceCode;
    label.packageCode = prepared.packageCode;
    label.shipDate = prepared.shipDate;
    label.propertyType = prepared.propertyType;
    label.weight = prepared.weight;
    label.dimensions = prepared.dimensions;
    label.requestPayload = payload as unknown as Record<string, unknown>;
    label.shipmentId = ssResponse.shipmentId;
    label.shipmentCost = ssResponse.shipmentCost;
    label.insuranceCost = ssResponse.insuranceCost;
    label.trackingNumber = ssResponse.trackingNumber;
    label.labelData = ssResponse.labelData;
    label.formData = ssResponse.formData;
    label.error = undefined;

    let driveError: string | undefined;
    if (ssResponse.labelData) {
      if (drive.connected) {
        try {
          const fileName = `${prepared.poNumber}.pdf`;
          const uploaded = await uploadPdfToDrive(
            drive.creds,
            fileName,
            ssResponse.labelData,
            drive.folderId
          );
          label.driveFileId = uploaded.id;
          label.driveFileName = uploaded.name;
          label.driveFileLink = uploaded.webViewLink || undefined;
        } catch (e) {
          driveError = (e as Error).message;
        }
      } else {
        driveError = 'Google Drive is not connected. Configure it in Settings.';
      }
    }

    await label.save();

    return {
      labelId: label._id,
      poNumber: label.poNumber,
      orderNumber: label.orderNumber,
      status: 'created' as const,
      shipmentId: label.shipmentId,
      shipmentCost: label.shipmentCost,
      insuranceCost: label.insuranceCost,
      trackingNumber: label.trackingNumber,
      driveFileLink: label.driveFileLink,
      driveFileName: label.driveFileName,
      driveError,
    };
  } catch (e) {
    const message = (e as Error).message;
    label.orderId = prepared.orderId;
    label.status = 'failed';
    label.carrierCode = prepared.carrierCode;
    label.serviceCode = prepared.serviceCode;
    label.shipDate = prepared.shipDate;
    label.propertyType = prepared.propertyType;
    label.weight = prepared.weight;
    label.dimensions = prepared.dimensions;
    label.requestPayload = payload as unknown as Record<string, unknown>;
    label.error = message;
    await label.save();
    return {
      labelId: label._id,
      poNumber: label.poNumber,
      orderNumber: label.orderNumber,
      status: 'failed' as const,
      error: message,
    };
  }
}

function summarizeBatchStatus(
  labels: { status: string }[]
): 'created' | 'partial' | 'failed' {
  const created = labels.filter((l) => l.status === 'created').length;
  if (created === labels.length) return 'created';
  if (created === 0) return 'failed';
  return 'partial';
}

/**
 * Draft step — persists the imported PO#/Order# rows as a batch of "drafted"
 * labels for later review. No ShipStation calls are made here.
 */
export const draftBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows: InputRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const fileName: string | undefined =
      typeof req.body?.fileName === 'string' ? req.body.fileName : undefined;

    const cleaned = rows
      .map((r) => ({
        poNumber: (r.poNumber || '').trim(),
        orderNumber: (r.orderNumber || '').trim(),
      }))
      .filter((r) => r.poNumber || r.orderNumber);

    if (cleaned.length === 0) {
      res.status(400).json({ message: 'No rows provided. Import a CSV with PO# and Order# columns.' });
      return;
    }

    const userId = req.user?.id;
    const user = userId ? await User.findById(userId) : null;

    const batch = await LabelBatch.create({
      status: 'drafted',
      fileName,
      itemCount: cleaned.length,
      createdBy: user?.email,
      createdByUserId: userId,
    });

    // Resolve a reviewable shipping snapshot for each row (no ShipStation calls).
    const prepared = await Promise.all(cleaned.map(prepareRow));

    await Label.insertMany(
      prepared.map((p) => ({
        batchId: batch._id,
        poNumber: p.poNumber,
        orderNumber: p.orderNumber,
        status: 'drafted',
        found: p.found,
        orderId: p.orderId,
        customerName: p.customerName,
        qty: p.qty,
        skus: p.skus,
        shipFrom: p.shipFrom,
        shipTo: p.shipTo,
        propertyType: p.propertyType,
        carrierCode: p.carrierCode,
        serviceCode: p.serviceCode,
        packageCode: p.packageCode,
        shipDate: p.shipDate,
        weight: p.weight,
        dimensions: p.dimensions,
        insuranceProvider: p.insuranceProvider,
        error: p.found ? undefined : p.error,
        createdBy: user?.email,
        createdByUserId: userId,
      }))
    );

    res.status(201).json({ data: batch });
  } catch (error) {
    res.status(500).json({ message: 'Failed to draft batch', error: (error as Error).message });
  }
};

/** Lists label batches (newest first) with their resolved item counts. */
export const getBatches = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = '1', pageSize = '50' } = req.query as { page?: string; pageSize?: string };
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const allowedSizes = [50, 100, 200, 500];
    const size = allowedSizes.includes(parseInt(pageSize, 10)) ? parseInt(pageSize, 10) : 50;
    const skip = (pageNum - 1) * size;

    const [batches, total] = await Promise.all([
      LabelBatch.find().sort({ createdAt: -1 }).skip(skip).limit(size).lean(),
      LabelBatch.countDocuments(),
    ]);

    res.json({
      data: batches,
      pagination: { page: pageNum, pageSize: size, total, pages: Math.ceil(total / size) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch batches', error: (error as Error).message });
  }
};

/** Returns the labels (items) that belong to a single batch. */
export const getBatchItems = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid batch id' });
      return;
    }

    const batch = await LabelBatch.findById(id).lean();
    if (!batch) {
      res.status(404).json({ message: 'Batch not found' });
      return;
    }

    const items = await Label.find({ batchId: id }).sort({ createdAt: 1 }).lean();

    // Ensure the Ship From column reflects the current warehouse origin. Items
    // drafted before warehouse resolution (or unfound rows) may have an empty
    // or partial address — backfill those for display from the resolved
    // warehouse (a single, cached lookup).
    if (items.some((it) => !it.shipFrom?.street1)) {
      const { address } = await resolveShipFrom();
      items.forEach((it) => {
        if (!it.shipFrom?.street1) it.shipFrom = { ...address };
      });
    }

    res.json({ data: { batch, items } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch batch items', error: (error as Error).message });
  }
};

/**
 * Re-resolves shipping details for a batch's not-yet-created "Not found" items
 * by re-running the order lookup against the (now possibly synced) orders table.
 *
 * Use case: rows drafted before the ShipStation orders sync finished are tagged
 * "Not found". After syncing, the operator can refresh the batch to pull in the
 * newly available order details — no labels are created here. Only items that
 * haven't been purchased and aren't already resolved are touched, so created
 * labels keep the snapshot they were bought with.
 */
export const refreshBatchItems = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid batch id' });
      return;
    }

    const batch = await LabelBatch.findById(id);
    if (!batch) {
      res.status(404).json({ message: 'Batch not found' });
      return;
    }

    // Only re-check rows that are still unresolved and not yet purchased.
    const pending = await Label.find({
      batchId: id,
      status: { $ne: 'created' },
      found: { $ne: true },
    });

    let resolved = 0;

    await Promise.all(
      pending.map(async (label) => {
        const prepared = await prepareRow({
          poNumber: label.poNumber,
          orderNumber: label.orderNumber,
        });

        label.found = prepared.found;
        label.orderId = prepared.orderId;
        label.customerName = prepared.customerName;
        label.qty = prepared.qty;
        label.skus = prepared.skus;
        if (prepared.shipFrom) label.shipFrom = prepared.shipFrom;
        if (prepared.shipTo) label.shipTo = prepared.shipTo;
        label.propertyType = prepared.propertyType;
        label.carrierCode = prepared.carrierCode;
        label.serviceCode = prepared.serviceCode;
        label.packageCode = prepared.packageCode;
        label.shipDate = prepared.shipDate;
        label.weight = prepared.weight;
        label.dimensions = prepared.dimensions;
        label.insuranceProvider = prepared.insuranceProvider;
        label.error = prepared.found ? undefined : prepared.error;

        if (prepared.found) resolved += 1;
        await label.save();
      })
    );

    const [updatedBatch, items] = await Promise.all([
      LabelBatch.findById(id).lean(),
      Label.find({ batchId: id }).sort({ createdAt: 1 }).lean(),
    ]);

    res.json({
      data: { batch: updatedBatch, items, checked: pending.length, resolved },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to refresh batch items', error: (error as Error).message });
  }
};

interface PreflightItem {
  labelId: string;
  poNumber: string;
  orderNumber: string;
  customerName?: string;
  found: boolean;
  orderId?: number;
  // What the system will enforce on the order before buying the label.
  expectedWarehouseId?: number;
  expectedWarehouseName?: string;
  expectedInsuranceProvider: string;
  // What the live ShipStation order currently has (null when unreadable).
  liveWarehouseId?: number;
  liveWarehouseName?: string;
  liveInsuranceProvider?: string;
  liveInsuredValue?: number;
  // Whether the live order differs from the enforced values (will be corrected).
  willCorrectWarehouse: boolean;
  willCorrectInsurance: boolean;
  status: 'ok' | 'will_correct' | 'not_found' | 'error';
  error?: string;
}

interface PreflightSummary {
  total: number;
  creatable: number;
  notFound: number;
  willCorrect: number;
  errors: number;
  expectedWarehouseId?: number;
  expectedWarehouseName?: string;
  expectedShipFrom: ShipStationLabelAddress;
  expectedInsuranceProvider: string;
}

/**
 * Read-only preflight for the "Create + Print" confirmation modal. For every
 * pending (drafted/failed) item it resolves what the system *will enforce*
 * (Belleville Ship From + no insurance) and compares it against what the live
 * ShipStation order currently has, so the operator can confirm before any
 * billable label is bought. Makes no changes — purely informational.
 */
export const preflightBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid batch id' });
      return;
    }

    const batch = await LabelBatch.findById(id).lean();
    if (!batch) {
      res.status(404).json({ message: 'Batch not found' });
      return;
    }

    // Only items that "Create + Print" would actually process.
    const items = await Label.find({
      batchId: id,
      status: { $in: ['drafted', 'failed'] },
    })
      .sort({ createdAt: 1 })
      .lean();

    const expected = await resolveShipFrom();
    const expectedInsuranceProvider = NO_INSURANCE.provider;

    // id -> warehouseName map so we can label the live order's warehouse.
    let warehouseNames = new Map<number, string>();
    try {
      const warehouses = await listWarehouses();
      warehouseNames = new Map(
        warehouses.map((w) => [w.warehouseId, w.warehouseName || String(w.warehouseId)])
      );
    } catch {
      // Non-fatal — we just won't have friendly names for live warehouses.
    }

    const results: PreflightItem[] = [];
    for (const item of items) {
      const base: PreflightItem = {
        labelId: String(item._id),
        poNumber: item.poNumber,
        orderNumber: item.orderNumber,
        customerName: item.customerName,
        found: Boolean(item.found) && typeof item.orderId === 'number',
        orderId: item.orderId,
        expectedWarehouseId: expected.warehouseId,
        expectedWarehouseName: expected.warehouseName,
        expectedInsuranceProvider,
        willCorrectWarehouse: false,
        willCorrectInsurance: false,
        status: 'ok',
      };

      if (!base.found || typeof item.orderId !== 'number') {
        results.push({
          ...base,
          status: 'not_found',
          error: item.error || 'Order not found in the orders table.',
        });
        continue;
      }

      try {
        const order = await getShipStationOrder(item.orderId);
        const liveWarehouseId = order.advancedOptions?.warehouseId;
        const liveProvider = order.insuranceOptions?.provider ?? 'none';
        const liveInsured = Boolean(order.insuranceOptions?.insureShipment);
        const liveInsuredValue = order.insuranceOptions?.insuredValue;

        const willCorrectWarehouse =
          typeof expected.warehouseId === 'number' &&
          liveWarehouseId !== expected.warehouseId;
        const willCorrectInsurance =
          liveProvider !== expectedInsuranceProvider || liveInsured;

        results.push({
          ...base,
          liveWarehouseId,
          liveWarehouseName:
            typeof liveWarehouseId === 'number' ? warehouseNames.get(liveWarehouseId) : undefined,
          liveInsuranceProvider: liveProvider,
          liveInsuredValue,
          willCorrectWarehouse,
          willCorrectInsurance,
          status: willCorrectWarehouse || willCorrectInsurance ? 'will_correct' : 'ok',
        });
      } catch (e) {
        results.push({
          ...base,
          status: 'error',
          error: `Could not read live order: ${(e as Error).message}`,
        });
      }
    }

    const summary: PreflightSummary = {
      total: results.length,
      creatable: results.filter((r) => r.status === 'ok' || r.status === 'will_correct').length,
      notFound: results.filter((r) => r.status === 'not_found').length,
      willCorrect: results.filter((r) => r.status === 'will_correct').length,
      errors: results.filter((r) => r.status === 'error').length,
      expectedWarehouseId: expected.warehouseId,
      expectedWarehouseName: expected.warehouseName,
      expectedShipFrom: expected.address,
      expectedInsuranceProvider,
    };

    res.json({ data: { batch, summary, items: results } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to preflight batch', error: (error as Error).message });
  }
};

/**
 * Create + print step — creates the ShipStation labels for every not-yet-created
 * label in the batch, uploads each renamed PDF to Drive, and updates the batch
 * status to reflect the outcome.
 */
export const createBatchLabels = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid batch id' });
      return;
    }

    const batch = await LabelBatch.findById(id);
    if (!batch) {
      res.status(404).json({ message: 'Batch not found' });
      return;
    }

    const userId = req.user?.id;

    if (batch.createdByUserId && batch.createdByUserId !== userId) {
      res.status(403).json({ message: 'You can only create labels for batches you uploaded.' });
      return;
    }

    const { driveCreds, driveFolderId, driveConnected } = await resolveDriveContext(userId);
    const drive = { creds: driveCreds, folderId: driveFolderId, connected: driveConnected };

    // Process rows that have not been successfully created yet (drafted or failed).
    const pending = await Label.find({
      batchId: id,
      status: { $in: ['drafted', 'failed'] },
    }).select('+labelData');

    const results = [];
    for (const label of pending) {
      results.push(await createLabelForRecord(label, drive));
    }

    const allLabels = await Label.find({ batchId: id }).select('status').lean();
    batch.status = summarizeBatchStatus(allLabels);
    await batch.save();

    res.json({ data: { batch, results } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create labels', error: (error as Error).message });
  }
};

/**
 * Delete a batch and all its label items.
 * Only the user who created the batch is allowed to delete it.
 */
export const deleteBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid batch id' });
      return;
    }

    const batch = await LabelBatch.findById(id);
    if (!batch) {
      res.status(404).json({ message: 'Batch not found' });
      return;
    }

    if (batch.createdByUserId !== req.user?.id) {
      res.status(403).json({ message: 'You can only delete batches you created.' });
      return;
    }

    await Promise.all([
      Label.deleteMany({ batchId: id }),
      LabelBatch.findByIdAndDelete(id),
    ]);

    res.json({ data: { deleted: true } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete batch', error: (error as Error).message });
  }
};

/** Lists previously created labels (newest first), excluding the heavy base64 PDF. */
export const getLabels = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = '1', pageSize = '50' } = req.query as { page?: string; pageSize?: string };
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const allowedSizes = [50, 100, 200, 500];
    const size = allowedSizes.includes(parseInt(pageSize, 10)) ? parseInt(pageSize, 10) : 50;
    const skip = (pageNum - 1) * size;

    const [labels, total] = await Promise.all([
      Label.find().sort({ createdAt: -1 }).skip(skip).limit(size).lean(),
      Label.countDocuments(),
    ]);

    res.json({
      data: labels,
      pagination: { page: pageNum, pageSize: size, total, pages: Math.ceil(total / size) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch labels', error: (error as Error).message });
  }
};

/** Returns the raw base64 PDF for a single label (used for in-app download). */
export const getLabelPdf = async (req: Request, res: Response): Promise<void> => {
  try {
    const label = await Label.findById(req.params.id).select('+labelData');
    if (!label || !label.labelData) {
      res.status(404).json({ message: 'Label PDF not found' });
      return;
    }

    const pdf = Buffer.from(label.labelData, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${label.poNumber}.pdf"`);
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch label PDF', error: (error as Error).message });
  }
};

/** Strips characters that are unsafe in a zip entry / file name. */
function safePdfName(poNumber: string): string {
  const base = (poNumber || 'label').replace(/[\\/:*?"<>|]/g, '_').trim() || 'label';
  return `${base}.pdf`;
}

/**
 * Streams a single zip archive containing the PDFs of every created label in a
 * batch. Each entry is named after its PO# (PO#.pdf); duplicate PO#s get a
 * numeric suffix so no entry is overwritten.
 */
export const getBatchLabelsZip = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid batch id' });
      return;
    }

    const batch = await LabelBatch.findById(id).lean();
    if (!batch) {
      res.status(404).json({ message: 'Batch not found' });
      return;
    }

    const labels = await Label.find({ batchId: id, status: 'created' })
      .select('+labelData')
      .sort({ createdAt: 1 });

    const withPdf = labels.filter((l) => l.labelData);
    if (withPdf.length === 0) {
      // Created labels exist but none retained a stored PDF (e.g. older records
      // uploaded only to Drive). Surface a clear, actionable message.
      const createdCount = labels.length;
      const message = createdCount > 0
        ? 'No stored PDFs found for this batch. These labels were created before PDFs were retained for download — open them from the Drive links instead.'
        : 'No created labels in this batch yet.';
      res.status(404).json({ message });
      return;
    }

    // Build the whole archive in memory before responding. Shipping-label PDFs
    // are small, and buffering means any failure surfaces as a clean JSON error
    // instead of a half-written, aborted download.
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const built = new Promise<Buffer>((resolve, reject) => {
      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('warning', (err) => reject(err));
      archive.on('error', (err) => reject(err));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const usedNames = new Map<string, number>();
    for (const label of withPdf) {
      let name = safePdfName(label.poNumber);
      const seen = usedNames.get(name);
      if (seen != null) {
        usedNames.set(name, seen + 1);
        name = name.replace(/\.pdf$/i, `-${seen + 1}.pdf`);
      } else {
        usedNames.set(name, 0);
      }
      archive.append(Buffer.from(label.labelData as string, 'base64'), { name });
    }

    archive.finalize().catch(() => {
      /* error surfaces via the 'error' event handled by `built` */
    });
    const zipBuffer = await built;

    const shortId = `B-${String(batch._id).slice(-6).toUpperCase()}`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${shortId}-labels.zip"`);
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  } catch (error) {
    console.error('[Labels] Failed to export batch label PDFs:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to export label PDFs', error: (error as Error).message });
    } else {
      res.destroy();
    }
  }
};
