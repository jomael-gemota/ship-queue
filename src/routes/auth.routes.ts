import { Router } from 'express';
import passport from 'passport';
import { googleCallback, getMe, logout } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Redirect to Google consent screen.
// `accessType: offline` + `prompt: consent` ensure we receive a refresh token
// so the server can upload shipping-label PDFs to the user's Google Drive.
router.get(
  '/google',
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
