import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import User from '../models/User';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET!;

function buildOAuth2() {
  const callbackURL =
    process.env.DRIVE_CALLBACK_URL || 'http://localhost:5000/api/auth/drive/callback';
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL,
  );
}

/**
 * Returns the Google OAuth URL for Drive authorisation as JSON.
 * The frontend navigates to it directly so Vite's dev proxy never touches
 * the redirect — this avoids redirect_uri_mismatch in development.
 * Protected via requireAuth (standard Bearer token in Authorization header).
 */
export const getDriveAuthUrl = (req: Request, res: Response): void => {
  const userId = req.user!.id;
  const state = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '10m' });

  const oauth2 = buildOAuth2();
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account consent',
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/drive',
    ],
    state,
  });

  res.json({ url });
};

/**
 * Handles the OAuth callback from Google. Exchanges the code for tokens,
 * fetches the connected account's profile, and stores everything on the user.
 */
export const handleDriveCallback = async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  if (error || !code || !state) {
    res.redirect(`${CLIENT_URL}/settings?drive_error=access_denied`);
    return;
  }

  let userId: string;
  try {
    const payload = jwt.verify(state, JWT_SECRET) as { userId: string };
    userId = payload.userId;
  } catch {
    res.redirect(`${CLIENT_URL}/settings?drive_error=invalid_state`);
    return;
  }

  try {
    const oauth2 = buildOAuth2();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    // Fetch the profile of the Drive account (may differ from the login account).
    const oauth2Info = google.oauth2({ version: 'v2', auth: oauth2 });
    const { data: profile } = await oauth2Info.userinfo.get();

    const user = await User.findById(userId).select('+googleRefreshToken');
    if (!user) {
      res.redirect(`${CLIENT_URL}/settings?drive_error=user_not_found`);
      return;
    }

    user.googleAccessToken = tokens.access_token ?? undefined;
    // Google only returns a refresh_token on the initial consent; keep the
    // existing one if a new one wasn't issued.
    if (tokens.refresh_token) {
      user.googleRefreshToken = tokens.refresh_token;
    }
    user.driveScopeGranted = true;
    user.driveConnectedAt = new Date();
    user.driveAccountEmail = profile.email ?? undefined;
    user.driveAccountName = profile.name ?? undefined;
    user.driveAccountAvatar = profile.picture ?? undefined;
    await user.save();

    res.redirect(`${CLIENT_URL}/settings?drive=connected`);
  } catch (err) {
    console.error('Drive OAuth callback error:', err);
    res.redirect(`${CLIENT_URL}/settings?drive_error=auth_failed`);
  }
};
