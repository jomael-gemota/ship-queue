import { Router } from 'express';
import passport from 'passport';
import { googleCallback, getMe, logout } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Redirect to Google consent screen
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

// Google OAuth callback
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.CLIENT_URL}/login?error=auth_failed` }),
  googleCallback
);

// Protected — returns the currently authenticated user
router.get('/me', requireAuth, getMe);

router.post('/logout', requireAuth, logout);

export default router;
