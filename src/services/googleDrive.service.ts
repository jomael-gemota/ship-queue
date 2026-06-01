import { Readable } from 'stream';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

export interface DriveCredentials {
  refreshToken?: string | null;
  accessToken?: string | null;
}

export interface DriveFolder {
  id: string;
  name: string;
}

export interface UploadedDriveFile {
  id: string;
  name: string;
  webViewLink?: string | null;
}

function buildOAuthClient(creds: DriveCredentials): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }
  if (!creds.refreshToken) {
    throw new Error('Google Drive is not connected. Please sign in again to grant Drive access.');
  }

  // Use the refresh token as the single source of truth. We deliberately do
  // NOT set a stored access_token here: a bare access_token without an
  // `expiry_date` makes google-auth-library treat it as valid forever, so it
  // never refreshes and Drive calls silently break once the (1-hour) token
  // expires. With only the refresh token set, the library always mints a fresh
  // access token for the correct account on demand.
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({
    refresh_token: creds.refreshToken,
  });
  return oauth2;
}

/**
 * Uploads a base64-encoded PDF to the user's Google Drive inside `folderId`.
 * The file is named `${fileName}` (caller passes the PO-based name).
 */
export async function uploadPdfToDrive(
  creds: DriveCredentials,
  fileName: string,
  base64Pdf: string,
  folderId?: string
): Promise<UploadedDriveFile> {
  const auth = buildOAuthClient(creds);
  const drive = google.drive({ version: 'v3', auth });

  const buffer = Buffer.from(base64Pdf, 'base64');
  const stream = Readable.from(buffer);

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/pdf',
      ...(folderId ? { parents: [folderId] } : {}),
    },
    media: {
      mimeType: 'application/pdf',
      body: stream,
    },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });

  return {
    id: res.data.id || '',
    name: res.data.name || fileName,
    webViewLink: res.data.webViewLink,
  };
}

/**
 * Lists folders in the user's Drive. When `parentId` is provided, lists its
 * direct subfolders; otherwise lists folders under "My Drive" root.
 * When `driveId` is provided the search is scoped to that Shared Drive.
 */
export async function listDriveFolders(
  creds: DriveCredentials,
  parentId?: string,
  driveId?: string
): Promise<DriveFolder[]> {
  const auth = buildOAuthClient(creds);
  const drive = google.drive({ version: 'v3', auth });

  const parent = parentId || (driveId ?? 'root');

  const res = await drive.files.list({
    q: `mimeType = 'application/vnd.google-apps.folder' and '${parent}' in parents and trashed = false`,
    fields: 'files(id, name)',
    orderBy: 'name',
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    ...(driveId ? { corpora: 'drive', driveId } : {}),
  });

  return (res.data.files || [])
    .filter((f): f is { id: string; name: string } => Boolean(f.id && f.name))
    .map((f) => ({ id: f.id, name: f.name }));
}

/**
 * Lists all Shared Drives the authenticated account has access to.
 */
export async function listSharedDrives(creds: DriveCredentials): Promise<DriveFolder[]> {
  const auth = buildOAuthClient(creds);
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.drives.list({
    pageSize: 50,
    fields: 'drives(id, name)',
  });

  return (res.data.drives || [])
    .filter((d): d is { id: string; name: string } => Boolean(d.id && d.name))
    .map((d) => ({ id: d.id, name: d.name }));
}

/** Fetches a single folder's metadata (used to resolve a pasted folder ID). */
export async function getDriveFolder(
  creds: DriveCredentials,
  folderId: string
): Promise<DriveFolder> {
  const auth = buildOAuthClient(creds);
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.get({
    fileId: folderId,
    fields: 'id, name, mimeType',
    supportsAllDrives: true,
  });

  if (res.data.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('The provided ID is not a Google Drive folder.');
  }

  return { id: res.data.id || folderId, name: res.data.name || 'Folder' };
}
