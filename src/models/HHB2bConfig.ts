import { Schema, model, Document } from 'mongoose';
import {
  HH_B2B_DEFAULT_ACCOUNT_ID,
  HH_B2B_DEFAULT_BASE_URL,
  HH_B2B_DEFAULT_CATALOG,
} from '../lib/hhB2bDefaults';

export const HH_B2B_CONFIG_KEY = 'helly-hansen-sports';

export interface IHHB2bConfig extends Document {
  key: string;
  baseUrl: string;
  catalog: string;
  accountId: string;
  cookie?: string;
  cookieUpdatedAt?: Date | null;
  updatedByName: string;
  updatedByEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

const HHB2bConfigSchema = new Schema<IHHB2bConfig>(
  {
    key: { type: String, required: true, unique: true, default: HH_B2B_CONFIG_KEY },
    baseUrl: { type: String, required: true, default: HH_B2B_DEFAULT_BASE_URL },
    catalog: { type: String, required: true, default: HH_B2B_DEFAULT_CATALOG },
    accountId: { type: String, required: true, default: HH_B2B_DEFAULT_ACCOUNT_ID },
    cookie: { type: String, select: false, default: '' },
    cookieUpdatedAt: { type: Date, default: null },
    updatedByName: { type: String, default: '' },
    updatedByEmail: { type: String, default: '' },
  },
  { timestamps: true }
);

const HHB2bConfig = model<IHHB2bConfig>('HHB2bConfig', HHB2bConfigSchema);

export async function getOrCreateHhB2bConfig(withCookie = false): Promise<IHHB2bConfig> {
  const query = HHB2bConfig.findOne({ key: HH_B2B_CONFIG_KEY });
  if (withCookie) query.select('+cookie');
  const existing = await query;
  if (existing) return existing;

  try {
    const created = await HHB2bConfig.create({
      key: HH_B2B_CONFIG_KEY,
      baseUrl: HH_B2B_DEFAULT_BASE_URL,
      catalog: HH_B2B_DEFAULT_CATALOG,
      accountId: HH_B2B_DEFAULT_ACCOUNT_ID,
      cookie: '',
    });
    if (!withCookie) created.cookie = undefined;
    return created;
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: number }).code : undefined;
    if (code !== 11000) throw err;
    const raced = withCookie
      ? await HHB2bConfig.findOne({ key: HH_B2B_CONFIG_KEY }).select('+cookie')
      : await HHB2bConfig.findOne({ key: HH_B2B_CONFIG_KEY });
    if (!raced) throw err;
    return raced;
  }
}

export async function seedHhB2bConfig(): Promise<void> {
  await getOrCreateHhB2bConfig(false);
}

export default HHB2bConfig;
