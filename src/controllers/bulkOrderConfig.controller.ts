import { Request, Response } from 'express';
import { getOrCreateBulkOrderConfig } from '../models/BulkOrderConfig';
import type { IBulkOrderConfig } from '../models/BulkOrderConfig';
import {
  BULK_ORDER_DEFAULT_CATALOG,
  BULK_ORDER_DEFAULT_DROP_SHIP_ADDRESS,
  BULK_ORDER_DEFAULT_DROP_SHIP_NAME,
  BULK_ORDER_DEFAULT_DROP_SHIP_POSTAL,
  BULK_ORDER_DEFAULT_SHIP_TO_CODE,
} from '../models/BulkOrderConfig';
import { HhB2bDraftError, normalizeHhB2bAccountId, parseHhB2bBaseUrl, resolveHhB2bCookie } from '../lib/hhB2bConfig';
import {
  listThorogoodCatalogs,
  listThorogoodCustomers,
  listThorogoodShipTos,
  THOROGOOD_DEFAULT_CATALOG,
  THOROGOOD_DEFAULT_SHIP_TO,
  THOROGOOD_DEFAULT_SOLD_TO,
} from '../lib/hhB2bThorogood';
import type { HhB2bCookieSource } from '../lib/hhB2bConfig';
import { normalizeCookieHeader } from '../lib/hhSellerCentral';
import { normalizeHhSkuTokens } from '../lib/hhSkuExclude';
import { parseAlertWebhookUrl, parseSessionCheckTimes, resolveSessionCheckTimes } from '../services/hhB2bHealth';
import {
  BulkOrderHealthBusyError,
  BulkOrderWebhookTestError,
  reconcileBulkOrderHealthSchedule,
  runBulkOrderHealthCheck,
  sendBulkOrderWebhookTest,
} from '../services/bulkOrderHealth';

export interface BulkOrderSessionCheckDto {
  status: 'ok' | 'auth' | 'down' | null;
  checkedAt: string | null;
  latencyMs: number | null;
  message: string;
}

export interface BulkOrderLastAlertDto {
  at: string | null;
  event: 'failed' | 'recovered' | 'test' | null;
  error: string | null;
}

export interface BulkOrderConfigDto {
  baseUrl: string;
  catalog: string;
  accountId: string;
  defaultShipToCode: string;
  dropShipName: string;
  dropShipAddress: string;
  dropShipPostalCode: string;
  skuPrefixes: string[];
  skuSuffixes: string[];
  hasCookie: boolean;
  cookieSource: HhB2bCookieSource;
  cookieUpdatedAt: string | null;
  placeOrderEnabled: boolean;
  alertWebhookUrl: string;
  sessionCheckTimes: string[];
  sessionCheck: BulkOrderSessionCheckDto;
  lastAlert: BulkOrderLastAlertDto;
  updatedAt: string;
  updatedByName: string;
}

function sessionStatus(value: string | undefined): BulkOrderSessionCheckDto['status'] {
  if (value === 'ok' || value === 'auth' || value === 'down') return value;
  return null;
}

function alertEvent(value: string | undefined): BulkOrderLastAlertDto['event'] {
  if (value === 'failed' || value === 'recovered' || value === 'test') return value;
  return null;
}

async function serializeConfig(doc: IBulkOrderConfig): Promise<BulkOrderConfigDto> {
  const hasCookie = Boolean(normalizeCookieHeader(doc.cookie ?? ''));
  const cookieSource = (await resolveHhB2bCookie('thorogood', doc.cookie ?? '')).source;
  return {
    baseUrl: doc.baseUrl,
    catalog: doc.catalog?.trim() || BULK_ORDER_DEFAULT_CATALOG,
    accountId: doc.accountId,
    defaultShipToCode: doc.defaultShipToCode?.trim() || BULK_ORDER_DEFAULT_SHIP_TO_CODE,
    dropShipName: doc.dropShipName?.trim() || BULK_ORDER_DEFAULT_DROP_SHIP_NAME,
    dropShipAddress: doc.dropShipAddress?.trim() || BULK_ORDER_DEFAULT_DROP_SHIP_ADDRESS,
    dropShipPostalCode: doc.dropShipPostalCode?.trim() || BULK_ORDER_DEFAULT_DROP_SHIP_POSTAL,
    skuPrefixes: doc.skuPrefixesSet ? doc.skuPrefixes ?? [] : [],
    skuSuffixes: doc.skuSuffixesSet ? doc.skuSuffixes ?? [] : [],
    hasCookie,
    cookieSource,
    cookieUpdatedAt: doc.cookieUpdatedAt ? doc.cookieUpdatedAt.toISOString() : null,
    placeOrderEnabled: Boolean(doc.placeOrderEnabled),
    alertWebhookUrl: doc.alertWebhookUrl || '',
    sessionCheckTimes: resolveSessionCheckTimes(doc.sessionCheckTimes, Boolean(doc.sessionCheckTimesSet)),
    sessionCheck: {
      status: sessionStatus(doc.sessionCheckStatus),
      checkedAt: doc.sessionCheckedAt ? doc.sessionCheckedAt.toISOString() : null,
      latencyMs: typeof doc.sessionCheckLatencyMs === 'number' ? doc.sessionCheckLatencyMs : null,
      message: doc.sessionCheckMessage || '',
    },
    lastAlert: {
      at: doc.lastAlertAt ? doc.lastAlertAt.toISOString() : null,
      event: alertEvent(doc.lastAlertEvent),
      error: doc.lastAlertError || null,
    },
    updatedAt: doc.updatedAt.toISOString(),
    updatedByName: doc.updatedByName || '',
  };
}

export async function getBulkOrderShipTos(req: Request, res: Response): Promise<void> {
  const doc = await getOrCreateBulkOrderConfig(true);
  const requested = typeof req.query.customer === 'string' ? req.query.customer.trim() : '';
  const customerCode = /^\d+$/.test(requested) ? requested : doc.accountId;
  const fallback = [THOROGOOD_DEFAULT_SHIP_TO];
  const resolved = await resolveHhB2bCookie('thorogood', doc.cookie ?? '');
  if (!resolved.cookie) {
    res.json({
      data: fallback,
      source: 'fallback',
      message: 'Thorogood session cookie is missing. Ship To is limited to the warehouse address.',
    });
    return;
  }
  try {
    const data = await listThorogoodShipTos(doc.baseUrl, resolved.cookie, customerCode);
    res.json({ data, source: 'portal' });
  } catch (err) {
    const message = err instanceof HhB2bDraftError ? err.message : 'Could not load Thorogood ship-to addresses.';
    res.json({ data: fallback, source: 'fallback', message });
  }
}

export async function getBulkOrderCatalogs(_req: Request, res: Response): Promise<void> {
  const doc = await getOrCreateBulkOrderConfig(true);
  const fallback = [THOROGOOD_DEFAULT_CATALOG];
  const resolved = await resolveHhB2bCookie('thorogood', doc.cookie ?? '');
  if (!resolved.cookie) {
    res.json({
      data: fallback,
      source: 'fallback',
      message: 'Thorogood session cookie is missing. Catalog is limited to Thorogood Boots.',
    });
    return;
  }
  try {
    const data = await listThorogoodCatalogs(doc.baseUrl, resolved.cookie);
    res.json({ data, source: 'portal' });
  } catch (err) {
    const message = err instanceof HhB2bDraftError ? err.message : 'Could not load Thorogood catalogs.';
    res.json({ data: fallback, source: 'fallback', message });
  }
}

export async function getBulkOrderSoldTos(_req: Request, res: Response): Promise<void> {
  const doc = await getOrCreateBulkOrderConfig(true);
  const fallback = [THOROGOOD_DEFAULT_SOLD_TO];
  const resolved = await resolveHhB2bCookie('thorogood', doc.cookie ?? '');
  if (!resolved.cookie) {
    res.json({
      data: fallback,
      source: 'fallback',
      message: 'Thorogood session cookie is missing. Sold To is limited to 23550 - OUTDOOR EQUIPPED.',
    });
    return;
  }
  try {
    const data = await listThorogoodCustomers(doc.baseUrl, resolved.cookie);
    const withDefault = data.some((option) => option.code === THOROGOOD_DEFAULT_SOLD_TO.code)
      ? data
      : [THOROGOOD_DEFAULT_SOLD_TO, ...data];
    res.json({ data: withDefault, source: 'portal' });
  } catch (err) {
    const message = err instanceof HhB2bDraftError ? err.message : 'Could not load Thorogood customers.';
    res.json({ data: fallback, source: 'fallback', message });
  }
}

export async function getBulkOrderConfig(_req: Request, res: Response): Promise<void> {
  const doc = await getOrCreateBulkOrderConfig(true);
  res.json({ data: await serializeConfig(doc) });
}

export async function updateBulkOrderConfig(req: Request, res: Response): Promise<void> {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const doc = await getOrCreateBulkOrderConfig(true);

  if ('baseUrl' in body) {
    if (typeof body.baseUrl !== 'string') {
      res.status(400).json({ message: 'baseUrl must be a string.' });
      return;
    }
    const parsed = parseHhB2bBaseUrl(body.baseUrl);
    if (!parsed) {
      res.status(400).json({ message: 'baseUrl must be an http(s) URL.' });
      return;
    }
    doc.baseUrl = parsed;
  }

  if ('catalog' in body) {
    if (typeof body.catalog !== 'string') {
      res.status(400).json({ message: 'catalog must be a string.' });
      return;
    }
    doc.catalog = body.catalog.trim();
  }

  if ('accountId' in body) {
    if (typeof body.accountId !== 'string') {
      res.status(400).json({ message: 'accountId must be a string.' });
      return;
    }
    const accountId = normalizeHhB2bAccountId(body.accountId);
    if (!accountId) {
      res.status(400).json({ message: 'accountId is required.' });
      return;
    }
    doc.accountId = accountId;
  }

  if ('defaultShipToCode' in body) {
    if (typeof body.defaultShipToCode !== 'string' || !body.defaultShipToCode.trim()) {
      res.status(400).json({ message: 'defaultShipToCode is required.' });
      return;
    }
    doc.defaultShipToCode = body.defaultShipToCode.trim();
  }

  if ('dropShipName' in body) {
    if (typeof body.dropShipName !== 'string' || !body.dropShipName.trim()) {
      res.status(400).json({ message: 'dropShipName is required.' });
      return;
    }
    doc.dropShipName = body.dropShipName.trim();
  }

  if ('dropShipAddress' in body) {
    if (typeof body.dropShipAddress !== 'string' || !body.dropShipAddress.trim()) {
      res.status(400).json({ message: 'dropShipAddress is required.' });
      return;
    }
    doc.dropShipAddress = body.dropShipAddress.trim();
  }

  if ('dropShipPostalCode' in body) {
    if (typeof body.dropShipPostalCode !== 'string' || !body.dropShipPostalCode.trim()) {
      res.status(400).json({ message: 'dropShipPostalCode is required.' });
      return;
    }
    doc.dropShipPostalCode = body.dropShipPostalCode.trim();
  }

  if ('placeOrderEnabled' in body) {
    if (typeof body.placeOrderEnabled !== 'boolean') {
      res.status(400).json({ message: 'placeOrderEnabled must be a boolean.' });
      return;
    }
    doc.placeOrderEnabled = body.placeOrderEnabled;
  }

  if ('alertWebhookUrl' in body) {
    if (typeof body.alertWebhookUrl !== 'string') {
      res.status(400).json({ message: 'alertWebhookUrl must be a string.' });
      return;
    }
    const parsed = parseAlertWebhookUrl(body.alertWebhookUrl);
    if ('error' in parsed) {
      res.status(400).json({ message: parsed.error });
      return;
    }
    doc.alertWebhookUrl = parsed.url;
  }

  if ('sessionCheckTimes' in body) {
    const parsed = parseSessionCheckTimes(body.sessionCheckTimes);
    if ('error' in parsed) {
      res.status(400).json({ message: parsed.error });
      return;
    }
    doc.sessionCheckTimes = parsed.times;
    doc.sessionCheckTimesSet = true;
  }

  if ('skuPrefixes' in body) {
    const parsed = normalizeHhSkuTokens(body.skuPrefixes, 'Start strings');
    if ('error' in parsed) {
      res.status(400).json({ message: parsed.error });
      return;
    }
    doc.skuPrefixes = parsed.tokens;
    doc.skuPrefixesSet = true;
  }

  if ('skuSuffixes' in body) {
    const parsed = normalizeHhSkuTokens(body.skuSuffixes, 'End strings');
    if ('error' in parsed) {
      res.status(400).json({ message: parsed.error });
      return;
    }
    doc.skuSuffixes = parsed.tokens;
    doc.skuSuffixesSet = true;
  }

  if ('cookie' in body) {
    if (typeof body.cookie !== 'string') {
      res.status(400).json({ message: 'cookie must be a string.' });
      return;
    }
    const cookie = normalizeCookieHeader(body.cookie);
    doc.cookie = cookie;
    doc.cookieUpdatedAt = cookie ? new Date() : null;
  }

  doc.updatedByName = req.user?.name || '';
  doc.updatedByEmail = req.user?.email || '';
  await doc.save();
  try {
    await reconcileBulkOrderHealthSchedule();
  } catch (err) {
    console.error('[bulk-order-health] Failed to apply check times', err);
  }
  const fresh = await getOrCreateBulkOrderConfig(true);
  res.json({ data: await serializeConfig(fresh) });
}

export async function checkBulkOrderSession(_req: Request, res: Response): Promise<void> {
  try {
    await runBulkOrderHealthCheck();
  } catch (err) {
    if (err instanceof BulkOrderHealthBusyError) {
      res.status(409).json({ message: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Session check failed.';
    res.status(500).json({ message });
    return;
  }
  const doc = await getOrCreateBulkOrderConfig(true);
  res.json({ data: await serializeConfig(doc) });
}

export async function testBulkOrderWebhook(_req: Request, res: Response): Promise<void> {
  try {
    await sendBulkOrderWebhookTest();
  } catch (err) {
    if (err instanceof BulkOrderWebhookTestError) {
      res.status(400).json({ message: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Webhook test failed.';
    res.status(500).json({ message });
    return;
  }
  const doc = await getOrCreateBulkOrderConfig(true);
  res.json({ data: await serializeConfig(doc) });
}
