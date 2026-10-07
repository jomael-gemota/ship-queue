import { Cron } from 'croner';
import { Schema, model, Document } from 'mongoose';

/** Registry key for the Seller Central OE US jar. Must match a fetcher in `src/cookie-jar/registry.ts`. */
export const SELLER_CENTRAL_OE_US_KEY = 'seller-central-outdoor-equipped-us';
export const SELLER_CENTRAL_OE_US_NAME = 'Seller Central Outdoor Equipped US';
/** Cron fields are interpreted in this zone. Philippines does not observe DST. */
export const COOKIE_JAR_TIMEZONE = 'Asia/Manila';
/** 12:00 AM, 6:00 AM, 12:00 PM, and 6:00 PM Philippines time. */
export const SELLER_CENTRAL_OE_US_CRON = '0 0,6,12,18 * * *';

/** Helly Hansen Sports B2B session. One jar; it calls Sphere provider id `b2b-hhsportswear`. */
export const HELLY_HANSEN_SPORTS_B2B_KEY = 'helly-hansen-sports-b2b';
export const HELLY_HANSEN_SPORTS_B2B_NAME = 'Helly Hansen Sports B2B';
export const HELLY_HANSEN_SPORTS_B2B_CRON = SELLER_CENTRAL_OE_US_CRON;
/** Sphere cookie provider id. Not a CookieJar key. */
export const SPHERE_B2B_HH_SPORTSWEAR_ID = 'b2b-hhsportswear';
/** Helly Hansen Work B2B session. One jar; it calls Sphere provider id `b2b-hhworkwear`. */
export const HELLY_HANSEN_WORK_B2B_KEY = 'helly-hansen-work-b2b';
export const HELLY_HANSEN_WORK_B2B_NAME = 'Helly Hansen Work B2B';
export const HELLY_HANSEN_WORK_B2B_CRON = SELLER_CENTRAL_OE_US_CRON;
/** Sphere cookie provider id. Not a CookieJar key. */
export const SPHERE_B2B_HH_WORKWEAR_ID = 'b2b-hhworkwear';
/** Thorogood B2B session. One jar; it calls Sphere provider id `b2b-thorogood`. */
export const THOROGOOD_B2B_KEY = 'thorogood-b2b';
export const THOROGOOD_B2B_NAME = 'Thorogood B2B';
export const THOROGOOD_B2B_CRON = SELLER_CENTRAL_OE_US_CRON;
/** Sphere cookie provider id. Not a CookieJar key. */
export const SPHERE_B2B_THOROGOOD_ID = 'b2b-thorogood';

/** Previous Seller Central key — renamed in place on seed so the stored cookie is kept. */
const LEGACY_SELLER_CENTRAL_OE_US_KEY = 'outdoor-equipped-us';
/** Rows that used a Sphere provider id as a jar key. Folded back into the real jars. */
const STRAY_SPHERE_SPORTSWEAR_JAR_KEY = SPHERE_B2B_HH_SPORTSWEAR_ID;
const STRAY_SPHERE_WORKWEAR_JAR_KEY = SPHERE_B2B_HH_WORKWEAR_ID;
const STRAY_SPHERE_THOROGOOD_JAR_KEY = SPHERE_B2B_THOROGOOD_ID;

export const DEFAULT_JAR_CRON = SELLER_CENTRAL_OE_US_CRON;
export const MAX_JAR_NAME_LEN = 80;

/** Five-field cron in Philippines time (minute hour day month weekday). */
export function validateJarCron(cron: string): string | null {
  const trimmed = cron.trim();
  if (!trimmed) return 'Cron is required';
  if (trimmed.split(/\s+/).length !== 5) {
    return 'Cron must have 5 fields (minute hour day month weekday), e.g. 0 */6 * * *';
  }
  try {
    const job = new Cron(trimmed, { paused: true, mode: '5-part' });
    job.stop();
  } catch {
    return `Invalid cron "${trimmed}"`;
  }
  return null;
}

export interface ICookieJar extends Document {
  /** Joins this row to a fetcher implementation in code. Stable; not a display label. */
  key: string;
  /** UI label. Safe to rename without changing which fetcher runs. */
  name: string;
  enabled: boolean;
  /** Standard 5-field cron, interpreted in Asia/Manila. */
  cron: string;
  /** Last successful cookie payload. Omitted from queries unless explicitly selected. */
  cookie?: string;
  lastRunAt?: Date;
  lastSuccessAt?: Date;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CookieJarSchema = new Schema<ICookieJar>(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    enabled: { type: Boolean, required: true, default: true },
    cron: { type: String, required: true, default: DEFAULT_JAR_CRON },
    cookie: { type: String, select: false },
    lastRunAt: { type: Date },
    lastSuccessAt: { type: Date },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

const CookieJar = model<ICookieJar>('CookieJar', CookieJarSchema);

async function seedJar(key: string, name: string, cron: string, enabled: boolean): Promise<void> {
  const existing = await CookieJar.findOne({ key }).select('key');
  if (existing) return;
  try {
    await CookieJar.create({ key, name, enabled, cron });
    console.log(`[cookie-jar] Seeded ${key}`);
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: number }).code : undefined;
    if (code !== 11000) throw err;
  }
}

/**
 * Inserts the built-in jars if they are missing. Renames the legacy
 * `outdoor-equipped-us` row in place (keeps cookie / last-run). A row whose key
 * is a Sphere provider id (`b2b-hhsportswear`, `b2b-hhworkwear`, or `b2b-thorogood`) is not a jar:
 * it is folded into the matching jar, or removed when that jar
 * already exists. After that, name / enabled / cron are not overwritten — the
 * DB (and UI) stay authoritative.
 */
export async function seedCookieJars(): Promise<void> {
  const current = await CookieJar.findOne({ key: SELLER_CENTRAL_OE_US_KEY }).select('key');
  if (!current) {
    const renamed = await CookieJar.findOneAndUpdate(
      { key: LEGACY_SELLER_CENTRAL_OE_US_KEY },
      {
        $set: {
          key: SELLER_CENTRAL_OE_US_KEY,
          name: SELLER_CENTRAL_OE_US_NAME,
          cron: SELLER_CENTRAL_OE_US_CRON,
        },
      },
      { new: true }
    );
    if (renamed) {
      console.log(`[cookie-jar] Renamed ${LEGACY_SELLER_CENTRAL_OE_US_KEY} → ${SELLER_CENTRAL_OE_US_KEY}`);
    }
  }

  await foldStraySphereJar(
    STRAY_SPHERE_SPORTSWEAR_JAR_KEY,
    HELLY_HANSEN_SPORTS_B2B_KEY,
    HELLY_HANSEN_SPORTS_B2B_NAME
  );
  await foldStraySphereJar(
    STRAY_SPHERE_WORKWEAR_JAR_KEY,
    HELLY_HANSEN_WORK_B2B_KEY,
    HELLY_HANSEN_WORK_B2B_NAME
  );
  await foldStraySphereJar(STRAY_SPHERE_THOROGOOD_JAR_KEY, THOROGOOD_B2B_KEY, THOROGOOD_B2B_NAME);

  await seedJar(SELLER_CENTRAL_OE_US_KEY, SELLER_CENTRAL_OE_US_NAME, SELLER_CENTRAL_OE_US_CRON, true);
  await seedJar(HELLY_HANSEN_SPORTS_B2B_KEY, HELLY_HANSEN_SPORTS_B2B_NAME, HELLY_HANSEN_SPORTS_B2B_CRON, false);
  await seedJar(HELLY_HANSEN_WORK_B2B_KEY, HELLY_HANSEN_WORK_B2B_NAME, HELLY_HANSEN_WORK_B2B_CRON, false);
  await seedJar(THOROGOOD_B2B_KEY, THOROGOOD_B2B_NAME, THOROGOOD_B2B_CRON, false);
}

/** Keeps a stored cookie if the only row used the Sphere provider id as its key. */
async function foldStraySphereJar(strayKey: string, canonicalKey: string, canonicalName: string): Promise<void> {
  const current = await CookieJar.findOne({ key: canonicalKey }).select('key');
  if (!current) {
    const renamed = await CookieJar.findOneAndUpdate(
      { key: strayKey },
      { $set: { key: canonicalKey, name: canonicalName } },
      { new: true }
    );
    if (renamed) {
      console.log(`[cookie-jar] Renamed ${strayKey} → ${canonicalKey}`);
    }
    return;
  }

  const removed = await CookieJar.deleteOne({ key: strayKey });
  if (removed.deletedCount) {
    console.log(`[cookie-jar] Removed stray jar ${strayKey}`);
  }
}

export default CookieJar;
