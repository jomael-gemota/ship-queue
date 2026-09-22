import { Schema, model, Document } from 'mongoose';

/**
 * App-wide Doc Tidy configuration. Unlike Drive label uploads (which are
 * per-user), Doc Tidy reads a single shared mailbox, so the mailbox credential
 * and the attachment destination are global and admin-managed.
 */
export interface IDocTidyConfig extends Document {
  /** Singleton discriminator — there is only ever one config document. */
  key: string;

  /** Refresh token for the connected mailbox (Gmail read + Drive write). */
  gmailRefreshToken?: string;
  /** The address that was actually authorised, shown back in Settings. */
  gmailAccountEmail?: string;
  gmailConnectedAt?: Date;
  gmailConnectedByName?: string;

  /** Drive destination for extracted attachments. */
  driveFolderId?: string;
  driveFolderName?: string;
  /** Set when the destination lives in a Shared Drive rather than My Drive. */
  driveId?: string;

  /**
   * Shared column order for the Invoice Audit table.
   * Stored as an ordered array of InvoiceAuditColumnId strings.
   * Absent or empty = use the default order from INVOICE_AUDIT_COLUMNS.
   */
  auditColumnOrder?: string[];

  /**
   * Shared column order for the Workspace Emails table.
   * Stored as an ordered array of WorkspaceEmailColumnId strings.
   * Absent or empty = use the default order from WORKSPACE_EMAIL_COLUMNS.
   */
  wsEmailColumnOrder?: string[];

  /**
   * Shared column order for the PDF Imports table.
   * Absent or empty = use the default order from PDF_IMPORT_COLUMNS.
   */
  pdfImportColOrder?: string[];

  createdAt: Date;
  updatedAt: Date;
}

const SINGLETON_KEY = 'global';

const DocTidyConfigSchema = new Schema<IDocTidyConfig>(
  {
    key: { type: String, required: true, unique: true, default: SINGLETON_KEY },
    gmailRefreshToken: { type: String, select: false },
    gmailAccountEmail: { type: String },
    gmailConnectedAt: { type: Date },
    gmailConnectedByName: { type: String },
    driveFolderId: { type: String },
    driveFolderName: { type: String },
    driveId: { type: String },
    auditColumnOrder: { type: [String], default: undefined },
    wsEmailColumnOrder: { type: [String], default: undefined },
    pdfImportColOrder: { type: [String], default: undefined },
  },
  { timestamps: true }
);

const DocTidyConfig = model<IDocTidyConfig>('DocTidyConfig', DocTidyConfigSchema);

/**
 * Returns the singleton config document, creating an empty one the first time
 * it is requested. Pass `withSecrets` when the refresh token is needed.
 */
export async function getDocTidyConfigDoc(withSecrets = false): Promise<IDocTidyConfig> {
  const query = DocTidyConfig.findOne({ key: SINGLETON_KEY });
  if (withSecrets) query.select('+gmailRefreshToken');

  const existing = await query;
  if (existing) return existing;

  return DocTidyConfig.create({ key: SINGLETON_KEY });
}

export default DocTidyConfig;
