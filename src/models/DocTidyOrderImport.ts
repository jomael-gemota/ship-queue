import { Schema, model, Document, Types } from 'mongoose';

/**
 * One order-line record imported from a CSV or XLSX file.
 * Each record becomes one row in the Invoice Audit table.
 *
 * Records from the same file upload share a `importBatchId` so the whole
 * batch can be deleted together.
 */
export interface IDocTidyOrderImport extends Document {
  workspaceId: Types.ObjectId;

  /**
   * Stable string that groups all rows from the same file upload together.
   * Generated server-side as `${workspaceId}-${Date.now()}` at upload time.
   */
  importBatchId: string;

  /** As-written in the import file (stored as a string to avoid timezone shifts). */
  processedDate: string;
  poNumber: string;
  purchasedDate: string;
  customerName: string;
  orderId: string;
  orderSku: string;
  /** Stored as a string; the import file may contain non-numeric values (e.g. "10 EA"). */
  orderQty: string;
  status: string;

  importedByUserId?: string;
  importedByName?: string;

  createdAt: Date;
  updatedAt: Date;
}

const DocTidyOrderImportSchema = new Schema<IDocTidyOrderImport>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'DocTidyWorkspace',
      required: true,
      index: true,
    },

    importBatchId: { type: String, required: true, index: true },

    processedDate: { type: String, default: '' },
    poNumber:      { type: String, default: '' },
    purchasedDate: { type: String, default: '' },
    customerName:  { type: String, default: '' },
    orderId:       { type: String, default: '' },
    orderSku:      { type: String, default: '' },
    orderQty:      { type: String, default: '' },
    status:        { type: String, default: '' },

    importedByUserId: { type: String },
    importedByName:   { type: String },
  },
  { timestamps: true }
);

DocTidyOrderImportSchema.index({ workspaceId: 1, createdAt: -1 });
DocTidyOrderImportSchema.index({ workspaceId: 1, importBatchId: 1 });

export default model<IDocTidyOrderImport>('DocTidyOrderImport', DocTidyOrderImportSchema);
