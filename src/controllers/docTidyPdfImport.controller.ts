import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import multer from 'multer';
import DocTidyPdfImport from '../models/DocTidyPdfImport';
import { ParseRequestError, storePdf, requestParseFromGridFS } from '../services/docTidyParse.service';

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

/* ── List imports for a workspace ── */
export const listPdfImports = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.query as Record<string, string | undefined>;
    if (!workspaceId || !isValidObjectId(workspaceId)) {
      res.status(400).json({ message: 'A valid workspaceId is required' });
      return;
    }

    const imports = await DocTidyPdfImport.find({ workspaceId })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.json({ data: imports });
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

    const created = await Promise.all(
      files.map(async (file) => {
        const pdfFileId = await storePdf(file.originalname, file.buffer);
        return DocTidyPdfImport.create({
          workspaceId,
          filename: file.originalname,
          size: file.size,
          pdfFileId,
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
      { id: req.user?.id, name: req.user?.name }
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
