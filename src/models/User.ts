import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  googleId: string;
  email: string;
  name: string;
  avatar?: string;
  googleRefreshToken?: string;
  googleAccessToken?: string;
  googleTokenExpiry?: Date;
  driveScopeGranted?: boolean;
  driveFolderId?: string;
  driveFolderName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    avatar: { type: String },
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

export default model<IUser>('User', UserSchema);
