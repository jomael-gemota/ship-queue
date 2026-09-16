import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import HHOrderGroup, {
  HH_DEFAULT_CART_STATUS,
  HH_DEFAULT_DETAILS_STATUS,
  IHHChildOrder,
  IHHLineItem,
  IHHOrderGroup,
  HHCartStatus,
  HHDetailsStatus,
  isCartStatus,
  isDetailsStatus,
  mapLegacyHhStatus,
  rollupHhCartStatus,
  rollupHhDetailsStatus,
} from '../models/HHOrderGroup';
import { parseHhImportCsv, parseHhImportText } from '../lib/hhImport';
import { parseHhImportXlsx } from '../lib/hhImportXlsx';
import { countUnsyncedHhOrders, enqueueHhGroupScSync, getHhScSyncRuntime } from '../services/hhScSync';

export interface HHLineItemDto {
  id: string;
  title: string;
  sku: string;
  asin: string;
  imageUrl: string;
  quantity: number;
  unitPrice: number;
  tax: number;
}

export interface HHChildOrderDto {
  id: string;
  orderId: string;
  po: string;
  referenceNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  notes: string;
  detailsStatus: HHDetailsStatus;
  cartStatus: HHCartStatus;
  items: HHLineItemDto[];
}

export interface HHImportMeta {
  orderCount: number;
  duplicateRowsSkipped: number;
  incompleteRowsSkipped: number;
}

export interface HHOrderGroupDto {
  id: string;
  createdAt: string;
  createdByName: string;
  createdByEmail: string;
  notes: string;
  sourceFileName: string;
  detailsStatus: HHDetailsStatus;
  cartStatus: HHCartStatus;
  children: HHChildOrderDto[];
}

function asString(value: unknown, max = 500): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseSplitStatus(body: Record<string, unknown>): { detailsStatus: HHDetailsStatus; cartStatus: HHCartStatus } | string {
  if (body.detailsStatus != null && !isDetailsStatus(body.detailsStatus)) {
    return 'detailsStatus must be pending, synced, or failed';
  }
  if (body.cartStatus != null && !isCartStatus(body.cartStatus)) {
    return 'cartStatus must be none, draft, ready, review, or placed';
  }
  if (isDetailsStatus(body.detailsStatus) || isCartStatus(body.cartStatus)) {
    return {
      detailsStatus: isDetailsStatus(body.detailsStatus) ? body.detailsStatus : HH_DEFAULT_DETAILS_STATUS,
      cartStatus: isCartStatus(body.cartStatus) ? body.cartStatus : HH_DEFAULT_CART_STATUS,
    };
  }
  if (body.status != null) {
    if (typeof body.status !== 'string') return 'status must be a string';
    return mapLegacyHhStatus(body.status);
  }
  return {
    detailsStatus: HH_DEFAULT_DETAILS_STATUS,
    cartStatus: HH_DEFAULT_CART_STATUS,
  };
}

function serializeItem(item: IHHLineItem): HHLineItemDto {
  return {
    id: String(item._id),
    title: item.title,
    sku: item.sku,
    asin: item.asin ?? '',
    imageUrl: item.imageUrl ?? '',
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    tax: item.tax ?? 0,
  };
}

function serializeOrder(order: IHHChildOrder): HHChildOrderDto {
  return {
    id: String(order._id),
    orderId: order.orderId,
    po: order.po,
    referenceNumber: order.referenceNumber ?? '',
    customerName: order.customerName,
    customerEmail: order.customerEmail ?? '',
    customerPhone: order.customerPhone ?? '',
    addressLine1: order.addressLine1 ?? '',
    addressLine2: order.addressLine2 ?? '',
    city: order.city ?? '',
    state: order.state ?? '',
    postalCode: order.postalCode ?? '',
    country: order.country ?? '',
    notes: order.notes ?? '',
    detailsStatus: isDetailsStatus(order.detailsStatus)
      ? order.detailsStatus
      : mapLegacyHhStatus((order as { status?: string }).status).detailsStatus,
    cartStatus: isCartStatus(order.cartStatus)
      ? order.cartStatus
      : mapLegacyHhStatus((order as { status?: string }).status).cartStatus,
    items: (order.items ?? []).map(serializeItem),
  };
}

function serializeGroup(
  group: Pick<
    IHHOrderGroup,
    '_id' | 'createdAt' | 'createdByName' | 'createdByEmail' | 'notes' | 'sourceFileName' | 'detailsStatus' | 'cartStatus' | 'children'
  >
): HHOrderGroupDto {
  return {
    id: String(group._id),
    createdAt: group.createdAt instanceof Date ? group.createdAt.toISOString() : String(group.createdAt),
    createdByName: group.createdByName,
    createdByEmail: group.createdByEmail,
    notes: group.notes ?? '',
    sourceFileName: group.sourceFileName ?? '',
    detailsStatus: isDetailsStatus(group.detailsStatus)
      ? group.detailsStatus
      : mapLegacyHhStatus((group as { status?: string }).status).detailsStatus,
    cartStatus: isCartStatus(group.cartStatus)
      ? group.cartStatus
      : mapLegacyHhStatus((group as { status?: string }).status).cartStatus,
    children: (group.children ?? []).map(serializeOrder),
  };
}

function emptyImportedOrder(orderId: string, po: string) {
  return {
    orderId,
    po,
    referenceNumber: '',
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'US',
    notes: '',
    detailsStatus: HH_DEFAULT_DETAILS_STATUS,
    cartStatus: HH_DEFAULT_CART_STATUS,
    items: [],
  };
}

function importFileKind(originalName: string): 'xlsx' | 'csv' | null {
  const name = originalName.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return 'xlsx';
  if (name.endsWith('.csv')) return 'csv';
  return null;
}

interface ParsedLineItem {
  title: string;
  sku: string;
  asin: string;
  imageUrl: string;
  quantity: number;
  unitPrice: number;
  tax: number;
}

interface ParsedChildOrder {
  orderId: string;
  po: string;
  referenceNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  notes: string;
  detailsStatus: HHDetailsStatus;
  cartStatus: HHCartStatus;
  items: ParsedLineItem[];
}

function parseLineItem(raw: unknown, path: string): ParsedLineItem | string {
  if (raw == null || typeof raw !== 'object') return `${path} must be an object`;
  const body = raw as Record<string, unknown>;
  const title = asString(body.title, 500);
  const sku = asString(body.sku, 120);
  const quantity = asNumber(body.quantity);
  const unitPrice = asNumber(body.unitPrice);
  if (!title) return `${path}.title is required`;
  if (!sku) return `${path}.sku is required`;
  if (quantity == null || quantity < 0) return `${path}.quantity must be a number ≥ 0`;
  if (unitPrice == null || unitPrice < 0) return `${path}.unitPrice must be a number ≥ 0`;
  const tax = asNumber(body.tax);
  if (tax != null && tax < 0) return `${path}.tax must be a number ≥ 0`;
  return {
    title,
    sku,
    asin: asString(body.asin, 40),
    imageUrl: asString(body.imageUrl, 500),
    quantity,
    unitPrice,
    tax: tax ?? 0,
  };
}

function parseChildOrder(raw: unknown, path: string): ParsedChildOrder | string {
  if (raw == null || typeof raw !== 'object') return `${path} must be an object`;
  const body = raw as Record<string, unknown>;
  const orderId = asString(body.orderId, 80);
  const po = asString(body.po, 80);
  const referenceNumber =
    typeof body.referenceNumber === 'number' && Number.isFinite(body.referenceNumber)
      ? String(Math.trunc(body.referenceNumber))
      : asString(body.referenceNumber, 6);
  const customerName = asString(body.customerName, 200);
  if (!orderId) return `${path}.orderId is required`;
  if (!po) return `${path}.po is required`;
  if (referenceNumber && !/^\d{6}$/.test(referenceNumber)) {
    return `${path}.referenceNumber must be a 6-digit number`;
  }
  const split = parseSplitStatus(body);
  if (typeof split === 'string') return `${path}.${split}`;

  const rawItems = body.items;
  if (rawItems != null && !Array.isArray(rawItems)) return `${path}.items must be an array`;
  const items: ParsedLineItem[] = [];
  for (let i = 0; i < (rawItems ?? []).length; i += 1) {
    const parsed = parseLineItem((rawItems as unknown[])[i], `${path}.items[${i}]`);
    if (typeof parsed === 'string') return parsed;
    items.push(parsed);
  }

  return {
    orderId,
    po,
    referenceNumber,
    customerName,
    customerEmail: asString(body.customerEmail, 200),
    customerPhone: asString(body.customerPhone, 80),
    addressLine1: asString(body.addressLine1, 200),
    addressLine2: asString(body.addressLine2, 200),
    city: asString(body.city, 80),
    state: asString(body.state, 40),
    postalCode: asString(body.postalCode, 20),
    country: asString(body.country, 8) || 'US',
    notes: asString(body.notes, 4000),
    detailsStatus: split.detailsStatus,
    cartStatus: split.cartStatus,
    items,
  };
}

function parseChildren(raw: unknown): ParsedChildOrder[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return 'children must be an array';
  const children: ParsedChildOrder[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const parsed = parseChildOrder(raw[i], `children[${i}]`);
    if (typeof parsed === 'string') return parsed;
    children.push(parsed);
  }
  return children;
}

export const getScSyncStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    const pendingUnsynced = await countUnsyncedHhOrders();
    res.json({
      data: {
        ...getHhScSyncRuntime(),
        pendingUnsynced,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch HH Sportswear sync status', error: (error as Error).message });
  }
};

function markChildrenPending(group: IHHOrderGroup, childId?: string): void {
  const targets = childId
    ? group.children.filter((child) => String(child._id) === childId)
    : [...group.children];
  for (const child of targets) {
    child.detailsStatus = HH_DEFAULT_DETAILS_STATUS;
  }
  group.detailsStatus = rollupHhDetailsStatus(group.children.map((child) => child.detailsStatus));
  group.cartStatus = rollupHhCartStatus(group.children.map((child) => child.cartStatus));
  group.markModified('children');
}

export const rerunGroupScSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId);
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }
    if (group.children.length === 0) {
      res.status(400).json({ message: 'This batch has no orders to re-sync.' });
      return;
    }

    markChildrenPending(group);
    await group.save();
    enqueueHhGroupScSync(String(group._id));
    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to re-sync HH Sportswear group', error: (error as Error).message });
  }
};

export const rerunOrderScSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, orderId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }
    if (!isValidObjectId(orderId)) {
      res.status(400).json({ message: 'Invalid order id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId);
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const order = group.children.id(orderId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    markChildrenPending(group, String(order._id));
    await group.save();
    enqueueHhGroupScSync(String(group._id), String(order._id));
    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to re-sync HH Sportswear order', error: (error as Error).message });
  }
};

export const listGroups = async (_req: Request, res: Response): Promise<void> => {
  try {
    const groups = await HHOrderGroup.find().sort({ createdAt: -1 }).lean();
    queueMissingImageBackfill(groups);
    res.json({ data: groups.map(serializeGroup) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch HH Sportswear groups', error: (error as Error).message });
  }
};

let queuedImageBackfill = false;

function queueMissingImageBackfill(
  groups: Array<{
    _id: unknown;
    children?: Array<{ detailsStatus?: string; items?: Array<{ imageUrl?: string; tax?: number }> }>;
  }>
): void {
  if (queuedImageBackfill) return;
  queuedImageBackfill = true;
  for (const group of groups) {
    const needsImages = (group.children ?? []).some(
      (child) =>
        child.detailsStatus === 'synced' &&
        (child.items ?? []).some((item) => item.imageUrl == null || typeof item.tax !== 'number')
    );
    if (needsImages) enqueueHhGroupScSync(String(group._id));
  }
}

export const getGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId).lean();
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch HH Sportswear group', error: (error as Error).message });
  }
};

export const createGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const split = parseSplitStatus(body);
    if (typeof split === 'string') {
      res.status(400).json({ message: split });
      return;
    }

    const children = parseChildren(body.children);
    if (typeof children === 'string') {
      res.status(400).json({ message: children });
      return;
    }

    const group = await HHOrderGroup.create({
      notes: asString(body.notes, 4000),
      detailsStatus: split.detailsStatus,
      cartStatus: split.cartStatus,
      createdByName: req.user.name,
      createdByEmail: req.user.email,
      createdByUserId: req.user.id,
      children,
    });

    res.status(201).json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create HH Sportswear group', error: (error as Error).message });
  }
};

export const updateGroupNotes = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.notes !== 'string') {
      res.status(400).json({ message: 'notes must be a string' });
      return;
    }

    const group = await HHOrderGroup.findByIdAndUpdate(
      groupId,
      { notes: asString(body.notes, 4000) },
      { new: true }
    );
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update HH Sportswear notes', error: (error as Error).message });
  }
};

export const updateOrderNotes = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, orderId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }
    if (!isValidObjectId(orderId)) {
      res.status(400).json({ message: 'Invalid order id' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.notes !== 'string') {
      res.status(400).json({ message: 'notes must be a string' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId);
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const order = group.children.id(orderId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    order.notes = asString(body.notes, 4000);
    group.markModified('children');
    await group.save();

    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update HH Sportswear order notes', error: (error as Error).message });
  }
};

export const deleteGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findByIdAndDelete(groupId);
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    res.json({ data: { deleted: true } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete HH Sportswear group', error: (error as Error).message });
  }
};

export const deleteOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, orderId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }
    if (!isValidObjectId(orderId)) {
      res.status(400).json({ message: 'Invalid order id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId);
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const order = group.children.id(orderId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    order.deleteOne();
    group.detailsStatus = rollupHhDetailsStatus(group.children.map((child) => child.detailsStatus));
    group.cartStatus = rollupHhCartStatus(group.children.map((child) => child.cartStatus));
    await group.save();

    res.json({ data: { deleted: true } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete HH Sportswear order', error: (error as Error).message });
  }
};

export const importGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const file = req.file;
    const pasted = typeof req.body?.text === 'string' ? req.body.text : '';
    const usingPaste = !file?.buffer?.length && pasted.trim().length > 0;

    if (!file?.buffer?.length && !usingPaste) {
      res.status(400).json({ message: 'Upload a file or paste Order ID and PO Number rows.' });
      return;
    }

    let parsed;
    let sourceFileName: string;

    if (usingPaste) {
      parsed = parseHhImportText(pasted);
      sourceFileName = 'Pasted orders';
    } else {
      const kind = importFileKind(file!.originalname);
      if (!kind) {
        res.status(400).json({ message: 'Upload an .xlsx or .csv file.' });
        return;
      }
      parsed =
        kind === 'csv' ? parseHhImportCsv(file!.buffer.toString('utf8')) : await parseHhImportXlsx(file!.buffer);
      sourceFileName = asString(file!.originalname, 255);
    }
    if ('error' in parsed) {
      res.status(400).json({ message: parsed.error });
      return;
    }

    const group = await HHOrderGroup.create({
      notes: '',
      sourceFileName,
      detailsStatus: HH_DEFAULT_DETAILS_STATUS,
      cartStatus: HH_DEFAULT_CART_STATUS,
      createdByName: req.user.name,
      createdByEmail: req.user.email,
      createdByUserId: req.user.id,
      children: parsed.orders.map((row) => emptyImportedOrder(row.orderId, row.po)),
    });

    const meta: HHImportMeta = {
      orderCount: parsed.orders.length,
      duplicateRowsSkipped: parsed.duplicateRowsSkipped,
      incompleteRowsSkipped: parsed.incompleteRowsSkipped,
    };

    res.status(201).json({ data: serializeGroup(group), meta });
    enqueueHhGroupScSync(String(group._id));
  } catch (error) {
    res.status(500).json({ message: 'Failed to import HH Sportswear group', error: (error as Error).message });
  }
};
