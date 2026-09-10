import DocTidyMessage from '../models/DocTidyMessage';
import type { IDocTidyAttachment } from '../models/DocTidyMessage';
import type { IDocTidyRule } from '../models/DocTidyRule';
import { getDocTidyConfigDoc } from '../models/DocTidyConfig';
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
 * Keeps Drive tidy and filenames traceable: `2026-09-10_Acme-Invoice_bill.pdf`.
 * Drive allows duplicates, so no uniqueness suffix is needed.
 */
function buildDriveFileName(msg: ParsedGmailMessage, filename: string): string {
  const datePart = msg.sentAt.toISOString().slice(0, 10);
  const subjectPart = (msg.subject || 'no-subject')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60)
    .replace(/\s+/g, '-');
  return `${datePart}_${subjectPart}_${filename}`;
}

/**
 * Runs one rule end to end: query Gmail, verify each hit locally, copy
 * attachments into the configured Drive folder, and upsert the results.
 *
 * Upserting on `gmailMessageId` means a rule can be re-run safely; already
 * imported messages are refreshed rather than duplicated, and their
 * attachments are not re-uploaded.
 */
export async function runRule(rule: IDocTidyRule): Promise<RunRuleResult> {
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

  const ids = await listMessageIds(refreshToken, query, MAX_MESSAGES_PER_RUN);

  const result: RunRuleResult = {
    matched: 0,
    imported: 0,
    updated: 0,
    attachmentsUploaded: 0,
    attachmentErrors: 0,
    query,
  };

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
          const uploaded = await uploadBufferToDrive(
            { refreshToken },
            buildDriveFileName(msg, att.filename),
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
