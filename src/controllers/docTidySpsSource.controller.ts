import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import DocTidySpsSource from '../models/DocTidySpsSource';
import {
  ensureAccessToken,
  fetchSpsDocuments,
  fetchSpsDocumentContent,
  fetchAndParseTransactions,
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
 *   ?topLevel=1          — list the mailbox folders under /data/ (ignores dir/docType)
 *   &dir=testout         — mailbox folder (default: SPS_DATA_DIR env, else "out")
 *   &docType=PO          — sub-directory to list (omit to list the folder root)
 *   &poNumber=584615     — optional client-side filter (substring match in filename)
 *   &cursor=<token>      — optional pagination cursor
 */
export const querySpsDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;
    const { topLevel, dir, docType, poNumber, cursor } = req.query as Record<string, string | undefined>;

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
      topLevel: topLevel === '1' || topLevel === 'true',
      dataDir: dir,
      docType,
      poNumberFilter: poNumber,
      cursor,
    });

    res.json({ data: page.records, nextCursor: page.nextCursor ?? null, dataDir: page.dataDir });
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
 * Downloads and parses EDI files from a Transaction API v5 directory,
 * returning structured transaction records (doc type, PO #, invoice #,
 * sender, receiver, date) extracted from the file content.
 *
 * GET /workspaces/:workspaceId/sps-sources/:sourceId/transactions
 *   ?dir=in            — mailbox folder (default: SPS_DATA_DIR env, else "out")
 *   &docType=PO        — sub-directory / document type
 *   &limit=50          — max files to download and parse (default 50, max 200)
 *   &cursor=<token>    — pagination cursor from a previous response
 */
export const queryTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;
    const { dir, docType, limit, cursor } = req.query as Record<string, string | undefined>;

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
    const result = await fetchAndParseTransactions(accessToken, {
      dataDir: dir,
      docType,
      limit:  limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50,
      cursor,
    });

    res.json({
      data:       result.transactions,
      nextCursor: result.nextCursor ?? null,
      dataDir:    result.dataDir,
    });
  } catch (error) {
    if (error instanceof SpsAuthError) {
      res.status(401).json({ message: (error as Error).message });
      return;
    }
    if (error instanceof SpsApiError) {
      res.status(502).json({ message: (error as Error).message });
      return;
    }
    fail(res, error, 'Failed to fetch SPS transactions');
  }
};

/**
 * Downloads the raw EDI XML content of a single SPS document.
 *
 * GET /workspaces/:workspaceId/sps-sources/:sourceId/documents/:docType/:filename
 *   ?dir=testout         — mailbox folder (default: SPS_DATA_DIR env, else "out")
 */
export const getSpsDocumentContent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, sourceId, docType, filename } = req.params;
    const dir = typeof req.query.dir === 'string' ? req.query.dir : undefined;

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
    const content     = await fetchSpsDocumentContent(accessToken, docType, filename, dir);

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
