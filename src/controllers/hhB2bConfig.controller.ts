import { Request, Response } from 'express';
import { getOrCreateHhB2bConfig } from '../models/HHB2bConfig';
import type { IHHB2bConfig } from '../models/HHB2bConfig';
import { hhBrand, hhBrandFromRequest, hhBrandId, HH_BRANDS, type HHBrandId } from '../lib/hhBrand';
import { normalizeCookieHeader } from '../lib/hhSellerCentral';
import {
  HhB2bDraftError,
  normalizeHhB2bAccountId,
  parseHhB2bBaseUrl,
  resolveHhB2bCookie,
  type HhB2bCookieSource,
} from '../lib/hhB2bConfig';
import { effectiveThorogoodSkuInitials, normalizeThorogoodSkuInitials } from '../lib/hhThorogoodSku';
import {
  listThorogoodCatalogs,
  listThorogoodCustomers,
  THOROGOOD_DEFAULT_CATALOG,
  THOROGOOD_DEFAULT_SOLD_TO,
} from '../lib/hhB2bThorogood';
import {
  effectiveHhSkuPrefixes,
  effectiveHhSkuSuffixes,
  hhBrandUsesSkuAffixes,
  normalizeHhSkuTokens,
} from '../lib/hhSkuExclude';
import {
  HhB2bHealthBusyError,
  HhB2bWebhookTestError,
  parseAlertWebhookUrl,
  parseSessionCheckTimes,
  reconcileHhB2bHealthSchedule,
  resolveSessionCheckTimes,
  runHhB2bHealthCheck,
  sendHhB2bWebhookTest,
} from '../services/hhB2bHealth';

export interface HhB2bSessionCheckDto {
  status: 'ok' | 'auth' | 'down' | null;
  checkedAt: string | null;
  latencyMs: number | null;
  message: string;
}

export interface HhB2bLastAlertDto {
  at: string | null;
  event: 'failed' | 'recovered' | 'test' | null;
  error: string | null;
}

export interface HhB2bConfigDto {
  baseUrl: string;
  catalog: string;
  accountId: string;
  skuInitials: string[];
  skuPrefixes: string[];
  skuSuffixes: string[];
  hasCookie: boolean;
  /** Live session source. `config` is the pasted override. `jar` is Cookie Jar after that override is cleared. */
  cookieSource: HhB2bCookieSource;
  cookieUpdatedAt: string | null;
  placeOrderEnabled: boolean;
  alertWebhookUrl: string;
  sessionCheckTimes: string[];
  sessionCheck: HhB2bSessionCheckDto;
  lastAlert: HhB2bLastAlertDto;
  updatedAt: string;
  updatedByName: string;
}

function brandFromConfigKey(key: string): HHBrandId {
  const match = (Object.keys(HH_BRANDS) as HHBrandId[]).find((id) => HH_BRANDS[id].configKey === key);
  return hhBrandId(match);
}

function sessionStatus(value: string | undefined): HhB2bSessionCheckDto['status'] {
  if (value === 'ok' || value === 'auth' || value === 'down') return value;
  return null;
}

function alertEvent(value: string | undefined): HhB2bLastAlertDto['event'] {
  if (value === 'failed' || value === 'recovered' || value === 'test') return value;
  return null;
}

async function serializeConfig(doc: IHHB2bConfig): Promise<HhB2bConfigDto> {
  const cookieSource = (await resolveHhB2bCookie(brandFromConfigKey(doc.key), doc.cookie ?? '')).source;
  return {
    baseUrl: doc.baseUrl,
    catalog: doc.catalog,
    accountId: doc.accountId,
    skuInitials:
      doc.key === hhBrand('thorogood').configKey
        ? effectiveThorogoodSkuInitials(doc.skuInitials, Boolean(doc.skuInitialsSet))
        : [],
    skuPrefixes: hhBrandUsesSkuAffixes(brandFromConfigKey(doc.key))
      ? effectiveHhSkuPrefixes(doc.skuPrefixes, Boolean(doc.skuPrefixesSet))
      : [],
    skuSuffixes: hhBrandUsesSkuAffixes(brandFromConfigKey(doc.key))
      ? effectiveHhSkuSuffixes(doc.skuSuffixes, Boolean(doc.skuSuffixesSet))
      : [],
    hasCookie: Boolean(normalizeCookieHeader(doc.cookie ?? '')),
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

export async function getHhB2bConfig(req: Request, res: Response): Promise<void> {
  const doc = await getOrCreateHhB2bConfig(hhBrandFromRequest(req), true);
  res.json({ data: await serializeConfig(doc) });
}

export async function getHhB2bSoldTos(req: Request, res: Response): Promise<void> {
  if (hhBrandFromRequest(req) !== 'thorogood') {
    res.status(404).json({ message: 'Not found.' });
    return;
  }
  const doc = await getOrCreateHhB2bConfig('thorogood', true);
  const fallback = [THOROGOOD_DEFAULT_SOLD_TO];
  const resolved = await resolveHhB2bCookie('thorogood', doc.cookie ?? '');
  if (!resolved.cookie) {
    res.json({
      data: fallback,
      source: 'fallback',
      message: 'Thorogood session cookie is missing. Account ID is limited to 23550 - OUTDOOR EQUIPPED.',
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

export async function getHhB2bCatalogs(req: Request, res: Response): Promise<void> {
  if (hhBrandFromRequest(req) !== 'thorogood') {
    res.status(404).json({ message: 'Not found.' });
    return;
  }
  const doc = await getOrCreateHhB2bConfig('thorogood', true);
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

export async function updateHhB2bConfig(req: Request, res: Response): Promise<void> {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const doc = await getOrCreateHhB2bConfig(hhBrandFromRequest(req), true);

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
    const catalog = body.catalog.trim();
    if (!catalog) {
      res.status(400).json({ message: 'catalog is required.' });
      return;
    }
    doc.catalog = catalog;
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

  if ('skuPrefixes' in body || 'skuSuffixes' in body) {
    const brand = hhBrandFromRequest(req);
    if (!hhBrandUsesSkuAffixes(brand)) {
      res.status(400).json({ message: 'SKU strings are only saved for Helly Hansen Sports and Work.' });
      return;
    }
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

  if ('skuInitials' in body) {
    if (hhBrandFromRequest(req) !== 'thorogood') {
      res.status(400).json({ message: 'SKU initials are only saved for Thorogood.' });
      return;
    }
    const parsed = normalizeThorogoodSkuInitials(body.skuInitials);
    if ('error' in parsed) {
      res.status(400).json({ message: parsed.error });
      return;
    }
    doc.skuInitials = parsed.initials;
    doc.skuInitialsSet = true;
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
    await reconcileHhB2bHealthSchedule();
  } catch (err) {
    console.error('[hh-b2b-health] Failed to apply check times', err);
  }
  res.json({ data: await serializeConfig(doc) });
}

export async function checkHhB2bSession(req: Request, res: Response): Promise<void> {
  const brand = hhBrandFromRequest(req);
  try {
    await runHhB2bHealthCheck(brand);
  } catch (err) {
    if (err instanceof HhB2bHealthBusyError) {
      res.status(409).json({ message: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Session check failed.';
    res.status(500).json({ message });
    return;
  }
  const doc = await getOrCreateHhB2bConfig(brand, true);
  res.json({ data: await serializeConfig(doc) });
}

export async function testHhB2bWebhook(req: Request, res: Response): Promise<void> {
  const brand = hhBrandFromRequest(req);
  try {
    await sendHhB2bWebhookTest(brand);
  } catch (err) {
    if (err instanceof HhB2bWebhookTestError) {
      res.status(400).json({ message: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Webhook test failed.';
    res.status(500).json({ message });
    return;
  }
  const doc = await getOrCreateHhB2bConfig(brand, true);
  res.json({ data: await serializeConfig(doc) });
}
