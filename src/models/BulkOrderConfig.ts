import { Schema, model, Document } from 'mongoose';

export const BULK_ORDER_CONFIG_KEY = 'bulk:thorogood';

export const BULK_ORDER_DEFAULT_BASE_URL = 'https://thorogood.thorogoodb2b.com';
export const BULK_ORDER_DEFAULT_ACCOUNT_ID = '23550';
export const BULK_ORDER_DEFAULT_CATALOG = 'Thorogood Boots';
export const BULK_ORDER_DEFAULT_SHIP_TO_CODE = 'NCWH';
export const BULK_ORDER_DEFAULT_DROP_SHIP_NAME = 'OUTDOOR EQUIPPED';
export const BULK_ORDER_DEFAULT_DROP_SHIP_ADDRESS = '312 Raleigh Street Suite 4';
export const BULK_ORDER_DEFAULT_DROP_SHIP_POSTAL = '28412';

export interface IBulkOrderConfig extends Document {
  key: string;
  baseUrl: string;
  catalog: string;
  accountId: string;
  defaultShipToCode: string;
  dropShipName: string;
  dropShipAddress: string;
  dropShipPostalCode: string;
  cookie?: string;
  cookieUpdatedAt?: Date | null;
  skuPrefixes?: string[];
  skuPrefixesSet: boolean;
  skuSuffixes?: string[];
  skuSuffixesSet: boolean;
  placeOrderEnabled: boolean;
  alertWebhookUrl: string;
  sessionCheckTimes?: string[];
  sessionCheckTimesSet: boolean;
  sessionCheckStatus: string;
  sessionCheckedAt?: Date | null;
  sessionCheckLatencyMs?: number | null;
  sessionCheckMessage: string;
  lastAlertAt?: Date | null;
  lastAlertEvent: string;
  lastAlertError?: string | null;
  updatedByName: string;
  updatedByEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

const BulkOrderConfigSchema = new Schema<IBulkOrderConfig>(
  {
    key: { type: String, required: true, unique: true, default: BULK_ORDER_CONFIG_KEY },
    baseUrl: { type: String, required: true, default: BULK_ORDER_DEFAULT_BASE_URL },
    catalog: { type: String, default: '' },
    accountId: { type: String, required: true, default: BULK_ORDER_DEFAULT_ACCOUNT_ID },
    defaultShipToCode: { type: String, default: '' },
    dropShipName: { type: String, default: '' },
    dropShipAddress: { type: String, default: '' },
    dropShipPostalCode: { type: String, default: '' },
    cookie: { type: String, select: false, default: '' },
    cookieUpdatedAt: { type: Date, default: null },
    skuPrefixes: { type: [String], default: undefined },
    skuPrefixesSet: { type: Boolean, default: false },
    skuSuffixes: { type: [String], default: undefined },
    skuSuffixesSet: { type: Boolean, default: false },
    placeOrderEnabled: { type: Boolean, default: false },
    alertWebhookUrl: { type: String, default: '' },
    sessionCheckTimes: { type: [String] },
    sessionCheckTimesSet: { type: Boolean, default: false },
    sessionCheckStatus: { type: String, default: '' },
    sessionCheckedAt: { type: Date, default: null },
    sessionCheckLatencyMs: { type: Number, default: null },
    sessionCheckMessage: { type: String, default: '' },
    lastAlertAt: { type: Date, default: null },
    lastAlertEvent: { type: String, default: '' },
    lastAlertError: { type: String, default: null },
    updatedByName: { type: String, default: '' },
    updatedByEmail: { type: String, default: '' },
  },
  { timestamps: true },
);

const BulkOrderConfig = model<IBulkOrderConfig>('BulkOrderConfig', BulkOrderConfigSchema);

export async function getOrCreateBulkOrderConfig(withCookie = false): Promise<IBulkOrderConfig> {
  const query = BulkOrderConfig.findOne({ key: BULK_ORDER_CONFIG_KEY });
  if (withCookie) query.select('+cookie');
  const existing = await query;
  if (existing) return existing;

  try {
    const created = await BulkOrderConfig.create({
      key: BULK_ORDER_CONFIG_KEY,
      baseUrl: BULK_ORDER_DEFAULT_BASE_URL,
      catalog: '',
      accountId: BULK_ORDER_DEFAULT_ACCOUNT_ID,
      cookie: '',
    });
    if (!withCookie) created.cookie = undefined;
    return created;
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: number }).code : undefined;
    if (code !== 11000) throw err;
    const raced = withCookie
      ? await BulkOrderConfig.findOne({ key: BULK_ORDER_CONFIG_KEY }).select('+cookie')
      : await BulkOrderConfig.findOne({ key: BULK_ORDER_CONFIG_KEY });
    if (!raced) throw err;
    return raced;
  }
}

export async function seedBulkOrderConfig(): Promise<void> {
  await getOrCreateBulkOrderConfig(false);
}

export default BulkOrderConfig;
