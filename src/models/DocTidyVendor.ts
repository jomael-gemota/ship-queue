import { Schema, model, Document, Types } from 'mongoose';

/** Shared with `worker/collections.py`. See DocTidyParseJob for why it is pinned. */
export const VENDOR_COLLECTION = 'doctidy_vendors';

/**
 * Canonical key for vendor matching.
 *
 * Must stay byte-identical to `normalize_vendor_name()` in `worker/sku.py`: the
 * worker resolves vendors against this exact value, and a divergence silently
 * turns a registered vendor back into an unknown one.
 */
export function normalizeVendorName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A vendor profile. Registration is what scopes corrections to a vendor, and the
 * sample SKUs are cold-start format anchors: the agent reproduces their shape on
 * the vendor's very first document, before any correction exists.
 */
export interface IDocTidyVendor extends Document {
  /** The workspace this vendor belongs to. Optional for legacy vendors. */
  workspaceId?: Types.ObjectId;
  name: string;
  normalizedName: string;
  skuSamples: string[];
  /** Legacy single sample, still read as an extra anchor. */
  skuSample?: string | null;
  createdByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DocTidyVendorSchema = new Schema<IDocTidyVendor>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'DocTidyWorkspace' },
    name: { type: String, required: true, trim: true },
    // normalizedName is no longer globally unique — uniqueness is enforced
    // per-workspace via the compound index below.
    normalizedName: { type: String, required: true },
    skuSamples: { type: [String], default: [] },
    skuSample: { type: String, default: null },
    createdByName: { type: String },
  },
  { timestamps: true, collection: VENDOR_COLLECTION }
);

// Per-workspace uniqueness: one vendor name per workspace.
DocTidyVendorSchema.index({ workspaceId: 1, normalizedName: 1 }, { unique: true });

export default model<IDocTidyVendor>('DocTidyVendor', DocTidyVendorSchema);
