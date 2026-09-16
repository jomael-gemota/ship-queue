import CookieJar, { SELLER_CENTRAL_OE_US_KEY } from '../models/CookieJar';

const SC_ORIGIN = 'https://sellercentral.amazon.com';
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class HhScAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HhScAuthError';
  }
}

export class HhScNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HhScNotFoundError';
  }
}

export class HhScRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HhScRateLimitError';
  }
}

export interface ScOrderPayload {
  amazonOrderId: string;
  blob: string;
  buyerProxyEmail: string;
  sellerNotes: string;
  orderItems: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeCookieHeader(raw: string): string {
  let cookie = raw.trim();
  if (/^cookie\s*:/i.test(cookie)) {
    cookie = cookie.replace(/^cookie\s*:/i, '').trim();
  }
  return cookie;
}

function cookieNamedValue(cookie: string, name: string): string {
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return '';
}

export async function loadSellerCentralCookie(): Promise<string> {
  const jar = await CookieJar.findOne({ key: SELLER_CENTRAL_OE_US_KEY }).select('+cookie');
  if (!jar) {
    throw new HhScAuthError('Seller Central cookie jar is not configured');
  }
  if (!jar.enabled) {
    throw new HhScAuthError('Seller Central cookie jar is disabled');
  }
  const cookie = normalizeCookieHeader(jar.cookie ?? '');
  if (!cookie) {
    throw new HhScAuthError('Seller Central cookie is empty — wait for Cookie Jar to refresh');
  }
  return cookie;
}

async function scRequest(path: string, cookie: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  headers.set('Accept', 'application/json, text/plain, */*');
  headers.set('User-Agent', USER_AGENT);
  headers.set('Accept-Language', 'en-US,en;q=0.9');
  const csrf = cookieNamedValue(cookie, 'anti-csrftoken-a2z');
  if (csrf && !headers.has('anti-csrftoken-a2z')) {
    headers.set('anti-csrftoken-a2z', csrf);
  }

  const res = await fetch(`${SC_ORIGIN}${path}`, {
    ...init,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status === 429) {
    throw new HhScRateLimitError('Seller Central rate-limited the request');
  }
  if (res.status === 401 || res.status === 403) {
    throw new HhScAuthError(`Seller Central rejected the session (${res.status})`);
  }
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
    throw new HhScAuthError('Seller Central redirected — session cookie is stale');
  }
  if (res.status === 404) {
    throw new HhScNotFoundError('Seller Central order was not found');
  }
  if (!res.ok) {
    throw new Error(`Seller Central request failed (${res.status})`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    throw new HhScAuthError('Seller Central returned a login page — session cookie is stale');
  }

  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Seller Central returned a non-JSON body');
  }
}

export async function fetchScOrder(orderId: string, cookie: string): Promise<ScOrderPayload> {
  const body = await scRequest(`/orders-api/order/${encodeURIComponent(orderId)}`, cookie);
  const root = asRecord(body);
  const order = asRecord(root?.order) ?? root;
  if (!order) {
    throw new HhScNotFoundError('Seller Central order payload was empty');
  }

  const amazonOrderId = asString(order.amazonOrderId) || orderId;
  const blob = asString(order.blob);
  const items = Array.isArray(order.orderItems) ? order.orderItems : [];

  return {
    amazonOrderId,
    blob,
    buyerProxyEmail: asString(order.buyerProxyEmail),
    sellerNotes: asString(order.sellerNotes),
    orderItems: items,
  };
}

export async function fetchScBuyerInfo(orderId: string, blob: string, cookie: string): Promise<unknown> {
  return scRequest('/orders-st/resolve', cookie, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: `${SC_ORIGIN}/orders-v3/order/${encodeURIComponent(orderId)}`,
    },
    body: JSON.stringify({ blobs: [blob] }),
  });
}
