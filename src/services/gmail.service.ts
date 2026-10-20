import { google, gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

/**
 * Gmail read access for the single shared Doc Tidy mailbox. The credential is
 * the refresh token stored on the DocTidyConfig singleton, not on a User.
 */

/** Scopes requested when an admin connects the Doc Tidy mailbox. */
export const DOC_TIDY_SCOPES = [
  'profile',
  'email',
  // Read-only: Doc Tidy must never modify or delete mail.
  'https://www.googleapis.com/auth/gmail.readonly',
  // The same account owns the Drive folder that attachments are copied into.
  'https://www.googleapis.com/auth/drive',
];

/** Hard cap per run so a broad rule cannot exhaust the Gmail quota. */
export const MAX_MESSAGES_PER_RUN = 250;

export interface GmailAttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId?: string;
}

export interface ParsedGmailMessage {
  gmailMessageId: string;
  threadId?: string;
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  snippet?: string;
  bodyText: string;
  sentAt: Date;
  attachments: GmailAttachmentMeta[];
  /**
   * Every header a recipient can appear under (To, Cc, Bcc, Delivered-To,
   * X-Original-To, List-ID, List-Post), joined and lowercased. Group-delivered
   * mail often names the group in only one of these, so the local matcher
   * checks them all rather than just `to`.
   */
  recipientsRaw: string;
}

/** Shape needed to compile a rule into a Gmail query; matches DocTidyRule. */
export interface RuleQueryInput {
  fromAddresses?: string[];
  toAddresses?: string[];
  subjectKeywords?: string[];
  bodyKeywords?: string[];
  excludeKeywords?: string[];
  matchMode?: 'any' | 'all';
  dateFrom?: Date | null;
  dateTo?: Date | null;
  lookbackDays?: number | null;
  requireAttachment?: boolean;
}

export function buildGmailClient(refreshToken?: string | null): gmail_v1.Gmail {
  return google.gmail({ version: 'v1', auth: buildOAuthClient(refreshToken) });
}

export function buildOAuthClient(refreshToken?: string | null): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }
  if (!refreshToken) {
    throw new Error('The Doc Tidy mailbox is not connected. An admin can connect it in Settings.');
  }

  // Refresh token only — see googleDrive.service.ts for why a stored access
  // token without an expiry is deliberately not set here.
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

/** Gmail's `after:`/`before:` operators take YYYY/MM/DD. */
function toGmailDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/** Wraps a term in quotes so multi-word phrases survive Gmail's parser. */
function quote(term: string): string {
  const clean = term.trim().replace(/"/g, '');
  return clean.includes(' ') ? `"${clean}"` : clean;
}

/**
 * Compiles a rule into a Gmail search query so the filtering happens on
 * Google's side. Anything Gmail cannot express exactly (extension
 * allow-lists, strict `all` semantics) is re-checked in Node afterwards.
 */
export function buildGmailQuery(rule: RuleQueryInput): string {
  const clauses: string[] = [];

  const senders = (rule.fromAddresses ?? []).map((s) => s.trim()).filter(Boolean);
  if (senders.length) {
    clauses.push(`{${senders.map((s) => `from:${quote(s)}`).join(' ')}}`);
  }

  // Mail delivered via a Google Group can name the group in any of these
  // headers depending on how it was addressed and rewritten, so OR across all
  // of them. `list:` is the most reliable marker of group-delivered mail.
  const recipients = (rule.toAddresses ?? []).map((s) => s.trim()).filter(Boolean);
  if (recipients.length) {
    const terms = recipients.flatMap((r) => [
      `to:${quote(r)}`,
      `cc:${quote(r)}`,
      `bcc:${quote(r)}`,
      `deliveredto:${quote(r)}`,
      `list:${quote(r)}`,
    ]);
    clauses.push(`{${terms.join(' ')}}`);
  }

  const subjects = (rule.subjectKeywords ?? []).map((s) => s.trim()).filter(Boolean);
  const bodies = (rule.bodyKeywords ?? []).map((s) => s.trim()).filter(Boolean);
  const matchAll = rule.matchMode === 'all';

  if (matchAll) {
    // Every term must be present.
    subjects.forEach((s) => clauses.push(`subject:${quote(s)}`));
    bodies.forEach((b) => clauses.push(quote(b)));
  } else {
    // Any term may match: OR the subject and body groups together.
    const anyTerms = [
      ...subjects.map((s) => `subject:${quote(s)}`),
      ...bodies.map((b) => quote(b)),
    ];
    if (anyTerms.length) clauses.push(`{${anyTerms.join(' ')}}`);
  }

  (rule.excludeKeywords ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((term) => clauses.push(`-${quote(term)}`));

  if (rule.requireAttachment) clauses.push('has:attachment');

  // A rolling window takes precedence over an absolute range.
  if (rule.lookbackDays && rule.lookbackDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - rule.lookbackDays);
    clauses.push(`after:${toGmailDate(since)}`);
  } else {
    if (rule.dateFrom) clauses.push(`after:${toGmailDate(new Date(rule.dateFrom))}`);
    if (rule.dateTo) {
      // `before:` is exclusive, so push it out a day to make the range inclusive.
      const end = new Date(rule.dateTo);
      end.setDate(end.getDate() + 1);
      clauses.push(`before:${toGmailDate(end)}`);
    }
  }

  return clauses.join(' ').trim();
}

/** Returns message ids matching `query`, newest first, capped per run. */
export async function listMessageIds(
  refreshToken: string | null | undefined,
  query: string,
  limit = MAX_MESSAGES_PER_RUN
): Promise<string[]> {
  const gmail = buildGmailClient(refreshToken);
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query || undefined,
      maxResults: Math.min(100, limit - ids.length),
      pageToken,
    });

    for (const m of res.data.messages ?? []) {
      if (m.id) ids.push(m.id);
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < limit);

  return ids.slice(0, limit);
}

function header(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string {
  const found = payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? '';
}

/** Splits `"Some Name" <a@b.com>` into its display name and address. */
function parseAddress(raw: string): { email: string; name?: string } {
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    return { email: match[2].trim().toLowerCase(), name: match[1].replace(/"/g, '').trim() || undefined };
  }
  return { email: raw.trim().toLowerCase() };
}

function decodeBody(data?: string | null): string {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Walks the MIME tree collecting the plain-text body and any attachments.
 * HTML is only used when no text/plain alternative exists.
 */
function walkParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: { text: string[]; html: string[]; attachments: GmailAttachmentMeta[] }
): void {
  if (!part) return;

  const filename = part.filename ?? '';
  const isAttachment = Boolean(filename) && Boolean(part.body?.attachmentId);

  if (isAttachment) {
    acc.attachments.push({
      filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
      size: part.body?.size ?? 0,
      attachmentId: part.body?.attachmentId ?? undefined,
    });
  } else if (part.mimeType === 'text/plain') {
    acc.text.push(decodeBody(part.body?.data));
  } else if (part.mimeType === 'text/html') {
    acc.html.push(decodeBody(part.body?.data));
  }

  for (const child of part.parts ?? []) walkParts(child, acc);
}

/** Fetches one message and flattens it into the shape stored in Mongo. */
export async function getMessage(
  refreshToken: string | null | undefined,
  messageId: string
): Promise<ParsedGmailMessage> {
  const gmail = buildGmailClient(refreshToken);
  const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const msg = res.data;

  const acc = { text: [] as string[], html: [] as string[], attachments: [] as GmailAttachmentMeta[] };
  walkParts(msg.payload, acc);

  const fromRaw = header(msg.payload, 'From');
  const { email: from, name: fromName } = parseAddress(fromRaw);

  const to = header(msg.payload, 'To')
    .split(',')
    .map((entry) => parseAddress(entry).email)
    .filter(Boolean);

  const recipientsRaw = ['To', 'Cc', 'Bcc', 'Delivered-To', 'X-Original-To', 'List-ID', 'List-Post']
    .map((name) => header(msg.payload, name))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const bodyText = acc.text.join('\n').trim() || stripHtml(acc.html.join('\n'));

  // internalDate is the authoritative receive time; the Date header can be absent or skewed.
  const sentAt = msg.internalDate
    ? new Date(Number(msg.internalDate))
    : new Date(header(msg.payload, 'Date') || Date.now());

  return {
    gmailMessageId: msg.id ?? messageId,
    threadId: msg.threadId ?? undefined,
    from,
    fromName,
    to,
    subject: header(msg.payload, 'Subject') || '(no subject)',
    snippet: msg.snippet ?? undefined,
    bodyText,
    sentAt,
    attachments: acc.attachments,
    recipientsRaw,
  };
}

/** Downloads a single attachment's bytes. */
export async function getAttachmentBuffer(
  refreshToken: string | null | undefined,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const gmail = buildGmailClient(refreshToken);
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });

  const data = res.data.data;
  if (!data) throw new Error('Attachment has no content');

  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Returns the address of the connected mailbox, for display in Settings. */
export async function getMailboxAddress(refreshToken: string | null | undefined): Promise<string> {
  const gmail = buildGmailClient(refreshToken);
  const res = await gmail.users.getProfile({ userId: 'me' });
  return res.data.emailAddress ?? '';
}
