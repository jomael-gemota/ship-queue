import { Schema, model, Document, Types } from 'mongoose';

export type ParseJobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export const PARSE_JOB_STATUSES: ParseJobStatus[] = [
  'pending',
  'processing',
  'completed',
  'failed',
];

/**
 * Explicit collection name. The Python worker queries this collection with the
 * raw driver, so it cannot derive Mongoose's pluralised default
 * (`doctidyparsejobs`). The same string lives in `worker/collections.py`.
 */
export const PARSE_JOB_COLLECTION = 'doctidy_parse_jobs';

/**
 * One agent run over one attachment.
 *
 * Keyed by `{ messageId, attachmentIndex }` rather than by message: a captured
 * message can carry several PDFs, and each is its own document with its own
 * reasoning, output and corrections.
 *
 * The worker writes to this collection directly, so every field has to survive a
 * raw update: nothing here is populated by a Mongoose hook or a default that the
 * worker would not set.
 */
export interface IDocTidyParseJob extends Document {
  messageId: Types.ObjectId;
  attachmentIndex: number;

  /** Denormalised from the attachment so the job reads standalone. */
  filename: string;
  /** Drive file the bytes were mirrored from, for provenance. */
  driveFileId?: string;
  /** GridFS id of the mirrored PDF in the `doctidy_pdfs` bucket. */
  pdfFileId?: Types.ObjectId;

  status: ParseJobStatus;
  /** The agent's transcript, appended token by token as the job runs. */
  thinking: string;
  jsonOutput?: Record<string, unknown> | null;
  tableOutput?: Record<string, unknown> | null;

  /** Set by the worker after extraction; canonical once the vendor resolves. */
  vendorName?: string | null;
  /** True when the vendor is not registered, so the UI can offer setup. */
  vendorNeedsSetup?: boolean;
  /** Truncated source text, embedded when a correction is recorded. */
  documentTextSample?: string;

  error?: string | null;

  requestedByUserId?: string;
  requestedByName?: string;

  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const DocTidyParseJobSchema = new Schema<IDocTidyParseJob>(
  {
    messageId: { type: Schema.Types.ObjectId, ref: 'DocTidyMessage', required: true },
    attachmentIndex: { type: Number, required: true },

    filename: { type: String, default: 'document.pdf' },
    driveFileId: { type: String },
    pdfFileId: { type: Schema.Types.ObjectId },

    status: { type: String, enum: PARSE_JOB_STATUSES, default: 'pending' },
    thinking: { type: String, default: '' },
    jsonOutput: { type: Schema.Types.Mixed, default: null },
    tableOutput: { type: Schema.Types.Mixed, default: null },

    vendorName: { type: String, default: null },
    vendorNeedsSetup: { type: Boolean, default: false },
    documentTextSample: { type: String },

    error: { type: String, default: null },

    requestedByUserId: { type: String },
    requestedByName: { type: String },

    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: PARSE_JOB_COLLECTION }
);

// One job per attachment; the parse endpoint relies on this to be idempotent.
DocTidyParseJobSchema.index({ messageId: 1, attachmentIndex: 1 }, { unique: true });
// The worker re-dispatches everything still pending when it reconnects.
DocTidyParseJobSchema.index({ status: 1, createdAt: 1 });

export default model<IDocTidyParseJob>('DocTidyParseJob', DocTidyParseJobSchema);
