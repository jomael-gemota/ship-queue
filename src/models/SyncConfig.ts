import { Schema, model, Document } from 'mongoose';

export interface ISyncConfig extends Document {
  /** Singleton discriminator — there is only ever one config document. */
  key: string;
  enabled: boolean;
  intervalMs: number;
  updatedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SINGLETON_KEY = 'global';

/** Hard bounds enforced on the admin-supplied interval. */
export const MIN_INTERVAL_MS = 60_000; // 1 minute
export const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Seed defaults from env on first creation; afterwards the DB is authoritative. */
function defaultEnabled(): boolean {
  return process.env.AUTO_SYNC_ENABLED !== 'false';
}

function defaultIntervalMs(): number {
  const raw = Number(process.env.AUTO_SYNC_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= MIN_INTERVAL_MS && raw <= MAX_INTERVAL_MS) {
    return raw;
  }
  return 5 * 60 * 1000; // 5 minutes
}

const SyncConfigSchema = new Schema<ISyncConfig>(
  {
    key: { type: String, required: true, unique: true, default: SINGLETON_KEY },
    enabled: { type: Boolean, required: true, default: defaultEnabled },
    intervalMs: { type: Number, required: true, default: defaultIntervalMs },
    updatedByName: { type: String },
  },
  { timestamps: true }
);

const SyncConfig = model<ISyncConfig>('SyncConfig', SyncConfigSchema);

/**
 * Returns the singleton sync-config document, creating it (with env-seeded
 * defaults) the first time it is requested.
 */
export async function getSyncConfigDoc(): Promise<ISyncConfig> {
  const existing = await SyncConfig.findOne({ key: SINGLETON_KEY });
  if (existing) return existing;
  return SyncConfig.create({ key: SINGLETON_KEY });
}

export default SyncConfig;
