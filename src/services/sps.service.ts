import type { IDocTidySpsSource } from '../models/DocTidySpsSource';

// SPS Commerce uses Auth0 under the hood.
const AUTHORIZE_URL  = 'https://auth.spscommerce.com/authorize';
const TOKEN_URL      = 'https://auth.spscommerce.com/oauth/token';
const USERINFO_URL   = 'https://auth.spscommerce.com/userinfo';
const AUDIENCE       = 'api://api.spscommerce.com/';

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

const SPS_API_BASE      = process.env.SPS_API_BASE ?? 'https://api.spscommerce.com';
/** Default document-type sub-directory.  Override via SPS_DOC_TYPE env var (e.g. "IN"). */
const SPS_DOC_TYPE      = process.env.SPS_DOC_TYPE ?? 'PO';
const SPS_DATA_OUT_BASE = `${SPS_API_BASE}/transactions/v5/data/out`;

/**
 * A document entry returned by the SPS Transaction API v5 directory listing.
 *
 * The Transaction API v5 is a file-queue system, not a queryable database.
 * Each entry in `GET /transactions/v5/data/out/{docType}/` is a file (EDI XML)
 * whose filename typically contains the PO number, e.g.:
 *   "PO584615-1-v7.7-BulkImport.xml"
 *
 * Filtering by PO number is done client-side by searching the filename.
 */
export interface SpsDocumentRecord {
  /** Filename as returned by SPS, e.g. "PO584615-1-v7.7-BulkImport.xml" */
  filename: string;
  /** Full download URL: /transactions/v5/data/out/{docType}/{filename} */
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
 * Handles string[], object[] (name/href/size), or a root wrapper object.
 */
function normaliseDocumentList(data: unknown, docType: string): SpsDocumentRecord[] {
  const baseUrl = `${SPS_DATA_OUT_BASE}/${docType}/`;

  function toRecord(item: unknown, idx: number): SpsDocumentRecord {
    if (typeof item === 'string') {
      return {
        filename:    item,
        downloadUrl: `${baseUrl}${encodeURIComponent(item)}`,
        docType,
        rawData:     item,
      };
    }
    if (item && typeof item === 'object') {
      const obj      = item as Record<string, unknown>;
      const filename = String(obj.name ?? obj.filename ?? obj.id ?? `document-${idx}`);
      return {
        filename,
        downloadUrl: String(obj.href ?? obj.url ?? `${baseUrl}${encodeURIComponent(filename)}`),
        docType,
        size:        typeof obj.size === 'number' ? obj.size : undefined,
        createdAt:   (obj.lastModified ?? obj.createdAt ?? obj.timestamp)
          ? String(obj.lastModified ?? obj.createdAt ?? obj.timestamp)
          : undefined,
        rawData:     item,
      };
    }
    return { filename: `document-${idx}`, downloadUrl: baseUrl, docType, rawData: item };
  }

  if (Array.isArray(data)) {
    return (data as unknown[]).map(toRecord);
  }
  if (data && typeof data === 'object') {
    const obj    = data as Record<string, unknown>;
    const nested =
      (obj.results as unknown[]) ??
      (obj.data    as unknown[]) ??
      (obj.items   as unknown[]) ??
      (obj.files   as unknown[]) ??
      null;
    if (Array.isArray(nested)) return nested.map(toRecord);
  }
  return [];
}

/**
 * Lists available document files in the SPS Transaction API v5 out-directory.
 *
 * `GET /transactions/v5/data/out/{docType}/`
 *
 * @param params.docType         — Sub-directory to list (default: SPS_DOC_TYPE env var, fallback "PO")
 * @param params.poNumberFilter  — Client-side filter: only return files whose filename contains this string
 */
export async function fetchSpsDocuments(
  accessToken: string,
  params: { docType?: string; poNumberFilter?: string; cursor?: string },
): Promise<SpsDocumentsPage> {
  const docType = (params.docType ?? SPS_DOC_TYPE).toUpperCase();
  const listUrl = new URL(`${SPS_DATA_OUT_BASE}/${docType}/`);
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

  const allRecords = normaliseDocumentList(data, docType);

  // Client-side PO number filter (Transaction API v5 has no server-side filter).
  const filter   = params.poNumberFilter?.trim().toLowerCase();
  const filtered = filter
    ? allRecords.filter((r) => r.filename.toLowerCase().includes(filter))
    : allRecords;

  return { records: filtered, nextCursor: null };
}

/**
 * Downloads the raw EDI XML content of a single document from the SPS queue.
 * Returns the raw text so the caller can display or parse it.
 *
 * `GET /transactions/v5/data/out/{docType}/{filename}`
 */
export async function fetchSpsDocumentContent(
  accessToken: string,
  docType: string,
  filename: string,
): Promise<string> {
  const url = `${SPS_DATA_OUT_BASE}/${docType.toUpperCase()}/${encodeURIComponent(filename)}`;
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
