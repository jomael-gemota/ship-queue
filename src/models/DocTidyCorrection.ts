import { Schema, model, Document, Types } from 'mongoose';

/** Shared with `worker/collections.py`. See DocTidyParseJob for why it is pinned. */
export const CORRECTION_COLLECTION = 'doctidy_corrections';

export type CorrectionMode = 'json' | 'tabular';
export const CORRECTION_MODES: CorrectionMode[] = ['json', 'tabular'];

/** Characters of source text embedded for retrieval. Mirrors the worker's constant. */
export const CORRECTION_TEXT_SAMPLE_CHARS = 2000;

/**
 * A user's fix to a parse job's output, and the retrieval half of the learning
 * loop. `embedding` indexes the source document so a later, similar document can
 * pull this correction back as a few-shot example; `note` carries the user's
 * instruction, which the worker promotes into the system prompt as a hard rule.
 *
 * `vendorName` is denormalised so retrieval can be vendor-scoped without a join,
 * and so a correction survives the vendor profile being renamed.
 */
export interface IDocTidyCorrection extends Document {
  parseJobId: Types.ObjectId;
  filename: string;
  vendorName: string | null;
  documentTextSample: string;
  /** Null when no embedding key was configured; the correction is stored anyway. */
  embedding: number[] | null;
  originalOutput?: Record<string, unknown> | null;
  correctedOutput: Record<string, unknown>;
  /** Which view the edit was made from, so the diff re-renders faithfully. */
  mode?: CorrectionMode;
  correctedTables?: unknown;
  note?: string;
  createdByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DocTidyCorrectionSchema = new Schema<IDocTidyCorrection>(
  {
    parseJobId: { type: Schema.Types.ObjectId, ref: 'DocTidyParseJob', required: true },
    filename: { type: String, default: 'document.pdf' },
    vendorName: { type: String, default: null },
    documentTextSample: { type: String, default: '' },
    embedding: { type: [Number], default: null },
    originalOutput: { type: Schema.Types.Mixed, default: null },
    correctedOutput: { type: Schema.Types.Mixed, required: true },
    mode: { type: String, enum: CORRECTION_MODES },
    correctedTables: { type: Schema.Types.Mixed },
    note: { type: String },
    createdByName: { type: String },
  },
  { timestamps: true, collection: CORRECTION_COLLECTION }
);

DocTidyCorrectionSchema.index({ parseJobId: 1, createdAt: -1 });
// Retrieval pulls a vendor's corrections directly so a learned format is never
// crowded out of the global recency window.
DocTidyCorrectionSchema.index({ vendorName: 1, createdAt: -1 });

export default model<IDocTidyCorrection>('DocTidyCorrection', DocTidyCorrectionSchema);
