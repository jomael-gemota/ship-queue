import { Schema, model } from 'mongoose';

/**
 * The part of one UTC day's bill for an alias's upstream model (e.g. Hermes →
 * gpt-5.6-sol) that our usage events don't account for, such as jobs run by a
 * worker that wasn't reporting usage. Written by the daily true-up and shown on
 * the dashboard as untracked usage, not charged to any workspace.
 */
export interface IDocTidyBilledRemainder {
  /** Start of the UTC day. */
  day: Date;
  /** The alias row's model, e.g. `hermes-agent`. */
  model: string;
  upstreamModel: string;
  billedUsd: number;
  trackedBilledUsd: number;
  untrackedUsd: number;
  trackedShare: number;
  trackedCalls: number;
  createdAt: Date;
  updatedAt: Date;
}

const DocTidyBilledRemainderSchema = new Schema<IDocTidyBilledRemainder>(
  {
    day: { type: Date, required: true },
    model: { type: String, required: true },
    upstreamModel: { type: String, required: true },
    billedUsd: { type: Number, default: 0 },
    trackedBilledUsd: { type: Number, default: 0 },
    untrackedUsd: { type: Number, default: 0 },
    trackedShare: { type: Number, default: 0 },
    trackedCalls: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'doctidy_billed_remainders' }
);

DocTidyBilledRemainderSchema.index({ day: 1, model: 1 }, { unique: true });

export default model<IDocTidyBilledRemainder>('DocTidyBilledRemainder', DocTidyBilledRemainderSchema);
