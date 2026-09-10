import { Schema, model, Document } from 'mongoose';

export type MatchMode = 'any' | 'all';
export const MATCH_MODES: MatchMode[] = ['any', 'all'];

/**
 * A named extraction entry. Rules are shared team-wide: any authenticated user
 * can create, edit, run or delete one. `createdBy*` is attribution only.
 */
export interface IDocTidyRule extends Document {
  name: string;
  description?: string;
  enabled: boolean;

  /** Sender addresses (or partial addresses/domains) to match. */
  fromAddresses: string[];
  /**
   * Recipient addresses the message must have arrived under. Essential when
   * the connected mailbox receives a Google Group's mail as a member: the
   * group address appears here, not in `fromAddresses`.
   */
  toAddresses: string[];
  subjectKeywords: string[];
  bodyKeywords: string[];
  /** Messages containing any of these terms are discarded. */
  excludeKeywords: string[];

  /**
   * `any` — a message matches if it hits at least one term in any group.
   * `all` — every non-empty group must be satisfied.
   */
  matchMode: MatchMode;

  /** Absolute range. Ignored when `lookbackDays` is set. */
  dateFrom?: Date;
  dateTo?: Date;
  /** Rolling window, e.g. 30 = "the last 30 days" at run time. */
  lookbackDays?: number;

  requireAttachment: boolean;
  /** Lowercase, dot-less extensions, e.g. ['pdf', 'xlsx']. Empty = allow all. */
  attachmentExtensions: string[];

  createdByUserId?: string;
  createdByName?: string;

  lastRunAt?: Date;
  lastRunMatchCount?: number;
  lastRunError?: string;

  createdAt: Date;
  updatedAt: Date;
}

const DocTidyRuleSchema = new Schema<IDocTidyRule>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    enabled: { type: Boolean, default: true },

    fromAddresses: { type: [String], default: [] },
    toAddresses: { type: [String], default: [] },
    subjectKeywords: { type: [String], default: [] },
    bodyKeywords: { type: [String], default: [] },
    excludeKeywords: { type: [String], default: [] },

    matchMode: { type: String, enum: MATCH_MODES, default: 'any' },

    dateFrom: { type: Date },
    dateTo: { type: Date },
    lookbackDays: { type: Number, min: 1, max: 3650 },

    requireAttachment: { type: Boolean, default: true },
    attachmentExtensions: { type: [String], default: [] },

    createdByUserId: { type: String },
    createdByName: { type: String },

    lastRunAt: { type: Date },
    lastRunMatchCount: { type: Number },
    lastRunError: { type: String },
  },
  { timestamps: true }
);

// The rules page lists enabled entries first, newest first.
DocTidyRuleSchema.index({ enabled: -1, createdAt: -1 });

export default model<IDocTidyRule>('DocTidyRule', DocTidyRuleSchema);
