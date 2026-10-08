import { Schema, model, Document } from 'mongoose';

/**
 * An SPS Commerce OAuth credential scoped to a specific Doc Tidy workspace.
 *
 * Workspaces that configure at least one SPS source use its refresh token
 * to pull invoices via the SPS Commerce API instead of (or alongside) Gmail.
 * Multiple sources per workspace are supported; the extraction service
 * currently uses the first available (token-bearing) source.
 *
 * Mirrors DocTidyEmailSource — same lifecycle, same access-control pattern.
 */
export interface IDocTidySpsSource extends Document {
  /** The workspace this source belongs to. */
  workspaceId: string;

  /** Optional friendly label shown in the UI (e.g. "Brand A SPS account"). */
  label?: string;

  /** The SPS account identifier returned after OAuth (if available). */
  spsAccountId?: string;

  /** The account email/identity shown in the workspace settings UI. */
  spsAccountEmail?: string;

  /** OAuth2 refresh token — never returned by API queries (select: false). */
  spsRefreshToken?: string;

  /** Short-lived access token cached to avoid redundant refresh calls. */
  spsAccessToken?: string;

  /** When the cached access token expires. */
  spsTokenExpiry?: Date;

  spsConnectedAt?: Date;
  spsConnectedByUserId?: string;
  spsConnectedByName?: string;

  createdAt: Date;
  updatedAt: Date;
}

const DocTidySpsSourceSchema = new Schema<IDocTidySpsSource>(
  {
    workspaceId:          { type: String, required: true },
    label:                { type: String, trim: true },
    spsAccountId:         { type: String },
    spsAccountEmail:      { type: String },
    // Secrets — never returned by default; callers must .select('+spsRefreshToken ...')
    spsRefreshToken:      { type: String, select: false },
    spsAccessToken:       { type: String, select: false },
    spsTokenExpiry:       { type: Date,   select: false },
    spsConnectedAt:       { type: Date },
    spsConnectedByUserId: { type: String },
    spsConnectedByName:   { type: String },
  },
  { timestamps: true }
);

// Fast lookup by workspace (the primary access pattern).
DocTidySpsSourceSchema.index({ workspaceId: 1 });

export default model<IDocTidySpsSource>('DocTidySpsSource', DocTidySpsSourceSchema);
