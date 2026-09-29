import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import DocTidyWorkspace from '../models/DocTidyWorkspace';
import DocTidyOrganization from '../models/DocTidyOrganization';

/* ---------------------------------------------------------------- helpers */

function fail(res: Response, error: unknown, fallback: string): void {
  res.status(500).json({ message: fallback, error: (error as Error).message });
}

/* --------------------------------------------------------------- workspaces */

/**
 * List workspaces with access control.
 *
 * Admin: returns all workspaces (no filter).
 * Regular user: returns workspaces in their accessible organizations
 *               plus workspaces with no organizationId (unassigned / legacy).
 */
export const listWorkspaces = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAdmin = req.user?.role === 'admin';

    if (isAdmin) {
      const workspaces = await DocTidyWorkspace.find().sort({ name: 1 }).lean();
      res.json({ data: workspaces });
      return;
    }

    // Find orgs this user belongs to.
    const accessibleOrgs = await DocTidyOrganization.find(
      { memberUserIds: req.user?.id },
      { _id: 1 }
    ).lean();
    const orgIds = accessibleOrgs.map((o) => String(o._id));

    // Return workspaces that are either in an accessible org OR unassigned.
    const filter = orgIds.length > 0
      ? {
          $or: [
            { organizationId: { $in: orgIds } },
            { organizationId: { $exists: false } },
            { organizationId: null },
          ],
        }
      : {
          $or: [
            { organizationId: { $exists: false } },
            { organizationId: null },
          ],
        };

    const workspaces = await DocTidyWorkspace.find(filter).sort({ name: 1 }).lean();
    res.json({ data: workspaces });
  } catch (error) {
    fail(res, error, 'Failed to load workspaces');
  }
};

export const createWorkspace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, organizationId } = req.body as { name?: unknown; organizationId?: unknown };

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ message: 'name is required' });
      return;
    }

    // Non-admins can only create workspaces in orgs they are members of.
    const isAdmin = req.user?.role === 'admin';
    if (organizationId && typeof organizationId === 'string' && !isAdmin) {
      const org = await DocTidyOrganization.findById(organizationId, { memberUserIds: 1 }).lean();
      if (!org || !org.memberUserIds.includes(req.user?.id ?? '')) {
        res.status(403).json({ message: 'You are not a member of that organization' });
        return;
      }
    }

    const workspace = await DocTidyWorkspace.create({
      name: name.trim(),
      organizationId: organizationId && typeof organizationId === 'string' ? organizationId : undefined,
      createdByUserId: req.user?.id,
      createdByName: req.user?.name,
    });

    res.status(201).json({ data: workspace });
  } catch (error) {
    fail(res, error, 'Failed to create workspace');
  }
};

export const updateWorkspace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid workspace id' });
      return;
    }

    const { name, organizationId } = req.body as { name?: unknown; organizationId?: unknown };
    const update: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ message: 'name must be a non-empty string' });
        return;
      }
      update.name = name.trim();
    }

    // Only admins may reassign a workspace to a different organization.
    if (organizationId !== undefined) {
      if (req.user?.role !== 'admin') {
        res.status(403).json({ message: 'Only admins can assign workspaces to organizations' });
        return;
      }
      update.organizationId = organizationId === null ? null : String(organizationId);
    }

    const workspace = await DocTidyWorkspace.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    ).lean();

    if (!workspace) {
      res.status(404).json({ message: 'Workspace not found' });
      return;
    }

    res.json({ data: workspace });
  } catch (error) {
    fail(res, error, 'Failed to update workspace');
  }
};

/**
 * Deletes a workspace record only. Rules and parse jobs are unaffected.
 */
export const deleteWorkspace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid workspace id' });
      return;
    }

    const workspace = await DocTidyWorkspace.findByIdAndDelete(id);
    if (!workspace) {
      res.status(404).json({ message: 'Workspace not found' });
      return;
    }

    res.json({ data: { deleted: true } });
  } catch (error) {
    fail(res, error, 'Failed to delete workspace');
  }
};
