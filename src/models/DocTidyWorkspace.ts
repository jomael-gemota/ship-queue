import { Schema, model, Document } from 'mongoose';

/**
 * A named workspace that owns a set of filter rules.
 *
 * Workspaces are team-wide (like rules and vendors). Rules reference the
 * workspace via `rule.workspaceId` (one-to-many). Deleting a workspace does
 * not delete its rules — they become unassigned until reassigned or deleted.
 */
export interface IDocTidyWorkspace extends Document {
  name: string;
  /** The organization this workspace belongs to, if any. */
  organizationId?: string;
  createdByUserId?: string;
  createdByName?: string;

  /**
   * Per-workspace column order for the Invoice Audit table.
   * Absent or empty → fall back to DEFAULT_AUDIT_COL_ORDER.
   */
  auditColumnOrder?: string[];
  /**
   * Per-workspace column order for the Workspace Emails table.
   * Absent or empty → fall back to DEFAULT_EMAIL_COL_ORDER.
   */
  wsEmailColumnOrder?: string[];
  /**
   * Per-workspace column order for the PDF Imports table.
   * Absent or empty → fall back to DEFAULT_PDF_IMPORT_COL_ORDER.
   */
  pdfImportColOrder?: string[];

  /**
   * Controls how order imports are matched to parsed invoices for this workspace.
   *
   * `full` (default) — all import fields supported; matching requires PO # + SKU.
   * `header-only`    — only PO # is required; matching by PO # alone; line-item
   *                    columns are hidden by default in the Invoice Audit table.
   */
  importMode?: 'full' | 'header-only';

  createdAt: Date;
  updatedAt: Date;
}

const DocTidyWorkspaceSchema = new Schema<IDocTidyWorkspace>(
  {
    name: { type: String, required: true, trim: true },
    organizationId: { type: String, default: undefined },
    createdByUserId: { type: String },
    createdByName: { type: String },
    auditColumnOrder: { type: [String], default: undefined },
    wsEmailColumnOrder: { type: [String], default: undefined },
    pdfImportColOrder: { type: [String], default: undefined },
    importMode: {
      type: String,
      enum: ['full', 'header-only'],
      default: 'full',
    },
  },
  { timestamps: true }
);

// Listing is alphabetical by name.
DocTidyWorkspaceSchema.index({ name: 1 });
// Fast lookup by organization for access control queries.
DocTidyWorkspaceSchema.index({ organizationId: 1 });

export default model<IDocTidyWorkspace>('DocTidyWorkspace', DocTidyWorkspaceSchema);
