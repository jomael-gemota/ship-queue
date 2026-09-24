import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import DocTidyOrderImport, { IDocTidyOrderImport } from '../models/DocTidyOrderImport';
import { populateCogsForBatch, populateCogsForWorkspace } from '../services/dcCogs.service';

/* ── multer — memory storage; parsing happens in this controller ── */
export const orderImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const ok =
      name.endsWith('.csv') ||
      name.endsWith('.xlsx') ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (ok) cb(null, true);
    else cb(new Error('Only CSV and XLSX files are accepted'));
  },
});

/* ── Header normalisation ── */

/**
 * Strips spaces, `#`, `_`, `-`, `.` and lowercases a header string.
 * "PO #" → "po", "Order SKU" → "ordersku", "Processed Date" → "processeddate"
 */
function normHeader(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[\s#_\-\.]+/g, '');
}

const HEADER_MAP: Record<string, keyof Omit<IDocTidyOrderImport, '_id' | 'workspaceId' | 'importBatchId' | 'importedByUserId' | 'importedByName' | 'createdAt' | 'updatedAt'>> = {
  processeddate:          'processedDate',
  processingdate:         'processedDate',
  po:                     'poNumber',
  ponumber:               'poNumber',
  purchaseordernumber:    'poNumber',
  purchaseddate:          'purchasedDate',
  purchasedate:           'purchasedDate',
  orderdate:              'purchasedDate',
  customername:           'customerName',
  customer:               'customerName',
  name:                   'customerName',
  orderid:                'orderId',
  ordersku:               'orderSku',
  sku:                    'orderSku',
  itemsku:                'orderSku',
  orderqty:               'orderQty',
  qty:                    'orderQty',
  quantity:               'orderQty',
  orderedqty:             'orderQty',
  orderedquantity:        'orderQty',
  status:                 'status',
  orderstatus:            'status',
};

/** Format an ExcelJS cell value as a plain string. */
function cellStr(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Format as YYYY-MM-DD
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = value as any;
    if ('result' in obj) {
      // Formula cell — use the computed result
      return cellStr(obj.result as ExcelJS.CellValue);
    }
    if ('richText' in obj && Array.isArray(obj.richText)) {
      // Rich-text cell — concatenate the text runs
      return (obj.richText as { text: string }[]).map((r) => r.text).join('');
    }
  }
  return String(value).trim();
}

/**
 * Read a worksheet (already loaded into a Workbook) and return an array of
 * row objects keyed by normalised header name.
 */
function sheetToRows(sheet: ExcelJS.Worksheet): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  let headers: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    const cells = row.values as ExcelJS.CellValue[]; // 1-indexed; index 0 is undefined
    const values = cells.slice(1).map(cellStr); // shift to 0-indexed

    if (rowNumber === 1) {
      headers = values.map(normHeader);
      return;
    }

    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      if (headers[i]) obj[headers[i]] = values[i] ?? '';
    }
    // Skip entirely empty rows
    if (Object.values(obj).every((v) => !v)) return;
    rows.push(obj);
  });

  return rows;
}

/** Parse a buffer into worksheet rows (auto-detects XLSX vs. CSV by filename). */
async function parseFileBuffer(
  buffer: Buffer,
  filename: string
): Promise<Record<string, string>[]> {
  const wb = new ExcelJS.Workbook();
  if (filename.toLowerCase().endsWith('.csv')) {
    const stream = Readable.from(buffer.toString('utf8'));
    await wb.csv.read(stream);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);
  }
  const sheet = wb.getWorksheet(1);
  if (!sheet) return [];
  return sheetToRows(sheet);
}

function fail(res: Response, error: unknown, fallback: string): void {
  console.error(fallback, error);
  res.status(500).json({ message: fallback, error: (error as Error).message });
}

/* ── List order imports for a workspace ── */
export const listOrderImports = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      workspaceId,
      search,
      page = '1',
      pageSize = '500',
    } = req.query as Record<string, string | undefined>;

    if (!workspaceId || !isValidObjectId(workspaceId)) {
      res.status(400).json({ message: 'A valid workspaceId is required' });
      return;
    }

    const filter: Record<string, unknown> = { workspaceId };

    if (search?.trim()) {
      const re = { $regex: search.trim(), $options: 'i' };
      filter.$or = [
        { poNumber: re },
        { orderSku: re },
        { customerName: re },
        { orderId: re },
        { status: re },
      ];
    }

    const pg   = Math.max(1, parseInt(page, 10));
    const size = Math.min(5000, Math.max(1, parseInt(pageSize, 10)));

    const [data, total] = await Promise.all([
      DocTidyOrderImport.find(filter)
        .sort({ createdAt: -1 })
        .skip((pg - 1) * size)
        .limit(size)
        .lean(),
      DocTidyOrderImport.countDocuments(filter),
    ]);

    res.json({
      data,
      pagination: {
        page: pg,
        pageSize: size,
        total,
        pages: Math.max(1, Math.ceil(total / size)),
      },
    });
  } catch (error) {
    fail(res, error, 'Failed to list order imports');
  }
};

/* ── Upload a CSV/XLSX file and create one record per data row ── */
export const uploadOrderImports = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.body as { workspaceId?: string };
    if (!workspaceId || !isValidObjectId(workspaceId)) {
      res.status(400).json({ message: 'A valid workspaceId is required' });
      return;
    }

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ message: 'A CSV or XLSX file is required' });
      return;
    }

    const importBatchId = `${workspaceId}-${Date.now()}`;

    let rows: Record<string, string>[];
    try {
      rows = await parseFileBuffer(file.buffer, file.originalname);
    } catch (parseErr) {
      res.status(422).json({
        message: 'Failed to parse the uploaded file. Make sure it is a valid CSV or XLSX.',
        error: (parseErr as Error).message,
      });
      return;
    }

    if (rows.length === 0) {
      res.status(422).json({ message: 'The file contained no data rows.' });
      return;
    }

    // Map each row to a DocTidyOrderImport document
    const docs = rows.map((row) => {
      const record: Record<string, unknown> = {
        workspaceId,
        importBatchId,
        processedDate: '',
        poNumber: '',
        purchasedDate: '',
        customerName: '',
        orderId: '',
        orderSku: '',
        orderQty: '',
        status: '',
        importedByUserId: req.user?.id,
        importedByName: req.user?.name,
      };

      for (const [normKey, value] of Object.entries(row)) {
        const field = HEADER_MAP[normKey];
        if (field) record[field] = value;
      }

      return record;
    });

    const created = await DocTidyOrderImport.insertMany(docs);

    res.status(201).json({
      data: created,
      importBatchId,
      count: created.length,
    });

    // Fire-and-forget: populate DC COGS for the new batch in the background.
    // This does NOT block the response — the frontend can re-fetch order
    // imports after a moment to pick up the populated values.
    void populateCogsForBatch(importBatchId);
  } catch (error) {
    fail(res, error, 'Failed to upload order imports');
  }
};

/* ── Re-trigger DC COGS lookup for all pending rows in a workspace ── */
export const refreshCogsForWorkspace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    if (!isValidObjectId(workspaceId)) {
      res.status(400).json({ message: 'Invalid workspaceId' });
      return;
    }

    const pendingCount = await DocTidyOrderImport.countDocuments({ workspaceId, dcCogs: null });

    // Fire-and-forget — response returns immediately with the count of rows queued.
    void populateCogsForWorkspace(workspaceId);

    res.json({ queued: pendingCount });
  } catch (error) {
    fail(res, error, 'Failed to queue COGS refresh');
  }
};

/* ── Delete a single order import record ── */
export const deleteOrderImport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid import id' });
      return;
    }

    const doc = await DocTidyOrderImport.findByIdAndDelete(id);
    if (!doc) {
      res.status(404).json({ message: 'Order import not found' });
      return;
    }

    res.json({ data: { deleted: true } });
  } catch (error) {
    fail(res, error, 'Failed to delete order import');
  }
};

/* ── Delete all records belonging to a batch ── */
export const deleteOrderImportBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { batchId } = req.params;
    if (!batchId) {
      res.status(400).json({ message: 'batchId is required' });
      return;
    }

    const result = await DocTidyOrderImport.deleteMany({ importBatchId: batchId });
    res.json({ data: { deleted: result.deletedCount } });
  } catch (error) {
    fail(res, error, 'Failed to delete order import batch');
  }
};
