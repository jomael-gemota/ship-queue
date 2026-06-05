import { Request, Response } from 'express';
import User from '../models/User';
import {
  ensureAccessToken,
  listSubfolders,
  extractFileLinks,
  DropboxAuthError,
} from '../services/dropbox.service';

/** Loads the current user with the hidden Dropbox token fields selected. */
async function loadUserWithTokens(userId?: string) {
  return User.findById(userId).select('+dropboxRefreshToken +dropboxAccessToken +dropboxTokenExpiry');
}

/** Maps a Dropbox auth failure to a 401 the frontend can react to (reconnect). */
function handleDropboxError(res: Response, error: unknown): void {
  if (error instanceof DropboxAuthError) {
    res.status(401).json({
      code: 'dropbox_token_expired',
      message: 'Your Dropbox connection has been revoked or expired. Please reconnect in Settings.',
    });
    return;
  }
  res.status(400).json({ message: (error as Error).message || 'Dropbox request failed' });
}

/**
 * Lists the immediate sub-folders of `path` (root when omitted) so the user can
 * drill down and pick a single folder. Mounted shared folders appear here too.
 */
export const listFolders = async (req: Request, res: Response): Promise<void> => {
  try {
    const path = (req.query.path as string) || '';

    const user = await loadUserWithTokens(req.user?.id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    if (!user.dropboxRefreshToken) {
      res.status(400).json({ code: 'dropbox_not_connected', message: 'Dropbox is not connected. Connect it in Settings.' });
      return;
    }

    const accessToken = await ensureAccessToken(user);
    const folders = await listSubfolders(accessToken, path);
    res.json({ data: folders });
  } catch (error) {
    handleDropboxError(res, error);
  }
};

/**
 * Extracts shared-link URLs for every file in `path` matching the requested
 * extensions. `recursive` optionally includes files in sub-folders.
 */
export const extractLinks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { path, extensions, recursive } = req.body as {
      path?: string;
      extensions?: string[];
      recursive?: boolean;
    };

    if (path === undefined || path === null) {
      res.status(400).json({ message: 'A Dropbox folder path is required.' });
      return;
    }

    const user = await loadUserWithTokens(req.user?.id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    if (!user.dropboxRefreshToken) {
      res.status(400).json({ code: 'dropbox_not_connected', message: 'Dropbox is not connected. Connect it in Settings.' });
      return;
    }

    const accessToken = await ensureAccessToken(user);
    const result = await extractFileLinks(
      accessToken,
      path,
      Array.isArray(extensions) ? extensions : [],
      Boolean(recursive)
    );

    res.json({ data: result });
  } catch (error) {
    handleDropboxError(res, error);
  }
};

/**
 * Persists the user's Dropbox Fetcher setup (selected folder + breadcrumb trail,
 * file type, and recursion) so it survives refresh and logout.
 */
export const savePreferences = async (req: Request, res: Response): Promise<void> => {
  try {
    const { folderPath, crumbs, fileType, recursive } = req.body as {
      folderPath?: string;
      crumbs?: { path?: string; name?: string }[];
      fileType?: string;
      recursive?: boolean;
    };

    const user = await User.findById(req.user?.id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const safeCrumbs = Array.isArray(crumbs)
      ? crumbs
          .filter((c) => c && typeof c.path === 'string')
          .map((c) => ({ path: c.path as string, name: String(c.name ?? '') }))
      : [];

    user.dropboxFetcherPrefs = {
      folderPath: typeof folderPath === 'string' ? folderPath : '',
      crumbs: safeCrumbs,
      fileType: typeof fileType === 'string' ? fileType : 'all',
      recursive: Boolean(recursive),
    };
    await user.save();

    res.json({ data: { saved: true } });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message || 'Failed to save preferences' });
  }
};
