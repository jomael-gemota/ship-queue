import { Types } from 'mongoose';
import DocTidyWorkspace from '../models/DocTidyWorkspace';
import DocTidyRule from '../models/DocTidyRule';
import DocTidyMessage from '../models/DocTidyMessage';
import DocTidyParseJob from '../models/DocTidyParseJob';
import DocTidyPdfImport, { type IDocTidyPdfImport } from '../models/DocTidyPdfImport';
import { ParseRequestError, requestParse, requestParseFromGridFS } from './docTidyParse.service';
import { hasWorker } from './docTidyWorkerRegistry';
import { isParseableFilename } from '../lib/parseableFiles';

/**
 * Sends newly arrived documents to the Tidy Agent for workspaces that have
 * auto-parse switched on.
 *
 * Arrival hooks try immediately; the poller's catch-up sweep picks up whatever
 * they could not hand over (worker offline). Only items with no parse job at
 * all are swept — a failed job is left for a human, so a document that always
 * fails cannot burn tokens on every tick.
 */

const SWEEP_LIMIT_PER_TICK = 10;
/** The sweep covers outages, not history; older stragglers are left for manual parsing. */
const SWEEP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Keys currently being handed over, so a hook and the sweep never dispatch the
 *  same document twice (requestParse downloads from Drive before the job row exists). */
const inFlight = new Set<string>();
/** Keys that failed for a reason retrying will not fix (e.g. 422). */
const givenUp = new Set<string>();

type Attachment = { filename: string; driveFileId?: string };

const emailKey = (messageId: string, index: number): string => `email:${messageId}:${index}`;
const importKey = (importId: string): string => `import:${importId}`;

/** Returns whether a hand-over was actually attempted. */
async function attempt(key: string, run: () => Promise<void>): Promise<boolean> {
  if (inFlight.has(key) || givenUp.has(key)) return false;
  inFlight.add(key);
  try {
    await run();
  } catch (err) {
    // 503 = worker offline, 409 = already parsing: the sweep handles both.
    if (err instanceof ParseRequestError && err.status !== 503 && err.status !== 409) {
      givenUp.add(key);
    }
    console.warn(`[DocTidyAutoParse] ${key}: ${(err as Error).message}`);
  } finally {
    inFlight.delete(key);
  }
  return true;
}

function parseableIndexes(attachments: Attachment[]): number[] {
  return attachments.flatMap((att, i) =>
    att.driveFileId && isParseableFilename(att.filename) ? [i] : []
  );
}

function parseAttachment(messageId: string, index: number): Promise<boolean> {
  return attempt(emailKey(messageId, index), async () => {
    await requestParse(messageId, index, { name: 'Auto-parse' });
  });
}

function parseImport(imp: IDocTidyPdfImport): Promise<boolean> {
  return attempt(importKey(String(imp._id)), async () => {
    const job = await requestParseFromGridFS(
      imp.pdfFileId,
      imp.filename,
      String(imp._id),
      { id: imp.uploadedByUserId, name: 'Auto-parse' },
      imp.driveFileId,
      imp.workspaceId
    );
    imp.parseJobId = job._id as Types.ObjectId;
    await imp.save();
  });
}

/** Called by the email extractor after a message is imported for the first time. */
export async function autoParseNewMessage(
  messageId: Types.ObjectId,
  workspaceId: Types.ObjectId | string | null | undefined
): Promise<void> {
  if (!workspaceId || !hasWorker()) return;
  const ws = await DocTidyWorkspace.findById(workspaceId).select('autoParseEmails').lean();
  if (!ws?.autoParseEmails) return;

  const message = await DocTidyMessage.findById(messageId).select('attachments').lean();
  if (!message) return;
  for (const index of parseableIndexes(message.attachments ?? [])) {
    await parseAttachment(String(messageId), index);
  }
}

/** Called by the upload endpoint; sets `parseJobId` on each import it hands over. */
export async function autoParseNewImports(
  workspaceId: string,
  imports: IDocTidyPdfImport[]
): Promise<void> {
  if (imports.length === 0 || !hasWorker()) return;
  const ws = await DocTidyWorkspace.findById(workspaceId).select('autoParseImports').lean();
  if (!ws?.autoParseImports) return;

  for (const imp of imports) await parseImport(imp);
}

function sweepFloor(since: Date | null | undefined): Date {
  const floor = Date.now() - SWEEP_LOOKBACK_MS;
  return new Date(Math.max(since ? since.getTime() : Date.now(), floor));
}

async function sweepEmails(budget: number): Promise<number> {
  const workspaces = await DocTidyWorkspace.find({ autoParseEmails: true })
    .select('_id autoParseEmailsSince')
    .lean();

  let dispatched = 0;
  for (const ws of workspaces) {
    if (dispatched >= budget) break;
    const ruleIds = (await DocTidyRule.find({ workspaceId: ws._id }).select('_id').lean()).map((r) => r._id);
    if (ruleIds.length === 0) continue;

    const messages = await DocTidyMessage.find({
      ruleId: { $in: ruleIds },
      hasAttachments: true,
      createdAt: { $gte: sweepFloor(ws.autoParseEmailsSince) },
    })
      .select('_id attachments.filename attachments.driveFileId')
      .sort({ createdAt: 1 })
      .lean();
    if (messages.length === 0) continue;

    const jobs = await DocTidyParseJob.find({ messageId: { $in: messages.map((m) => m._id) } })
      .select('messageId attachmentIndex')
      .lean();
    const hasJob = new Set(jobs.map((j) => emailKey(String(j.messageId), j.attachmentIndex)));

    for (const msg of messages) {
      for (const index of parseableIndexes(msg.attachments ?? [])) {
        if (dispatched >= budget) return dispatched;
        if (hasJob.has(emailKey(String(msg._id), index))) continue;
        if (await parseAttachment(String(msg._id), index)) dispatched += 1;
      }
    }
  }
  return dispatched;
}

async function sweepImports(budget: number): Promise<number> {
  if (budget <= 0) return 0;
  const workspaces = await DocTidyWorkspace.find({ autoParseImports: true })
    .select('_id autoParseImportsSince')
    .lean();

  let dispatched = 0;
  for (const ws of workspaces) {
    const imports = await DocTidyPdfImport.find({
      workspaceId: ws._id,
      parseJobId: null,
      createdAt: { $gte: sweepFloor(ws.autoParseImportsSince) },
    }).sort({ createdAt: 1 });

    for (const imp of imports) {
      if (dispatched >= budget) return dispatched;
      if (await parseImport(imp)) dispatched += 1;
    }
  }
  return dispatched;
}

/**
 * Hands over documents that arrived while the worker was offline. Bounded per
 * tick so a long outage drains gradually instead of flooding the worker.
 */
let sweeping = false;

export async function sweepAutoParse(): Promise<void> {
  if (sweeping || !hasWorker()) return;
  sweeping = true;
  try {
    const fromEmails = await sweepEmails(SWEEP_LIMIT_PER_TICK);
    await sweepImports(SWEEP_LIMIT_PER_TICK - fromEmails);
  } catch (err) {
    console.error('[DocTidyAutoParse] Sweep failed:', (err as Error).message);
  } finally {
    sweeping = false;
  }
}
