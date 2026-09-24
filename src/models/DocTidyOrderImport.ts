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

  /**
   * DC cost of goods sold, fetched from the Channel Precision bt_costs API.
   * `null`  = not yet fetched
   * `"n/a"` = fetched but no matching SKU found
   * Any other string = the cost value (e.g. "12.50")
   */
  dcCogs?: string | null;
  /** MSRP from the same API response (field name `mspr` in the source). */
  dcMsrp?: string | null;
  /** When the COGS was last fetched (for staleness checks). */
  dcCogsAt?: Date | null;

  /**
   * Cached invoice match — written the moment a parse job completes and a
   * matching PO # + SKU is found.  Storing these values here means the Invoice
   * Audit table only ever needs to query this collection; it never has to load
   * all parse jobs to do client-side matching.
   *
   * `null` = not yet matched (job not yet parsed, or no matching invoice found)
   */
  matchedInvoice?: IMatchedInvoice | null;

  createdAt: Date;
  updatedAt: Date;
}

/** All invoice fields extracted from the matched parse job and stored inline. */
export interface IMatchedInvoice {
  /** The parse job whose jsonOutput was the source of truth. */
  jobId: Types.ObjectId;
  /** Google Drive file ID — used to render the invoice link. */
  driveFileId?: string;
  invoiceSku?: string;
  invoiceDate?: string;
  invoiceNumber?: string;
  terms?: string;
  itemCost?: string;
  invoiceQty?: string;
  discountedPrice?: string;
  discountPct?: string;
  dropshipFee?: string;
  miscCharges?: string;
  totalCost?: string;
  /** When the cache was last written. */
  cachedAt: Date;
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

    dcCogs:   { type: String, default: null },
    dcMsrp:   { type: String, default: null },
    dcCogsAt: { type: Date,   default: null },

    matchedInvoice: {
      type: new Schema({
        jobId:            { type: Schema.Types.ObjectId, required: true },
        driveFileId:      { type: String },
        invoiceSku:       { type: String },
        invoiceDate:      { type: String },
        invoiceNumber:    { type: String },
        terms:            { type: String },
        itemCost:         { type: String },
        invoiceQty:       { type: String },
        discountedPrice:  { type: String },
        discountPct:      { type: String },
        dropshipFee:      { type: String },
        miscCharges:      { type: String },
        totalCost:        { type: String },
        cachedAt:         { type: Date, required: true },
      }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true }
);

DocTidyOrderImportSchema.index({ workspaceId: 1, createdAt: -1 });
DocTidyOrderImportSchema.index({ workspaceId: 1, importBatchId: 1 });

export default model<IDocTidyOrderImport>('DocTidyOrderImport', DocTidyOrderImportSchema);
