import { Schema, model } from 'mongoose';

export type ServiceTier = 'standard' | 'flex' | 'batch' | 'fast';
export const SERVICE_TIERS: ServiceTier[] = ['standard', 'flex', 'batch', 'fast'];

/**
 * USD per 1M tokens for one model at one service tier, mirroring the columns
 * on OpenAI's pricing page. Optional rates fall back to `inputPer1M`: a model
 * with no cached-input discount bills cached tokens at the input rate, and one
 * with no cache-write surcharge bills cache writes at the input rate.
 *
 * `longContextThreshold` + `long*` cover models priced differently above a
 * context size (e.g. gpt-5.5 above 272K input tokens).
 *
 * A plain interface rather than `extends Document`, because the `model` path
 * collides with `Document#model()` in the type system.
 */
export interface IDocTidyModelPrice {
  model: string;
  serviceTier: ServiceTier;
  inputPer1M: number;
  cachedInputPer1M?: number | null;
  cacheWritePer1M?: number | null;
  outputPer1M: number;
  longContextThreshold?: number | null;
  longInputPer1M?: number | null;
  longCachedInputPer1M?: number | null;
  longCacheWritePer1M?: number | null;
  longOutputPer1M?: number | null;
  /**
   * Set on an alias row such as `hermes-agent`: the OpenAI model the alias
   * really calls. Calls priced by such a row are estimates (list cost ×
   * `calibrationFactor`) until the daily true-up replaces them with the billed
   * amount. See design-log/2026-10-10-hermes-cost-calibration-and-daily-true-up.md.
   */
  upstreamModel?: string | null;
  /** Billed ÷ list cost of `upstreamModel` over recent days; null = not calibrated. */
  calibrationFactor?: number | null;
  calibratedAt?: Date | null;
  notes?: string;
  updatedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const optionalRate = { type: Number, default: null, min: 0 };

const DocTidyModelPriceSchema = new Schema<IDocTidyModelPrice>(
  {
    model: { type: String, required: true, trim: true },
    serviceTier: { type: String, enum: SERVICE_TIERS, default: 'standard' },
    inputPer1M: { type: Number, required: true, min: 0 },
    cachedInputPer1M: optionalRate,
    cacheWritePer1M: optionalRate,
    outputPer1M: { type: Number, default: 0, min: 0 },
    longContextThreshold: { type: Number, default: null, min: 0 },
    longInputPer1M: optionalRate,
    longCachedInputPer1M: optionalRate,
    longCacheWritePer1M: optionalRate,
    longOutputPer1M: optionalRate,
    upstreamModel: { type: String, default: null, trim: true },
    calibrationFactor: { type: Number, default: null, min: 0 },
    calibratedAt: { type: Date, default: null },
    notes: { type: String },
    updatedByName: { type: String },
  },
  { timestamps: true, collection: 'doctidy_model_prices' }
);

DocTidyModelPriceSchema.index({ model: 1, serviceTier: 1 }, { unique: true });

const DocTidyModelPrice = model<IDocTidyModelPrice>('DocTidyModelPrice', DocTidyModelPriceSchema);

/**
 * Standard / Flex / Fast prices for the models Doc Tidy calls, taken from
 * https://platform.openai.com/docs/pricing on 2026-10-10. Only inserted into an
 * empty collection: once admins edit prices, theirs are authoritative.
 */
const SEED_PRICES: Array<Partial<IDocTidyModelPrice>> = [
  { model: 'gpt-4o-mini', serviceTier: 'standard', inputPer1M: 0.15, cachedInputPer1M: 0.075, outputPer1M: 0.6 },
  { model: 'gpt-4o-mini', serviceTier: 'fast', inputPer1M: 0.25, cachedInputPer1M: 0.125, outputPer1M: 1.0 },
  { model: 'text-embedding-3-small', serviceTier: 'standard', inputPer1M: 0.02, outputPer1M: 0 },
  {
    model: 'gpt-5.5', serviceTier: 'standard',
    inputPer1M: 5, cachedInputPer1M: 0.5, outputPer1M: 30,
    longContextThreshold: 272_000, longInputPer1M: 10, longCachedInputPer1M: 1, longOutputPer1M: 45,
  },
  {
    model: 'gpt-5.5', serviceTier: 'flex',
    inputPer1M: 2.5, cachedInputPer1M: 0.25, outputPer1M: 15,
    longContextThreshold: 272_000, longInputPer1M: 5, longCachedInputPer1M: 0.5, longOutputPer1M: 22.5,
  },
  { model: 'gpt-5.5', serviceTier: 'fast', inputPer1M: 12.5, cachedInputPer1M: 1.25, outputPer1M: 75 },
];

const GPT_56_SOL_RATES = {
  inputPer1M: 4, cachedInputPer1M: 0.4, cacheWritePer1M: 5, outputPer1M: 20,
  longContextThreshold: 272_000, longInputPer1M: 8, longCachedInputPer1M: 0.8,
  longCacheWritePer1M: 10, longOutputPer1M: 30,
};

/**
 * Rows added after the first seed, inserted only when missing so they reach
 * databases that were seeded before they existed. Hermes reports its model as
 * `hermes-agent` and calls gpt-5.6-sol upstream (verified 2026-10-10).
 */
const ENSURED_PRICES: Array<Partial<IDocTidyModelPrice>> = [
  { model: 'gpt-5.6-sol', serviceTier: 'standard', ...GPT_56_SOL_RATES },
  {
    model: 'hermes-agent', serviceTier: 'standard', ...GPT_56_SOL_RATES,
    upstreamModel: 'gpt-5.6-sol',
  },
];

const SEED_NOTE = 'Seeded from openai.com/api/pricing (2026-10-10)';

export async function seedModelPrices(): Promise<void> {
  if ((await DocTidyModelPrice.estimatedDocumentCount()) === 0) {
    await DocTidyModelPrice.insertMany(SEED_PRICES.map((p) => ({ ...p, notes: SEED_NOTE })));
    console.log(`[doc-tidy usage] seeded ${SEED_PRICES.length} model price rows`);
  }
  for (const price of ENSURED_PRICES) {
    const result = await DocTidyModelPrice.updateOne(
      { model: price.model, serviceTier: price.serviceTier },
      { $setOnInsert: { ...price, notes: SEED_NOTE } },
      { upsert: true }
    );
    if (result.upsertedCount) console.log(`[doc-tidy usage] added price row for ${price.model}`);
  }
}

export default DocTidyModelPrice;
