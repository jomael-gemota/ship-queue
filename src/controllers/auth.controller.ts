import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';

const JWT_SECRET = process.env.JWT_SECRET!;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export const googleCallback = (req: Request, res: Response): void => {
  const user = req.user as IUser;

  const token = jwt.sign(
    {
      id: user._id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      canCreateLabels: user.canCreateLabels,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
  );

  res.redirect(`${CLIENT_URL}/auth/callback?token=${token}`);
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const dbUser = await User.findById(req.user!.id).select('-googleRefreshToken -googleAccessToken -googleTokenExpiry');
    if (!dbUser) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    res.json({
      data: {
        id: dbUser._id,
        email: dbUser.email,
        name: dbUser.name,
        avatar: dbUser.avatar,
        role: dbUser.role,
        canCreateLabels: dbUser.canCreateLabels,
        driveScopeGranted: dbUser.driveScopeGranted ?? false,
        driveFolderId: dbUser.driveFolderId,
      },
    });
  } catch {
    res.status(500).json({ message: 'Failed to fetch user' });
  }
};

export const logout = (_req: Request, res: Response): void => {
  res.json({ message: 'Logged out successfully' });
};
