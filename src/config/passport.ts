import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User';

const ALLOWED_EMAIL_DOMAINS = ['outdoorequipped.com', 'channelprecision.com'];

const isAllowedEmailDomain = (email: string): boolean => {
  const emailDomain = email.split('@')[1]?.toLowerCase();
  return !!emailDomain && ALLOWED_EMAIL_DOMAINS.includes(emailDomain);
};

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const avatar = profile.photos?.[0]?.value;

        if (!email) {
          return done(new Error('No email returned from Google'), undefined);
        }

        if (!isAllowedEmailDomain(email)) {
          return done(null, false, { message: 'unauthorized_domain' });
        }

        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email,
            name: profile.displayName,
            avatar,
          });
        }

        // Persist Drive OAuth credentials. Google only returns a refresh token
        // on the first consent (or when prompt=consent), so keep the existing
        // one if a new one isn't supplied.
        user.googleAccessToken = accessToken;
        if (refreshToken) {
          user.googleRefreshToken = refreshToken;
          user.driveScopeGranted = true;
        }
        if (avatar) user.avatar = avatar;
        await user.save();

        return done(null, user as Express.User);
      } catch (error) {
        return done(error as Error, undefined);
      }
    }
  )
);

export default passport;
