import { Router } from 'express';
import passport from 'passport';
import { googleCallback, getMe, logout } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Standard login — no forced consent so returning users are not re-prompted.
// Google will request Drive access on first login and skip the consent screen
// on every subsequent login. A refresh token is only returned on first consent;
// the Passport callback keeps the existing stored token when one isn't supplied.
router.get(
  '/google',
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/drive',
    ],
    accessType: 'offline',
    session: false,
  })
);

// Forced re-consent — used from the Settings page to (re)connect Google Drive.
// `prompt: consent` ensures Google returns a fresh refresh token even for
// users who have already granted access before.
router.get(
  '/google/reconnect',
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/drive',
    ],
    accessType: 'offline',
    prompt: 'consent',
    session: false,
  })
);

// Google OAuth callback
router.get(
  '/google/callback',
  (req, res, next) => {
    passport.authenticate('google', { session: false }, (error: unknown, user: Express.User | false, info?: { message?: string }) => {
      if (error) {
        return res.redirect(`${CLIENT_URL}/login?error=auth_failed`);
      }

      if (!user) {
        const errorCode = info?.message === 'unauthorized_domain' ? 'unauthorized_domain' : 'auth_failed';
        return res.redirect(`${CLIENT_URL}/login?error=${errorCode}`);
      }

      req.user = user;
      return next();
    })(req, res, next);
  },
  googleCallback
);

// Protected — returns the currently authenticated user
router.get('/me', requireAuth, getMe);

router.post('/logout', requireAuth, logout);

export default router;
