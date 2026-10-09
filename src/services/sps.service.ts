import type { IDocTidySpsSource } from '../models/DocTidySpsSource';

// SPS Commerce uses Auth0 under the hood.
const AUTHORIZE_URL  = 'https://auth.spscommerce.com/authorize';
const TOKEN_URL      = 'https://auth.spscommerce.com/oauth/token';
const USERINFO_URL   = 'https://auth.spscommerce.com/userinfo';

// SPS Dev Center OAuth audience.
//
// Two known audience values and what they unlock:
//   api://api.spscommerce.com/ — Transaction API v5 file queue (Sandbox client)
//   https://spscommerce.com    — Fulfillment Monitor (Production client, but blocked for Dev Center apps)
//
// The correct value depends entirely on which Dev Center app type is configured:
//   Sandbox app  → always issues api://api.spscommerce.com/  → Transaction API works
//   Production app → always issues https://spscommerce.com  → neither API works for us yet
//
// Default: api://api.spscommerce.com/ (requires Sandbox-type Dev Center credentials)
const AUDIENCE = (process.env.SPS_AUDIENCE ?? 'api://api.spscommerce.com/') as string;

/** Raised when stored SPS credentials have been revoked or are expired. */
export class SpsAuthError extends Error {
  constructor(message = 'SPS Commerce connection revoked or expired') {
    super(message);
    this.name = 'SpsAuthError';
  }
}

/** Raised for non-auth SPS API failures. */
export class SpsApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpsApiError';
  }
}

export interface SpsTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
}

export interface SpsUserInfo {
  /** Auth0 subject — stable unique account identifier. */
  sub?: string;
  email?: string;
  name?: string;
}

function getClientCreds(): { clientId: string; clientSecret: string } {
  const clientId     = process.env.SPS_CLIENT_ID;
  const clientSecret = process.env.SPS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new SpsApiError(
      'SPS Commerce is not configured. Set SPS_CLIENT_ID and SPS_CLIENT_SECRET.'
    );
  }
  return { clientId, clientSecret };
}

export function getCallbackUrl(): string {
  return (
    process.env.SPS_CALLBACK_URL ||
    'http://localhost:5000/api/auth/sps/callback'
  );
}

/** Builds the SPS Commerce (Auth0) OAuth consent URL. */
export function buildAuthUrl(state: string): string {
  const { clientId } = getClientCreds();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  getCallbackUrl(),
    audience:      AUDIENCE,
    // offline_access is required for Auth0 to issue a refresh_token.
    scope:         'openid profile email offline_access',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Exchanges an authorization code for access + refresh tokens. */
export async function exchangeCodeForTokens(code: string): Promise<SpsTokens> {
  const { clientId, clientSecret } = getClientCreds();

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  getCallbackUrl(),
    code,
  });

  const res  = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    throw new SpsApiError(
      (data.error_description as string) ||
      (data.error as string) ||
      'Failed to exchange SPS authorization code'
    );
  }

  return {
    accessToken:      data.access_token as string,
    refreshToken:     data.refresh_token as string | undefined,
    expiresInSeconds: data.expires_in as number | undefined,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<SpsTokens> {
  const { clientId, clientSecret } = getClientCreds();

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res  = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    if (data.error === 'invalid_grant') {
      throw new SpsAuthError();
    }
    throw new SpsApiError(
      (data.error_description as string) ||
      (data.error as string) ||
      'Failed to refresh SPS access token'
    );
  }

  return {
    accessToken:      data.access_token as string,
    expiresInSeconds: data.expires_in as number | undefined,
  };
}

/**
 * Fetches the connected account's identity from the Auth0 /userinfo endpoint.
 * Returns an empty object on failure so the caller can still save the token.
 */
export async function getSpsUserInfo(accessToken: string): Promise<SpsUserInfo> {
  try {
    const res  = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return {};
    return {
      sub:   data.sub   as string | undefined,
      email: data.email as string | undefined,
      name:  data.name  as string | undefined,
    };
  } catch {
    return {};
  }
}

/* ─────────────────────────────── SPS Transaction API v5 — document queue ── */

const SPS_API_BASE  = process.env.SPS_API_BASE ?? 'https://api.spscommerce.com';
const SPS_DATA_BASE = `${SPS_API_BASE}/transactions/v5/data`;
/** Mailbox folder under /data/ to browse. Accounts in testing often only have "testout". */
const SPS_DATA_DIR  = process.env.SPS_DATA_DIR ?? 'out';

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Resolves and validates a mailbox folder name (e.g. "out", "testout"). */
function resolveDataDir(dataDir?: string): string {
  const dir = dataDir?.trim() || SPS_DATA_DIR;
  if (!SAFE_SEGMENT.test(dir)) {
    throw new SpsApiError(`Invalid SPS mailbox folder '${dir}'.`);
  }
  return dir;
}

function resolveDocType(docType: string): string {
  const type = docType.trim().toUpperCase();
  if (!SAFE_SEGMENT.test(type)) {
    throw new SpsApiError(`Invalid SPS document type '${docType}'.`);
  }
  return type;
}

/**
 * A document entry returned by the SPS Transaction API v5 directory listing.
 *
 * The Transaction API v5 is a file-queue system, not a queryable database.
 * Each entry in `GET /transactions/v5/data/{dataDir}/{docType}/` is a file (EDI XML)
 * whose filename typically contains the PO number, e.g.:
 *   "PO584615-1-v7.7-BulkImport.xml"
 *
 * Filtering by PO number is done client-side by searching the filename.
 */
export interface SpsDocumentRecord {
  /** Filename as returned by SPS, e.g. "PO584615-1-v7.7-BulkImport.xml" */
  filename: string;
  /** Full download URL: /transactions/v5/data/{dataDir}/{docType}/{filename} */
  downloadUrl: string;
  /** Document-type directory (PO, IN, etc.) */
  docType: string;
  /** File size in bytes (when provided by the API) */
  size?: number;
  /** ISO timestamp when the file appeared in the queue (when provided) */
  createdAt?: string;
  /** Raw API response item for debugging */
  rawData?: unknown;
}

export interface SpsDocumentsPage {
  records: SpsDocumentRecord[];
  nextCursor?: string | null;
  /** Mailbox folder that was listed ("out", "testout", …); null for a top-level listing. */
  dataDir: string | null;
}

/** @deprecated Renamed to SpsDocumentRecord — kept for backward compat. */
export type SpsInvoiceRecord = SpsDocumentRecord;
/** @deprecated Renamed to SpsDocumentsPage — kept for backward compat. */
export type SpsInvoicesPage  = SpsDocumentsPage;

function extractSpsError(data: Record<string, unknown>, status: number, statusText: string): string {
  // Transaction API v5 shape: { "error": { "errorDescription": "…", "error": "…" }, "status": "error" }
  const errObj  = data.error && typeof data.error === 'object'
    ? (data.error as Record<string, unknown>)
    : null;
  const msgStr  = typeof data.message === 'string' ? data.message : null;
  const errStr  = typeof data.error   === 'string' ? data.error   : null;
  const errDesc = errObj
    ? String(errObj.errorDescription ?? errObj.error ?? JSON.stringify(errObj))
    : null;
  return msgStr || errDesc || errStr
    || `SPS API returned ${status}: ${statusText} — ${JSON.stringify(data).slice(0, 400)}`;
}

function tryParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Normalise a directory-listing response into a flat SpsDocumentRecord array.
 *
 * The SPS Transaction API v5 wraps its listing in `{ "results": [...], "paging": { … } }`.
 * Plain arrays and other common envelope keys are also accepted.
 */
function normaliseDocumentList(
  data: unknown,
  parentUrl: string,
  docType: string | undefined,
): SpsDocumentRecord[] {
  const baseUrl    = docType ? `${parentUrl}${docType}/` : parentUrl;
  const docTypeStr = docType ?? 'unknown';

  /** Resolve an href/url that SPS may return as a relative path ("/transactions/v5/…"). */
  function toAbsoluteUrl(raw: string): string {
    if (raw.startsWith('/')) return `${SPS_API_BASE}${raw}`;
    return raw;
  }

  function toRecord(item: unknown, idx: number): SpsDocumentRecord {
    if (typeof item === 'string') {
      // Could be a filename ("PO584615.xml") or a directory name ("PO", "IN", "testout/")
      const name  = item.replace(/\/$/, '');
      const isDir = item.endsWith('/') || !name.includes('.');
      return {
        filename:    name,
        downloadUrl: isDir ? `${parentUrl}${name}/` : `${baseUrl}${encodeURIComponent(name)}`,
        docType:     isDir ? name : docTypeStr,
        rawData:     item,
      };
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;

      // SPS Transaction API v5 uses "path" (e.g. "/out/IN/") as the name field
      // and "url" as the download/browse link.  Fall back to the other common
      // field names so the normaliser handles any future schema variation.
      const rawName = String(
        obj.path ?? obj.name ?? obj.filename ?? obj.id ?? `document-${idx}`,
      );
      // Strip any leading directory segments from a full path so we display
      // just the leaf name.  "/out/IN/" → "IN", "PO584615.xml" → "PO584615.xml"
      const leafName = rawName.replace(/\/$/, '').split('/').filter(Boolean).pop() ?? rawName.replace(/\/$/, '');
      const filename = leafName;

      // A trailing slash on the raw name, or an explicit type field, signals a directory.
      const isDir = rawName.endsWith('/') || (typeof obj.type === 'string' && obj.type === 'directory');

      // Prefer the absolute url/href from the response; fall back to constructing one.
      const rawHref = (obj.url ?? obj.href) ? String(obj.url ?? obj.href) : null;
      const downloadUrl = rawHref
        ? toAbsoluteUrl(rawHref)
        : isDir
          ? `${parentUrl}${filename}/`
          : `${baseUrl}${encodeURIComponent(filename)}`;

      return {
        filename,
        downloadUrl,
        docType:   isDir ? filename : docTypeStr,
        size:      typeof obj.size === 'number' ? obj.size : undefined,
        createdAt: (obj.lastModified ?? obj.createdAt ?? obj.timestamp)
          ? String(obj.lastModified ?? obj.createdAt ?? obj.timestamp)
          : undefined,
        rawData: item,
      };
    }
    return { filename: `document-${idx}`, downloadUrl: baseUrl, docType: docTypeStr, rawData: item };
  }

  if (Array.isArray(data)) {
    return (data as unknown[]).map(toRecord);
  }
  if (data && typeof data === 'object') {
    const obj    = data as Record<string, unknown>;
    const nested =
      (obj.results    as unknown[]) ??
      (obj.entries    as unknown[]) ??
      (obj.content    as unknown[]) ??
      (obj.data       as unknown[]) ??
      (obj.items      as unknown[]) ??
      (obj.files      as unknown[]) ??
      null;
    if (Array.isArray(nested)) return nested.map(toRecord);
  }
  return [];
}

/**
 * Lists entries in the SPS Transaction API v5 mailbox.
 *
 * With `params.topLevel`: lists `GET /transactions/v5/data/` to discover the
 *   mailbox folders the account has (in, out, testin, testout, …).
 * Without `params.docType`: lists `GET /transactions/v5/data/{dataDir}/`
 *   to discover what document-type sub-directories are available.
 * With `params.docType` (e.g. "PO"): lists `GET /transactions/v5/data/{dataDir}/PO/`
 *
 * @param params.dataDir         — Mailbox folder (default: SPS_DATA_DIR env, else "out")
 * @param params.docType         — Sub-directory to list (omit for folder root listing)
 * @param params.poNumberFilter  — Client-side filter: only return files whose filename contains this string
 */
export async function fetchSpsDocuments(
  accessToken: string,
  params: {
    topLevel?: boolean;
    dataDir?: string;
    docType?: string;
    poNumberFilter?: string;
    cursor?: string;
  },
): Promise<SpsDocumentsPage> {
  const dataDir   = params.topLevel ? null : resolveDataDir(params.dataDir);
  const docType   = !dataDir || !params.docType ? undefined : resolveDocType(params.docType);
  const parentUrl = dataDir ? `${SPS_DATA_BASE}/${dataDir}/` : `${SPS_DATA_BASE}/`;
  const listPath  = docType ? `${parentUrl}${docType}/` : parentUrl;
  const listUrl   = new URL(listPath);
  if (params.cursor) listUrl.searchParams.set('cursor', params.cursor);

  const res = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  if (res.status === 401 || res.status === 403) {
    throw new SpsAuthError('SPS token revoked or insufficient permissions to list documents.');
  }

  const rawText = await res.text();
  const data    = tryParseJson(rawText);

  if (!res.ok) {
    const errData = (data ?? {}) as Record<string, unknown>;
    throw new SpsApiError(extractSpsError(errData, res.status, res.statusText));
  }

  const allRecords = normaliseDocumentList(data, parentUrl, docType);

  // Extract the pagination cursor that SPS returns at the top level of the response.
  // Shape: { "entries": [...], "cursor": "<opaque-string-or-null>" }
  const nextCursor = (() => {
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const c   = obj.cursor ?? obj.nextCursor ?? obj.next_cursor;
      return typeof c === 'string' && c ? c : null;
    }
    return null;
  })();

  // Client-side PO number filter (Transaction API v5 has no server-side filter).
  const filter   = params.poNumberFilter?.trim().toLowerCase();
  const filtered = filter
    ? allRecords.filter((r) => r.filename.toLowerCase().includes(filter))
    : allRecords;

  return { records: filtered, nextCursor, dataDir };
}

/**
 * Downloads the raw EDI XML content of a single document from the SPS queue.
 * Returns the raw text so the caller can display or parse it.
 *
 * `GET /transactions/v5/data/{dataDir}/{docType}/{filename}`
 */
export async function fetchSpsDocumentContent(
  accessToken: string,
  docType: string,
  filename: string,
  dataDir?: string,
): Promise<string> {
  const dir = resolveDataDir(dataDir);
  const url = `${SPS_DATA_BASE}/${dir}/${resolveDocType(docType)}/${encodeURIComponent(filename)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: '*/*' },
  });

  if (res.status === 401 || res.status === 403) {
    throw new SpsAuthError('SPS token revoked or insufficient permissions to download this document.');
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const errData = (tryParseJson(errText) ?? {}) as Record<string, unknown>;
    throw new SpsApiError(extractSpsError(errData, res.status, res.statusText));
  }
  return res.text();
}

/* ──────────────────────────────────── Batch download + parse ── */

import { parseSpsFile } from './spsEdi.service';
export type { SpsTransaction } from './spsEdi.service';

/**
 * Lists EDI files in the specified mailbox folder+docType, downloads each one
 * (up to `limit`), and returns structured SpsTransaction records parsed from
 * the file content.
 *
 * Downloads are done with a concurrency of 5 to stay within SPS rate limits.
 */
export async function fetchAndParseTransactions(
  accessToken: string,
  params: {
    dataDir?: string;
    docType?: string;
    limit?: number;
    cursor?: string;
  },
): Promise<{ transactions: import('./spsEdi.service').SpsTransaction[]; nextCursor: string | null; dataDir: string | null }> {
  const limit = Math.min(params.limit ?? 50, 200);

  // 1. List files in the specified directory
  const page = await fetchSpsDocuments(accessToken, {
    dataDir: params.dataDir,
    docType: params.docType,
    cursor:  params.cursor,
  });

  // Only parse actual files (not directory entries)
  const files = page.records.slice(0, limit);

  // 2. Download & parse with concurrency = 5
  const CONCURRENCY = 5;
  const transactions: import('./spsEdi.service').SpsTransaction[] = [];

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (rec) => {
        try {
          const res = await fetch(rec.downloadUrl, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: '*/*' },
          });
          if (!res.ok) {
            // Return a stub record if the download fails
            return parseSpsFile({ content: '', filename: rec.filename, downloadUrl: rec.downloadUrl, docTypeFolderHint: rec.docType, size: rec.size, createdAt: rec.createdAt });
          }
          const content = await res.text();
          return parseSpsFile({ content, filename: rec.filename, downloadUrl: rec.downloadUrl, docTypeFolderHint: rec.docType, size: rec.size, createdAt: rec.createdAt });
        } catch {
          return parseSpsFile({ content: '', filename: rec.filename, downloadUrl: rec.downloadUrl, docTypeFolderHint: rec.docType, size: rec.size, createdAt: rec.createdAt });
        }
      }),
    );
    transactions.push(...results);
  }

  return { transactions, nextCursor: page.nextCursor ?? null, dataDir: page.dataDir };
}

/** Alias so existing controller code compiles unchanged. */
export const fetchSpsInvoices = (
  accessToken: string,
  params: { poNumber?: string; limit?: number; cursor?: string },
): Promise<SpsDocumentsPage> =>
  fetchSpsDocuments(accessToken, { poNumberFilter: params.poNumber, cursor: params.cursor });

/* ─────────────────────────────────────────────────────── Token helper ── */

/**
 * Returns a valid SPS access token for the given workspace source, refreshing
 * (and persisting) it when the stored one is missing or within 60 s of expiry.
 * The source document must be loaded with the hidden token fields selected
 * (`.select('+spsRefreshToken +spsAccessToken +spsTokenExpiry')`) and be saveable.
 */
export async function ensureAccessToken(source: IDocTidySpsSource): Promise<string> {
  if (!source.spsRefreshToken) {
    throw new SpsAuthError('SPS Commerce is not connected for this workspace.');
  }

  const now      = Date.now();
  const expiry   = source.spsTokenExpiry ? source.spsTokenExpiry.getTime() : 0;
  const stillValid = source.spsAccessToken && expiry - 60_000 > now;
  if (stillValid) return source.spsAccessToken as string;

  const tokens = await refreshAccessToken(source.spsRefreshToken);
  source.spsAccessToken  = tokens.accessToken;
  source.spsTokenExpiry  = new Date(now + (tokens.expiresInSeconds ?? 3600) * 1000);
  await source.save();
  return tokens.accessToken;
}
