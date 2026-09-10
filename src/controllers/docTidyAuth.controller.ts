import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { getDocTidyConfigDoc } from '../models/DocTidyConfig';
import { DOC_TIDY_SCOPES } from '../services/gmail.service';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET!;

function buildOAuth2() {
  const callbackURL =
    process.env.DOC_TIDY_CALLBACK_URL || 'http://localhost:5000/api/auth/doc-tidy/callback';
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL
  );
}

/**
 * Returns the consent URL for connecting the shared Doc Tidy mailbox.
 * Mirrors the Drive connect flow: the frontend navigates to the URL directly
 * so Vite's dev proxy never touches the redirect.
 *
 * `select_account consent` is important here — the admin is expected to sign in
 * as the invoice mailbox, which is usually not the account they are logged in
 * with, and we always need a refresh token back.
 */
export const getDocTidyAuthUrl = (req: Request, res: Response): void => {
  const state = jwt.sign({ userId: req.user!.id, name: req.user!.name }, JWT_SECRET, {
    expiresIn: '10m',
  });

  const url = buildOAuth2().generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account consent',
    scope: DOC_TIDY_SCOPES,
    state,
  });

  res.json({ url });
};

/**
 * Exchanges the OAuth code for tokens and stores them on the DocTidyConfig
 * singleton, so every user shares one mailbox connection.
 */
export const handleDocTidyCallback = async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error || !code || !state) {
    res.redirect(`${CLIENT_URL}/settings?doc_tidy_error=access_denied`);
    return;
  }

  let connectedByName: string | undefined;
  try {
    const payload = jwt.verify(state, JWT_SECRET) as { userId: string; name?: string };
    connectedByName = payload.name;
  } catch {
    res.redirect(`${CLIENT_URL}/settings?doc_tidy_error=invalid_state`);
    return;
  }

  try {
    const oauth2 = buildOAuth2();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    if (!tokens.refresh_token) {
      // Without a refresh token the connection would silently die in an hour.
      res.redirect(`${CLIENT_URL}/settings?doc_tidy_error=no_refresh_token`);
      return;
    }

    const { data: profile } = await google.oauth2({ version: 'v2', auth: oauth2 }).userinfo.get();

    const config = await getDocTidyConfigDoc(true);
    config.gmailRefreshToken = tokens.refresh_token;
    config.gmailAccountEmail = profile.email ?? undefined;
    config.gmailConnectedAt = new Date();
    config.gmailConnectedByName = connectedByName;
    await config.save();

    res.redirect(`${CLIENT_URL}/settings?doc_tidy=connected`);
  } catch (err) {
    console.error('Doc Tidy OAuth callback error:', err);
    res.redirect(`${CLIENT_URL}/settings?doc_tidy_error=auth_failed`);
  }
};
