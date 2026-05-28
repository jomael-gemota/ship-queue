import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { IUser } from '../models/User';

const JWT_SECRET = process.env.JWT_SECRET!;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export const googleCallback = (req: Request, res: Response): void => {
  const user = req.user as IUser;

  const token = jwt.sign(
    { id: user._id, email: user.email, name: user.name, avatar: user.avatar },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
  );

  res.redirect(`${CLIENT_URL}/auth/callback?token=${token}`);
};

export const getMe = (req: Request, res: Response): void => {
  res.json({ data: req.user });
};

export const logout = (_req: Request, res: Response): void => {
  res.json({ message: 'Logged out successfully' });
};
