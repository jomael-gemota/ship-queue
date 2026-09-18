import CookieJar, { HELLY_HANSEN_SPORTS_B2B_KEY } from '../models/CookieJar';
import { getOrCreateHhB2bConfig } from '../models/HHB2bConfig';
import { normalizeCookieHeader } from './hhSellerCentral';
import {
  HH_B2B_DEFAULT_ACCOUNT_ID,
  HH_B2B_DEFAULT_BASE_URL,
  HH_B2B_DEFAULT_CATALOG,
} from './hhB2bDefaults';

export {
  HH_B2B_DEFAULT_ACCOUNT_ID,
  HH_B2B_DEFAULT_BASE_URL,
  HH_B2B_DEFAULT_CATALOG,
} from './hhB2bDefaults';

export class HhB2bDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HhB2bDraftError';
  }
}

export class HhB2bAuthError extends HhB2bDraftError {
  constructor(message: string) {
    super(message);
    this.name = 'HhB2bAuthError';
  }
}

export interface HhB2bConfig {
  baseUrl: string;
  catalog: string;
  accountId: string;
}

export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function normalizeHhB2bAccountId(value: string): string {
  return value.trim().replace(/;+$/, '');
}

export function parseHhB2bBaseUrl(value: string): string | null {
  const trimmed = stripTrailingSlash(value.trim());
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return stripTrailingSlash(url.origin + url.pathname);
  } catch {
    return null;
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = (value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

export async function loadHhB2bConfig(): Promise<HhB2bConfig> {
  const stored = await getOrCreateHhB2bConfig(false);
  const baseUrl =
    parseHhB2bBaseUrl(firstNonEmpty(process.env.HH_B2B_BASE_URL, stored.baseUrl, HH_B2B_DEFAULT_BASE_URL)) ||
    HH_B2B_DEFAULT_BASE_URL;
  const catalog = firstNonEmpty(process.env.HH_B2B_CATALOG, stored.catalog, HH_B2B_DEFAULT_CATALOG) || HH_B2B_DEFAULT_CATALOG;
  const accountId =
    normalizeHhB2bAccountId(
      firstNonEmpty(process.env.HH_B2B_ACCOUNT_ID, stored.accountId, HH_B2B_DEFAULT_ACCOUNT_ID)
    ) || HH_B2B_DEFAULT_ACCOUNT_ID;
  return { baseUrl, catalog, accountId };
}

export async function isHhPlaceOrderEnabled(): Promise<boolean> {
  const stored = await getOrCreateHhB2bConfig(false);
  return Boolean(stored.placeOrderEnabled);
}

export async function loadHhB2bCookie(): Promise<string> {
  const fromEnv = normalizeCookieHeader(process.env.HH_B2B_COOKIE || '');
  if (fromEnv) return fromEnv;

  const stored = await getOrCreateHhB2bConfig(true);
  const fromConfig = normalizeCookieHeader(stored.cookie ?? '');
  if (fromConfig) return fromConfig;

  const jar = await CookieJar.findOne({ key: HELLY_HANSEN_SPORTS_B2B_KEY }).select('+cookie');
  if (jar?.enabled) {
    const fromJar = normalizeCookieHeader(jar.cookie ?? '');
    if (fromJar) return fromJar;
  }

  throw new HhB2bAuthError(
    'Helly Hansen Sports B2B cookie is empty — paste a session on Dropship (B2B) → HH Sportswear → Configurations'
  );
}

/** Same defaults as the B2B portal: start ship = today (UTC), cancel = +29 days. */
export function hhB2bArriveAndCancel(): { arriveOn: string; cancelOn: string } {
  const arriveOn = new Date().toISOString().slice(0, 10);
  const cancel = new Date(`${arriveOn}T00:00:00.000Z`);
  cancel.setUTCDate(cancel.getUTCDate() + 29);
  return { arriveOn, cancelOn: cancel.toISOString().slice(0, 10) };
}
