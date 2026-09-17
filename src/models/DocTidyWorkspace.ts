import { Schema, model, Document, Types } from 'mongoose';

/**
 * A named view over a subset of filter rules.
 *
 * Workspaces are team-wide (like rules and vendors). The relationship to rules
 * is many-to-many: the same rule can be referenced by multiple workspaces, and
 * deleting a workspace never affects the rule itself.
 */
export interface IDocTidyWorkspace extends Document {
  name: string;
  /** Rule IDs this workspace aggregates. Order is preserved for display. */
  ruleIds: Types.ObjectId[];
  createdByUserId?: string;
  createdByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DocTidyWorkspaceSchema = new Schema<IDocTidyWorkspace>(
  {
    name: { type: String, required: true, trim: true },
    ruleIds: [{ type: Schema.Types.ObjectId, ref: 'DocTidyRule' }],
    createdByUserId: { type: String },
    createdByName: { type: String },
  },
  { timestamps: true }
);

// Listing is alphabetical by name.
DocTidyWorkspaceSchema.index({ name: 1 });

export default model<IDocTidyWorkspace>('DocTidyWorkspace', DocTidyWorkspaceSchema);
