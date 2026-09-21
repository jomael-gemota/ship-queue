import { Request, Response } from 'express';
import { getOrCreateHhB2bConfig } from '../models/HHB2bConfig';
import type { IHHB2bConfig } from '../models/HHB2bConfig';
import { hhBrandFromRequest } from '../lib/hhBrand';
import { normalizeCookieHeader } from '../lib/hhSellerCentral';
import { normalizeHhB2bAccountId, parseHhB2bBaseUrl } from '../lib/hhB2bConfig';

export interface HhB2bConfigDto {
  baseUrl: string;
  catalog: string;
  accountId: string;
  hasCookie: boolean;
  cookieUpdatedAt: string | null;
  placeOrderEnabled: boolean;
  updatedAt: string;
  updatedByName: string;
}

function serializeConfig(doc: IHHB2bConfig): HhB2bConfigDto {
  return {
    baseUrl: doc.baseUrl,
    catalog: doc.catalog,
    accountId: doc.accountId,
    hasCookie: Boolean(normalizeCookieHeader(doc.cookie ?? '')),
    cookieUpdatedAt: doc.cookieUpdatedAt ? doc.cookieUpdatedAt.toISOString() : null,
    placeOrderEnabled: Boolean(doc.placeOrderEnabled),
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
  res.json({ data: serializeConfig(doc) });
}
