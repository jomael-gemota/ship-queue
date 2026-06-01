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
  driveConnectedAt?: Date;
  driveAccountEmail?: string;
  driveAccountName?: string;
  driveAccountAvatar?: string;
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
    driveConnectedAt: { type: Date },
    driveAccountEmail: { type: String },
    driveAccountName: { type: String },
    driveAccountAvatar: { type: String },
    driveFolderId: { type: String },
    driveFolderName: { type: String },
  },
  { timestamps: true }
);

export { ADMIN_EMAILS };

export default model<IUser>('User', UserSchema);
