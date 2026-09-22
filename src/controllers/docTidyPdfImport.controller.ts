import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import multer from 'multer';
import { Types } from 'mongoose';
import DocTidyPdfImport from '../models/DocTidyPdfImport';
import DocTidyParseJob from '../models/DocTidyParseJob';
import { ParseRequestError, storePdf, requestParseFromGridFS } from '../services/docTidyParse.service';
import { getDocTidyConfigDoc } from '../models/DocTidyConfig';
import { uploadBufferToDrive } from '../services/googleDrive.service';

/* ── multer — memory storage; bytes go straight into GridFS ── */
export const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  },
});

function fail(res: Response, error: unknown, fallback: string): void {
  if (error instanceof ParseRequestError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  res.status(500).json({ message: fallback, error: (error as Error).message });
}

/* ── List imports for a workspace (with search, date range, pagination) ── */
export const listPdfImports = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      workspaceId,
      search,
      dateFrom,
      dateTo,
      page = '1',
      pageSize = '100',
    } = req.query as Record<string, string | undefined>;

    if (!workspaceId || !isValidObjectId(workspaceId)) {
      res.status(400).json({ message: 'A valid workspaceId is required' });
      return;
    }

    const filter: Record<string, unknown> = { workspaceId };

    if (search?.trim()) {
      filter.filename = { $regex: search.trim(), $options: 'i' };
    }

    if (dateFrom || dateTo) {
      const range: Record<string, Date> = {};
      if (dateFrom) range.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
      }
      filter.createdAt = range;
    }

    const pg = Math.max(1, parseInt(page, 10));
    const size = Math.min(500, Math.max(1, parseInt(pageSize, 10)));

    const [imports, total] = await Promise.all([
      DocTidyPdfImport.find(filter)
        .sort({ createdAt: -1 })
        .skip((pg - 1) * size)
        .limit(size)
        .lean(),
      DocTidyPdfImport.countDocuments(filter),
    ]);

    // Inline parse job status so the frontend can render multi-state action buttons.
    const parseJobIds = imports
      .map((i) => i.parseJobId)
      .filter((id): id is Types.ObjectId => Boolean(id));

    const parseJobs = parseJobIds.length > 0
      ? await DocTidyParseJob.find({ _id: { $in: parseJobIds } })
          .select('_id status error')
          .lean()
      : [];

    const parseJobMap = new Map(parseJobs.map((j) => [String(j._id), j]));

    const data = imports.map((imp) => ({
      ...imp,
      parseJob: imp.parseJobId ? (parseJobMap.get(String(imp.parseJobId)) ?? null) : null,
    }));

    res.json({
      data,
      pagination: { page: pg, pageSize: size, total, pages: Math.max(1, Math.ceil(total / size)) },
    });
  } catch (error) {
    fail(res, error, 'Failed to list PDF imports');
  }
};

/* ── Upload one or more PDFs ── */
export const uploadPdfImports = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.body as { workspaceId?: string };
    if (!workspaceId || !isValidObjectId(workspaceId)) {
      res.status(400).json({ message: 'A valid workspaceId is required' });
      return;
    }

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ message: 'At least one PDF file is required' });
      return;
    }

    // Load Drive config once for all files (best-effort mirror — do not block
    // the upload if Drive is not connected or the upload fails).
    const config = await getDocTidyConfigDoc(true).catch(() => null);
    const driveReady = Boolean(config?.gmailRefreshToken && config?.driveFolderId);

    const created = await Promise.all(
      files.map(async (file) => {
        // 1. Store in GridFS (the worker reads from here).
        const pdfFileId = await storePdf(file.originalname, file.buffer);

        // 2. Mirror to Drive in the same folder as email PDFs (best-effort).
        let driveFileId: string | undefined;
        let driveWebViewLink: string | undefined;
        if (driveReady && config) {
          try {
            const uploaded = await uploadBufferToDrive(
              { refreshToken: config.gmailRefreshToken },
              file.originalname,
              'application/pdf',
              file.buffer,
              config.driveFolderId
            );
            driveFileId = uploaded.id || undefined;
            driveWebViewLink = uploaded.webViewLink || undefined;
          } catch {
            // Non-fatal: GridFS copy is the authoritative source for parsing.
          }
        }

        return DocTidyPdfImport.create({
          workspaceId,
          filename: file.originalname,
          size: file.size,
          pdfFileId,
          driveFileId,
          driveWebViewLink,
          uploadedByUserId: req.user?.id,
          uploadedByName: req.user?.name,
        });
      })
    );

    res.status(201).json({ data: created });
  } catch (error) {
    fail(res, error, 'Failed to upload PDF imports');
  }
};

/* ── Send one import to the Tidy Agent ── */
export const sendPdfImportToAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid import id' });
      return;
    }

    const imp = await DocTidyPdfImport.findById(id);
    if (!imp) {
      res.status(404).json({ message: 'PDF import not found' });
      return;
    }

    const job = await requestParseFromGridFS(
      imp.pdfFileId,
      imp.filename,
      String(imp._id),
      { id: req.user?.id, name: req.user?.name },
      imp.driveFileId
    );

    // Link the parse job back to the import record.
    imp.parseJobId = job._id;
    await imp.save();

    res.status(202).json({ data: { import: imp, job } });
  } catch (error) {
    fail(res, error, 'Failed to send PDF import to Tidy Agent');
  }
};

/* ── Delete an import (and its GridFS file) ── */
export const deletePdfImport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid import id' });
      return;
    }

    const imp = await DocTidyPdfImport.findByIdAndDelete(id);
    if (!imp) {
      res.status(404).json({ message: 'PDF import not found' });
      return;
    }

    res.json({ data: { deleted: true } });
  } catch (error) {
    fail(res, error, 'Failed to delete PDF import');
  }
};
