import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  getCurrentAccount,
} from '../services/dropbox.service';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET!;

/**
 * Returns the Dropbox OAuth consent URL as JSON. The frontend navigates to it
 * directly (full redirect) so Vite's dev proxy never touches the redirect.
 * Protected via requireAuth (standard Bearer token in Authorization header).
 */
export const getDropboxAuthUrl = (req: Request, res: Response): void => {
  try {
    const userId = req.user!.id;
    const state = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '10m' });
    res.json({ url: buildAuthUrl(state) });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message || 'Failed to start Dropbox authorisation' });
  }
};

/**
 * Handles the OAuth callback from Dropbox. Exchanges the code for tokens, fetches
 * the connected account's profile, and stores everything on the user.
 */
export const handleDropboxCallback = async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  if (error || !code || !state) {
    res.redirect(`${CLIENT_URL}/settings?dropbox_error=access_denied`);
    return;
  }

  let userId: string;
  try {
    const payload = jwt.verify(state, JWT_SECRET) as { userId: string };
    userId = payload.userId;
  } catch {
    res.redirect(`${CLIENT_URL}/settings?dropbox_error=invalid_state`);
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const account = await getCurrentAccount(tokens.accessToken);

    const user = await User.findById(userId).select('+dropboxRefreshToken +dropboxAccessToken +dropboxTokenExpiry');
    if (!user) {
      res.redirect(`${CLIENT_URL}/settings?dropbox_error=user_not_found`);
      return;
    }

    user.dropboxAccessToken = tokens.accessToken;
    // A refresh token is only returned with offline access; keep the existing
    // one if Dropbox didn't issue a new one.
    if (tokens.refreshToken) {
      user.dropboxRefreshToken = tokens.refreshToken;
    }
    user.dropboxTokenExpiry = new Date(Date.now() + (tokens.expiresInSeconds ?? 14400) * 1000);
    user.dropboxConnectedAt = new Date();
    user.dropboxAccountId = account.accountId;
    user.dropboxAccountEmail = account.email;
    user.dropboxAccountName = account.name;
    await user.save();

    res.redirect(`${CLIENT_URL}/settings?dropbox=connected`);
  } catch (err) {
    console.error('Dropbox OAuth callback error:', err);
    res.redirect(`${CLIENT_URL}/settings?dropbox_error=auth_failed`);
  }
};
