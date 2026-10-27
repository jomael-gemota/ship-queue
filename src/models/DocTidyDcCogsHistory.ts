import { Schema, model, Document } from 'mongoose';

/**
 * One DC COGS value a SKU held, recorded when the SKU first got a cost and on
 * every change. Keyed by SKU (trimmed, uppercased) because DC cost is per SKU,
 * not per workspace or order row.
 */
export interface IDocTidyDcCogsHistory extends Document {
  sku: string;
  cost: string;
  msrp: string;
  recordedAt: Date;
  /** `stored` = the cost Doc Tidy already held before history tracking began. */
  source: 'dc_lookup' | 'stored';
}

const DocTidyDcCogsHistorySchema = new Schema<IDocTidyDcCogsHistory>({
  sku: { type: String, required: true },
  cost: { type: String, required: true },
  msrp: { type: String, default: '' },
  recordedAt: { type: Date, required: true },
  source: { type: String, enum: ['dc_lookup', 'stored'], default: 'dc_lookup' },
});

DocTidyDcCogsHistorySchema.index({ sku: 1, recordedAt: -1 });

export default model<IDocTidyDcCogsHistory>('DocTidyDcCogsHistory', DocTidyDcCogsHistorySchema);
