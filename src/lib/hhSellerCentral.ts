import CookieJar, { SELLER_CENTRAL_OE_US_KEY } from '../models/CookieJar';

const SC_ORIGIN = 'https://sellercentral.amazon.com';
const SC_CSRF_HEADER = 'anti-csrftoken-a2z';
const SC_CSRF_REQUEST_HEADER = 'anti-csrftoken-a2z-request';
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

async function scFetch(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  headers.set('Accept', 'application/json, text/plain, */*');
  headers.set('User-Agent', USER_AGENT);
  headers.set('Accept-Language', 'en-US,en;q=0.9');
  const csrf = cookieNamedValue(cookie, SC_CSRF_HEADER);
  if (csrf && !headers.has(SC_CSRF_HEADER)) {
    headers.set(SC_CSRF_HEADER, csrf);
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
  return res;
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const compact = (await res.text()).trim().replace(/\s+/g, ' ');
    if (!compact) return '';
    return compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
  } catch {
    return '';
  }
}

async function readScJson(res: Response): Promise<unknown> {
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`Seller Central request failed (${res.status})${detail ? `: ${detail}` : ''}`);
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

async function scRequest(path: string, cookie: string, init: RequestInit = {}): Promise<unknown> {
  return readScJson(await scFetch(path, cookie, init));
}

/** Ask Get Order for a CSRF token, then echo it on the Seller Notes POST. */
async function fetchScCsrfToken(orderId: string, cookie: string): Promise<string> {
  const res = await scFetch(`/orders-api/order/${encodeURIComponent(orderId)}`, cookie, {
    headers: { [SC_CSRF_REQUEST_HEADER]: 'true' },
  });
  const token = res.headers.get(SC_CSRF_HEADER)?.trim() ?? '';
  await readScJson(res);
  if (!token) {
    throw new Error('Seller Central did not return an anti-csrftoken-a2z token');
  }
  return token;
}

/** Existing note plus a blank line and the PO. Null when there is nothing to write. */
export function composeSellerNoteWithPo(existing: string, po: string): string | null {
  const note = existing.trim();
  const purchaseOrder = po.trim();
  if (!purchaseOrder) return null;

  const lines = note.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line === purchaseOrder) return null;
    break;
  }

  if (!note) return purchaseOrder;
  return `${note}\n\n${purchaseOrder}`;
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

export async function updateScSellerNotes(orderId: string, noteText: string, cookie: string): Promise<void> {
  const csrf = await fetchScCsrfToken(orderId, cookie);
  await scRequest(`/orders-api/order/${encodeURIComponent(orderId)}/seller-notes`, cookie, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: `${SC_ORIGIN}/orders-v3/order/${encodeURIComponent(orderId)}`,
      [SC_CSRF_HEADER]: csrf,
    },
    body: JSON.stringify({ orderId, noteText }),
  });
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
