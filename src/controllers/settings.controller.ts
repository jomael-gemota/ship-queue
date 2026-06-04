import { Request, Response } from 'express';
import User from '../models/User';
import { listDriveFolders, listSharedDrives, getDriveFolder } from '../services/googleDrive.service';
import { getSyncConfigDoc, MIN_INTERVAL_MS, MAX_INTERVAL_MS } from '../models/SyncConfig';
import { applySyncConfig } from '../services/syncScheduler';
import { triggerSync } from './order.controller';

function getCreds(refreshToken?: string | null, accessToken?: string | null) {
  return { refreshToken, accessToken };
}

function buildSettingsPayload(user: InstanceType<typeof User>) {
  return {
    driveConnected: Boolean(user.googleRefreshToken),
    driveConnectedAt: user.driveConnectedAt || null,
    driveAccountEmail: user.driveAccountEmail || user.email,
    driveAccountName: user.driveAccountName || user.name,
    driveAccountAvatar: user.driveAccountAvatar || user.avatar || null,
    driveFolderId: user.driveFolderId || null,
    driveFolderName: user.driveFolderName || null,
  };
}

/** Returns the user's Drive connection status and selected destination folder. */
export const getSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id).select('+googleRefreshToken');
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.json({ data: buildSettingsPayload(user) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load settings', error: (error as Error).message });
  }
};

/** Persists the chosen Drive destination folder (by ID, validated against Drive). */
export const updateSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { driveFolderId } = req.body as { driveFolderId?: string };

    const user = await User.findById(req.user?.id).select('+googleRefreshToken +googleAccessToken');
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (!driveFolderId) {
      // Clearing the folder — uploads will go to Drive root.
      user.driveFolderId = undefined;
      user.driveFolderName = undefined;
      await user.save();
      res.json({ data: buildSettingsPayload(user) });
      return;
    }

    if (!user.googleRefreshToken) {
      res.status(400).json({ message: 'Google Drive is not connected. Please sign in again to grant Drive access.' });
      return;
    }

    // Validate the folder exists and is accessible.
    const folder = await getDriveFolder(
      getCreds(user.googleRefreshToken, user.googleAccessToken),
      driveFolderId
    );

    user.driveFolderId = folder.id;
    user.driveFolderName = folder.name;
    await user.save();

    res.json({ data: buildSettingsPayload(user) });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message || 'Failed to update settings' });
  }
};

/**
 * Revokes the user's Google Drive connection by clearing all stored OAuth
 * credentials and Drive folder settings. The user will need to reconnect
 * (and grant consent again) before labels can be uploaded.
 */
export const disconnectDrive = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id).select('+googleRefreshToken +googleAccessToken');
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // Best-effort token revocation with Google so the access is truly removed.
    if (user.googleRefreshToken) {
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(user.googleRefreshToken)}`,
          { method: 'POST' }
        );
      } catch {
        // Non-fatal — proceed with clearing local credentials regardless.
      }
    }

    user.googleRefreshToken = undefined;
    user.googleAccessToken = undefined;
    user.googleTokenExpiry = undefined;
    user.driveScopeGranted = false;
    user.driveConnectedAt = undefined;
    user.driveAccountEmail = undefined;
    user.driveAccountName = undefined;
    user.driveAccountAvatar = undefined;
    user.driveFolderId = undefined;
    user.driveFolderName = undefined;
    await user.save();

    res.json({ data: { disconnected: true } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to disconnect Google Drive', error: (error as Error).message });
  }
};

/**
 * Returns the global background-sync configuration (enabled + interval). Any
 * authenticated user may read it; only admins can change it.
 */
export const getSyncConfig = async (_req: Request, res: Response): Promise<void> => {
  try {
    const doc = await getSyncConfigDoc();
    res.json({ data: { enabled: doc.enabled, intervalMs: doc.intervalMs } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load sync configuration', error: (error as Error).message });
  }
};

/**
 * Updates the global background-sync configuration and applies it to the running
 * scheduler immediately (no server restart needed). Admin-only.
 */
export const updateSyncConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { enabled, intervalMs } = req.body as { enabled?: boolean; intervalMs?: number };

    const doc = await getSyncConfigDoc();

    if (typeof enabled === 'boolean') {
      doc.enabled = enabled;
    }

    if (intervalMs !== undefined) {
      const next = Number(intervalMs);
      if (!Number.isFinite(next) || next < MIN_INTERVAL_MS || next > MAX_INTERVAL_MS) {
        res.status(400).json({
          message: `Interval must be between ${MIN_INTERVAL_MS / 1000} and ${MAX_INTERVAL_MS / 1000} seconds`,
        });
        return;
      }
      doc.intervalMs = Math.round(next);
    }

    doc.updatedByName = req.user?.name;
    await doc.save();

    // Reconfigure the live scheduler so the change takes effect right away.
    applySyncConfig({ enabled: doc.enabled, intervalMs: doc.intervalMs });

    // Give the admin immediate feedback that auto-sync works by kicking off one
    // sync now (no-op if a sync is already running). The recurring schedule then
    // continues from here.
    let syncStarted = false;
    if (doc.enabled) {
      syncStarted = triggerSync();
    }

    res.json({ data: { enabled: doc.enabled, intervalMs: doc.intervalMs, syncStarted } });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message || 'Failed to update sync configuration' });
  }
};

/** Returns true when a googleapis/google-auth-library error is a revoked/expired token. */
function isInvalidGrant(error: unknown): boolean {
  const msg = ((error as Error)?.message ?? '').toLowerCase();
  return msg.includes('invalid_grant');
}

/**
 * Lists Drive folders for the picker.
 * - At root (no parentId, no driveId): returns My Drive folders + Shared Drives.
 * - With driveId only: lists the root of that Shared Drive.
 * - With parentId (+ optional driveId): lists subfolders of that folder.
 */
export const listFolders = async (req: Request, res: Response): Promise<void> => {
  try {
    const parentId = (req.query.parentId as string) || undefined;
    const driveId = (req.query.driveId as string) || undefined;

    const user = await User.findById(req.user?.id).select('+googleRefreshToken +googleAccessToken');
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (!user.googleRefreshToken) {
      res.status(400).json({ message: 'Google Drive is not connected. Please sign in again to grant Drive access.' });
      return;
    }

    const creds = getCreds(user.googleRefreshToken, user.googleAccessToken);

    if (!parentId && !driveId) {
      // Root level — merge My Drive folders with Shared Drives so the user can
      // see everything available to the connected account.
      const [myDriveFolders, sharedDrives] = await Promise.all([
        listDriveFolders(creds),
        listSharedDrives(creds).catch(() => [] as { id: string; name: string }[]),
      ]);

      res.json({
        data: [
          ...myDriveFolders,
          ...sharedDrives.map((d) => ({ id: d.id, name: d.name, isSharedDrive: true })),
        ],
      });
      return;
    }

    const folders = await listDriveFolders(creds, parentId, driveId);
    res.json({ data: folders });
  } catch (error) {
    if (isInvalidGrant(error)) {
      res.status(401).json({
        code: 'drive_token_expired',
        message: 'Your Google Drive connection has been revoked or expired. Please reconnect.',
      });
      return;
    }
    res.status(400).json({ message: (error as Error).message || 'Failed to list Drive folders' });
  }
};
