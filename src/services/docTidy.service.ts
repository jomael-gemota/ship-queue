import DocTidyMessage from '../models/DocTidyMessage';
import type { IDocTidyAttachment } from '../models/DocTidyMessage';
import DocTidyRule, { type IDocTidyRule } from '../models/DocTidyRule';
import { getDocTidyConfigDoc } from '../models/DocTidyConfig';
import { broadcast } from './docTidyEvents';
import {
  buildGmailQuery,
  getAttachmentBuffer,
  getMessage,
  listMessageIds,
  MAX_MESSAGES_PER_RUN,
  type ParsedGmailMessage,
} from './gmail.service';
import { uploadBufferToDrive } from './googleDrive.service';

export interface RunRuleResult {
  matched: number;
  imported: number;
  updated: number;
  attachmentsUploaded: number;
  attachmentErrors: number;
  query: string;
}

export interface RunRuleOptions {
  /**
   * Skip Gmail ids that are already stored, without fetching them. Keeps the
   * background poller cheap: a tick then costs one `messages.list` per rule
   * plus a `messages.get` only for genuinely new mail, instead of
   * re-downloading every message in the rule's lookback window every time.
   */
  skipKnown?: boolean;
}

export interface RunAllRulesResult {
  results: {
    ruleId: string;
    name: string;
    matched?: number;
    imported?: number;
    error?: string;
  }[];
  imported: number;
}

/** Lowercase extension without the dot, or '' when the name has none. */
function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx + 1).toLowerCase();
}

function normalise(list?: string[]): string[] {
  return (list ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Re-checks a Gmail result against the rule. Gmail's query language is
 * approximate for our purposes: it tokenises rather than substring-matches,
 * ignores extension allow-lists, and `{a b}` OR-groups cannot express strict
 * per-group `all` semantics. This pass makes the stored results exact.
 */
export function messageMatchesRule(msg: ParsedGmailMessage, rule: IDocTidyRule): boolean {
  const subject = (msg.subject ?? '').toLowerCase();
  const body = (msg.bodyText ?? '').toLowerCase();
  const from = (msg.from ?? '').toLowerCase();
  const haystack = `${subject}\n${body}`;

  const excludes = normalise(rule.excludeKeywords);
  if (excludes.some((term) => haystack.includes(term))) return false;

  const senders = normalise(rule.fromAddresses);
  if (senders.length && !senders.some((s) => from.includes(s))) return false;

  if (!matchesRecipients(msg, rule)) return false;

  const attachments = filterAttachments(msg, rule);
  if (rule.requireAttachment && attachments.length === 0) return false;

  const subjectTerms = normalise(rule.subjectKeywords);
  const bodyTerms = normalise(rule.bodyKeywords);
  if (!subjectTerms.length && !bodyTerms.length) return true;

  const subjectHits = subjectTerms.filter((t) => subject.includes(t));
  const bodyHits = bodyTerms.filter((t) => body.includes(t));

  if (rule.matchMode === 'all') {
    return subjectHits.length === subjectTerms.length && bodyHits.length === bodyTerms.length;
  }

  return subjectHits.length > 0 || bodyHits.length > 0;
}

/**
 * Checks a rule's recipient addresses against every header the address could
 * appear in. Google Groups renders the address dot-separated in `List-ID`
 * (`<invoice.outdoorequipped.com>`), so an `@`→`.` variant is tried too —
 * without it, group mail that Gmail correctly returned would be discarded here.
 */
function matchesRecipients(msg: ParsedGmailMessage, rule: IDocTidyRule): boolean {
  const wanted = normalise(rule.toAddresses);
  if (!wanted.length) return true;

  const haystack = `${msg.recipientsRaw ?? ''} ${(msg.to ?? []).join(' ')}`.toLowerCase();

  return wanted.some(
    (address) => haystack.includes(address) || haystack.includes(address.replace('@', '.'))
  );
}

/** Attachments surviving the rule's extension allow-list (empty = allow all). */
function filterAttachments(msg: ParsedGmailMessage, rule: IDocTidyRule) {
  const allowed = normalise(rule.attachmentExtensions).map((e) => e.replace(/^\./, ''));
  if (!allowed.length) return msg.attachments;
  return msg.attachments.filter((a) => allowed.includes(extensionOf(a.filename)));
}

/**
 * Runs one rule end to end: query Gmail, verify each hit locally, copy
 * attachments into the configured Drive folder, and upsert the results.
 *
 * Upserting on `gmailMessageId` means a rule can be re-run safely; already
 * imported messages are refreshed rather than duplicated, and their
 * attachments are not re-uploaded.
 */
export async function runRule(rule: IDocTidyRule, options: RunRuleOptions = {}): Promise<RunRuleResult> {
  const config = await getDocTidyConfigDoc(true);
  const refreshToken = config.gmailRefreshToken;

  if (!refreshToken) {
    throw new Error('The Doc Tidy mailbox is not connected. An admin can connect it in Settings.');
  }

  const query = buildGmailQuery({
    fromAddresses: rule.fromAddresses,
    toAddresses: rule.toAddresses,
    subjectKeywords: rule.subjectKeywords,
    bodyKeywords: rule.bodyKeywords,
    excludeKeywords: rule.excludeKeywords,
    matchMode: rule.matchMode,
    dateFrom: rule.dateFrom,
    dateTo: rule.dateTo,
    lookbackDays: rule.lookbackDays,
    requireAttachment: rule.requireAttachment,
  });

  const allIds = await listMessageIds(refreshToken, query, MAX_MESSAGES_PER_RUN);

  const result: RunRuleResult = {
    matched: 0,
    imported: 0,
    updated: 0,
    attachmentsUploaded: 0,
    attachmentErrors: 0,
    query,
  };

  // One indexed lookup for the whole batch, rather than a round trip per id.
  let ids = allIds;
  if (options.skipKnown && allIds.length) {
    const known = await DocTidyMessage.find({ gmailMessageId: { $in: allIds } })
      .select('gmailMessageId')
      .lean();
    const seen = new Set(known.map((doc) => doc.gmailMessageId));
    ids = allIds.filter((id) => !seen.has(id));
  }

  for (const id of ids) {
    const msg = await getMessage(refreshToken, id);
    if (!messageMatchesRule(msg, rule)) continue;

    result.matched += 1;

    const existing = await DocTidyMessage.findOne({ gmailMessageId: msg.gmailMessageId });
    const keptAttachments = filterAttachments(msg, rule);

    // Only upload the first time we see a message; a re-run must not duplicate
    // files in Drive.
    let attachments: IDocTidyAttachment[];
    if (existing) {
      attachments = existing.attachments;
    } else {
      attachments = [];
      for (const att of keptAttachments) {
        const record: IDocTidyAttachment = {
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          gmailAttachmentId: att.attachmentId,
        };

        try {
          if (!att.attachmentId) throw new Error('Attachment has no Gmail id');

          const buffer = await getAttachmentBuffer(refreshToken, msg.gmailMessageId, att.attachmentId);
          // Uploaded under the sender's own filename. Drive tolerates
          // duplicate names, so no date or subject prefix is added.
          const uploaded = await uploadBufferToDrive(
            { refreshToken },
            att.filename,
            att.mimeType,
            buffer,
            config.driveFolderId
          );

          record.driveFileId = uploaded.id;
          record.webViewLink = uploaded.webViewLink ?? undefined;
          result.attachmentsUploaded += 1;
        } catch (err) {
          // One bad attachment must not abandon the whole run; record why and
          // keep the row so the failure is visible in the results table.
          record.uploadError = (err as Error).message;
          result.attachmentErrors += 1;
        }

        attachments.push(record);
      }
    }

    await DocTidyMessage.updateOne(
      { gmailMessageId: msg.gmailMessageId },
      {
        $set: {
          ruleId: rule._id,
          ruleName: rule.name,
          documentType: rule.documentType ?? 'other',
          threadId: msg.threadId,
          from: msg.from,
          fromName: msg.fromName,
          to: msg.to,
          subject: msg.subject,
          snippet: msg.snippet,
          bodyText: msg.bodyText,
          sentAt: msg.sentAt,
          attachments,
          hasAttachments: attachments.length > 0,
          extractedAt: new Date(),
        },
      },
      { upsert: true }
    );

    if (existing) result.updated += 1;
    else result.imported += 1;
  }

  return result;
}

/**
 * Guards against two extractions overlapping. Both would look up a message,
 * find it missing, and upload its attachments — leaving Drive with duplicates
 * that nothing downstream cleans up.
 */
let running = false;

export function isExtractionRunning(): boolean {
  return running;
}

/**
 * Runs every enabled rule and records the outcome on each one. Shared by the
 * HTTP endpoint and the background poller so both report identically.
 *
 * Returns `null` when a run is already in progress, rather than queueing.
 */
export async function runEnabledRules(options: RunRuleOptions = {}): Promise<RunAllRulesResult | null> {
  if (running) return null;
  running = true;

  try {
    const rules = await DocTidyRule.find({ enabled: true });
    const result: RunAllRulesResult = { results: [], imported: 0 };

    for (const rule of rules) {
      try {
        const runResult = await runRule(rule, options);
        rule.lastRunAt = new Date();
        rule.lastRunMatchCount = runResult.matched;
        rule.lastRunError = undefined;
        await rule.save();

        result.imported += runResult.imported;
        result.results.push({
          ruleId: String(rule._id),
          name: rule.name,
          matched: runResult.matched,
          imported: runResult.imported,
        });
      } catch (error) {
        // One failing rule should not stop the rest of the batch.
        const message = (error as Error).message || 'Extraction failed';
        rule.lastRunAt = new Date();
        rule.lastRunError = message;
        await rule.save();

        result.results.push({ ruleId: String(rule._id), name: rule.name, error: message });
      }
    }

    // Tell any open results table to refetch. Only on a real import, so an
    // idle poll does not churn every connected client.
    if (result.imported > 0) {
      broadcast({ type: 'imported', imported: result.imported });
    }

    return result;
  } finally {
    running = false;
  }
}
