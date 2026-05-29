import { Request, Response } from 'express';
import User from '../models/User';

export const listUsers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await User.find({})
      .select('email name avatar role canCreateLabels createdAt')
      .sort({ createdAt: 1 });

    res.json({ data: users });
  } catch {
    res.status(500).json({ message: 'Failed to fetch users' });
  }
};

export const updateUserPermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { canCreateLabels } = req.body;

    if (typeof canCreateLabels !== 'boolean') {
      res.status(400).json({ message: 'canCreateLabels must be a boolean' });
      return;
    }

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (user.role === 'admin') {
      res.status(400).json({ message: 'Cannot modify permissions of an admin user' });
      return;
    }

    user.canCreateLabels = canCreateLabels;
    await user.save();

    res.json({
      data: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        canCreateLabels: user.canCreateLabels,
      },
    });
  } catch {
    res.status(500).json({ message: 'Failed to update user permissions' });
  }
};
