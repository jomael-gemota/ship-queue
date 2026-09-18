import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import DocTidyWorkspace from '../models/DocTidyWorkspace';

/* ---------------------------------------------------------------- helpers */

function fail(res: Response, error: unknown, fallback: string): void {
  res.status(500).json({ message: fallback, error: (error as Error).message });
}

/* --------------------------------------------------------------- workspaces */

export const listWorkspaces = async (_req: Request, res: Response): Promise<void> => {
  try {
    const workspaces = await DocTidyWorkspace.find().sort({ name: 1 }).lean();
    res.json({ data: workspaces });
  } catch (error) {
    fail(res, error, 'Failed to load workspaces');
  }
};

export const createWorkspace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body as { name?: unknown };

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ message: 'name is required' });
      return;
    }

    const workspace = await DocTidyWorkspace.create({
      name: name.trim(),
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

    const { name } = req.body as { name?: unknown };
    const update: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ message: 'name must be a non-empty string' });
        return;
      }
      update.name = name.trim();
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
