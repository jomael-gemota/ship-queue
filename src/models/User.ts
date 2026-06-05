import { Schema, model, Document } from 'mongoose';

export type UserRole = 'admin' | 'user';

/** Persisted Dropbox Fetcher setup so users return to their last folder/file-type. */
export interface DropboxFetcherPrefs {
  folderPath?: string;
  crumbs?: { path: string; name: string }[];
  fileType?: string;
  recursive?: boolean;
}

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
  // OAuth credentials for the Dropbox Fetcher — never returned by default
  dropboxRefreshToken?: string;
  dropboxAccessToken?: string;
  dropboxTokenExpiry?: Date;
  dropboxConnectedAt?: Date;
  dropboxAccountId?: string;
  dropboxAccountEmail?: string;
  dropboxAccountName?: string;
  dropboxFetcherPrefs?: DropboxFetcherPrefs;
  /** Updated on every successful Google sign-in. */
  lastLoginAt?: Date;
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
    // Dropbox OAuth credentials (secrets hidden by default; loaded with .select('+...'))
    dropboxRefreshToken: { type: String, select: false },
    dropboxAccessToken: { type: String, select: false },
    dropboxTokenExpiry: { type: Date, select: false },
    dropboxConnectedAt: { type: Date },
    dropboxAccountId: { type: String },
    dropboxAccountEmail: { type: String },
    dropboxAccountName: { type: String },
    // Persisted Dropbox Fetcher setup (last folder, breadcrumb, file type, recursion)
    dropboxFetcherPrefs: {
      type: {
        folderPath: { type: String },
        crumbs: { type: [{ path: String, name: String, _id: false }], default: undefined },
        fileType: { type: String },
        recursive: { type: Boolean },
      },
      default: undefined,
    },
    // Timestamp of the most recent successful Google sign-in.
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

export { ADMIN_EMAILS };

export default model<IUser>('User', UserSchema);
