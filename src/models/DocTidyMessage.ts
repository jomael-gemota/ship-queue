import { Schema, model, Document, Types } from 'mongoose';

export interface IDocTidyAttachment {
  filename: string;
  mimeType: string;
  size: number;
  /** Gmail's per-message attachment handle, kept so a failed upload can retry. */
  gmailAttachmentId?: string;
  /** Populated once the file has been copied into the destination Drive. */
  driveFileId?: string;
  webViewLink?: string;
  /** Set when the Drive upload failed; the row still lists the attachment. */
  uploadError?: string;
}

/**
 * An extracted message. Shared team-wide and deduped on `gmailMessageId`, so
 * re-running a rule refreshes existing rows instead of duplicating them.
 */
export interface IDocTidyMessage extends Document {
  ruleId?: Types.ObjectId;
  /** Denormalised so results stay readable after a rule is deleted. */
  ruleName?: string;

  gmailMessageId: string;
  threadId?: string;

  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  snippet?: string;
  /** Full plain-text body — large, so excluded from list queries. */
  bodyText?: string;

  sentAt: Date;
  attachments: IDocTidyAttachment[];
  hasAttachments: boolean;
  extractedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

const AttachmentSchema = new Schema<IDocTidyAttachment>(
  {
    filename: { type: String, required: true },
    mimeType: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },
    gmailAttachmentId: { type: String },
    driveFileId: { type: String },
    webViewLink: { type: String },
    uploadError: { type: String },
  },
  { _id: false }
);

const DocTidyMessageSchema = new Schema<IDocTidyMessage>(
  {
    ruleId: { type: Schema.Types.ObjectId, ref: 'DocTidyRule', index: true },
    ruleName: { type: String },

    gmailMessageId: { type: String, required: true, unique: true },
    threadId: { type: String },

    from: { type: String, required: true },
    fromName: { type: String },
    to: { type: [String], default: [] },
    subject: { type: String, default: '(no subject)' },
    snippet: { type: String },
    bodyText: { type: String, select: false },

    sentAt: { type: Date, required: true },
    attachments: { type: [AttachmentSchema], default: [] },
    hasAttachments: { type: Boolean, default: false },
    extractedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Supports the default "newest first" list query and the rule filter.
DocTidyMessageSchema.index({ sentAt: -1 });
DocTidyMessageSchema.index({ ruleId: 1, sentAt: -1 });

export default model<IDocTidyMessage>('DocTidyMessage', DocTidyMessageSchema);
