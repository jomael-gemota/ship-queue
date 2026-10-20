import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import DocTidySpsSource from '../models/DocTidySpsSource';
import { buildAuthUrl, exchangeCodeForTokens, getSpsUserInfo } from '../services/sps.service';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET!;

/**
 * Returns the SPS Commerce OAuth consent URL for a specific workspace.
 * The frontend navigates to it directly (full redirect) so Vite's dev proxy
 * never touches the redirect. Protected via requireAuth.
 *
 * Mirrors getWorkspaceEmailSourceAuthUrl in docTidyAuth.controller.ts.
 */
export const getWorkspaceSpsAuthUrl = (req: Request, res: Response): void => {
  const { workspaceId } = req.params;

  const state = jwt.sign(
    { userId: req.user!.id, name: req.user!.name, target: 'workspace', workspaceId },
    JWT_SECRET,
    { expiresIn: '10m' }
  );

  res.json({ url: buildAuthUrl(state) });
};

/**
 * OAuth callback from SPS Commerce (Auth0).
 * Upserts a DocTidySpsSource for the target workspace and redirects back to
 * the Invoice Audit page with a success/error query param.
 *
 * Mirrors handleDocTidyCallback workspace branch.
 */
export const handleSpsCallback = async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as {
    code?:  string;
    state?: string;
    error?: string;
  };

  if (error || !code || !state) {
    res.redirect(`${CLIENT_URL}/doc-tidy?ws_sps_error=access_denied`);
    return;
  }

  let payload: {
    userId: string;
    name?: string;
    target?: string;
    workspaceId?: string;
  };

  try {
    payload = jwt.verify(state, JWT_SECRET) as typeof payload;
  } catch {
    res.redirect(`${CLIENT_URL}/doc-tidy?ws_sps_error=invalid_state`);
    return;
  }

  if (!payload.workspaceId) {
    res.redirect(`${CLIENT_URL}/doc-tidy/invoice-audit?ws_sps_error=missing_workspace`);
    return;
  }

  /** Redirect target — keeps the user inside the workspace view. */
  const wsBase = `${CLIENT_URL}/doc-tidy/invoice-audit/workspaces/${payload.workspaceId}`;

  try {
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.refreshToken) {
      // Without a refresh token the connection would silently die in an hour.
      res.redirect(`${wsBase}?ws_sps_error=no_refresh_token`);
      return;
    }

    // Fetch the connected account's identity (email / display name) so the UI
    // can show a meaningful label instead of "unknown account".  Non-fatal —
    // we still save the token if the userinfo call fails.
    const userInfo = await getSpsUserInfo(tokens.accessToken);

    // Upsert: reconnecting the same account for the same workspace updates the
    // existing record rather than accumulating stale duplicates.
    await DocTidySpsSource.findOneAndUpdate(
      { workspaceId: payload.workspaceId },
      {
        $set: {
          workspaceId:          payload.workspaceId,
          spsRefreshToken:      tokens.refreshToken,
          spsAccessToken:       tokens.accessToken,
          spsTokenExpiry:       new Date(Date.now() + (tokens.expiresInSeconds ?? 3600) * 1000),
          spsConnectedAt:       new Date(),
          spsConnectedByUserId: payload.userId,
          spsConnectedByName:   payload.name,
          ...(userInfo.sub   ? { spsAccountId:    userInfo.sub }   : {}),
          ...(userInfo.email ? { spsAccountEmail: userInfo.email } : {}),
        },
      },
      { upsert: true, new: true }
    );

    res.redirect(`${wsBase}?ws_sps=connected`);
  } catch (err) {
    console.error('SPS Commerce OAuth callback error:', err);
    res.redirect(`${wsBase}?ws_sps_error=auth_failed`);
  }
};
