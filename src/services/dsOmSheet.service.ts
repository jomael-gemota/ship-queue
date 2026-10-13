import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { buildOAuthClient } from './googleDrive.service';
import {
  cellsToWrite,
  type DsOmWriteSelection,
  columnIndex,
  dsOmCellText,
  planDsOmWrite,
  quoteSheetName,
  sheetRowsFromValues,
  type DsOmColumns,
  type DsOmOrderInput,
  type DsOmPlan,
  type DsOmSheetRow,
  type DsOmTarget,
} from '../lib/dsOmMatch';

const SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';

export interface DsOmWorkbook {
  spreadsheetId: string;
  sheetName: string;
  columns: DsOmColumns;
}

export interface DsOmInspection {
  accountEmail: string | null;
  spreadsheetTitle: string;
  sheetName: string;
  columns: DsOmColumns;
  labels: DsOmColumns;
  plan: DsOmPlan | null;
}

export class DsOmSheetError extends Error {
  accountEmail: string | null;

  constructor(message: string, accountEmail: string | null = null) {
    super(message);
    this.name = 'DsOmSheetError';
    this.accountEmail = accountEmail;
  }
}

function googleStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const response = (error as { response?: { status?: number } }).response;
  return typeof response?.status === 'number' ? response.status : null;
}

function googleMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const data = (error as { response?: { data?: { error?: { message?: string } | string } } }).response?.data;
  if (!data) return error instanceof Error ? error.message : '';
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error.message === 'string') return data.error.message;
  return error instanceof Error ? error.message : '';
}

function isInvalidGrant(error: unknown): boolean {
  const message = googleMessage(error).toLowerCase();
  return message.includes('invalid_grant');
}

function sheetError(error: unknown, email: string | null, fallback: string, sheetName?: string): DsOmSheetError {
  if (error instanceof DsOmSheetError) return error;
  if (isInvalidGrant(error)) {
    return new DsOmSheetError('Your Google connection expired. Sign in again to grant access.', email);
  }
  const message = googleMessage(error);
  if (/insufficient/i.test(message) && /scope/i.test(message)) {
    return new DsOmSheetError('Your Google connection does not include Sheets access. Sign in again to grant access.', email);
  }
  if (/unable to parse range/i.test(message) && sheetName) {
    return new DsOmSheetError(`No tab named "${sheetName}".`, email);
  }
  if (/protected/i.test(message)) {
    return new DsOmSheetError('The reference column is protected. Ask the sheet owner to allow edits there.', email);
  }
  const status = googleStatus(error);
  if (status === 404 || status === 403) {
    return new DsOmSheetError(
      `${namedAccount(email)} can't open that workbook. Check the workbook ID and that this account is an editor.`,
      email,
    );
  }
  const trimmed = message.trim().slice(0, 240);
  return new DsOmSheetError(trimmed || fallback, email);
}

export function googleAuthFromRefreshToken(refreshToken: string): OAuth2Client {
  return buildOAuthClient({ refreshToken });
}

async function accountEmail(auth: OAuth2Client): Promise<string | null> {
  try {
    const profile = await google.oauth2({ version: 'v2', auth }).userinfo.get();
    const email = profile.data.email?.trim();
    return email || null;
  } catch (error) {
    const message = googleMessage(error);
    if (isInvalidGrant(error) || (/insufficient/i.test(message) && /scope/i.test(message))) {
      throw sheetError(error, null, 'Could not read the Google account.');
    }
    return null;
  }
}

function namedAccount(email: string | null): string {
  return email ? `This Google account (${email})` : 'This Google account';
}

async function openWorkbook(auth: OAuth2Client, workbook: DsOmWorkbook, email: string | null): Promise<string> {
  const drive = google.drive({ version: 'v3', auth });
  let file: { name?: string | null; mimeType?: string | null; capabilities?: { canEdit?: boolean | null } | null };
  try {
    const res = await drive.files.get({
      fileId: workbook.spreadsheetId,
      fields: 'name,mimeType,capabilities(canEdit)',
      supportsAllDrives: true,
    });
    file = res.data;
  } catch (error) {
    throw sheetError(error, email, 'Could not open the DS OM workbook.');
  }

  if (file.mimeType && file.mimeType !== SHEETS_MIME) {
    throw new DsOmSheetError('That file is not a Google Sheet. DS OM has to be a Google spreadsheet.', email);
  }
  if (file.capabilities?.canEdit !== true) {
    throw new DsOmSheetError(
      `${namedAccount(email)} can view the workbook but cannot edit it.`,
      email,
    );
  }
  return file.name?.trim() || 'DS OM';
}

async function readGrid(
  auth: OAuth2Client,
  workbook: DsOmWorkbook,
  email: string | null,
): Promise<{ columns: DsOmColumns; labels: DsOmColumns; rows: DsOmSheetRow[] }> {
  const sheets = google.sheets({ version: 'v4', auth });
  const range = quoteSheetName(workbook.sheetName);
  let values: unknown[][] = [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: workbook.spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    values = (res.data.values ?? []) as unknown[][];
  } catch (error) {
    throw sheetError(error, email, 'Could not read the DS OM sheet.', workbook.sheetName);
  }

  const indexes = {
    orderId: columnIndex(workbook.columns.orderId),
    po: columnIndex(workbook.columns.po),
    reference: columnIndex(workbook.columns.reference),
  };
  const parsed = sheetRowsFromValues(values, indexes);
  if ('error' in parsed) throw new DsOmSheetError(parsed.error, email);
  const header = values[0] ?? [];
  return {
    columns: workbook.columns,
    labels: {
      orderId: dsOmCellText(header[indexes.orderId]),
      po: dsOmCellText(header[indexes.po]),
      reference: dsOmCellText(header[indexes.reference]),
    },
    rows: parsed.rows,
  };
}

export async function inspectDsOmSheet(
  refreshToken: string,
  workbook: DsOmWorkbook,
  orders: DsOmOrderInput[] | null,
  requirePlaced = true,
): Promise<DsOmInspection> {
  const auth = googleAuthFromRefreshToken(refreshToken);
  const email = await accountEmail(auth);
  const spreadsheetTitle = await openWorkbook(auth, workbook, email);
  const grid = await readGrid(auth, workbook, email);
  return {
    accountEmail: email,
    spreadsheetTitle,
    sheetName: workbook.sheetName,
    columns: grid.columns,
    labels: grid.labels,
    plan: orders ? planDsOmWrite(orders, grid.rows, { requirePlaced }) : null,
  };
}

async function writeCells(
  auth: OAuth2Client,
  workbook: DsOmWorkbook,
  referenceColumn: string,
  cells: DsOmTarget[],
  email: string | null,
): Promise<void> {
  if (cells.length === 0) return;
  const sheets = google.sheets({ version: 'v4', auth });
  const quoted = quoteSheetName(workbook.sheetName);
  const chunkSize = 200;
  try {
    for (let offset = 0; offset < cells.length; offset += chunkSize) {
      const chunk = cells.slice(offset, offset + chunkSize);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: workbook.spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: chunk.map((cell) => ({
            range: `${quoted}!${referenceColumn}${cell.row}`,
            values: [[dsOmCellText(cell.referenceNumber)]],
          })),
        },
      });
    }
  } catch (error) {
    throw sheetError(error, email, 'Could not update the DS OM sheet.', workbook.sheetName);
  }
}

export async function writeDsOmReferences(
  refreshToken: string,
  workbook: DsOmWorkbook,
  orders: DsOmOrderInput[],
  overwrite: boolean,
  selected?: DsOmWriteSelection[] | null,
  requirePlaced = true,
): Promise<DsOmInspection & { written: number; overwritten: number }> {
  const auth = googleAuthFromRefreshToken(refreshToken);
  const email = await accountEmail(auth);
  const spreadsheetTitle = await openWorkbook(auth, workbook, email);
  const grid = await readGrid(auth, workbook, email);
  const plan = planDsOmWrite(orders, grid.rows, { requirePlaced });
  const filling = new Set(plan.willFill.map((cell) => `${cell.childId}:${cell.row}`));
  const cells = cellsToWrite(plan, overwrite, selected);
  await writeCells(auth, workbook, grid.columns.reference, cells, email);
  const written = cells.filter((cell) => filling.has(`${cell.childId}:${cell.row}`)).length;
  const overwritten = cells.length - written;
  const after = planDsOmWrite(
    orders,
    grid.rows.map((row) => {
      const next = cells.find((cell) => cell.row === row.row);
      return next ? { ...row, reference: dsOmCellText(next.referenceNumber) } : row;
    }),
    { requirePlaced },
  );
  return {
    accountEmail: email,
    spreadsheetTitle,
    sheetName: workbook.sheetName,
    columns: grid.columns,
    labels: grid.labels,
    plan: after,
    written,
    overwritten,
  };
}
