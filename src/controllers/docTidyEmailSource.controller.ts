import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import DocTidyEmailSource from '../models/DocTidyEmailSource';

function fail(res: Response, error: unknown, fallback: string): void {
  res.status(500).json({ message: fallback, error: (error as Error).message });
}

/**
 * Lists all email sources for a workspace.
 * Refresh tokens are never included in the response (select: false on model).
 */
export const listEmailSources = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;

    if (!workspaceId) {
      res.status(400).json({ message: 'workspaceId is required' });
      return;
    }

    const sources = await DocTidyEmailSource.find({ workspaceId })
      .sort({ gmailConnectedAt: -1 })
      .lean();

    res.json({ data: sources });
  } catch (error) {
    fail(res, error, 'Failed to load email sources');
  }
};

/**
 * Deletes a per-workspace email source. Admin only.
 */
export const deleteEmailSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;

    if (!isValidObjectId(sourceId)) {
      res.status(400).json({ message: 'Invalid source id' });
      return;
    }

    const source = await DocTidyEmailSource.findOneAndDelete({
      _id: sourceId,
      workspaceId,
    });

    if (!source) {
      res.status(404).json({ message: 'Email source not found' });
      return;
    }

    res.json({ data: { deleted: true } });
  } catch (error) {
    fail(res, error, 'Failed to delete email source');
  }
};
