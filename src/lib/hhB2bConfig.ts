import CookieJar from '../models/CookieJar';
import { getOrCreateHhB2bConfig } from '../models/HHB2bConfig';
import { normalizeCookieHeader } from './hhSellerCentral';
import { hhBrand, HH_DEFAULT_BRAND, type HHBrandId } from './hhBrand';
import { effectiveThorogoodSkuInitials } from './hhThorogoodSku';
import { effectiveHhSkuPrefixes, effectiveHhSkuSuffixes, hhBrandUsesSkuAffixes } from './hhSkuExclude';

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
  skuInitials: string[];
  skuPrefixes: string[];
  skuSuffixes: string[];
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

function envOverrides(brand: HHBrandId): { baseUrl?: string; catalog?: string; accountId?: string; cookie?: string } {
  if (brand !== HH_DEFAULT_BRAND) return {};
  return {
    baseUrl: process.env.HH_B2B_BASE_URL,
    catalog: process.env.HH_B2B_CATALOG,
    accountId: process.env.HH_B2B_ACCOUNT_ID,
    cookie: process.env.HH_B2B_COOKIE,
  };
}

export async function loadHhB2bConfig(brand: HHBrandId = HH_DEFAULT_BRAND): Promise<HhB2bConfig> {
  const def = hhBrand(brand);
  const stored = await getOrCreateHhB2bConfig(brand, false);
  const env = envOverrides(brand);
  const baseUrl = parseHhB2bBaseUrl(firstNonEmpty(env.baseUrl, stored.baseUrl, def.baseUrl)) || def.baseUrl;
  const catalog = firstNonEmpty(env.catalog, stored.catalog, def.catalog) || def.catalog;
  const accountId =
    normalizeHhB2bAccountId(firstNonEmpty(env.accountId, stored.accountId, def.accountId)) || def.accountId;
  const skuInitials =
    brand === 'thorogood'
      ? effectiveThorogoodSkuInitials(stored.skuInitials, Boolean(stored.skuInitialsSet))
      : [];
  const usesAffixes = hhBrandUsesSkuAffixes(brand);
  const skuPrefixes = usesAffixes
    ? effectiveHhSkuPrefixes(stored.skuPrefixes, Boolean(stored.skuPrefixesSet))
    : [];
  const skuSuffixes = usesAffixes
    ? effectiveHhSkuSuffixes(stored.skuSuffixes, Boolean(stored.skuSuffixesSet))
    : [];
  return { baseUrl, catalog, accountId, skuInitials, skuPrefixes, skuSuffixes };
}

export async function isHhPlaceOrderEnabled(brand: HHBrandId = HH_DEFAULT_BRAND): Promise<boolean> {
  const stored = await getOrCreateHhB2bConfig(brand, false);
  return Boolean(stored.placeOrderEnabled);
}

/** Where the live B2B session comes from. A pasted config cookie, or Sportswear `HH_B2B_COOKIE`, overrides the jar. */
export type HhB2bCookieSource = 'env' | 'config' | 'jar' | 'jar-empty' | 'none';

/**
 * Same order as the cookie drafts and session checks actually use.
 * `jar-empty` means the brand jar is enabled but has not stored a session yet.
 */
export async function resolveHhB2bCookie(
  brand: HHBrandId,
  storedCookie: string,
): Promise<{ source: HhB2bCookieSource; cookie: string }> {
  const fromEnv = normalizeCookieHeader(envOverrides(brand).cookie || '');
  if (fromEnv) return { source: 'env', cookie: fromEnv };

  const fromConfig = normalizeCookieHeader(storedCookie);
  if (fromConfig) return { source: 'config', cookie: fromConfig };

  const key = hhBrand(brand).cookieJarKey;
  if (key) {
    const jar = await CookieJar.findOne({ key }).select('+cookie');
    if (jar?.enabled) {
      const fromJar = normalizeCookieHeader(jar.cookie ?? '');
      if (fromJar) return { source: 'jar', cookie: fromJar };
      return { source: 'jar-empty', cookie: '' };
    }
  }

  return { source: 'none', cookie: '' };
}

export async function loadHhB2bCookie(brand: HHBrandId = HH_DEFAULT_BRAND): Promise<string> {
  const def = hhBrand(brand);
  const stored = await getOrCreateHhB2bConfig(brand, true);
  const resolved = await resolveHhB2bCookie(brand, stored.cookie ?? '');
  if (resolved.cookie) return resolved.cookie;

  if (!def.cookieJarKey) {
    throw new HhB2bAuthError(
      `${def.cookieJarName} cookie is empty — paste a session on Dropship (B2B) → ${def.name} → Configurations`
    );
  }

  throw new HhB2bAuthError(
    `${def.cookieJarName} cookie is empty — wait for Cookie Jar to refresh, or paste a session on Dropship (B2B) → ${def.name} → Configurations`
  );
}

/** Same defaults as the B2B portal: start ship = today (UTC), cancel = +29 days. */
export function hhB2bArriveAndCancel(): { arriveOn: string; cancelOn: string } {
  const arriveOn = new Date().toISOString().slice(0, 10);
  const cancel = new Date(`${arriveOn}T00:00:00.000Z`);
  cancel.setUTCDate(cancel.getUTCDate() + 29);
  return { arriveOn, cancelOn: cancel.toISOString().slice(0, 10) };
}
