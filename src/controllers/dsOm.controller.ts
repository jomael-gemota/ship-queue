import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import User from '../models/User';
import HHOrderGroup from '../models/HHOrderGroup';
import { getOrCreateHhB2bConfig } from '../models/HHB2bConfig';
import type { IHHB2bConfig } from '../models/HHB2bConfig';
import { hhBrandFromRequest, hhBrandId } from '../lib/hhBrand';
import { dsOmConfigReady, DS_OM_MAX_ROWS, type DsOmPlan, type DsOmWriteSelection } from '../lib/dsOmMatch';
import { DsOmSheetError, inspectDsOmSheet, writeDsOmReferences, type DsOmWorkbook } from '../services/dsOmSheet.service';

const NOT_CONFIGURED = 'DS OM is not set up yet. Add the workbook, sheet, and column letters in Configurations.';
const NOT_CONNECTED = 'Google is not connected for this account. Sign in again to grant access.';

function workbookFromConfig(doc: IHHB2bConfig): DsOmWorkbook | null {
  const spreadsheetId = (doc.dsOmSpreadsheetId || '').trim();
  const sheetName = (doc.dsOmSheetName || '').trim();
  const orderId = (doc.dsOmOrderIdColumn || '').trim();
  const po = (doc.dsOmPoColumn || '').trim();
  const reference = (doc.dsOmReferenceColumn || '').trim();
  if (!dsOmConfigReady({ spreadsheetId, sheetName, orderIdColumn: orderId, poColumn: po, referenceColumn: reference })) {
    return null;
  }
  return {
    spreadsheetId,
    sheetName,
    columns: { orderId, po, reference },
  };
}

async function refreshTokenFor(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await User.findById(userId).select('+googleRefreshToken');
  const token = user?.googleRefreshToken?.trim();
  return token || null;
}

function planPayload(plan: DsOmPlan | null) {
  return {
    willFill: plan?.willFill ?? [],
    alreadySet: plan?.alreadySet ?? [],
    hasOtherText: plan?.hasOtherText ?? [],
    notFound: plan?.notFound ?? [],
    skipped: plan?.skipped ?? [],
  };
}

function parseSelectedRows(value: unknown): DsOmWriteSelection[] {
  if (!Array.isArray(value)) return [];
  const selected: DsOmWriteSelection[] = [];
  for (const item of value.slice(0, DS_OM_MAX_ROWS)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const childId = typeof record.childId === 'string' ? record.childId.trim() : '';
    const row = record.row;
    if (!childId || childId.length > 64 || !Number.isInteger(row) || (row as number) < 2 || (row as number) > DS_OM_MAX_ROWS + 1) {
      continue;
    }
    selected.push({ childId, row: row as number });
  }
  return selected;
}

function blocked(message: string, accountEmail: string | null = null) {
  return {
    ok: false,
    accountEmail,
    message,
    spreadsheetTitle: null,
    sheetName: null,
    ...planPayload(null),
  };
}

export async function checkDsOmSheet(req: Request, res: Response): Promise<void> {
  const doc = await getOrCreateHhB2bConfig(hhBrandFromRequest(req), false);
  const workbook = workbookFromConfig(doc);
  if (!workbook) {
    res.status(400).json({ message: NOT_CONFIGURED });
    return;
  }
  const refreshToken = await refreshTokenFor(req.user?.id);
  if (!refreshToken) {
    res.status(400).json({ message: NOT_CONNECTED });
    return;
  }
  try {
    const inspection = await inspectDsOmSheet(refreshToken, workbook, null);
    res.json({
      data: {
        accountEmail: inspection.accountEmail,
        spreadsheetTitle: inspection.spreadsheetTitle,
        sheetName: inspection.sheetName,
        columns: inspection.columns,
        labels: inspection.labels,
      },
    });
  } catch (error) {
    if (error instanceof DsOmSheetError) {
      res.status(400).json({ message: error.message });
      return;
    }
    console.error('[ds-om] check failed', error);
    res.status(500).json({ message: 'Could not check the DS OM sheet.' });
  }
}

export async function previewDsOmWrite(req: Request, res: Response): Promise<void> {
  const loaded = await loadBatch(req, res);
  if (!loaded) return;
  try {
    const inspection = await inspectDsOmSheet(
      loaded.refreshToken,
      loaded.workbook,
      loaded.orders,
      loaded.requirePlaced,
    );
    res.json({
      data: {
        ok: true,
        accountEmail: inspection.accountEmail,
        message: null,
        spreadsheetTitle: inspection.spreadsheetTitle,
        sheetName: inspection.sheetName,
        ...planPayload(inspection.plan),
      },
    });
  } catch (error) {
    if (error instanceof DsOmSheetError) {
      res.json({ data: blocked(error.message, error.accountEmail) });
      return;
    }
    console.error('[ds-om] preview failed', error);
    res.status(500).json({ message: 'Could not read the DS OM sheet.' });
  }
}

export async function commitDsOmWrite(req: Request, res: Response): Promise<void> {
  const loaded = await loadBatch(req, res);
  if (!loaded) return;
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const overwrite = body.overwrite === true;
  const selected = Object.prototype.hasOwnProperty.call(body, 'rows') ? parseSelectedRows(body.rows) : undefined;
  try {
    const result = await writeDsOmReferences(
      loaded.refreshToken,
      loaded.workbook,
      loaded.orders,
      overwrite,
      selected,
      loaded.requirePlaced,
    );
    console.log(
      `[ds-om] ${loaded.groupId} filled ${result.written} overwrote ${result.overwritten} as ${result.accountEmail || 'unknown'}`,
    );
    res.json({
      data: {
        ok: true,
        accountEmail: result.accountEmail,
        message: null,
        spreadsheetTitle: result.spreadsheetTitle,
        sheetName: result.sheetName,
        written: result.written,
        overwritten: result.overwritten,
        ...planPayload(result.plan),
      },
    });
  } catch (error) {
    if (error instanceof DsOmSheetError) {
      res.status(400).json({ message: error.message });
      return;
    }
    console.error('[ds-om] write failed', error);
    res.status(500).json({ message: 'Could not update the DS OM sheet.' });
  }
}

async function loadBatch(req: Request, res: Response) {
  const { groupId } = req.params;
  if (!isValidObjectId(groupId)) {
    res.status(400).json({ message: 'Invalid group id' });
    return null;
  }
  const doc = await getOrCreateHhB2bConfig(hhBrandFromRequest(req), false);
  const workbook = workbookFromConfig(doc);
  if (!workbook) {
    res.json({ data: blocked(NOT_CONFIGURED) });
    return null;
  }
  const refreshToken = await refreshTokenFor(req.user?.id);
  if (!refreshToken) {
    res.json({ data: blocked(NOT_CONNECTED) });
    return null;
  }
  const group = await HHOrderGroup.findById(groupId).lean();
  if (!group || hhBrandId(group.brand) !== hhBrandFromRequest(req)) {
    res.status(404).json({ message: 'Group not found' });
    return null;
  }
  return {
    groupId,
    refreshToken,
    requirePlaced: hhBrandFromRequest(req) !== 'thorogood',
    workbook,
    orders: (group.children ?? []).map((child) => ({
      childId: String(child._id ?? ''),
      orderId: child.orderId ?? '',
      po: child.po ?? '',
      referenceNumber: child.referenceNumber ?? '',
      placed: child.cartStatus === 'placed',
    })),
  };
}
