import { Schema, model, Document, Types } from 'mongoose';

export type MatchMode = 'any' | 'all';
export const MATCH_MODES: MatchMode[] = ['any', 'all'];

/**
 * The kind of document a rule collects. Closed on purpose: the value is filtered
 * on in the results table, so it has to stay comparable across rules.
 */
export type DocumentType = 'order_confirmation' | 'invoice' | 'other';
export const DOCUMENT_TYPES: DocumentType[] = ['order_confirmation', 'invoice', 'other'];

/**
 * A named extraction entry. Rules belong to exactly one workspace.
 * `createdBy*` is attribution only.
 */
export interface IDocTidyRule extends Document {
  /**
   * The workspace this rule belongs to. Optional for legacy rules created
   * before workspace-scoping was introduced; required for all new rules.
   */
  workspaceId?: Types.ObjectId;
  name: string;
  description?: string;
  enabled: boolean;

  /**
   * What the rule collects. Copied onto every message the rule captures, so the
   * results table can be grouped and filtered without resolving the rule.
   */
  documentType: DocumentType;

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
    workspaceId: { type: Schema.Types.ObjectId, ref: 'DocTidyWorkspace', index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    enabled: { type: Boolean, default: true },

    // Rules written before this field existed read as 'other'.
    documentType: { type: String, enum: DOCUMENT_TYPES, default: 'other' },

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

// The rules page lists enabled entries first, newest first within a workspace.
DocTidyRuleSchema.index({ enabled: -1, createdAt: -1 });
// Fast workspace-scoped rule lookup (messages query, parse-jobs query).
DocTidyRuleSchema.index({ workspaceId: 1, enabled: -1 });

export default model<IDocTidyRule>('DocTidyRule', DocTidyRuleSchema);
