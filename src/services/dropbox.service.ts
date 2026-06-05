import type { IUser } from '../models/User';

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropbox.com/oauth2/token';
const RPC_BASE = 'https://api.dropboxapi.com/2';

/** Scopes the Dropbox app must have enabled and that we request at consent time. */
export const DROPBOX_SCOPES = [
  'account_info.read',
  'files.metadata.read',
  'sharing.read',
  'sharing.write',
];

/** Raised when Dropbox rejects the stored refresh token (revoked / expired). */
export class DropboxAuthError extends Error {
  constructor(message = 'Dropbox connection revoked or expired') {
    super(message);
    this.name = 'DropboxAuthError';
  }
}

/** Raised for non-auth Dropbox API failures so callers can surface a message. */
export class DropboxApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DropboxApiError';
  }
}

export interface DropboxAccount {
  accountId?: string;
  email?: string;
  name?: string;
}

export interface DropboxTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
}

export interface DropboxFolderEntry {
  id: string;
  name: string;
  /** Lower-cased path used for subsequent API calls (e.g. "/folder/sub"). */
  path: string;
}

export interface DropboxFileLink {
  name: string;
  path: string;
  url: string;
  size?: number;
}

function getClientCreds(): { key: string; secret: string } {
  const key = process.env.DROPBOX_APP_KEY;
  const secret = process.env.DROPBOX_APP_SECRET;
  if (!key || !secret) {
    throw new DropboxApiError('Dropbox is not configured. Set DROPBOX_APP_KEY and DROPBOX_APP_SECRET.');
  }
  return { key, secret };
}

export function getCallbackUrl(): string {
  return process.env.DROPBOX_CALLBACK_URL || 'http://localhost:5000/api/auth/dropbox/callback';
}

function basicAuthHeader(): string {
  const { key, secret } = getClientCreds();
  return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
}

/** Builds the Dropbox OAuth consent URL (offline access → refresh token). */
export function buildAuthUrl(state: string): string {
  const { key } = getClientCreds();
  const params = new URLSearchParams({
    client_id: key,
    response_type: 'code',
    redirect_uri: getCallbackUrl(),
    token_access_type: 'offline',
    scope: DROPBOX_SCOPES.join(' '),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Exchanges an authorization code for access + refresh tokens. */
export async function exchangeCodeForTokens(code: string): Promise<DropboxTokens> {
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: getCallbackUrl(),
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new DropboxApiError(
      (data.error_description as string) || (data.error as string) || 'Failed to exchange Dropbox authorization code'
    );
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresInSeconds: data.expires_in as number | undefined,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<DropboxTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // invalid_grant means the refresh token was revoked or is no longer valid.
    if (data.error === 'invalid_grant') {
      throw new DropboxAuthError();
    }
    throw new DropboxApiError((data.error_description as string) || (data.error as string) || 'Failed to refresh Dropbox token');
  }

  return {
    accessToken: data.access_token as string,
    expiresInSeconds: data.expires_in as number | undefined,
  };
}

/**
 * Returns a valid access token for the user, refreshing (and persisting) it when
 * the stored one is missing or within 60s of expiry. The user document must be
 * loaded with the hidden token fields selected and be saveable.
 */
export async function ensureAccessToken(user: IUser): Promise<string> {
  if (!user.dropboxRefreshToken) {
    throw new DropboxAuthError('Dropbox is not connected.');
  }

  const now = Date.now();
  const expiry = user.dropboxTokenExpiry ? user.dropboxTokenExpiry.getTime() : 0;
  const stillValid = user.dropboxAccessToken && expiry - 60_000 > now;
  if (stillValid) {
    return user.dropboxAccessToken as string;
  }

  const tokens = await refreshAccessToken(user.dropboxRefreshToken);
  user.dropboxAccessToken = tokens.accessToken;
  user.dropboxTokenExpiry = new Date(now + (tokens.expiresInSeconds ?? 14400) * 1000);
  await user.save();
  return tokens.accessToken;
}

/** Performs a Dropbox RPC-style POST and returns the parsed JSON body. */
async function dbxRpc<T>(endpoint: string, accessToken: string, body: unknown): Promise<T> {
  const res = await fetch(`${RPC_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    // Dropbox requires the body to be valid JSON; some endpoints take `null`.
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const err = data as { error_summary?: string };
    if (res.status === 401) {
      throw new DropboxAuthError();
    }
    const summary = (err && err.error_summary) || (typeof data === 'string' ? data : '') || `Dropbox API error (${res.status})`;
    const apiErr = new DropboxApiError(summary);
    // Attach the raw summary so specific handlers (e.g. shared_link_already_exists) can branch.
    (apiErr as DropboxApiError & { summary?: string }).summary = summary;
    throw apiErr;
  }

  return data as T;
}

interface DropboxListEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  id?: string;
  name: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
}

interface ListFolderResult {
  entries: DropboxListEntry[];
  cursor: string;
  has_more: boolean;
}

/** Normalizes a folder path for the Dropbox API (root must be an empty string). */
function normalizePath(path?: string): string {
  if (!path) return '';
  const trimmed = path.trim();
  if (trimmed === '' || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Lists every entry under `path`, following pagination cursors. */
async function listAllEntries(accessToken: string, path: string, recursive: boolean): Promise<DropboxListEntry[]> {
  const entries: DropboxListEntry[] = [];

  let page = await dbxRpc<ListFolderResult>('/files/list_folder', accessToken, {
    path: normalizePath(path),
    recursive,
    include_non_downloadable_files: true,
    limit: 2000,
  });
  entries.push(...page.entries);

  while (page.has_more) {
    page = await dbxRpc<ListFolderResult>('/files/list_folder/continue', accessToken, {
      cursor: page.cursor,
    });
    entries.push(...page.entries);
  }

  return entries;
}

/** Fetches the connected Dropbox account's display name + email. */
export async function getCurrentAccount(accessToken: string): Promise<DropboxAccount> {
  const data = await dbxRpc<{
    account_id?: string;
    email?: string;
    name?: { display_name?: string };
  }>('/users/get_current_account', accessToken, null);

  return {
    accountId: data.account_id,
    email: data.email,
    name: data.name?.display_name,
  };
}

/** Lists the immediate sub-folders of `path` (root when blank), sorted by name. */
export async function listSubfolders(accessToken: string, path?: string): Promise<DropboxFolderEntry[]> {
  const entries = await listAllEntries(accessToken, normalizePath(path), false);
  return entries
    .filter((e) => e['.tag'] === 'folder' && e.path_lower)
    .map((e) => ({
      id: e.id || (e.path_lower as string),
      name: e.name,
      path: e.path_lower as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns the files in `path` whose extension is in `extensions` (empty = all). */
async function listMatchingFiles(
  accessToken: string,
  path: string,
  extensions: string[],
  recursive: boolean
): Promise<DropboxListEntry[]> {
  const entries = await listAllEntries(accessToken, path, recursive);
  const exts = extensions.map((e) => e.toLowerCase().replace(/^\./, '')).filter(Boolean);

  return entries.filter((e) => {
    if (e['.tag'] !== 'file' || !e.path_lower) return false;
    if (exts.length === 0) return true;
    const dot = e.name.lastIndexOf('.');
    if (dot === -1) return false;
    const ext = e.name.slice(dot + 1).toLowerCase();
    return exts.includes(ext);
  });
}

interface SharedLinkMetadata {
  url: string;
}

/** Creates a shared link for `path`, reusing the existing one if it already has one. */
async function createOrReuseSharedLink(accessToken: string, path: string): Promise<string> {
  try {
    const data = await dbxRpc<SharedLinkMetadata>('/sharing/create_shared_link_with_settings', accessToken, {
      path,
      settings: { audience: 'public', access: 'viewer', allow_download: true },
    });
    return data.url;
  } catch (err) {
    const summary = (err as DropboxApiError & { summary?: string }).summary || '';
    if (summary.includes('shared_link_already_exists')) {
      const existing = await dbxRpc<{ links: SharedLinkMetadata[] }>('/sharing/list_shared_links', accessToken, {
        path,
        direct_only: true,
      });
      if (existing.links && existing.links.length > 0) {
        return existing.links[0].url;
      }
    }
    // Some accounts reject custom settings; retry once with defaults before failing.
    if (summary.includes('settings_error')) {
      const data = await dbxRpc<SharedLinkMetadata>('/sharing/create_shared_link_with_settings', accessToken, { path });
      return data.url;
    }
    throw err;
  }
}

/** Runs `worker` over `items` with a bounded number of concurrent calls. */
async function mapWithConcurrency<I, O>(items: I[], limit: number, worker: (item: I) => Promise<O>): Promise<O[]> {
  const results: O[] = new Array(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export interface ExtractLinksResult {
  links: DropboxFileLink[];
  scanned: number;
  failures: { name: string; path: string }[];
}

/**
 * Extracts shared-link URLs for every file in `path` matching `extensions`.
 * When `recursive` is true, files in sub-folders are included too.
 */
export async function extractFileLinks(
  accessToken: string,
  path: string,
  extensions: string[],
  recursive: boolean
): Promise<ExtractLinksResult> {
  const files = await listMatchingFiles(accessToken, normalizePath(path), extensions, recursive);

  const failures: { name: string; path: string }[] = [];
  const linked = await mapWithConcurrency(files, 5, async (file) => {
    try {
      const url = await createOrReuseSharedLink(accessToken, file.path_lower as string);
      return {
        name: file.name,
        path: file.path_display || (file.path_lower as string),
        url,
        size: file.size,
      } as DropboxFileLink;
    } catch {
      failures.push({ name: file.name, path: file.path_display || (file.path_lower as string) });
      return null;
    }
  });

  const links = linked.filter((l): l is DropboxFileLink => l !== null).sort((a, b) => a.name.localeCompare(b.name));

  return { links, scanned: files.length, failures };
}

/** Best-effort revocation of the current access token on disconnect. */
export async function revokeToken(accessToken: string): Promise<void> {
  try {
    await fetch(`${RPC_BASE}/auth/token/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Non-fatal — local credentials are cleared by the caller regardless.
  }
}
