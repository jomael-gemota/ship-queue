import { Request, Response } from 'express';
import { getOrCreateHhB2bConfig } from '../models/HHB2bConfig';
import type { IHHB2bConfig } from '../models/HHB2bConfig';
import { hhBrandFromRequest } from '../lib/hhBrand';
import { normalizeCookieHeader } from '../lib/hhSellerCentral';
import { normalizeHhB2bAccountId, parseHhB2bBaseUrl } from '../lib/hhB2bConfig';
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
  hasCookie: boolean;
  cookieUpdatedAt: string | null;
  placeOrderEnabled: boolean;
  alertWebhookUrl: string;
  sessionCheckTimes: string[];
  sessionCheck: HhB2bSessionCheckDto;
  lastAlert: HhB2bLastAlertDto;
  updatedAt: string;
  updatedByName: string;
}

function sessionStatus(value: string | undefined): HhB2bSessionCheckDto['status'] {
  if (value === 'ok' || value === 'auth' || value === 'down') return value;
  return null;
}

function alertEvent(value: string | undefined): HhB2bLastAlertDto['event'] {
  if (value === 'failed' || value === 'recovered' || value === 'test') return value;
  return null;
}

function serializeConfig(doc: IHHB2bConfig): HhB2bConfigDto {
  return {
    baseUrl: doc.baseUrl,
    catalog: doc.catalog,
    accountId: doc.accountId,
    hasCookie: Boolean(normalizeCookieHeader(doc.cookie ?? '')),
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
  res.json({ data: serializeConfig(doc) });
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
  res.json({ data: serializeConfig(doc) });
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
  res.json({ data: serializeConfig(doc) });
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
  res.json({ data: serializeConfig(doc) });
}
