import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { HhB2bAuthError, HhB2bDraftError, resolveHhB2bCookie } from '../lib/hhB2bConfig';
import { parseBulkItemFile } from '../lib/bulkItemImport';
import {
  createThorogoodBulkDraft,
  describeThorogoodLineItems,
  fetchThorogoodProductImage,
  importThorogoodShipmentItems,
  previewThorogoodImportLines,
  isThorogoodImageResource,
  listThorogoodOrderItems,
  updateThorogoodBulkDraft,
  type ThorogoodBulkShipmentInput,
  type ThorogoodCatalogLine,
  type ThorogoodImportedLine,
  type ThorogoodImportLine,
  type ThorogoodLineItem,
} from '../lib/hhB2bThorogood';
import BulkOrder, { type IBulkOrder, type IBulkOrderLineItem, type IBulkOrderShipment } from '../models/BulkOrder';
import { getOrCreateBulkOrderConfig } from '../models/BulkOrderConfig';
import { effectiveThorogoodImportAffixes } from '../lib/hhThorogoodSku';

const MAX_NOTES = 500;
const LIST_LIMIT = 200;
const MAX_IMAGE_BYTES = 1_500_000;
const IMAGE_FETCH_CONCURRENCY = 4;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function serializeShipment(shipment: IBulkOrderShipment) {
  return {
    customerPo: shipment.customerPo,
    shipToCode: shipment.shipToCode,
    shipToLabel: shipment.shipToLabel,
    catalogCode: shipment.catalogCode,
    catalogName: shipment.catalogName,
    useDropShip: Boolean(shipment.useDropShip),
    dropShipName: shipment.dropShipName || '',
    dropShipAddress: shipment.dropShipAddress || '',
    dropShipPostalCode: shipment.dropShipPostalCode || '',
    requestedShipDate: shipment.requestedShipDate,
    notes: shipment.notes || '',
    items: storedItems(shipment),
  };
}

function storedItems(shipment: IBulkOrderShipment): ThorogoodLineItem[] {
  return (shipment.items ?? []).map((item) => ({ sku: item.sku, quantity: item.quantity }));
}

function plainItem(item: IBulkOrderLineItem): IBulkOrderLineItem {
  const candidate = item as unknown as { toObject?: () => IBulkOrderLineItem };
  const raw = typeof candidate.toObject === 'function' ? candidate.toObject() : item;
  const price = typeof raw.price === 'number' && Number.isFinite(raw.price) ? raw.price : null;
  return {
    sku: raw.sku,
    sellerSku: raw.sellerSku || '',
    quantity: raw.quantity,
    name: raw.name || '',
    price,
    currencyCode: raw.currencyCode || '',
    imageResource: raw.imageResource || '',
    imageContentType: raw.imageContentType || '',
    styleCode: raw.styleCode || '',
    size: raw.size || '',
    width: raw.width || '',
    imageData: raw.imageData,
  };
}

function imageBytes(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.length ? value : null;
  if (value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    return bytes.length ? bytes : null;
  }
  if (typeof value === 'object' && value && 'buffer' in value && Buffer.isBuffer((value as { buffer: unknown }).buffer)) {
    const bytes = (value as { buffer: Buffer }).buffer;
    return bytes.length ? bytes : null;
  }
  if (
    typeof value === 'object' &&
    value &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    const bytes = Buffer.from((value as { data: number[] }).data);
    return bytes.length ? bytes : null;
  }
  return null;
}

/** Bump when the stored catalog snapshot gains fields, so the next open refreshes once. */
const CATALOG_SNAPSHOT = 'v2';

/** Catalog, customer, ship-to, and ship date. A change means stored prices may no longer match Thorogood. */
function catalogContextKey(doc: IBulkOrder, shipment: IBulkOrderShipment): string {
  return [shipment.catalogCode, doc.soldToCode, shipment.shipToCode, shipment.requestedShipDate, CATALOG_SNAPSHOT]
    .map((part) => (part || '').trim())
    .join('|');
}

function catalogIsCurrent(doc: IBulkOrder, shipment: IBulkOrderShipment): boolean {
  if ((shipment.items ?? []).length === 0) return true;
  return (shipment.itemsCatalogKey || '') === catalogContextKey(doc, shipment);
}

function catalogLines(shipment: IBulkOrderShipment) {
  return (shipment.items ?? []).map((item) => {
    const stored = plainItem(item);
    const bytes = imageBytes(stored.imageData);
    const imageDataUrl =
      bytes && stored.imageContentType ? `data:${stored.imageContentType};base64,${bytes.toString('base64')}` : '';
    return {
      sku: stored.sku,
      sellerSku: stored.sellerSku || '',
      quantity: stored.quantity,
      name: stored.name,
      price: stored.price,
      currencyCode: stored.currencyCode,
      imageResource: stored.imageResource,
      imageDataUrl,
      styleCode: stored.styleCode,
      size: stored.size,
      width: stored.width,
    };
  });
}

function portalSkuKey(sku: string): string {
  return sku.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function joinSellerSku(current: string, next: string): string {
  const add = next.trim();
  if (!add) return current;
  if (!current) return add;
  const parts = current.split(', ');
  if (parts.some((part) => part.toUpperCase() === add.toUpperCase())) return current;
  return `${current}, ${add}`;
}

/** Portal sync rebuilds lines from Thorogood. Write the uploaded seller codes back on afterwards. */
function stampSellerSkus(shipment: IBulkOrderShipment | undefined, lines: ThorogoodImportedLine[]): void {
  if (!shipment) return;
  const byKey = new Map<string, string>();
  for (const line of lines) {
    const key = portalSkuKey(line.portalSku);
    if (!key) continue;
    byKey.set(key, joinSellerSku(byKey.get(key) ?? '', line.sellerSku));
  }
  for (const item of shipment.items ?? []) {
    item.sellerSku = byKey.get(portalSkuKey(item.sku)) ?? '';
  }
}

function sameLineItems(left: ThorogoodLineItem[], right: ThorogoodLineItem[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item.sku === right[index]?.sku && item.quantity === right[index]?.quantity);
}

function blankStoredItem(item: ThorogoodLineItem): IBulkOrderLineItem {
  return {
    sku: item.sku,
    sellerSku: '',
    quantity: item.quantity,
    name: '',
    price: null,
    currencyCode: '',
    imageResource: '',
    imageContentType: '',
    styleCode: '',
    size: '',
    width: '',
  };
}

/** Keep name, price, and image for SKUs that are still on the shipment. */
function mergeStoredItems(
  current: IBulkOrderLineItem[],
  next: ThorogoodLineItem[]
): { items: IBulkOrderLineItem[]; addedSku: boolean } {
  const prior = new Map(current.map((item) => [item.sku, plainItem(item)]));
  let addedSku = false;
  const items = next.map((item) => {
    const existing = prior.get(item.sku);
    if (!existing) {
      addedSku = true;
      return blankStoredItem(item);
    }
    return { ...existing, quantity: item.quantity };
  });
  return { items, addedSku };
}

/** Copy portal SKUs onto the document. Returns true when a shipment list changed. */
function applyPortalItems(doc: IBulkOrder, portalItems: ThorogoodLineItem[][]): boolean {
  let changed = false;
  const count = Math.min(doc.shipments.length, portalItems.length);
  for (let index = 0; index < count; index += 1) {
    const next = portalItems[index] ?? [];
    if (sameLineItems(storedItems(doc.shipments[index]), next)) continue;
    const merged = mergeStoredItems(doc.shipments[index].items ?? [], next);
    doc.shipments[index].items = merged.items;
    if (merged.addedSku) doc.shipments[index].itemsCatalogKey = '';
    changed = true;
  }
  for (let index = portalItems.length; index < doc.shipments.length; index += 1) {
    if (storedItems(doc.shipments[index]).length === 0) continue;
    doc.shipments[index].items = [];
    doc.shipments[index].itemsCatalogKey = '';
    changed = true;
  }
  if (changed) doc.markModified('shipments');
  return changed;
}

async function portalItemsFor(doc: IBulkOrder): Promise<ThorogoodLineItem[][] | null> {
  const config = await getOrCreateBulkOrderConfig(true);
  const resolved = await resolveHhB2bCookie('thorogood', config.cookie ?? '');
  if (!resolved.cookie) return null;
  return listThorogoodOrderItems(config.baseUrl, resolved.cookie, doc.portalOrderCode);
}

type ItemSync =
  | { status: 'synced' }
  | { status: 'missing-cookie' }
  | { status: 'failed'; message: string };

/** Read the Thorogood draft and store its SKUs when they differ. Cookie or portal failure leaves the document unchanged. */
async function syncStoredItems(doc: IBulkOrder): Promise<ItemSync> {
  try {
    const portalItems = await portalItemsFor(doc);
    if (!portalItems) return { status: 'missing-cookie' };
    if (applyPortalItems(doc, portalItems)) await doc.save();
    return { status: 'synced' };
  } catch (err) {
    const message = err instanceof HhB2bDraftError ? err.message : 'Could not load Thorogood items.';
    return { status: 'failed', message };
  }
}

async function loadImageCache(
  baseUrl: string,
  cookie: string,
  resources: string[]
): Promise<Map<string, { contentType: string; data: Buffer }>> {
  const cache = new Map<string, { contentType: string; data: Buffer }>();
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < resources.length) {
      const resource = resources[cursor];
      cursor += 1;
      try {
        const image = await fetchThorogoodProductImage(baseUrl, cookie, resource);
        if (image.body.length > MAX_IMAGE_BYTES) continue;
        cache.set(resource, { contentType: image.contentType, data: image.body });
      } catch (err) {
        if (err instanceof HhB2bAuthError) throw err;
      }
    }
  }
  const workers = Math.min(IMAGE_FETCH_CONCURRENCY, resources.length);
  if (workers > 0) await Promise.all(Array.from({ length: workers }, () => run()));
  return cache;
}

function snapshotItems(
  described: ThorogoodCatalogLine[],
  previous: IBulkOrderLineItem[],
  images: Map<string, { contentType: string; data: Buffer }>
): IBulkOrderLineItem[] {
  const prior = new Map(previous.map((item) => [item.sku, plainItem(item)]));
  return described.map((item) => {
    const existing = prior.get(item.sku);
    const resource = item.imageResource;
    const reused =
      resource && existing?.imageResource === resource ? imageBytes(existing.imageData) : null;
    const fetched = resource ? images.get(resource) : undefined;
    const bytes = reused ?? fetched?.data;
    const imageContentType = reused ? existing?.imageContentType || '' : fetched?.contentType || '';
    return {
      sku: item.sku,
      sellerSku: existing?.sellerSku || '',
      quantity: item.quantity,
      name: item.name,
      price: item.price,
      currencyCode: item.price == null ? '' : item.currencyCode,
      imageResource: resource,
      imageContentType: bytes ? imageContentType : '',
      styleCode: item.styleCode,
      size: item.size,
      width: item.width,
      ...(bytes ? { imageData: bytes } : {}),
    };
  });
}

/**
 * Load name, wholesale price, and thumbnail from Thorogood and store them on the shipment.
 * Skips the portal when this catalog context was already saved.
 */
async function persistCatalogDetails(doc: IBulkOrder, index: number): Promise<string | undefined> {
  const shipment = doc.shipments[index];
  if (!shipment || catalogIsCurrent(doc, shipment)) return undefined;
  const current = shipment.items ?? [];
  if (current.length === 0) return undefined;

  const config = await getOrCreateBulkOrderConfig(true);
  const resolved = await resolveHhB2bCookie('thorogood', config.cookie ?? '');
  if (!resolved.cookie) {
    const saved = current.some((item) => {
      const stored = plainItem(item);
      return stored.name || stored.price != null || stored.imageResource;
    });
    return saved
      ? 'Thorogood session cookie is missing. Showing the last product details saved on this order.'
      : 'Thorogood session cookie is missing. Product names, prices, and images are not saved on this order yet.';
  }

  try {
    const described = await describeThorogoodLineItems(
      config.baseUrl,
      resolved.cookie,
      {
        collectionCode: shipment.catalogCode,
        customerCode: doc.soldToCode,
        shipToCode: shipment.shipToCode,
        requestedShipDate: shipment.requestedShipDate,
      },
      storedItems(shipment)
    );
    const alreadyStored = new Set(
      current
        .map((item) => plainItem(item))
        .filter((item) => item.imageResource && imageBytes(item.imageData))
        .map((item) => item.imageResource)
    );
    const needed = [
      ...new Set(described.map((item) => item.imageResource).filter((resource) => resource && !alreadyStored.has(resource))),
    ];
    const images = await loadImageCache(config.baseUrl, resolved.cookie, needed);
    shipment.items = snapshotItems(described, current, images);
    shipment.itemsCatalogKey = catalogContextKey(doc, shipment);
    doc.markModified('shipments');
    await doc.save();
    return undefined;
  } catch (err) {
    if (err instanceof HhB2bAuthError) return err.message;
    return err instanceof HhB2bDraftError
      ? err.message
      : 'Product names, prices, and images could not be loaded from Thorogood.';
  }
}

function serializeOrder(doc: IBulkOrder) {
  return {
    id: doc.id as string,
    orderName: doc.orderName,
    status: 'draft' as const,
    soldToCode: doc.soldToCode,
    soldToLabel: doc.soldToLabel || doc.soldToCode,
    shipToCode: doc.shipToCode,
    shipToLabel: doc.shipToLabel || doc.shipToCode,
    portalOrderCode: doc.portalOrderCode,
    shipments: (doc.shipments ?? []).map(serializeShipment),
    createdAt: doc.createdAt.toISOString(),
    createdByName: doc.createdByName || '',
    createdByEmail: doc.createdByEmail || '',
    createdByAvatar: doc.createdByAvatar || '',
  };
}

export async function getBulkOrderProductImage(req: Request, res: Response): Promise<void> {
  const resource = req.params.resource;
  if (!isThorogoodImageResource(resource)) {
    res.status(400).json({ message: 'Invalid product image.' });
    return;
  }
  const config = await getOrCreateBulkOrderConfig(true);
  const resolved = await resolveHhB2bCookie('thorogood', config.cookie ?? '');
  if (!resolved.cookie) {
    res.status(400).json({ message: 'Thorogood session cookie is missing. Paste one on Configurations.' });
    return;
  }
  try {
    const image = await fetchThorogoodProductImage(config.baseUrl, resolved.cookie, resource);
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(image.body);
  } catch (err) {
    const message = err instanceof HhB2bDraftError ? err.message : 'Could not load the product image.';
    res.status(err instanceof HhB2bAuthError ? 400 : 404).json({ message });
  }
}

export async function listBulkOrders(_req: Request, res: Response): Promise<void> {
  const docs = await BulkOrder.find()
    .select('-shipments.items.imageData')
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT);
  res.json({ data: docs.map(serializeOrder) });
}

export async function getBulkOrder(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid order id.' });
    return;
  }
  const doc = await BulkOrder.findById(id).select('-shipments.items.imageData');
  if (!doc) {
    res.status(404).json({ message: 'Order not found.' });
    return;
  }
  res.json({ data: serializeOrder(doc) });
}

export async function getBulkOrderShipmentItems(req: Request, res: Response): Promise<void> {
  const { id, shipmentIndex } = req.params;
  if (!isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid order id.' });
    return;
  }
  const index = /^\d+$/.test(shipmentIndex) ? Number(shipmentIndex) : -1;
  const doc = await BulkOrder.findById(id);
  if (!doc || index < 0 || index >= doc.shipments.length) {
    res.status(404).json({ message: 'Shipment not found.' });
    return;
  }

  let message: string | undefined;
  if (!catalogIsCurrent(doc, doc.shipments[index])) {
    message = await persistCatalogDetails(doc, index);
  }
  res.json({
    data: {
      orderName: doc.orderName,
      shipmentIndex: index,
      shipment: serializeShipment(doc.shipments[index]),
      items: catalogLines(doc.shipments[index]),
      message,
    },
  });
}

async function findShipment(id: string, shipmentIndex: string): Promise<
  { doc: IBulkOrder; index: number } | { status: number; message: string }
> {
  if (!isValidObjectId(id)) return { status: 400, message: 'Invalid order id.' };
  const index = /^\d+$/.test(shipmentIndex) ? Number(shipmentIndex) : -1;
  const doc = await BulkOrder.findById(id);
  if (!doc || index < 0 || index >= doc.shipments.length) return { status: 404, message: 'Shipment not found.' };
  return { doc, index };
}

async function importSession(): Promise<
  | { baseUrl: string; cookie: string; affixes: { prefixes: string[]; suffixes: string[] } }
  | { message: string }
> {
  const config = await getOrCreateBulkOrderConfig(true);
  const resolved = await resolveHhB2bCookie('thorogood', config.cookie ?? '');
  if (!resolved.cookie) return { message: 'Thorogood session cookie is missing. Paste one on Configurations.' };
  return {
    baseUrl: config.baseUrl,
    cookie: resolved.cookie,
    affixes: effectiveThorogoodImportAffixes(
      config.skuPrefixes,
      config.skuPrefixesSet,
      config.skuSuffixes,
      config.skuSuffixesSet,
    ),
  };
}

function readCommitLines(value: unknown): ThorogoodImportLine[] | string {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) {
    return 'Choose the items to import.';
  }
  const rows = (value as { items: unknown[] }).items;
  if (rows.length === 0) return 'Choose at least one item to import.';
  if (rows.length > 200) return 'The file has too many SKUs (max 200).';
  const items: ThorogoodImportLine[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return 'Each item must include a B2B SKU and a quantity.';
    const record = row as Record<string, unknown>;
    const sellerSku = text(record.sellerSku);
    const portalSku = text(record.portalSku);
    const rawQty = record.quantity;
    const quantity = typeof rawQty === 'number' ? rawQty : Number(text(rawQty));
    if (!portalSku) return 'Each item needs a B2B SKU.';
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 99999) {
      return 'Each item needs a whole-number quantity.';
    }
    items.push({ sellerSku, portalSku, quantity });
  }
  return items;
}

function importErrorMessage(err: unknown, fallback: string): string {
  return err instanceof HhB2bDraftError ? err.message : fallback;
}

async function applyImportedLines(
  doc: IBulkOrder,
  index: number,
  imported: ThorogoodImportedLine[],
): Promise<{ warning?: string } | { error: string }> {
  const sync = await syncStoredItems(doc);
  if (sync.status !== 'synced') {
    const detail = sync.status === 'failed' ? sync.message : 'Thorogood session cookie is missing.';
    return { error: `Items were sent to Thorogood, but they could not be saved on the order. ${detail}` };
  }
  stampSellerSkus(doc.shipments[index], imported);
  doc.markModified('shipments');
  await doc.save();
  const warning = await persistCatalogDetails(doc, index);
  stampSellerSkus(doc.shipments[index], imported);
  doc.markModified('shipments');
  await doc.save();
  return { warning };
}

function sendImportedItems(res: Response, doc: IBulkOrder, index: number, warning?: string): void {
  res.json({
    data: {
      orderName: doc.orderName,
      shipmentIndex: index,
      shipment: serializeShipment(doc.shipments[index]),
      items: catalogLines(doc.shipments[index]),
      message: warning,
    },
  });
}

export async function previewBulkOrderShipmentItems(req: Request, res: Response): Promise<void> {
  const found = await findShipment(req.params.id, req.params.shipmentIndex);
  if ('status' in found) {
    res.status(found.status).json({ message: found.message });
    return;
  }
  const file = req.file;
  if (!file?.buffer?.length) {
    res.status(400).json({ message: 'Upload an .xlsx or .csv file.' });
    return;
  }
  const parsed = await parseBulkItemFile(file.buffer, file.originalname || '');
  if ('error' in parsed) {
    res.status(400).json({ message: parsed.error });
    return;
  }
  const session = await importSession();
  if ('message' in session) {
    res.status(400).json({ message: session.message });
    return;
  }
  try {
    const preview = await previewThorogoodImportLines(
      session.baseUrl,
      session.cookie,
      found.doc.portalOrderCode,
      found.index,
      parsed.items,
      found.doc.soldToCode,
      session.affixes,
    );
    res.json({ data: preview });
  } catch (err) {
    res.status(400).json({ message: importErrorMessage(err, 'Could not check the file against Thorogood.') });
  }
}

export async function checkBulkOrderShipmentItem(req: Request, res: Response): Promise<void> {
  const found = await findShipment(req.params.id, req.params.shipmentIndex);
  if ('status' in found) {
    res.status(found.status).json({ message: found.message });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const portalSku = text(body.portalSku);
  if (!portalSku) {
    res.status(400).json({ message: 'Enter a B2B SKU.' });
    return;
  }
  const session = await importSession();
  if ('message' in session) {
    res.status(400).json({ message: session.message });
    return;
  }
  try {
    const preview = await previewThorogoodImportLines(
      session.baseUrl,
      session.cookie,
      found.doc.portalOrderCode,
      found.index,
      [{ sellerSku: '', portalSku, quantity: 1 }],
      found.doc.soldToCode,
      session.affixes,
    );
    const issue = preview.issues[0];
    if (issue || !preview.ready[0]) {
      res.status(400).json({ message: issue?.message || 'Not found in the Thorogood catalog.', tried: issue?.tried ?? [] });
      return;
    }
    res.json({ data: { portalSku: preview.ready[0].portalSku } });
  } catch (err) {
    res.status(400).json({ message: importErrorMessage(err, 'Could not check that B2B SKU.') });
  }
}

export async function commitBulkOrderShipmentItems(req: Request, res: Response): Promise<void> {
  const found = await findShipment(req.params.id, req.params.shipmentIndex);
  if ('status' in found) {
    res.status(found.status).json({ message: found.message });
    return;
  }
  const lines = readCommitLines(req.body);
  if (typeof lines === 'string') {
    res.status(400).json({ message: lines });
    return;
  }
  const session = await importSession();
  if ('message' in session) {
    res.status(400).json({ message: session.message });
    return;
  }
  try {
    const imported = await importThorogoodShipmentItems(
      session.baseUrl,
      session.cookie,
      found.doc.portalOrderCode,
      found.index,
      lines,
      found.doc.soldToCode,
      session.affixes,
    );
    const applied = await applyImportedLines(found.doc, found.index, imported);
    if ('error' in applied) {
      res.status(400).json({ message: applied.error });
      return;
    }
    sendImportedItems(res, found.doc, found.index, applied.warning);
  } catch (err) {
    res.status(400).json({ message: importErrorMessage(err, 'Could not import items.') });
  }
}

export async function importBulkOrderShipmentItems(req: Request, res: Response): Promise<void> {
  const found = await findShipment(req.params.id, req.params.shipmentIndex);
  if ('status' in found) {
    res.status(found.status).json({ message: found.message });
    return;
  }
  const file = req.file;
  if (!file?.buffer?.length) {
    res.status(400).json({ message: 'Upload an .xlsx or .csv file.' });
    return;
  }
  const parsed = await parseBulkItemFile(file.buffer, file.originalname || '');
  if ('error' in parsed) {
    res.status(400).json({ message: parsed.error });
    return;
  }
  const session = await importSession();
  if ('message' in session) {
    res.status(400).json({ message: session.message });
    return;
  }

  try {
    const imported = await importThorogoodShipmentItems(
      session.baseUrl,
      session.cookie,
      found.doc.portalOrderCode,
      found.index,
      parsed.items,
      found.doc.soldToCode,
      session.affixes,
    );
    const applied = await applyImportedLines(found.doc, found.index, imported);
    if ('error' in applied) {
      res.status(400).json({ message: applied.error });
      return;
    }
    sendImportedItems(res, found.doc, found.index, applied.warning);
  } catch (err) {
    res.status(400).json({ message: importErrorMessage(err, 'Could not import items.') });
  }
}

export async function updateBulkOrder(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid order id.' });
    return;
  }
  const existing = await BulkOrder.findById(id);
  if (!existing) {
    res.status(404).json({ message: 'Order not found.' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const orderName = text(body.orderName);
  const soldToCode = text(body.soldToCode);
  const shipToCode = text(body.shipToCode);
  const parsed = readShipments(body.shipments);
  if (typeof parsed === 'string') {
    res.status(400).json({ message: parsed });
    return;
  }
  const notes = (Array.isArray(body.shipments) ? body.shipments : []).map((item) => {
    if (!item || typeof item !== 'object') return '';
    return text((item as Record<string, unknown>).notes);
  });

  const config = await getOrCreateBulkOrderConfig(true);
  const resolved = await resolveHhB2bCookie('thorogood', config.cookie ?? '');
  if (!resolved.cookie) {
    res.status(400).json({ message: 'Thorogood session cookie is missing. Paste one on Configurations.' });
    return;
  }

  let draft;
  try {
    draft = await updateThorogoodBulkDraft(config.baseUrl, resolved.cookie, existing.portalOrderCode, {
      orderName,
      soldToCode,
      shipToCode,
      shipments: parsed,
    });
  } catch (err) {
    const message = err instanceof HhB2bDraftError ? err.message : 'Could not update the Thorogood draft.';
    res.status(400).json({ message });
    return;
  }

  const previous = existing.shipments.map((shipment) => ({
    catalogCode: shipment.catalogCode,
    itemsCatalogKey: shipment.itemsCatalogKey || '',
    items: (shipment.items ?? []).map((item) => plainItem(item)),
  }));
  existing.orderName = orderName;
  existing.soldToCode = soldToCode;
  existing.soldToLabel = draft.soldToLabel;
  existing.shipToCode = draft.shipToCode;
  existing.shipToLabel = draft.shipToLabel;
  existing.shipments = draft.shipments.map((shipment, index) => {
    const source = parsed[index]?.sourceIndex ?? index;
    const prior = previous[source];
    const sameCatalog = prior?.catalogCode === shipment.catalogCode;
    return {
      ...shipment,
      notes: notes[index] ?? '',
      items: sameCatalog ? prior?.items ?? [] : [],
      itemsCatalogKey: sameCatalog ? prior?.itemsCatalogKey ?? '' : '',
    };
  });
  const sync = await syncStoredItems(existing);
  let warning = draft.warning || '';
  if (sync.status !== 'synced') {
    const detail = sync.status === 'failed' ? sync.message : 'Thorogood session cookie is missing.';
    warning = [warning, `The draft was updated, but its items were not copied from Thorogood. ${detail}`]
      .filter(Boolean)
      .join(' ');
  }
  const catalogWarnings: string[] = [];
  for (let index = 0; index < existing.shipments.length; index += 1) {
    const catalogWarning = await persistCatalogDetails(existing, index);
    if (catalogWarning && !catalogWarnings.includes(catalogWarning)) catalogWarnings.push(catalogWarning);
  }
  if (catalogWarnings.length) {
    warning = [warning, ...catalogWarnings].filter(Boolean).join(' ');
  }
  try {
    await existing.save();
    res.json({ data: serializeOrder(existing), warning: warning || undefined });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save the order.';
    res.status(500).json({
      message: `Thorogood draft ${draft.portalOrderCode} was updated, but the Orders row was not saved. ${message}`,
    });
  }
}

export async function deleteBulkOrder(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid order id.' });
    return;
  }
  const doc = await BulkOrder.findById(id);
  if (!doc) {
    res.status(404).json({ message: 'Order not found.' });
    return;
  }
  await doc.deleteOne();
  res.json({ data: { deleted: true } });
}

function readShipments(value: unknown): ThorogoodBulkShipmentInput[] | string {
  if (!Array.isArray(value) || value.length === 0) return 'Add at least one shipment.';
  const shipments: ThorogoodBulkShipmentInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return 'Each shipment must be an object.';
    const row = item as Record<string, unknown>;
    const notes = text(row.notes);
    if (notes.length > MAX_NOTES) return `Notes cannot be longer than ${MAX_NOTES} characters.`;
    const drop = row.dropShip && typeof row.dropShip === 'object' ? (row.dropShip as Record<string, unknown>) : null;
    const rawSource = row.sourceIndex;
    const sourceIndex =
      typeof rawSource === 'number' && Number.isInteger(rawSource) && rawSource >= 0 ? rawSource : undefined;
    shipments.push({
      customerPo: text(row.customerPo),
      shipToCode: text(row.shipToCode),
      catalogName: text(row.catalogName),
      catalogCode: text(row.catalogCode),
      useDropShip: row.useDropShip !== false,
      dropShip: drop
        ? { name: text(drop.name), address: text(drop.address), postalCode: text(drop.postalCode) }
        : undefined,
      requestedShipDate: text(row.requestedShipDate),
      sourceIndex,
    });
  }
  return shipments;
}

export async function createBulkOrder(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const orderName = text(body.orderName);
  const soldToCode = text(body.soldToCode);
  const shipToCode = text(body.shipToCode);
  const parsed = readShipments(body.shipments);
  if (typeof parsed === 'string') {
    res.status(400).json({ message: parsed });
    return;
  }
  const notes = (Array.isArray(body.shipments) ? body.shipments : []).map((item) => {
    if (!item || typeof item !== 'object') return '';
    return text((item as Record<string, unknown>).notes);
  });

  const doc = await getOrCreateBulkOrderConfig(true);
  const resolved = await resolveHhB2bCookie('thorogood', doc.cookie ?? '');
  if (!resolved.cookie) {
    res.status(400).json({ message: 'Thorogood session cookie is missing. Paste one on Configurations.' });
    return;
  }

  let draft;
  try {
    draft = await createThorogoodBulkDraft(doc.baseUrl, resolved.cookie, {
      orderName,
      soldToCode,
      shipToCode,
      shipments: parsed,
    });
  } catch (err) {
    const message = err instanceof HhB2bDraftError ? err.message : 'Could not create the Thorogood draft.';
    res.status(400).json({ message });
    return;
  }

  try {
    const saved = await BulkOrder.create({
      orderName,
      status: 'draft',
      soldToCode,
      soldToLabel: draft.soldToLabel,
      shipToCode: draft.shipToCode,
      shipToLabel: draft.shipToLabel,
      portalOrderCode: draft.portalOrderCode,
      shipments: draft.shipments.map((shipment, index) => ({
        ...shipment,
        notes: notes[index] ?? '',
        items: [],
      })),
      createdByName: user.name || '',
      createdByEmail: user.email || '',
      createdByAvatar: user.avatar || '',
    });
    res.status(201).json({ data: serializeOrder(saved), warning: draft.warning || undefined });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save the order.';
    res.status(500).json({
      message: `Thorogood draft ${draft.portalOrderCode} was created, but the Orders row was not saved. ${message}`,
    });
  }
}
