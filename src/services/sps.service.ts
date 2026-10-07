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

/* ─────────────────────────────────────── SPS Fulfillment / Invoice API ── */

const SPS_API_BASE = 'https://api.spscommerce.com';

/**
 * A normalised EDI-810 (Invoice) record returned by the SPS Fulfillment API.
 * Fields are mapped from the RSX 7.7.7 JSON envelope on a best-effort basis;
 * the full raw envelope is preserved in `rawData` for debugging.
 */
export interface SpsInvoiceRecord {
  id: string;
  purchaseOrderNumber?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  totalAmount?: number;
  currency?: string;
  tradingPartner?: string;
  tradingPartnerId?: string;
  documentType?: string;
  createdAt?: string;
  status?: string;
  rawData?: Record<string, unknown>;
}

export interface SpsInvoicesPage {
  records: SpsInvoiceRecord[];
  nextCursor?: string | null;
}

/**
 * Fetches EDI 810 (Invoice) records from the SPS Fulfillment API for a given
 * access token, optionally filtered by PO number.
 *
 * NOTE: The exact endpoint path depends on your SPS account provisioning.
 * If this returns 404/403, check your SPS Dev Center API documentation.
 * Alternative endpoint: /transactions/v5/data/out?documentType=810
 */
export async function fetchSpsInvoices(
  accessToken: string,
  params: { poNumber?: string; limit?: number; cursor?: string },
): Promise<SpsInvoicesPage> {
  const url = new URL(`${SPS_API_BASE}/fulfillment/v1/invoices`);
  if (params.poNumber) url.searchParams.set('purchaseOrderNumber', params.poNumber);
  if (params.limit)    url.searchParams.set('limit', String(params.limit));
  if (params.cursor)   url.searchParams.set('cursor', params.cursor);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new SpsAuthError('SPS token revoked or insufficient permissions to read invoices.');
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    throw new SpsApiError(
      (data.message as string) ||
      (data.error as string) ||
      `SPS API returned ${res.status}: ${res.statusText}`,
    );
  }

  // Normalise response — SPS may return results under `results`, `data`, or `items`.
  const items = (
    (data.results as unknown[]) ||
    (data.data as unknown[]) ||
    (data.items as unknown[]) ||
    []
  ) as Record<string, unknown>[];

  const records: SpsInvoiceRecord[] = items.map((item) => ({
    id:                  String(item.id ?? item.transactionId ?? ''),
    purchaseOrderNumber: item.purchaseOrderNumber as string | undefined,
    invoiceNumber:       item.invoiceNumber as string | undefined,
    invoiceDate:         item.invoiceDate as string | undefined,
    totalAmount:         typeof item.totalAmount === 'number' ? item.totalAmount : undefined,
    currency:            item.currency as string | undefined,
    tradingPartner:      (item.tradingPartner ?? item.tradingPartnerName) as string | undefined,
    tradingPartnerId:    item.tradingPartnerId as string | undefined,
    documentType:        item.documentType as string | undefined,
    createdAt:           (item.createdAt ?? item.receivedAt) as string | undefined,
    status:              item.status as string | undefined,
    rawData:             item,
  }));

  return {
    records,
    nextCursor: (data.nextCursor ?? data.cursor ?? null) as string | null | undefined,
  };
}

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
