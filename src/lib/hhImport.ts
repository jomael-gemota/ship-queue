export interface HhImportOrderRow {
  orderId: string;
  po: string;
}

export interface HhImportParseOk {
  orders: HhImportOrderRow[];
  duplicateRowsSkipped: number;
  incompleteRowsSkipped: number;
}

export type HhImportParseResult = HhImportParseOk | { error: string };

export const HH_IMPORT_MAX_ORDERS = 500;
export const HH_IMPORT_MAX_ROWS = 5000;
export const HH_IMPORT_MAX_PASTE_CHARS = 1_000_000;

const AMAZON_ORDER_ID_RE = /^\d{3}-\d{7}-\d{7}$/;

const ORDER_HEADERS = new Set([
  'orderid',
  'amazonorderid',
  'amazonorder',
  'amzorderid',
  'amzorder',
  'order',
  'ordernumber',
  'orderno',
  'ordernum',
]);

const PO_HEADERS = new Set([
  'po',
  'ponumber',
  'ponum',
  'poid',
  'purchaseorder',
  'purchaseordernumber',
  'purchaseorderno',
]);

export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function looksLikeAmazonOrderId(value: string): boolean {
  return AMAZON_ORDER_ID_RE.test(value.trim());
}

export function cellToString(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text.trim();
    if (typeof record.richText === 'object' && Array.isArray(record.richText)) {
      return record.richText
        .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
        .join('')
        .trim();
    }
    if ('result' in record) return cellToString(record.result);
    if (typeof record.hyperlink === 'string') return cellToString(record.text ?? record.hyperlink);
  }
  return String(value).trim();
}

type ImportDelimiter = '\t' | ',' | ';' | 'whitespace';

export function detectImportDelimiter(lines: string[]): ImportDelimiter {
  for (const line of lines) {
    const sample = line.trim();
    if (!sample) continue;
    if (sample.includes('\t')) return '\t';
    if (sample.includes(',')) return ',';
    if (sample.includes(';')) return ';';
    return 'whitespace';
  }
  return ',';
}

/** Parses a delimited row, respecting double-quoted fields. */
export function parseDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/** Parses a single CSV row, respecting double-quoted fields. */
export function parseCsvLine(line: string): string[] {
  return parseDelimitedLine(line, ',');
}

function splitImportLine(line: string, delimiter: ImportDelimiter): string[] {
  if (delimiter === 'whitespace') {
    const trimmed = line.trim();
    return trimmed ? trimmed.split(/\s+/) : [''];
  }
  return parseDelimitedLine(line, delimiter);
}

function inferOrderAndPoIndexes(rows: string[][]): { orderIdx: number; poIdx: number } | { error: string } {
  const populated = new Set<number>();
  const orderHits = new Map<number, number>();

  for (const row of rows) {
    row.forEach((cell, idx) => {
      if (!cell.trim()) return;
      populated.add(idx);
      if (looksLikeAmazonOrderId(cell)) {
        orderHits.set(idx, (orderHits.get(idx) ?? 0) + 1);
      }
    });
  }

  const cols = [...populated].sort((a, b) => a - b);
  if (cols.length < 2) {
    return { error: 'Each row needs an Order ID and a PO Number.' };
  }

  let orderIdx = -1;
  let best = 0;
  for (const col of cols) {
    const hits = orderHits.get(col) ?? 0;
    if (hits > best) {
      best = hits;
      orderIdx = col;
    }
  }
  if (orderIdx === -1 || best === 0) {
    return {
      error: 'Add Order ID and PO Number headers, or paste Amazon Order IDs in one column.',
    };
  }

  const poIdx = cols.find((col) => col !== orderIdx);
  if (poIdx == null) {
    return { error: 'Each row needs an Order ID and a PO Number.' };
  }
  return { orderIdx, poIdx };
}

export function parseHhImportText(text: string): HhImportParseResult {
  const normalized = text.replace(/^\uFEFF/, '');
  if (!normalized.trim()) return { error: 'Paste Order ID and PO Number rows, or upload a file.' };
  if (normalized.length > HH_IMPORT_MAX_PASTE_CHARS) {
    return { error: 'Pasted text is too large.' };
  }
  const lines = normalized.split(/\r?\n/);
  const delimiter = detectImportDelimiter(lines);
  const rows = lines.map((line) => splitImportLine(line, delimiter).map((cell) => cell.trim()));
  return parseHhImportMatrix(rows);
}

export function parseHhImportCsv(text: string): HhImportParseResult {
  return parseHhImportText(text);
}

export function parseHhImportMatrix(rows: string[][]): HhImportParseResult {
  let firstIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].some((cell) => cell.trim() !== '')) {
      firstIndex = i;
      break;
    }
  }
  if (firstIndex === -1) return { error: 'The file is empty.' };

  const header = rows[firstIndex].map((cell) => normalizeHeader(cell));
  const orderFromHeader = header.findIndex((h) => ORDER_HEADERS.has(h));
  const poFromHeader = header.findIndex((h) => PO_HEADERS.has(h));
  const hasOrderHeader = orderFromHeader !== -1;
  const hasPoHeader = poFromHeader !== -1;

  let orderIdx: number;
  let poIdx: number;
  let dataRows: string[][];

  if (hasOrderHeader && hasPoHeader) {
    if (orderFromHeader === poFromHeader) {
      return { error: 'Order ID and PO Number must be separate columns.' };
    }
    orderIdx = orderFromHeader;
    poIdx = poFromHeader;
    dataRows = rows.slice(firstIndex + 1);
  } else if (hasOrderHeader || hasPoHeader) {
    return { error: 'The spreadsheet needs Order ID and PO Number columns.' };
  } else {
    const inferred = inferOrderAndPoIndexes(rows.slice(firstIndex));
    if ('error' in inferred) return inferred;
    orderIdx = inferred.orderIdx;
    poIdx = inferred.poIdx;
    dataRows = rows.slice(firstIndex);
  }

  if (dataRows.length > HH_IMPORT_MAX_ROWS) {
    return { error: `The spreadsheet has too many rows (max ${HH_IMPORT_MAX_ROWS}).` };
  }

  const seen = new Set<string>();
  const orders: HhImportOrderRow[] = [];
  let duplicateRowsSkipped = 0;
  let incompleteRowsSkipped = 0;

  for (const row of dataRows) {
    const orderId = (row[orderIdx] ?? '').trim();
    const po = (row[poIdx] ?? '').trim();
    if (!orderId && !po) continue;
    if (!orderId || !po) {
      incompleteRowsSkipped += 1;
      continue;
    }
    const key = `${orderId}\u0000${po}`;
    if (seen.has(key)) {
      duplicateRowsSkipped += 1;
      continue;
    }
    seen.add(key);
    orders.push({ orderId, po });
    if (orders.length > HH_IMPORT_MAX_ORDERS) {
      return { error: `Too many unique orders (max ${HH_IMPORT_MAX_ORDERS}).` };
    }
  }

  if (orders.length === 0) {
    return { error: 'No Order ID / PO Number rows found.' };
  }

  return { orders, duplicateRowsSkipped, incompleteRowsSkipped };
}
