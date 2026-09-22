import { Schema, model, Document, Types } from 'mongoose';
import { HH_BRAND_IDS, HH_DEFAULT_BRAND, type HHBrandId } from '../lib/hhBrand';

export const HH_DETAILS_STATUSES = ['pending', 'synced', 'failed'] as const;
export type HHDetailsStatus = (typeof HH_DETAILS_STATUSES)[number];

export const HH_CART_STATUSES = ['none', 'draft', 'ready', 'review', 'placed'] as const;
export type HHCartStatus = (typeof HH_CART_STATUSES)[number];

export const HH_DEFAULT_DETAILS_STATUS: HHDetailsStatus = 'pending';
export const HH_DEFAULT_CART_STATUS: HHCartStatus = 'none';

export function isDetailsStatus(value: unknown): value is HHDetailsStatus {
  return typeof value === 'string' && (HH_DETAILS_STATUSES as readonly string[]).includes(value);
}

export function isCartStatus(value: unknown): value is HHCartStatus {
  return typeof value === 'string' && (HH_CART_STATUSES as readonly string[]).includes(value);
}

export function isHhPlaced(child: { cartStatus?: string }): boolean {
  return child.cartStatus === 'placed';
}

export function mapLegacyHhStatus(legacy?: string): {
  detailsStatus: HHDetailsStatus;
  cartStatus: HHCartStatus;
} {
  switch (legacy) {
    case 'synced_undrafted':
      return { detailsStatus: 'synced', cartStatus: 'none' };
    case 'synced_drafted':
      return { detailsStatus: 'synced', cartStatus: 'draft' };
    case 'for_confirmation':
      return { detailsStatus: 'synced', cartStatus: 'ready' };
    case 'flagged':
      return { detailsStatus: 'failed', cartStatus: 'none' };
    default:
      return { detailsStatus: 'pending', cartStatus: 'none' };
  }
}

export interface IHHLineItem {
  _id: Types.ObjectId;
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

export interface IHHChildOrder {
  _id: Types.ObjectId;
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
  b2bDraftId: string;
  cartError: string;
  placeError: string;
  verifyIssues: Array<{ field: string; label: string; expected: string; actual: string }>;
  verifyRows: Array<{ field: string; label: string; expected: string; actual: string; matched: boolean }>;
  verifiedAt: Date | null;
  items: IHHLineItem[];
}

export interface IHHOrderGroup extends Document {
  brand: HHBrandId;
  notes: string;
  sourceFileName: string;
  detailsStatus: HHDetailsStatus;
  cartStatus: HHCartStatus;
  createdByName: string;
  createdByEmail: string;
  createdByUserId?: string;
  children: Types.DocumentArray<IHHChildOrder>;
  createdAt: Date;
  updatedAt: Date;
}

const LineItemSchema = new Schema<IHHLineItem>(
  {
    title: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true },
    asin: { type: String, default: '', trim: true },
    imageUrl: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    tax: { type: Number, required: true, min: 0, default: 0 },
    excluded: { type: Boolean, default: false },
    excludeNote: { type: String, default: '', trim: true },
  },
  { _id: true }
);

const ChildOrderSchema = new Schema<IHHChildOrder>(
  {
    orderId: { type: String, required: true, trim: true },
    po: { type: String, required: true, trim: true },
    referenceNumber: { type: String, default: '', trim: true },
    customerName: { type: String, default: '', trim: true },
    customerEmail: { type: String, default: '', trim: true, lowercase: true },
    customerPhone: { type: String, default: '', trim: true },
    addressLine1: { type: String, default: '', trim: true },
    addressLine2: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    postalCode: { type: String, default: '', trim: true },
    country: { type: String, default: 'US', trim: true },
    notes: { type: String, default: '', trim: true },
    detailsStatus: {
      type: String,
      enum: HH_DETAILS_STATUSES,
      required: true,
      default: HH_DEFAULT_DETAILS_STATUS,
    },
    cartStatus: {
      type: String,
      enum: HH_CART_STATUSES,
      required: true,
      default: HH_DEFAULT_CART_STATUS,
    },
    b2bDraftId: { type: String, default: '', trim: true },
    cartError: { type: String, default: '', trim: true },
    placeError: { type: String, default: '', trim: true },
    verifyIssues: {
      type: [
        {
          _id: false,
          field: { type: String, default: '' },
          label: { type: String, default: '' },
          expected: { type: String, default: '' },
          actual: { type: String, default: '' },
        },
      ],
      default: [],
    },
    verifyRows: {
      type: [
        {
          _id: false,
          field: { type: String, default: '' },
          label: { type: String, default: '' },
          expected: { type: String, default: '' },
          actual: { type: String, default: '' },
          matched: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
    verifiedAt: { type: Date, default: null },
    items: { type: [LineItemSchema], default: [] },
  },
  { _id: true }
);

const HHOrderGroupSchema = new Schema<IHHOrderGroup>(
  {
    brand: { type: String, enum: HH_BRAND_IDS, required: true, default: HH_DEFAULT_BRAND, index: true },
    notes: { type: String, default: '', trim: true },
    sourceFileName: { type: String, default: '', trim: true },
    detailsStatus: {
      type: String,
      enum: HH_DETAILS_STATUSES,
      required: true,
      default: HH_DEFAULT_DETAILS_STATUS,
      index: true,
    },
    cartStatus: {
      type: String,
      enum: HH_CART_STATUSES,
      required: true,
      default: HH_DEFAULT_CART_STATUS,
      index: true,
    },
    createdByName: { type: String, required: true, trim: true },
    createdByEmail: { type: String, required: true, trim: true, lowercase: true },
    createdByUserId: { type: String, trim: true },
    children: { type: [ChildOrderSchema], default: [] },
  },
  { timestamps: true }
);

HHOrderGroupSchema.index({ detailsStatus: 1, createdAt: -1 });
HHOrderGroupSchema.index({ cartStatus: 1, createdAt: -1 });
HHOrderGroupSchema.index({ createdAt: -1 });
HHOrderGroupSchema.index({ brand: 1, createdAt: -1 });
HHOrderGroupSchema.index({ 'children.detailsStatus': 1, createdAt: 1 });

const CART_RANK: Record<HHCartStatus, number> = {
  none: 0,
  review: 1,
  draft: 2,
  ready: 3,
  placed: 4,
};

export function rollupHhDetailsStatus(statuses: HHDetailsStatus[]): HHDetailsStatus {
  if (statuses.length === 0) return HH_DEFAULT_DETAILS_STATUS;
  if (statuses.some((status) => status === 'pending')) return 'pending';
  if (statuses.some((status) => status === 'failed')) return 'failed';
  return 'synced';
}

export function rollupHhCartStatus(statuses: HHCartStatus[]): HHCartStatus {
  if (statuses.length === 0) return HH_DEFAULT_CART_STATUS;
  if (statuses.some((status) => status === 'none')) return 'none';
  if (statuses.some((status) => status === 'review')) return 'review';
  let lowest: HHCartStatus = 'placed';
  for (const status of statuses) {
    if (CART_RANK[status] < CART_RANK[lowest]) lowest = status;
  }
  return lowest;
}

const HHOrderGroup = model<IHHOrderGroup>('HHOrderGroup', HHOrderGroupSchema);

type LegacyChild = IHHChildOrder & { status?: string };
type LegacyGroup = {
  _id: Types.ObjectId;
  status?: string;
  detailsStatus?: string;
  cartStatus?: string;
  children?: LegacyChild[];
};

export async function migrateHhSplitStatuses(): Promise<void> {
  const groups = await HHOrderGroup.find().lean<LegacyGroup[]>();
  let updated = 0;

  for (const group of groups) {
    const groupNeeds = !isDetailsStatus(group.detailsStatus) || !isCartStatus(group.cartStatus);
    const children = (group.children ?? []).map((child) => {
      const { status: _legacy, ...rest } = child;
      if (isDetailsStatus(child.detailsStatus) && isCartStatus(child.cartStatus)) return rest;
      return { ...rest, ...mapLegacyHhStatus(_legacy) };
    });
    const childNeeds = (group.children ?? []).some(
      (child) => !isDetailsStatus(child.detailsStatus) || !isCartStatus(child.cartStatus)
    );
    if (!groupNeeds && !childNeeds) continue;

    const mapped = groupNeeds
      ? mapLegacyHhStatus(group.status)
      : { detailsStatus: group.detailsStatus as HHDetailsStatus, cartStatus: group.cartStatus as HHCartStatus };

    await HHOrderGroup.updateOne(
      { _id: group._id },
      {
        $set: {
          detailsStatus: mapped.detailsStatus,
          cartStatus: mapped.cartStatus,
          children,
        },
        $unset: { status: 1 },
      }
    );
    updated += 1;
  }

  if (updated > 0) {
    console.log(`[hh] Migrated ${updated} group${updated === 1 ? '' : 's'} to details/cart status`);
  }
}

export async function migrateHhOrderGroupBrands(): Promise<void> {
  const result = await HHOrderGroup.updateMany(
    { $or: [{ brand: { $exists: false } }, { brand: null }, { brand: '' }] },
    { $set: { brand: HH_DEFAULT_BRAND } }
  );
  const count = result.modifiedCount ?? 0;
  if (count > 0) {
    console.log(`[hh] Set brand=${HH_DEFAULT_BRAND} on ${count} existing batch${count === 1 ? '' : 'es'}`);
  }
}

/** Local placeholder drafts were never posted to B2B. Cart Draft means a real document. */
export async function migrateLocalHhCartDrafts(): Promise<void> {
  const groups = await HHOrderGroup.find({ 'children.b2bDraftId': /^local:/ }).lean<LegacyGroup[]>();
  let updated = 0;

  for (const group of groups) {
    const children = (group.children ?? []).map((child) => {
      if (!(child.b2bDraftId ?? '').startsWith('local:')) return child;
      return { ...child, cartStatus: HH_DEFAULT_CART_STATUS, b2bDraftId: '' };
    });
    await HHOrderGroup.updateOne(
      { _id: group._id },
      {
        $set: {
          children,
          cartStatus: rollupHhCartStatus(children.map((child) => child.cartStatus)),
        },
      }
    );
    updated += 1;
  }

  if (updated > 0) {
    console.log(`[hh] Cleared ${updated} group${updated === 1 ? '' : 's'} of local cart placeholders`);
  }
}

export default HHOrderGroup;
