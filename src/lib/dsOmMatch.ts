export const DS_OM_SHEET_NAME_MAX = 100;
export const DS_OM_MAX_ROWS = 20000;

export interface DsOmColumns {
  orderId: string;
  po: string;
  reference: string;
}

export interface DsOmOrderInput {
  childId: string;
  orderId: string;
  po: string;
  referenceNumber: string;
  placed: boolean;
}

export interface DsOmSheetRow {
  row: number;
  orderId: string;
  po: string;
  reference: string;
  /** True when the reference cell is text. A numeric string shows a leading ' in Sheets. */
  referenceIsText: boolean;
}

export interface DsOmTarget {
  childId: string;
  orderId: string;
  po: string;
  referenceNumber: string;
  row: number;
  current: string;
}

export interface DsOmNotFound {
  childId: string;
  orderId: string;
  po: string;
  referenceNumber: string;
}

export interface DsOmSkipped {
  childId: string;
  orderId: string;
  po: string;
  reason: 'not-placed' | 'no-reference';
}

export interface DsOmPlan {
  willFill: DsOmTarget[];
  alreadySet: DsOmTarget[];
  hasOtherText: DsOmTarget[];
  notFound: DsOmNotFound[];
  skipped: DsOmSkipped[];
}

export function dsOmCellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    if (Number.isSafeInteger(value)) return String(value);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).trim();
}

/** Digits Sheets can store as a number. A string write of the same digits shows a leading '. */
export function dsOmPlainNumber(value: string): number | null {
  const text = dsOmCellText(value);
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  if (!Number.isSafeInteger(number)) return null;
  return number;
}

export function parseDsOmSpreadsheetId(input: string): { id: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { id: '' };
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = fromUrl?.[1] ?? trimmed;
  if (!/^[a-zA-Z0-9-_]{20,128}$/.test(id)) {
    return { error: 'Workbook must be a Google Sheets URL or the ID from that URL.' };
  }
  return { id };
}

export function parseDsOmSheetName(input: string): { name: string } | { error: string } {
  const name = input.trim();
  if (name.length > DS_OM_SHEET_NAME_MAX) {
    return { error: `Sheet name must be ${DS_OM_SHEET_NAME_MAX} characters or fewer.` };
  }
  if ([...name].some((char) => char.charCodeAt(0) < 32)) {
    return { error: 'Sheet name cannot include line breaks.' };
  }
  return { name };
}

export function columnIndex(letter: string): number {
  let index = 0;
  for (const char of letter) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

export function parseDsOmColumns(
  orderId: string,
  po: string,
  reference: string,
): { columns: DsOmColumns } | { error: string } {
  const parseLetter = (input: string): string | { error: string } => {
    const value = input.trim().toUpperCase();
    if (!value) return '';
    if (!/^[A-Z]{1,3}$/.test(value) || columnIndex(value) > 18277) {
      return { error: 'Use a column letter, such as A or AC.' };
    }
    return value;
  };

  const orderIdColumn = parseLetter(orderId);
  if (typeof orderIdColumn !== 'string') return orderIdColumn;
  const poColumn = parseLetter(po);
  if (typeof poColumn !== 'string') return poColumn;
  const referenceColumn = parseLetter(reference);
  if (typeof referenceColumn !== 'string') return referenceColumn;

  const columns = { orderId: orderIdColumn, po: poColumn, reference: referenceColumn };
  const named = Object.values(columns).filter(Boolean);
  if (new Set(named).size !== named.length) {
    return { error: 'Order ID, PO, and Reference must be three different columns.' };
  }
  return { columns };
}

export function dsOmConfigReady(input: {
  spreadsheetId: string;
  sheetName: string;
  orderIdColumn: string;
  poColumn: string;
  referenceColumn: string;
}): boolean {
  return Boolean(
    input.spreadsheetId.trim() &&
      input.sheetName.trim() &&
      input.orderIdColumn.trim() &&
      input.poColumn.trim() &&
      input.referenceColumn.trim(),
  );
}

export function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

export function sheetRowsFromValues(
  values: unknown[][],
  columns: { orderId: number; po: number; reference: number },
): { rows: DsOmSheetRow[] } | { error: string } {
  if (values.length > DS_OM_MAX_ROWS) {
    return { error: `This sheet has more than ${DS_OM_MAX_ROWS} rows.` };
  }
  const rows: DsOmSheetRow[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const line = values[index] ?? [];
    const orderId = dsOmCellText(line[columns.orderId]);
    const po = dsOmCellText(line[columns.po]);
    const rawReference = line[columns.reference];
    const reference = dsOmCellText(rawReference);
    if (!orderId && !po && !reference) continue;
    rows.push({
      row: index + 1,
      orderId,
      po,
      reference,
      referenceIsText: typeof rawReference === 'string' && reference !== '',
    });
  }
  return { rows };
}

function pairKey(orderId: string, po: string): string {
  return `${orderId}\n${po}`;
}

function targetFrom(order: DsOmOrderInput, row: DsOmSheetRow): DsOmTarget {
  return {
    childId: order.childId,
    orderId: order.orderId,
    po: order.po,
    referenceNumber: dsOmCellText(order.referenceNumber),
    row: row.row,
    current: row.reference,
  };
}

export function planDsOmWrite(
  orders: DsOmOrderInput[],
  sheetRows: DsOmSheetRow[],
  options?: { requirePlaced?: boolean },
): DsOmPlan {
  const requirePlaced = options?.requirePlaced !== false;
  const index = new Map<string, DsOmSheetRow[]>();
  for (const row of sheetRows) {
    if (!row.orderId || !row.po) continue;
    const key = pairKey(row.orderId, row.po);
    const list = index.get(key);
    if (list) list.push(row);
    else index.set(key, [row]);
  }

  const plan: DsOmPlan = {
    willFill: [],
    alreadySet: [],
    hasOtherText: [],
    notFound: [],
    skipped: [],
  };

  for (const order of orders) {
    const orderId = dsOmCellText(order.orderId);
    const po = dsOmCellText(order.po);
    const referenceNumber = dsOmCellText(order.referenceNumber);
    if (requirePlaced && !order.placed) {
      plan.skipped.push({ childId: order.childId, orderId, po, reason: 'not-placed' });
      continue;
    }
    if (!referenceNumber) {
      plan.skipped.push({ childId: order.childId, orderId, po, reason: 'no-reference' });
      continue;
    }
    const matches = orderId && po ? index.get(pairKey(orderId, po)) ?? [] : [];
    if (matches.length === 0) {
      plan.notFound.push({ childId: order.childId, orderId, po, referenceNumber });
      continue;
    }
    const normalized = { ...order, orderId, po, referenceNumber };
    for (const row of matches) {
      const item = targetFrom(normalized, row);
      const sameDigitsAsText =
        row.reference === referenceNumber && row.referenceIsText && dsOmPlainNumber(referenceNumber) != null;
      if (!row.reference || sameDigitsAsText) plan.willFill.push(item);
      else if (row.reference === referenceNumber) plan.alreadySet.push(item);
      else plan.hasOtherText.push(item);
    }
  }

  return plan;
}

export interface DsOmWriteSelection {
  childId: string;
  row: number;
}

export function cellsToWrite(
  plan: DsOmPlan,
  overwrite: boolean,
  selected?: DsOmWriteSelection[] | null,
): DsOmTarget[] {
  const cells = overwrite ? [...plan.willFill, ...plan.hasOtherText] : [...plan.willFill];
  if (selected == null) return cells;
  const allow = new Set(selected.map((item) => `${item.childId}:${item.row}`));
  return cells.filter((cell) => allow.has(`${cell.childId}:${cell.row}`));
}
