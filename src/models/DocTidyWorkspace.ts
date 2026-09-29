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
  createdAt: Date;
  updatedAt: Date;
}

const DocTidyWorkspaceSchema = new Schema<IDocTidyWorkspace>(
  {
    name: { type: String, required: true, trim: true },
    organizationId: { type: String, default: undefined },
    createdByUserId: { type: String },
    createdByName: { type: String },
  },
  { timestamps: true }
);

// Listing is alphabetical by name.
DocTidyWorkspaceSchema.index({ name: 1 });
// Fast lookup by organization for access control queries.
DocTidyWorkspaceSchema.index({ organizationId: 1 });

export default model<IDocTidyWorkspace>('DocTidyWorkspace', DocTidyWorkspaceSchema);
