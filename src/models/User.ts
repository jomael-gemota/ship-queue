import { Schema, model, Document } from 'mongoose';

export type UserRole = 'admin' | 'user';

export interface IUser extends Document {
  googleId: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  canCreateLabels: boolean;
  googleRefreshToken?: string;
  googleAccessToken?: string;
  googleTokenExpiry?: Date;
  driveScopeGranted?: boolean;
  driveFolderId?: string;
  driveFolderName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ADMIN_EMAILS = ['jomael@outdoorequipped.com'];

const UserSchema = new Schema<IUser>(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    avatar: { type: String },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    canCreateLabels: { type: Boolean, default: false },
    // OAuth credentials for Google Drive uploads — never returned by default
    googleRefreshToken: { type: String, select: false },
    googleAccessToken: { type: String, select: false },
    googleTokenExpiry: { type: Date, select: false },
    driveScopeGranted: { type: Boolean, default: false },
    driveFolderId: { type: String },
    driveFolderName: { type: String },
  },
  { timestamps: true }
);

export { ADMIN_EMAILS };

export default model<IUser>('User', UserSchema);
