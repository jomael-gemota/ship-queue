import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import DocTidyOrganization from '../models/DocTidyOrganization';
import DocTidyWorkspace from '../models/DocTidyWorkspace';
import User from '../models/User';

/* ---------------------------------------------------------------- helpers */

function fail(res: Response, error: unknown, fallback: string): void {
  res.status(500).json({ message: fallback, error: (error as Error).message });
}

/* --------------------------------------------------------- organizations */

/**
 * List organizations.
 * Admin: returns all, hasAccess=true on every org.
 * Regular user: returns all orgs, hasAccess=true only for orgs they are a member of.
 */
export const listOrganizations = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const userId  = req.user?.id ?? '';
    const orgs = await DocTidyOrganization.find({}).sort({ name: 1 }).lean();
    const data = orgs.map((org) => ({
      ...org,
      hasAccess: isAdmin || org.memberUserIds.some((id) => String(id) === userId),
    }));
    res.json({ data });
  } catch (error) {
    fail(res, error, 'Failed to load organizations');
  }
};

/** Create an organization. Admin only. */
export const createOrganization = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, memberUserIds } = req.body as { name?: unknown; memberUserIds?: unknown };

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ message: 'name is required' });
      return;
    }

    const org = await DocTidyOrganization.create({
      name: name.trim(),
      memberUserIds: Array.isArray(memberUserIds)
        ? memberUserIds.filter((id) => typeof id === 'string')
        : [],
      createdByUserId: req.user?.id,
      createdByName: req.user?.name,
    });

    res.status(201).json({ data: org });
  } catch (error) {
    fail(res, error, 'Failed to create organization');
  }
};

/** Update name and/or member list. Admin only. */
export const updateOrganization = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid organization id' });
      return;
    }

    const { name, memberUserIds } = req.body as { name?: unknown; memberUserIds?: unknown };
    const update: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ message: 'name must be a non-empty string' });
        return;
      }
      update.name = name.trim();
    }

    if (memberUserIds !== undefined) {
      if (!Array.isArray(memberUserIds)) {
        res.status(400).json({ message: 'memberUserIds must be an array' });
        return;
      }
      update.memberUserIds = memberUserIds.filter((id) => typeof id === 'string');
    }

    const org = await DocTidyOrganization.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    ).lean();

    if (!org) {
      res.status(404).json({ message: 'Organization not found' });
      return;
    }

    res.json({ data: org });
  } catch (error) {
    fail(res, error, 'Failed to update organization');
  }
};

/**
 * Delete an organization. Workspaces are unassigned (organizationId cleared),
 * not deleted. Admin only.
 */
export const deleteOrganization = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid organization id' });
      return;
    }

    const org = await DocTidyOrganization.findByIdAndDelete(id);
    if (!org) {
      res.status(404).json({ message: 'Organization not found' });
      return;
    }

    // Unassign workspaces that belonged to this org so they become visible to all users again.
    await DocTidyWorkspace.updateMany(
      { organizationId: id },
      { $unset: { organizationId: 1 } }
    );

    res.json({ data: { deleted: true } });
  } catch (error) {
    fail(res, error, 'Failed to delete organization');
  }
};

/**
 * List all users (name, email, avatar only).
 * Used by the admin's member-picker when editing an organization.
 * Admin only.
 */
export const listUsersForOrg = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await User.find({})
      .select('_id name email avatar role')
      .sort({ name: 1 })
      .lean();
    res.json({ data: users });
  } catch (error) {
    fail(res, error, 'Failed to load users');
  }
};
