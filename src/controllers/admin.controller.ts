import { Request, Response } from 'express';
import User, { ADMIN_EMAILS } from '../models/User';

export const listUsers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await User.find({})
      .select('email name avatar role canCreateLabels createdAt lastLoginAt')
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

export const updateUserRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (role !== 'admin' && role !== 'user') {
      res.status(400).json({ message: "role must be either 'admin' or 'user'" });
      return;
    }

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (req.user?.id === id) {
      res.status(400).json({ message: 'Cannot change your own role' });
      return;
    }

    // The designated super-admin is re-promoted on every login, so demoting it
    // here would be misleading.
    if (role === 'user' && ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      res.status(400).json({ message: 'Cannot downgrade the primary admin account' });
      return;
    }

    user.role = role;
    // Admins always have label-creation access.
    if (role === 'admin') {
      user.canCreateLabels = true;
    }
    await user.save();

    res.json({
      data: {
        _id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: user.role,
        canCreateLabels: user.canCreateLabels,
        createdAt: user.createdAt,
      },
    });
  } catch {
    res.status(500).json({ message: 'Failed to update user role' });
  }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (user.role === 'admin') {
      res.status(400).json({ message: 'Cannot delete an admin user' });
      return;
    }

    if (req.user?.id === id) {
      res.status(400).json({ message: 'Cannot delete your own account' });
      return;
    }

    await user.deleteOne();
    res.json({ message: 'User deleted successfully' });
  } catch {
    res.status(500).json({ message: 'Failed to delete user' });
  }
};
