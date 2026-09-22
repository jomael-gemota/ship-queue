import { Schema, model, Document, Types } from 'mongoose';

/**
 * A PDF uploaded directly by a user for Tidy Agent parsing,
 * outside the email-capture flow.
 *
 * The PDF bytes are stored in the `doctidy_pdfs` GridFS bucket immediately on
 * upload. Parsing does not start automatically — the user explicitly triggers it
 * via the "Send to Tidy Agent" action, at which point a `DocTidyParseJob` is
 * created and `parseJobId` is populated.
 */
export interface IDocTidyPdfImport extends Document {
  workspaceId: Types.ObjectId;

  filename: string;
  /** Original file size in bytes. */
  size: number;
  /** GridFS file id in the `doctidy_pdfs` bucket. */
  pdfFileId: Types.ObjectId;

  /** Populated after the user sends this import to the Tidy Agent. */
  parseJobId?: Types.ObjectId | null;

  uploadedByUserId?: string;
  uploadedByName?: string;

  createdAt: Date;
  updatedAt: Date;
}

const DocTidyPdfImportSchema = new Schema<IDocTidyPdfImport>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'DocTidyWorkspace', required: true, index: true },

    filename: { type: String, required: true },
    size: { type: Number, default: 0 },
    pdfFileId: { type: Schema.Types.ObjectId, required: true },

    parseJobId: { type: Schema.Types.ObjectId, ref: 'DocTidyParseJob', default: null },

    uploadedByUserId: { type: String },
    uploadedByName: { type: String },
  },
  { timestamps: true }
);

DocTidyPdfImportSchema.index({ workspaceId: 1, createdAt: -1 });

export default model<IDocTidyPdfImport>('DocTidyPdfImport', DocTidyPdfImportSchema);
