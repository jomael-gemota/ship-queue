import { Request, Response } from 'express';
import User from '../models/User';
import { listDriveFolders, getDriveFolder } from '../services/googleDrive.service';

function getCreds(refreshToken?: string | null, accessToken?: string | null) {
  return { refreshToken, accessToken };
}

/** Returns the user's Drive connection status and selected destination folder. */
export const getSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id).select('+googleRefreshToken');
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.json({
      data: {
        driveConnected: Boolean(user.googleRefreshToken),
        driveFolderId: user.driveFolderId || null,
        driveFolderName: user.driveFolderName || null,
      },
    });
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
      res.json({ data: { driveFolderId: null, driveFolderName: null } });
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

    res.json({ data: { driveFolderId: folder.id, driveFolderName: folder.name } });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message || 'Failed to update settings' });
  }
};

/** Lists Drive folders for the picker (optionally under a parent folder). */
export const listFolders = async (req: Request, res: Response): Promise<void> => {
  try {
    const parentId = (req.query.parentId as string) || undefined;

    const user = await User.findById(req.user?.id).select('+googleRefreshToken +googleAccessToken');
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (!user.googleRefreshToken) {
      res.status(400).json({ message: 'Google Drive is not connected. Please sign in again to grant Drive access.' });
      return;
    }

    const folders = await listDriveFolders(
      getCreds(user.googleRefreshToken, user.googleAccessToken),
      parentId
    );

    res.json({ data: folders });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message || 'Failed to list Drive folders' });
  }
};
