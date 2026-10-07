import { Schema, model, Document } from 'mongoose';

/**
 * A Gmail OAuth credential scoped to a specific Doc Tidy workspace.
 *
 * Workspaces that configure at least one email source use its refresh token
 * instead of the global DocTidyConfig token when running their rules. Workspaces
 * with no sources automatically fall back to the global config (backward compat).
 *
 * Multiple sources per workspace are supported; the extraction service currently
 * uses the first available (token-bearing) source. Extension to per-rule or
 * round-robin selection is left for future work.
 */
export interface IDocTidyEmailSource extends Document {
  /** The workspace this source belongs to. */
  workspaceId: string;

  /** Optional friendly label shown in the UI (e.g. "Brand A mailbox"). */
  label?: string;

  /** The Gmail address that was authorised; shown in the workspace settings UI. */
  emailAddress?: string;

  /** OAuth2 refresh token — never returned by API queries (select: false). */
  gmailRefreshToken?: string;

  gmailConnectedAt?: Date;
  gmailConnectedByUserId?: string;
  gmailConnectedByName?: string;

  createdAt: Date;
  updatedAt: Date;
}

const DocTidyEmailSourceSchema = new Schema<IDocTidyEmailSource>(
  {
    workspaceId: { type: String, required: true },
    label: { type: String, trim: true },
    emailAddress: { type: String },
    gmailRefreshToken: { type: String, select: false },
    gmailConnectedAt: { type: Date },
    gmailConnectedByUserId: { type: String },
    gmailConnectedByName: { type: String },
  },
  { timestamps: true }
);

// Fast lookup by workspace (the primary access pattern).
DocTidyEmailSourceSchema.index({ workspaceId: 1 });

export default model<IDocTidyEmailSource>('DocTidyEmailSource', DocTidyEmailSourceSchema);
