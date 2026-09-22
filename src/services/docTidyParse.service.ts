import mongoose, { Types } from 'mongoose';
import { GridFSBucket } from 'mongodb';
import { Readable } from 'stream';
import DocTidyMessage, { type IDocTidyAttachment } from '../models/DocTidyMessage';
import DocTidyParseJob, { type IDocTidyParseJob } from '../models/DocTidyParseJob';
import { getDocTidyConfigDoc } from '../models/DocTidyConfig';
import { downloadDriveFile } from './googleDrive.service';
import { announceParseStatus, hasWorker, sendToWorker } from './docTidyWorkerRegistry';

/**
 * GridFS bucket holding PDFs mirrored out of Drive. Named explicitly because the
 * worker opens the same bucket by name (see `worker/collections.py`).
 */
export const PDF_BUCKET = 'doctidy_pdfs';

export class ParseRequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function getBucket(): GridFSBucket {
  const db = mongoose.connection.db;
  if (!db) throw new ParseRequestError('Database connection is not ready', 503);
  return new GridFSBucket(db, { bucketName: PDF_BUCKET });
}

export async function storePdf(filename: string, buffer: Buffer): Promise<Types.ObjectId> {
  const bucket = getBucket();

  return new Promise<Types.ObjectId>((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename);
    Readable.from(buffer).pipe(uploadStream);
    uploadStream.on('finish', () => resolve(uploadStream.id as unknown as Types.ObjectId));
    uploadStream.on('error', reject);
  });
}

/** Best-effort: a leftover file wastes space but must not fail a re-parse. */
async function deletePdf(fileId: Types.ObjectId): Promise<void> {
  try {
    await getBucket().delete(fileId as unknown as never);
  } catch {
    // Already gone, or the bucket was cleared out from under us.
  }
}

/**
 * The attachment a parse job reads, resolved from its position on the message.
 * Position is the key because Gmail attachment ids are not stable across the
 * re-imports a rule re-run performs.
 */
async function resolveAttachment(
  messageId: string,
  attachmentIndex: number
): Promise<{ messageId: Types.ObjectId; attachment: IDocTidyAttachment }> {
  if (!Types.ObjectId.isValid(messageId)) {
    throw new ParseRequestError('Invalid message id', 400);
  }

  const message = await DocTidyMessage.findById(messageId);
  if (!message) throw new ParseRequestError('Message not found', 404);

  const attachment = message.attachments?.[attachmentIndex];
  if (!attachment) throw new ParseRequestError('Attachment not found on this message', 404);
  if (!attachment.driveFileId) {
    throw new ParseRequestError(
      'This attachment was never stored in Drive, so there is nothing to parse',
      422
    );
  }

  return { messageId: message._id as Types.ObjectId, attachment };
}

/**
 * Hands a job to the worker, or explains why it cannot be handed over.
 *
 * The worker is checked before any expensive work: a queued job with nobody to
 * run it would sit at `pending` with no feedback, and the user would have no way
 * to tell that from a slow parse.
 */
function dispatch(job: IDocTidyParseJob): void {
  const sent = sendToWorker({ type: 'job', jobId: String(job._id) });
  if (!sent) {
    throw new ParseRequestError(
      'The parsing worker is not connected. Please try again shortly.',
      503
    );
  }
}

/**
 * Creates or resets the job for one attachment, mirrors its bytes out of Drive
 * into GridFS, and dispatches it.
 *
 * Idempotent by design: the unique `{ messageId, attachmentIndex }` index means a
 * second click re-runs the existing job rather than accumulating duplicates of
 * the same document, which would each carry their own divergent corrections.
 */
export async function requestParse(
  messageIdParam: string,
  attachmentIndex: number,
  requestedBy?: { id?: string; name?: string }
): Promise<IDocTidyParseJob> {
  if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0) {
    throw new ParseRequestError('Invalid attachment index', 400);
  }
  if (!hasWorker()) {
    throw new ParseRequestError(
      'The parsing worker is not connected. Please try again shortly.',
      503
    );
  }

  const { messageId, attachment } = await resolveAttachment(messageIdParam, attachmentIndex);

  const existing = await DocTidyParseJob.findOne({ messageId, attachmentIndex });
  if (existing && existing.status === 'processing') {
    throw new ParseRequestError('This document is already being parsed', 409);
  }

  const config = await getDocTidyConfigDoc(true);
  if (!config.gmailRefreshToken) {
    throw new ParseRequestError('The Doc Tidy mailbox is not connected', 400);
  }

  const buffer = await downloadDriveFile(
    { refreshToken: config.gmailRefreshToken },
    attachment.driveFileId as string
  );
  const pdfFileId = await storePdf(attachment.filename, buffer);

  // Replace rather than accumulate: the previous mirror is only useful to the
  // run that is being discarded.
  if (existing?.pdfFileId) await deletePdf(existing.pdfFileId);

  const job = await DocTidyParseJob.findOneAndUpdate(
    { messageId, attachmentIndex },
    {
      $set: {
        filename: attachment.filename,
        driveFileId: attachment.driveFileId,
        pdfFileId,
        source: 'email',
        status: 'pending',
        thinking: '',
        jsonOutput: null,
        tableOutput: null,
        error: null,
        completedAt: null,
        requestedByUserId: requestedBy?.id,
        requestedByName: requestedBy?.name,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  dispatch(job);
  announceParseStatus(String(job._id), 'pending');
  return job;
}

/**
 * Creates a parse job for a PDF that already lives in GridFS (a direct upload),
 * bypassing the Drive download step entirely.
 *
 * A synthetic `DocTidyMessage` is created (or reused) so the existing parse-job
 * schema — which requires a `messageId` — remains unchanged and the worker
 * protocol is unaffected.
 */
export async function requestParseFromGridFS(
  pdfFileId: Types.ObjectId,
  filename: string,
  importId: string,
  requestedBy?: { id?: string; name?: string },
  driveFileId?: string,
  workspaceId?: Types.ObjectId
): Promise<IDocTidyParseJob> {
  if (!hasWorker()) {
    throw new ParseRequestError(
      'The parsing worker is not connected. Please try again shortly.',
      503
    );
  }

  // Upsert a lightweight synthetic message so the parse job has a valid messageId.
  const syntheticGmailId = `pdf-import-${importId}`;
  const message = await DocTidyMessage.findOneAndUpdate(
    { gmailMessageId: syntheticGmailId },
    {
      $setOnInsert: {
        gmailMessageId: syntheticGmailId,
        from: 'direct-upload',
        to: [],
        subject: filename,
        sentAt: new Date(),
        attachments: [{ filename, mimeType: 'application/pdf', size: 0 }],
        hasAttachments: true,
        extractedAt: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const messageId = message._id as Types.ObjectId;
  const attachmentIndex = 0;

  const existing = await DocTidyParseJob.findOne({ messageId, attachmentIndex });
  if (existing && existing.status === 'processing') {
    throw new ParseRequestError('This document is already being parsed', 409);
  }

  const job = await DocTidyParseJob.findOneAndUpdate(
    { messageId, attachmentIndex },
    {
      $set: {
        filename,
        pdfFileId,
        ...(driveFileId ? { driveFileId } : {}),
        source: 'pdf-import',
        ...(workspaceId ? { workspaceId } : {}),
        status: 'pending',
        thinking: '',
        jsonOutput: null,
        tableOutput: null,
        error: null,
        completedAt: null,
        requestedByUserId: requestedBy?.id,
        requestedByName: requestedBy?.name,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  dispatch(job);
  announceParseStatus(String(job._id), 'pending');
  return job;
}

/**
 * Re-runs an existing job against the PDF already mirrored for it. Deliberately
 * does not touch Drive: a re-run is usually prompted by a correction, and the
 * point is to feed the same bytes through a now better-informed agent.
 */
export async function rerunParse(jobId: string): Promise<IDocTidyParseJob> {
  if (!Types.ObjectId.isValid(jobId)) throw new ParseRequestError('Invalid job id', 400);

  const job = await DocTidyParseJob.findById(jobId);
  if (!job) throw new ParseRequestError('Parse job not found', 404);
  if (job.status === 'processing') {
    throw new ParseRequestError('This document is already being parsed', 409);
  }
  if (!job.pdfFileId) {
    throw new ParseRequestError('No stored PDF for this job — parse it again instead', 422);
  }
  if (!hasWorker()) {
    throw new ParseRequestError(
      'The parsing worker is not connected. Please try again shortly.',
      503
    );
  }

  // The user-confirmed vendor survives a re-run, which is what makes registering
  // a vendor "stick" when the agent cannot name it from the document itself.
  job.status = 'pending';
  job.thinking = '';
  job.jsonOutput = null;
  job.tableOutput = null;
  job.error = null;
  job.completedAt = null;
  await job.save();

  dispatch(job);
  announceParseStatus(String(job._id), 'pending');
  return job;
}
