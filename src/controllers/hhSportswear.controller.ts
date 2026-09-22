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
  isHhPlaced,
  mapLegacyHhStatus,
  rollupHhCartStatus,
  rollupHhDetailsStatus,
} from '../models/HHOrderGroup';
import { parseHhImportCsv, parseHhImportText } from '../lib/hhImport';
import { parseHhImportXlsx } from '../lib/hhImportXlsx';
import { countUnsyncedHhOrders, enqueueHhGroupScSync, getHhScSyncRuntime } from '../services/hhScSync';
import { countUndraftedHhOrders, enqueueHhCartDraft, getHhCartDraftRuntime } from '../services/hhCartDraft';
import {
  childCanPlace,
  childCanVerify,
  clearHhCartVerification,
  enqueueHhCartVerify,
  getHhCartVerifyQueued,
  invalidateHhCartVerification,
  liveCompareHhCarts,
} from '../services/hhCartVerify';
import { enqueueHhCartPlace, getHhCartPlaceRuntime } from '../services/hhCartPlace';
import { getOrCreateHhB2bConfig } from '../models/HHB2bConfig';
import { HhB2bAuthError, loadHhB2bCookie } from '../lib/hhB2bConfig';
import { hhBrand, hhBrandFromRequest, hhBrandId, type HHBrandId } from '../lib/hhBrand';
import { buildHhBatchExportXlsx, hhExportFileName } from '../lib/hhExportXlsx';
import { hhCartItems } from '../lib/hhLineItems';
import { withHhGroupLock } from '../lib/hhGroupLock';

export interface HHLineItemDto {
  id: string;
  title: string;
  sku: string;
  asin: string;
  imageUrl: string;
  quantity: number;
  unitPrice: number;
  tax: number;
  excluded: boolean;
  excludeNote: string;
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
  placeError: string;
  cartError: string;
  verifyIssues: Array<{ field: string; label: string; expected: string; actual: string }>;
  verifyRows: Array<{ field: string; label: string; expected: string; actual: string; match: boolean }>;
  verifiedAt: string | null;
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
    excluded: Boolean(item.excluded),
    excludeNote: item.excludeNote ?? '',
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
    placeError: order.placeError ?? '',
    cartError: order.cartError ?? '',
    verifyIssues: (order.verifyIssues ?? []).map((issue) => ({
      field: issue.field ?? '',
      label: issue.label ?? '',
      expected: issue.expected ?? '',
      actual: issue.actual ?? '',
    })),
    verifyRows: (order.verifyRows ?? []).map((row) => ({
      field: row.field ?? '',
      label: row.label ?? '',
      expected: row.expected ?? '',
      actual: row.actual ?? '',
      match: Boolean(row.matched),
    })),
    verifiedAt: order.verifiedAt instanceof Date ? order.verifiedAt.toISOString() : order.verifiedAt ? String(order.verifiedAt) : null,
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
    b2bDraftId: '',
    cartError: '',
    placeError: '',
    verifyIssues: [],
    verifyRows: [],
    verifiedAt: null,
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

function requestBrand(req: Request): HHBrandId {
  return hhBrandFromRequest(req);
}

function isBrandGroup(group: { brand?: string } | null | undefined, req: Request): group is NonNullable<typeof group> {
  return Boolean(group) && hhBrandId(group?.brand) === requestBrand(req);
}

export const getScSyncStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const brand = requestBrand(req);
    const [pendingUnsynced, pendingUndrafted, config] = await Promise.all([
      countUnsyncedHhOrders(brand),
      countUndraftedHhOrders(brand),
      getOrCreateHhB2bConfig(brand, false),
    ]);
    const place = getHhCartPlaceRuntime();
    res.json({
      data: {
        ...getHhScSyncRuntime(),
        pendingUnsynced,
        placeOrderEnabled: Boolean(config.placeOrderEnabled),
        cart: {
          ...getHhCartDraftRuntime(),
          pendingUndrafted,
          verifying: getHhCartVerifyQueued() > 0,
          placing: place.running || place.queued > 0,
          placeCurrentOrderId: place.currentOrderId,
          placeQueued: place.queued,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch HH Sportswear sync status', error: (error as Error).message });
  }
};

function resetCartForResync(child: IHHChildOrder): void {
  if (child.cartStatus === 'placed') return;
  child.cartStatus = HH_DEFAULT_CART_STATUS;
  child.b2bDraftId = '';
  child.referenceNumber = '';
  child.placeError = '';
  child.cartError = '';
  clearHhCartVerification(child);
}

function canRedraftCart(child: IHHChildOrder): boolean {
  if (child.cartStatus === 'placed') return false;
  if (child.detailsStatus !== 'synced') return false;
  return hhCartItems(child.items).length > 0;
}

function redraftBlockedMessage(child: IHHChildOrder): string {
  if ((child.items ?? []).length > 0 && hhCartItems(child.items).length === 0) {
    return 'Every line is excluded. Include at least one item before drafting.';
  }
  return 'This order is not ready to draft. Details must be Synced with line items, and Cart cannot be Placed.';
}

function prepareCartRedraft(group: IHHOrderGroup, childId?: string): number {
  const targets = childId
    ? group.children.filter((child) => String(child._id) === childId)
    : [...group.children];
  let prepared = 0;
  for (const child of targets) {
    if (!canRedraftCart(child)) continue;
    child.cartStatus = HH_DEFAULT_CART_STATUS;
    child.b2bDraftId = '';
    child.referenceNumber = '';
    child.placeError = '';
    child.cartError = '';
    clearHhCartVerification(child);
    prepared += 1;
  }
  group.detailsStatus = rollupHhDetailsStatus(group.children.map((child) => child.detailsStatus));
  group.cartStatus = rollupHhCartStatus(group.children.map((child) => child.cartStatus));
  group.markModified('children');
  return prepared;
}

function markChildrenPending(group: IHHOrderGroup, childId?: string, options?: { resetCart?: boolean }): number {
  const resetCart = options?.resetCart !== false;
  const targets = childId
    ? group.children.filter((child) => String(child._id) === childId)
    : [...group.children];
  let marked = 0;
  for (const child of targets) {
    if (isHhPlaced(child)) continue;
    child.detailsStatus = HH_DEFAULT_DETAILS_STATUS;
    if (resetCart) resetCartForResync(child);
    else invalidateHhCartVerification(child);
    marked += 1;
  }
  group.detailsStatus = rollupHhDetailsStatus(group.children.map((child) => child.detailsStatus));
  group.cartStatus = rollupHhCartStatus(group.children.map((child) => child.cartStatus));
  group.markModified('children');
  return marked;
}

export const rerunGroupScSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId);
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }
    if (group.children.length === 0) {
      res.status(400).json({ message: 'This batch has no orders to re-sync.' });
      return;
    }
    if (group.children.every(isHhPlaced)) {
      res.status(409).json({ message: 'Placed orders cannot be re-synced.' });
      return;
    }

    const draftCart = parseBoolFlag(req.body?.draftCart, true);
    markChildrenPending(group, undefined, { resetCart: draftCart });
    await group.save();
    enqueueHhGroupScSync(String(group._id), undefined, { autoDraft: draftCart });
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
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const order = group.children.id(orderId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }
    if (isHhPlaced(order)) {
      res.status(409).json({ message: 'Placed orders cannot be re-synced.' });
      return;
    }

    const draftCart = parseBoolFlag(req.body?.draftCart, true);
    markChildrenPending(group, String(order._id), { resetCart: draftCart });
    await group.save();
    enqueueHhGroupScSync(String(group._id), String(order._id), { autoDraft: draftCart });
    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to re-sync HH Sportswear order', error: (error as Error).message });
  }
};

export const rerunGroupCartDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId);
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    if (group.children.length > 0 && group.children.every(isHhPlaced)) {
      res.status(409).json({ message: 'Placed orders cannot have their cart regenerated.' });
      return;
    }

    const prepared = prepareCartRedraft(group);
    if (prepared === 0) {
      res.status(400).json({
        message: 'No orders are ready to draft. Details must be Synced with line items, and Cart cannot be Placed.',
      });
      return;
    }

    await group.save();
    enqueueHhCartDraft(String(group._id));
    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to regenerate HH Sportswear cart drafts', error: (error as Error).message });
  }
};

export const rerunOrderCartDraft = async (req: Request, res: Response): Promise<void> => {
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
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const order = group.children.id(orderId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }
    if (isHhPlaced(order)) {
      res.status(409).json({ message: 'Placed orders cannot have their cart regenerated.' });
      return;
    }
    if (!canRedraftCart(order)) {
      res.status(400).json({
        message: redraftBlockedMessage(order),
      });
      return;
    }

    prepareCartRedraft(group, String(order._id));
    await group.save();
    enqueueHhCartDraft(String(group._id), String(order._id));
    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to regenerate HH Sportswear cart draft', error: (error as Error).message });
  }
};

export const rerunGroupCartVerify = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId);
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }
    if (!group.children.some(childCanVerify)) {
      res.status(400).json({
        message: 'No B2B drafts to check. Cart must be Draft, Ready, or Review with a live Helly Hansen document.',
      });
      return;
    }

    enqueueHhCartVerify(String(group._id));
    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to re-check HH Sportswear carts', error: (error as Error).message });
  }
};

export const rerunOrderCartVerify = async (req: Request, res: Response): Promise<void> => {
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
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const order = group.children.id(orderId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }
    if (!childCanVerify(order)) {
      res.status(400).json({
        message: 'This order has no B2B draft to check. Cart must be Draft, Ready, or Review with a live Helly Hansen document.',
      });
      return;
    }

    enqueueHhCartVerify(String(group._id), String(order._id));
    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to re-check HH Sportswear cart', error: (error as Error).message });
  }
};

async function respondCartCompare(req: Request, res: Response, groupId: string, orderId?: string): Promise<void> {
  const compare = await liveCompareHhCarts(groupId, orderId);
  const fresh = await HHOrderGroup.findById(groupId);
  if (!isBrandGroup(fresh, req)) {
    res.status(404).json({ message: 'Group not found' });
    return;
  }
  res.json({ data: serializeGroup(fresh), compare });
}

export const compareGroupCart = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId);
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }
    if (group.children.length === 0) {
      res.status(400).json({ message: 'This batch has no orders to compare.' });
      return;
    }

    await respondCartCompare(req, res, String(group._id));
  } catch (error) {
    if (error instanceof HhB2bAuthError) {
      res.status(401).json({ message: error.message });
      return;
    }
    res.status(500).json({ message: 'Failed to compare HH Sportswear carts', error: (error as Error).message });
  }
};

export const compareOrderCart = async (req: Request, res: Response): Promise<void> => {
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
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const order = group.children.id(orderId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    await respondCartCompare(req, res, String(group._id), String(order._id));
  } catch (error) {
    if (error instanceof HhB2bAuthError) {
      res.status(401).json({ message: error.message });
      return;
    }
    res.status(500).json({ message: 'Failed to compare HH Sportswear cart', error: (error as Error).message });
  }
};

export const placeGroupCart = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId);
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }
    if (!group.children.some(childCanPlace)) {
      res.status(400).json({
        message: 'No Ready orders to place. Cart must match the live Helly Hansen draft.',
      });
      return;
    }

    enqueueHhCartPlace(String(group._id));
    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to place HH Sportswear orders', error: (error as Error).message });
  }
};

export const placeOrderCart = async (req: Request, res: Response): Promise<void> => {
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
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const order = group.children.id(orderId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }
    if (isHhPlaced(order)) {
      res.status(409).json({ message: 'This order is already placed.' });
      return;
    }
    if (!childCanPlace(order)) {
      res.status(400).json({
        message: 'This order is not Ready to place. Match the live Helly Hansen cart first.',
      });
      return;
    }

    enqueueHhCartPlace(String(group._id), String(order._id));
    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to place HH Sportswear order', error: (error as Error).message });
  }
};

export const listGroups = async (req: Request, res: Response): Promise<void> => {
  try {
    const brand = requestBrand(req);
    const groups = await HHOrderGroup.find({ brand }).sort({ createdAt: -1 }).lean();
    queueMissingImageBackfill(brand, groups);
    queueMissingCartDrafts(brand, groups);
    queueMissingCartVerifies(brand, groups);
    res.json({ data: groups.map(serializeGroup) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch HH Sportswear groups', error: (error as Error).message });
  }
};

const queuedImageBackfill = new Set<string>();
const queuedCartBackfill = new Set<string>();
const queuedCartVerifyBackfill = new Set<string>();

function queueMissingImageBackfill(
  brand: HHBrandId,
  groups: Array<{
    _id: unknown;
    children?: Array<{ detailsStatus?: string; items?: Array<{ imageUrl?: string; tax?: number }> }>;
  }>
): void {
  if (queuedImageBackfill.has(brand)) return;
  queuedImageBackfill.add(brand);
  for (const group of groups) {
    const needsImages = (group.children ?? []).some(
      (child) =>
        child.detailsStatus === 'synced' &&
        (child.items ?? []).some((item) => item.imageUrl == null || typeof item.tax !== 'number')
    );
    if (needsImages) enqueueHhGroupScSync(String(group._id));
  }
}

function queueMissingCartDrafts(
  brand: HHBrandId,
  groups: Array<{
    _id: unknown;
    children?: Array<{
      detailsStatus?: string;
      cartStatus?: string;
      b2bDraftId?: string;
      items?: unknown[];
    }>;
  }>
): void {
  if (queuedCartBackfill.has(brand)) return;
  queuedCartBackfill.add(brand);
  void (async () => {
    try {
      await loadHhB2bCookie(brand);
    } catch (err) {
      queuedCartBackfill.delete(brand);
      if (!(err instanceof HhB2bAuthError)) {
        console.warn('[hh-cart-draft] Could not check B2B session before backfill', err);
      }
      return;
    }
    for (const group of groups) {
      const needsDraft = (group.children ?? []).some(
        (child) =>
          child.detailsStatus === 'synced' &&
          (child.items ?? []).length > 0 &&
          (child.b2bDraftId ?? '').startsWith('local:')
      );
      if (needsDraft) enqueueHhCartDraft(String(group._id));
    }
  })();
}

function queueMissingCartVerifies(
  brand: HHBrandId,
  groups: Array<{
    _id: unknown;
    children?: Array<{
      detailsStatus?: string;
      cartStatus?: string;
      b2bDraftId?: string;
    }>;
  }>
): void {
  if (queuedCartVerifyBackfill.has(brand)) return;
  queuedCartVerifyBackfill.add(brand);
  void (async () => {
    try {
      await loadHhB2bCookie(brand);
    } catch (err) {
      queuedCartVerifyBackfill.delete(brand);
      if (!(err instanceof HhB2bAuthError)) {
        console.warn('[hh-cart-verify] Could not check B2B session before backfill', err);
      }
      return;
    }
    for (const group of groups) {
      const needsVerify = (group.children ?? []).some(
        (child) =>
          child.detailsStatus === 'synced' &&
          child.cartStatus === 'draft' &&
          Boolean((child.b2bDraftId ?? '').trim()) &&
          !String(child.b2bDraftId).startsWith('local:')
      );
      if (needsVerify) enqueueHhCartVerify(String(group._id));
    }
  })();
}

export const getGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId).lean();
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch HH Sportswear group', error: (error as Error).message });
  }
};

export const exportGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId).lean();
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const rows = (group.children ?? []).map((child) => ({
      orderId: child.orderId ?? '',
      po: child.po ?? '',
      referenceNumber: child.referenceNumber ?? '',
    }));
    const buffer = await buildHhBatchExportXlsx(rows);
    const filename = hhExportFileName(hhBrand(requestBrand(req)).slug, group.sourceFileName ?? '', String(group._id));

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: 'Failed to export HH batch', error: (error as Error).message });
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
      brand: requestBrand(req),
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

    const group = await HHOrderGroup.findOneAndUpdate(
      { _id: groupId, brand: requestBrand(req) },
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
    if (!isBrandGroup(group, req)) {
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

export const updateOrderItemExclude = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, orderId, itemId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }
    if (!isValidObjectId(orderId)) {
      res.status(400).json({ message: 'Invalid order id' });
      return;
    }
    if (!isValidObjectId(itemId)) {
      res.status(400).json({ message: 'Invalid item id' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const excluded = body.excluded;
    if (typeof excluded !== 'boolean') {
      res.status(400).json({ message: 'excluded must be true or false' });
      return;
    }
    if (body.excludeNote != null && typeof body.excludeNote !== 'string') {
      res.status(400).json({ message: 'excludeNote must be a string' });
      return;
    }

    const group = await withHhGroupLock(groupId, async () => {
      const found = await HHOrderGroup.findById(groupId);
      if (!isBrandGroup(found, req)) return null;
      const order = found.children.id(orderId);
      if (!order) return 'order';
      if (isHhPlaced(order)) return 'placed';
      const item = order.items.find((row) => String(row._id) === itemId);
      if (!item) return 'item';

      item.excluded = excluded;
      item.excludeNote = excluded ? asString(body.excludeNote, 500) : '';
      order.cartError = '';
      if (order.cartStatus !== 'none') {
        resetCartForResync(order);
      } else {
        invalidateHhCartVerification(order);
      }
      found.detailsStatus = rollupHhDetailsStatus(found.children.map((child) => child.detailsStatus));
      found.cartStatus = rollupHhCartStatus(found.children.map((child) => child.cartStatus));
      found.markModified('children');
      await found.save();
      return found;
    });

    if (group === null) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }
    if (group === 'order') {
      res.status(404).json({ message: 'Order not found' });
      return;
    }
    if (group === 'placed') {
      res.status(409).json({ message: 'Placed orders cannot exclude line items.' });
      return;
    }
    if (group === 'item') {
      res.status(404).json({ message: 'Item not found' });
      return;
    }

    res.json({ data: serializeGroup(group) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update HH line item', error: (error as Error).message });
  }
};

export const deleteGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    if (!isValidObjectId(groupId)) {
      res.status(400).json({ message: 'Invalid group id' });
      return;
    }

    const group = await HHOrderGroup.findById(groupId);
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }
    if (group.children.some(isHhPlaced)) {
      res.status(409).json({ message: 'This batch has a placed order and cannot be deleted.' });
      return;
    }

    await group.deleteOne();
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
    if (!isBrandGroup(group, req)) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const order = group.children.id(orderId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }
    if (isHhPlaced(order)) {
      res.status(409).json({ message: 'Placed orders cannot be deleted.' });
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

function parseBoolFlag(value: unknown, fallback = true): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  return fallback;
}

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
      brand: requestBrand(req),
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
    const fetchDetails = parseBoolFlag(req.body?.fetchDetails, true);
    const draftCart = fetchDetails && parseBoolFlag(req.body?.draftCart, true);
    if (fetchDetails) {
      enqueueHhGroupScSync(String(group._id), undefined, { autoDraft: draftCart });
    }
  } catch (error) {
    res.status(500).json({ message: 'Failed to import HH Sportswear group', error: (error as Error).message });
  }
};
