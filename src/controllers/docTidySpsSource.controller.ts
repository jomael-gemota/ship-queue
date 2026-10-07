import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import DocTidySpsSource from '../models/DocTidySpsSource';
import {
  ensureAccessToken,
  fetchSpsDocuments,
  fetchSpsDocumentContent,
  SpsAuthError,
  SpsApiError,
} from '../services/sps.service';

function fail(res: Response, error: unknown, fallback: string): void {
  res.status(500).json({ message: fallback, error: (error as Error).message });
}

/**
 * Lists all SPS Commerce sources for a workspace.
 * Refresh / access tokens are never included in the response (select: false).
 */
export const listSpsSources = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;

    if (!workspaceId) {
      res.status(400).json({ message: 'workspaceId is required' });
      return;
    }

    const sources = await DocTidySpsSource.find({ workspaceId })
      .sort({ spsConnectedAt: -1 })
      .lean();

    res.json({ data: sources });
  } catch (error) {
    fail(res, error, 'Failed to load SPS Commerce sources');
  }
};

/**
 * Deletes a per-workspace SPS Commerce source.
 */
export const deleteSpsSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;

    if (!isValidObjectId(sourceId)) {
      res.status(400).json({ message: 'Invalid source id' });
      return;
    }

    const source = await DocTidySpsSource.findOneAndDelete({
      _id: sourceId,
      workspaceId,
    });

    if (!source) {
      res.status(404).json({ message: 'SPS Commerce source not found' });
      return;
    }

    res.json({ data: { deleted: true } });
  } catch (error) {
    fail(res, error, 'Failed to delete SPS Commerce source');
  }
};

/**
 * Lists SPS document files for a workspace source.
 *
 * GET /workspaces/:workspaceId/sps-sources/:sourceId/documents
 *   ?docType=PO          — sub-directory to list (default: PO)
 *   &poNumber=584615     — optional client-side filter (substring match in filename)
 *   &cursor=<token>      — optional pagination cursor
 */
export const querySpsDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;
    const { docType, poNumber, cursor } = req.query as Record<string, string | undefined>;

    if (!isValidObjectId(sourceId)) {
      res.status(400).json({ message: 'Invalid source id' });
      return;
    }

    const source = await DocTidySpsSource.findOne({ _id: sourceId, workspaceId })
      .select('+spsRefreshToken +spsAccessToken +spsTokenExpiry');

    if (!source) {
      res.status(404).json({ message: 'SPS Commerce source not found' });
      return;
    }

    const accessToken = await ensureAccessToken(source);
    const page = await fetchSpsDocuments(accessToken, {
      docType,
      poNumberFilter: poNumber,
      cursor,
    });

    res.json({ data: page.records, nextCursor: page.nextCursor ?? null });
  } catch (error) {
    if (error instanceof SpsAuthError) {
      res.status(401).json({ message: error.message });
      return;
    }
    if (error instanceof SpsApiError) {
      res.status(502).json({ message: error.message });
      return;
    }
    fail(res, error, 'Failed to list SPS documents');
  }
};

/** @deprecated Alias — use querySpsDocuments instead. */
export const querySpsInvoices = querySpsDocuments;

/**
 * Downloads the raw EDI XML content of a single SPS document.
 *
 * GET /workspaces/:workspaceId/sps-sources/:sourceId/documents/:docType/:filename
 */
export const getSpsDocumentContent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, sourceId, docType, filename } = req.params;

    if (!isValidObjectId(sourceId)) {
      res.status(400).json({ message: 'Invalid source id' });
      return;
    }
    if (!docType || !filename) {
      res.status(400).json({ message: 'docType and filename are required' });
      return;
    }

    const source = await DocTidySpsSource.findOne({ _id: sourceId, workspaceId })
      .select('+spsRefreshToken +spsAccessToken +spsTokenExpiry');

    if (!source) {
      res.status(404).json({ message: 'SPS Commerce source not found' });
      return;
    }

    const accessToken = await ensureAccessToken(source);
    const content     = await fetchSpsDocumentContent(accessToken, docType, filename);

    // Return wrapped JSON so the frontend authApi (which always parses JSON) works correctly.
    res.json({ data: content });
  } catch (error) {
    if (error instanceof SpsAuthError) {
      res.status(401).json({ message: error.message });
      return;
    }
    if (error instanceof SpsApiError) {
      res.status(502).json({ message: error.message });
      return;
    }
    fail(res, error, 'Failed to download SPS document');
  }
};
