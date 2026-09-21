import { Schema, model, Document } from 'mongoose';
import { hhBrand, HH_BRAND_IDS, type HHBrandId } from '../lib/hhBrand';

export const HH_B2B_CONFIG_KEY = hhBrand('sportswear').configKey;

export interface IHHB2bConfig extends Document {
  key: string;
  baseUrl: string;
  catalog: string;
  accountId: string;
  cookie?: string;
  cookieUpdatedAt?: Date | null;
  /** When false, Place Order is visible but does not submit to Helly Hansen. */
  placeOrderEnabled: boolean;
  updatedByName: string;
  updatedByEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

const HHB2bConfigSchema = new Schema<IHHB2bConfig>(
  {
    key: { type: String, required: true, unique: true, default: HH_B2B_CONFIG_KEY },
    baseUrl: { type: String, required: true },
    catalog: { type: String, required: true },
    accountId: { type: String, required: true },
    cookie: { type: String, select: false, default: '' },
    cookieUpdatedAt: { type: Date, default: null },
    placeOrderEnabled: { type: Boolean, default: false },
    updatedByName: { type: String, default: '' },
    updatedByEmail: { type: String, default: '' },
  },
  { timestamps: true }
);

const HHB2bConfig = model<IHHB2bConfig>('HHB2bConfig', HHB2bConfigSchema);

export async function getOrCreateHhB2bConfig(brand: HHBrandId, withCookie = false): Promise<IHHB2bConfig> {
  const def = hhBrand(brand);
  const query = HHB2bConfig.findOne({ key: def.configKey });
  if (withCookie) query.select('+cookie');
  const existing = await query;
  if (existing) return existing;

  try {
    const created = await HHB2bConfig.create({
      key: def.configKey,
      baseUrl: def.baseUrl,
      catalog: def.catalog,
      accountId: def.accountId,
      cookie: '',
    });
    if (!withCookie) created.cookie = undefined;
    return created;
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: number }).code : undefined;
    if (code !== 11000) throw err;
    const raced = withCookie
      ? await HHB2bConfig.findOne({ key: def.configKey }).select('+cookie')
      : await HHB2bConfig.findOne({ key: def.configKey });
    if (!raced) throw err;
    return raced;
  }
}

export async function seedHhB2bConfig(): Promise<void> {
  for (const brand of HH_BRAND_IDS) {
    await getOrCreateHhB2bConfig(brand, false);
  }
}

export default HHB2bConfig;
