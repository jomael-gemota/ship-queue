import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { UserRole } from '../models/User';

export interface JwtPayload {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  canCreateLabels: boolean;
}

declare global {
  namespace Express {
    interface User extends JwtPayload {}
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ message: 'Forbidden: admin access required' });
    return;
  }
  next();
};

export const requireLabelPermission = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user?.canCreateLabels) {
    res.status(403).json({ message: 'Forbidden: you do not have permission to create labels' });
    return;
  }
  next();
};
