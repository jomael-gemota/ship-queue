import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import DocTidyRule, {
  DOCUMENT_TYPES,
  MATCH_MODES,
  type DocumentType,
  type MatchMode,
} from '../models/DocTidyRule';
import DocTidyMessage from '../models/DocTidyMessage';
import DocTidyParseJob from '../models/DocTidyParseJob';
import { getDocTidyConfigDoc } from '../models/DocTidyConfig';
import { runRule, runEnabledRules } from '../services/docTidy.service';
import { addClient, broadcast } from '../services/docTidyEvents';
import { getDriveFolder, listDriveFolders, listSharedDrives } from '../services/googleDrive.service';

/** Escapes user input before it is used inside a RegExp. */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Coerces arbitrary JSON into a trimmed string array. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  // Also accept a comma/newline separated string for convenience.
  if (typeof value === 'string') {
    return value
      .split(/[\n,]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Builds the persisted rule fields from a request body. */
function buildRulePayload(body: Record<string, unknown>) {
  const matchMode = MATCH_MODES.includes(body.matchMode as MatchMode)
    ? (body.matchMode as MatchMode)
    : 'any';

  const documentType = DOCUMENT_TYPES.includes(body.documentType as DocumentType)
    ? (body.documentType as DocumentType)
    : 'other';

  const lookbackRaw = Number(body.lookbackDays);
  const lookbackDays =
    Number.isFinite(lookbackRaw) && lookbackRaw > 0 ? Math.min(3650, Math.round(lookbackRaw)) : undefined;

  return {
    name: String(body.name ?? '').trim(),
    description: typeof body.description === 'string' ? body.description.trim() : undefined,
    enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    documentType,
    fromAddresses: toStringArray(body.fromAddresses),
    toAddresses: toStringArray(body.toAddresses),
    subjectKeywords: toStringArray(body.subjectKeywords),
    bodyKeywords: toStringArray(body.bodyKeywords),
    excludeKeywords: toStringArray(body.excludeKeywords),
    matchMode,
    // A rolling window and an absolute range are mutually exclusive.
    dateFrom: lookbackDays ? undefined : parseDate(body.dateFrom),
    dateTo: lookbackDays ? undefined : parseDate(body.dateTo),
    lookbackDays,
    requireAttachment: body.requireAttachment === undefined ? true : Boolean(body.requireAttachment),
    attachmentExtensions: toStringArray(body.attachmentExtensions).map((e) =>
      e.replace(/^\./, '').toLowerCase()
    ),
  };
}

/* ------------------------------------------------------------------ rules */

export const listRules = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rules = await DocTidyRule.find().sort({ enabled: -1, createdAt: -1 }).lean();
    res.json({ data: rules });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load rules', error: (error as Error).message });
  }
};

export const createRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = buildRulePayload(req.body ?? {});

    if (!payload.name) {
      res.status(400).json({ message: 'A rule name is required' });
      return;
    }

    const rule = await DocTidyRule.create({
      ...payload,
      createdByUserId: req.user?.id,
      createdByName: req.user?.name,
    });

    res.status(201).json({ data: rule });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message || 'Failed to create rule' });
  }
};

export const updateRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid rule id' });
      return;
    }

    const payload = buildRulePayload(req.body ?? {});
    if (!payload.name) {
      res.status(400).json({ message: 'A rule name is required' });
      return;
    }

    const rule = await DocTidyRule.findByIdAndUpdate(id, payload, { new: true });
    if (!rule) {
      res.status(404).json({ message: 'Rule not found' });
      return;
    }

    // Keep the labels denormalised onto already-extracted messages in step with
    // the rule. Re-running will not revisit those messages (`skipKnown`), so
    // without this a renamed or re-classified rule leaves its own history
    // contradicting it.
    await DocTidyMessage.updateMany(
      { ruleId: rule._id },
      { $set: { ruleName: rule.name, documentType: rule.documentType } }
    );

    res.json({ data: rule });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message || 'Failed to update rule' });
  }
};

export const deleteRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid rule id' });
      return;
    }

    const rule = await DocTidyRule.findByIdAndDelete(id);
    if (!rule) {
      res.status(404).json({ message: 'Rule not found' });
      return;
    }

    // Extracted messages are deliberately kept; they record `ruleName` so the
    // history stays readable after the rule that produced them is gone.
    res.json({ data: { deleted: true } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete rule', error: (error as Error).message });
  }
};

/* --------------------------------------------------------------- running */

export const runRuleById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid rule id' });
    return;
  }

  const rule = await DocTidyRule.findById(id);
  if (!rule) {
    res.status(404).json({ message: 'Rule not found' });
    return;
  }

  try {
    const result = await runRule(rule);

    rule.lastRunAt = new Date();
    rule.lastRunMatchCount = result.matched;
    rule.lastRunError = undefined;
    await rule.save();

    // Keep other people's open results tables current too.
    if (result.imported > 0) broadcast({ type: 'imported', imported: result.imported });

    res.json({ data: result });
  } catch (error) {
    const message = (error as Error).message || 'Extraction failed';

    rule.lastRunAt = new Date();
    rule.lastRunError = message;
    await rule.save();

    res.status(400).json({ message });
  }
};

export const runAllRules = async (_req: Request, res: Response): Promise<void> => {
  try {
    const enabledCount = await DocTidyRule.countDocuments({ enabled: true });
    if (enabledCount === 0) {
      res.status(400).json({ message: 'There are no enabled rules to run' });
      return;
    }

    const result = await runEnabledRules();
    if (!result) {
      res.status(409).json({
        message: 'An extraction is already running — new messages will appear automatically.',
      });
      return;
    }

    res.json({ data: { results: result.results } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to run rules', error: (error as Error).message });
  }
};

/* ---------------------------------------------------------------- events */

/**
 * Server-sent events stream that tells open results tables when to refetch.
 *
 * Events carry a signal rather than the rows themselves, so each client
 * re-queries with its own filters and page and cannot drift out of sync with
 * its filter state.
 */
export const streamEvents = (req: Request, res: Response): void => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops reverse proxies buffering the stream into uselessness.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const remove = addClient(res);
  res.write(`data: ${JSON.stringify({ type: 'connected', at: new Date().toISOString() })}\n\n`);

  req.on('close', remove);
};

/* -------------------------------------------------------------- messages */

export const getMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      search,
      ruleId,
      documentType,
      hasAttachments,
      dateFrom,
      dateTo,
      page = '1',
      pageSize = '50',
    } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const allowedSizes = [50, 100, 200, 500];
    const requested = parseInt(pageSize ?? '50', 10);
    const size = allowedSizes.includes(requested) ? requested : 50;
    const skip = (pageNum - 1) * size;

    const filter: Record<string, unknown> = {};

    if (ruleId && isValidObjectId(ruleId)) filter.ruleId = ruleId;

    if (DOCUMENT_TYPES.includes(documentType as DocumentType)) {
      // Messages stored before the field existed have no `documentType` and are
      // shown as "Other", so that filter has to match them too.
      filter.documentType =
        documentType === 'other' ? { $in: ['other', null] } : documentType;
    }

    if (hasAttachments === 'true') filter.hasAttachments = true;
    if (hasAttachments === 'false') filter.hasAttachments = false;

    const from = parseDate(dateFrom);
    const to = parseDate(dateTo);
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) {
        // Make the upper bound inclusive of the whole day.
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
      }
      filter.sentAt = range;
    }

    const term = search?.trim();
    if (term) {
      const regex = new RegExp(escapeRegExp(term), 'i');
      filter.$or = [
        { subject: regex },
        { from: regex },
        { fromName: regex },
        { snippet: regex },
        { ruleName: regex },
        { 'attachments.filename': regex },
      ];
    }

    const hasFilter = Object.keys(filter).length > 0;

    const [messages, total] = await Promise.all([
      DocTidyMessage.find(filter).sort({ sentAt: -1 }).skip(skip).limit(size).lean(),
      hasFilter ? DocTidyMessage.countDocuments(filter) : DocTidyMessage.estimatedDocumentCount(),
    ]);

    // Parse state for this page in one query rather than one per row. The table
    // renders a Parse action per attachment, so it needs to know which of them
    // already have a job and where each got to.
    const jobs = await DocTidyParseJob.find({ messageId: { $in: messages.map((m) => m._id) } })
      .select('messageId attachmentIndex status error completedAt vendorName vendorNeedsSetup')
      .lean();

    const jobsByMessage = new Map<string, typeof jobs>();
    for (const job of jobs) {
      const key = String(job.messageId);
      const bucket = jobsByMessage.get(key);
      if (bucket) bucket.push(job);
      else jobsByMessage.set(key, [job]);
    }

    res.json({
      data: messages.map((m) => ({ ...m, parseJobs: jobsByMessage.get(String(m._id)) ?? [] })),
      pagination: {
        page: pageNum,
        pageSize: size,
        total,
        pages: Math.ceil(total / size),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load messages', error: (error as Error).message });
  }
};

export const getMessageById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid message id' });
      return;
    }

    const message = await DocTidyMessage.findById(id).select('+bodyText').lean();
    if (!message) {
      res.status(404).json({ message: 'Message not found' });
      return;
    }

    res.json({ data: message });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load message', error: (error as Error).message });
  }
};

/* ---------------------------------------------------------------- config */

async function buildConfigPayload() {
  const config = await getDocTidyConfigDoc(true);
  return {
    mailboxConnected: Boolean(config.gmailRefreshToken),
    mailboxEmail: config.gmailAccountEmail || null,
    connectedAt: config.gmailConnectedAt || null,
    connectedByName: config.gmailConnectedByName || null,
    driveFolderId: config.driveFolderId || null,
    driveFolderName: config.driveFolderName || null,
  };
}

export const getConfig = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ data: await buildConfigPayload() });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load configuration', error: (error as Error).message });
  }
};

/** Sets the Drive destination folder for attachments. Admin-only. */
export const updateConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { driveFolderId, driveId } = req.body as { driveFolderId?: string; driveId?: string };
    const config = await getDocTidyConfigDoc(true);

    if (!driveFolderId) {
      config.driveFolderId = undefined;
      config.driveFolderName = undefined;
      config.driveId = undefined;
      await config.save();
      res.json({ data: await buildConfigPayload() });
      return;
    }

    if (!config.gmailRefreshToken) {
      res.status(400).json({ message: 'Connect the Doc Tidy mailbox before choosing a folder' });
      return;
    }

    // Validate against Drive so a bad id fails here rather than mid-extraction.
    const folder = await getDriveFolder({ refreshToken: config.gmailRefreshToken }, driveFolderId);

    config.driveFolderId = folder.id;
    config.driveFolderName = folder.name;
    config.driveId = driveId || undefined;
    await config.save();

    res.json({ data: await buildConfigPayload() });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message || 'Failed to update configuration' });
  }
};

/** Clears the stored mailbox credential. Admin-only. */
export const disconnectMailbox = async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await getDocTidyConfigDoc(true);

    if (config.gmailRefreshToken) {
      // Best-effort revocation; proceed regardless so the app never gets stuck
      // holding a credential it cannot clear.
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(config.gmailRefreshToken)}`,
          { method: 'POST' }
        );
      } catch {
        /* non-fatal */
      }
    }

    config.gmailRefreshToken = undefined;
    config.gmailAccountEmail = undefined;
    config.gmailConnectedAt = undefined;
    config.gmailConnectedByName = undefined;
    config.driveFolderId = undefined;
    config.driveFolderName = undefined;
    config.driveId = undefined;
    await config.save();

    res.json({ data: { disconnected: true } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to disconnect mailbox', error: (error as Error).message });
  }
};

/**
 * Drive folder picker scoped to the connected Doc Tidy account, so the
 * destination can be a different drive from the label-upload folder.
 */
export const listConfigFolders = async (req: Request, res: Response): Promise<void> => {
  try {
    const parentId = (req.query.parentId as string) || undefined;
    const driveId = (req.query.driveId as string) || undefined;

    const config = await getDocTidyConfigDoc(true);
    if (!config.gmailRefreshToken) {
      res.status(400).json({ message: 'Connect the Doc Tidy mailbox first' });
      return;
    }

    const creds = { refreshToken: config.gmailRefreshToken };

    if (!parentId && !driveId) {
      const [myDrive, shared] = await Promise.all([
        listDriveFolders(creds),
        listSharedDrives(creds).catch(() => [] as { id: string; name: string }[]),
      ]);

      res.json({
        data: [...myDrive, ...shared.map((d) => ({ id: d.id, name: d.name, isSharedDrive: true }))],
      });
      return;
    }

    res.json({ data: await listDriveFolders(creds, parentId, driveId) });
  } catch (error) {
    const message = ((error as Error)?.message ?? '').toLowerCase();
    if (message.includes('invalid_grant')) {
      res.status(401).json({
        code: 'doc_tidy_token_expired',
        message: 'The Doc Tidy mailbox connection has expired. Please reconnect it.',
      });
      return;
    }
    res.status(400).json({ message: (error as Error).message || 'Failed to list Drive folders' });
  }
};
