import ExcelJS from 'exceljs';
import { cellToString, detectImportDelimiter, parseDelimitedLine } from './hhImport';

const SKU_HEADERS = ['sku', 'itemsku', 'sellersku', 'productsku', 'style', 'item'];
const PORTAL_HEADERS = ['b2bsku', 'portalsku', 'thorogoodsku'];
const QTY_HEADERS = ['quantity', 'qty', 'orderqty', 'qtyordered'];
const MAX_DATA_ROWS = 500;
const MAX_SKUS = 200;

export interface BulkItemLine {
  /** Seller Central code, such as TG-804-3166_12-M-V2. Empty when the file only has a B2B SKU. */
  sellerSku: string;
  /** Thorogood portal code. Empty when the file only has the seller SKU. */
  portalSku: string;
  quantity: number;
}

export type BulkItemParseResult = { items: BulkItemLine[] } | { error: string };

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseQty(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, '');
  if (!/^\d+(\.0+)?$/.test(trimmed)) return null;
  const qty = Number(trimmed);
  if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 99999) return null;
  return qty;
}

function columnIndex(header: string[], names: string[]): number {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index !== -1) return index;
  }
  return -1;
}

function joinSellerSku(current: string, next: string): string {
  const add = next.trim();
  if (!add) return current;
  if (!current) return add;
  const parts = current.split(', ');
  if (parts.some((part) => part.toUpperCase() === add.toUpperCase())) return current;
  return `${current}, ${add}`;
}

/** Without headers, the last number is the quantity. Three cells are SKU, B2B SKU, and Quantity. */
function readLine(
  row: string[],
  skuIdx: number,
  portalIdx: number,
  qtyIdx: number,
  headerFound: boolean,
): { sellerSku: string; portalSku: string; qtyText: string } {
  if (!headerFound) {
    const cells = row.map((cell) => cell.trim()).filter(Boolean);
    const qtyText = cells[cells.length - 1] ?? '';
    if (cells.length >= 3 && parseQty(qtyText) != null) {
      return { sellerSku: cells[0], portalSku: cells.slice(1, -1).join(' '), qtyText };
    }
    if (cells.length >= 2 && parseQty(qtyText) != null) {
      return { sellerSku: cells.slice(0, -1).join(' '), portalSku: '', qtyText };
    }
  }
  return {
    sellerSku: skuIdx >= 0 ? (row[skuIdx] ?? '').trim() : '',
    portalSku: portalIdx >= 0 ? (row[portalIdx] ?? '').trim() : '',
    qtyText: (row[qtyIdx] ?? '').trim(),
  };
}

function splitRow(line: string, delimiter: ReturnType<typeof detectImportDelimiter>): string[] {
  if (delimiter === 'whitespace') {
    const trimmed = line.trim();
    return trimmed ? trimmed.split(/\s+/) : [];
  }
  return parseDelimitedLine(line, delimiter).map((cell) => cell.trim());
}

/** SKU, B2B SKU, and Quantity. A row needs a quantity and at least one of the SKU columns. */
export function parseBulkItemMatrix(rows: string[][], rowNumbers?: number[]): BulkItemParseResult {
  const first = rows.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  if (first === -1) return { error: 'The file is empty.' };

  let skuIdx = -1;
  let portalIdx = -1;
  let qtyIdx = 1;
  let dataStart = first;
  let headerFound = false;
  const scanEnd = Math.min(rows.length, first + 8);
  for (let i = first; i < scanEnd; i += 1) {
    const header = rows[i].map((cell) => normalizeHeader(cell));
    const sku = columnIndex(header, SKU_HEADERS);
    const portal = columnIndex(header, PORTAL_HEADERS);
    const qty = columnIndex(header, QTY_HEADERS);
    const skuColumn = sku !== -1 && sku !== portal ? sku : -1;
    if (qty !== -1 && (skuColumn !== -1 || portal !== -1) && skuColumn !== qty && portal !== qty) {
      skuIdx = skuColumn;
      portalIdx = portal;
      qtyIdx = qty;
      dataStart = i + 1;
      headerFound = true;
      break;
    }
  }

  const problems: string[] = [];
  const totals = new Map<string, BulkItemLine>();
  let dataRows = 0;

  for (let i = dataStart; i < rows.length; i += 1) {
    const row = rows[i];
    const parsed = readLine(row, skuIdx, portalIdx, qtyIdx, headerFound);
    const sellerSku = parsed.sellerSku;
    const portalSku = parsed.portalSku;
    const qtyText = parsed.qtyText;
    if (!sellerSku && !portalSku && !qtyText) continue;
    dataRows += 1;
    if (dataRows > MAX_DATA_ROWS) {
      return { error: `The spreadsheet has too many rows (max ${MAX_DATA_ROWS}).` };
    }
    const rowNumber = rowNumbers?.[i] ?? i + 1;
    if (!sellerSku && !portalSku) {
      problems.push(`Row ${rowNumber} needs a SKU or a B2B SKU.`);
      continue;
    }
    const quantity = parseQty(qtyText);
    if (quantity == null) {
      problems.push(`Row ${rowNumber} needs a whole-number quantity.`);
      continue;
    }
    const key = portalSku
      ? `p:${portalSku.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')}`
      : `s:${sellerSku.trim().toUpperCase()}`;
    const existing = totals.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.sellerSku = joinSellerSku(existing.sellerSku, sellerSku);
      if (!existing.portalSku) existing.portalSku = portalSku;
    } else {
      totals.set(key, { sellerSku, portalSku, quantity });
    }
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, 4).join(' ');
    const more = problems.length > 4 ? ` ${problems.length - 4} more.` : '';
    return { error: `${shown}${more}` };
  }
  if (totals.size === 0) return { error: 'The spreadsheet needs a SKU or B2B SKU column, plus Quantity.' };
  if (totals.size > MAX_SKUS) return { error: `The file has too many SKUs (max ${MAX_SKUS}).` };

  return { items: [...totals.values()] };
}

function matrixFromCsv(text: string): { rows: string[][]; rowNumbers: number[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const delimiter = detectImportDelimiter(lines);
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  lines.forEach((line, index) => {
    rows.push(splitRow(line, delimiter));
    rowNumbers.push(index + 1);
  });
  return { rows, rowNumbers };
}

async function matrixFromXlsx(buffer: Buffer): Promise<{ rows: string[][]; rowNumbers: number[] } | { error: string }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { error: 'Could not read that spreadsheet. Upload an .xlsx or .csv file.' };
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { error: 'The spreadsheet has no sheets.' };
  const columnCount = Math.max(sheet.columnCount, 2);
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    for (let col = 1; col <= columnCount; col += 1) {
      cells.push(cellToString(row.getCell(col).value));
    }
    rows.push(cells);
    rowNumbers.push(row.number);
  });
  return { rows, rowNumbers };
}

export async function parseBulkItemFile(buffer: Buffer, filename: string): Promise<BulkItemParseResult> {
  const name = filename.toLowerCase();
  if (name.endsWith('.csv')) {
    const matrix = matrixFromCsv(buffer.toString('utf8'));
    return parseBulkItemMatrix(matrix.rows, matrix.rowNumbers);
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const matrix = await matrixFromXlsx(buffer);
    if ('error' in matrix) return matrix;
    return parseBulkItemMatrix(matrix.rows, matrix.rowNumbers);
  }
  return { error: 'Upload an .xlsx or .csv file.' };
}
