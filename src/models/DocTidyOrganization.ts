import { Schema, model, Document } from 'mongoose';

/**
 * A named container for workspaces, with an explicit member list.
 *
 * Admins see all organizations and all workspaces. Regular users see only
 * organizations where their userId is listed in `memberUserIds`, plus any
 * workspaces that have no organizationId (unassigned / legacy).
 *
 * Deleting an organization does NOT delete its workspaces — they are unassigned
 * (organizationId cleared) so they remain accessible to all users.
 */
export interface IDocTidyOrganization extends Document {
  name: string;
  /** User IDs of members who can view workspaces inside this organization. */
  memberUserIds: string[];
  createdByUserId?: string;
  createdByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DocTidyOrganizationSchema = new Schema<IDocTidyOrganization>(
  {
    name: { type: String, required: true, trim: true },
    memberUserIds: { type: [String], default: [] },
    createdByUserId: { type: String },
    createdByName: { type: String },
  },
  { timestamps: true }
);

// Listing is alphabetical by name.
DocTidyOrganizationSchema.index({ name: 1 });
// Fast member lookup for access control.
DocTidyOrganizationSchema.index({ memberUserIds: 1 });

export default model<IDocTidyOrganization>('DocTidyOrganization', DocTidyOrganizationSchema);
