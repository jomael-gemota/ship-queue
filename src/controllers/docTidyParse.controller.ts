import { Request, Response } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import DocTidyParseJob from '../models/DocTidyParseJob';
import DocTidyCorrection, {
  CORRECTION_TEXT_SAMPLE_CHARS,
  type CorrectionMode,
} from '../models/DocTidyCorrection';
import DocTidyVendor, { normalizeVendorName } from '../models/DocTidyVendor';
import DocTidyMessage from '../models/DocTidyMessage';
import DocTidyRule from '../models/DocTidyRule';
import {
  ParseRequestError,
  requestParse,
  rerunParse,
} from '../services/docTidyParse.service';
import { addJobClient, hasWorker, sendToWorker } from '../services/docTidyWorkerRegistry';
import { embedText } from '../lib/embeddings';

/** Maps a thrown ParseRequestError onto its status; anything else is a 500. */
function fail(res: Response, error: unknown, fallback: string): void {
  if (error instanceof ParseRequestError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  res.status(500).json({ message: fallback, error: (error as Error).message });
}

/* ------------------------------------------------------------ parse jobs */

export const getWorkerStatus = (_req: Request, res: Response): void => {
  res.json({ data: { connected: hasWorker() } });
};

export const parseAttachment = async (req: Request, res: Response): Promise<void> => {
  try {
    const job = await requestParse(req.params.id, Number(req.params.index), {
      id: req.user?.id,
      name: req.user?.name,
    });
    res.status(202).json({ data: job });
  } catch (error) {
    fail(res, error, 'Failed to start parsing');
  }
};

export const rerunParseJob = async (req: Request, res: Response): Promise<void> => {
  try {
    res.status(202).json({ data: await rerunParse(req.params.id) });
  } catch (error) {
    fail(res, error, 'Failed to re-run parsing');
  }
};

/**
 * Forcibly marks a pending or processing job as failed.
 *
 * Useful when the worker drops a job without updating its status (e.g. a crash
 * or network split), leaving the UI spinning indefinitely. The job is kept for
 * history and can be re-run once the root cause is resolved.
 */
export const abortParseJob = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid parse job id' });
      return;
    }

    const job = await DocTidyParseJob.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'failed',
          error: 'Parsing was stopped by the user.',
          completedAt: new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!job) {
      res.status(404).json({ message: 'Parse job not found' });
      return;
    }

    // Tell the worker to stop processing this job. Best-effort: if the worker
    // is offline the DB update above is still the source of truth, and the
    // guard in handleWorkerMessage will discard any late 'complete' that
    // arrives after reconnection.
    sendToWorker({ type: 'cancel', jobId: id });

    res.json({ data: job });
  } catch (error) {
    fail(res, error, 'Failed to abort the parse job');
  }
};

/**
 * Returns completed parse jobs for the Invoice Audit view.
 *
 * Large fields (`thinking`, `documentTextSample`) are excluded to keep
 * response payloads small; the full job is still available via GET /parse-jobs/:id.
 */
export const listParseJobs = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      status = 'completed',
      page = '1',
      pageSize = '200',
      vendorName,
      search,
      workspaceId,
    } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = { status };
    // `search` matches vendor name OR filename; `vendorName` kept for back-compat.
    const term = search || vendorName;
    if (term) {
      filter.$or = [
        { vendorName: { $regex: term, $options: 'i' } },
        { filename:   { $regex: term, $options: 'i' } },
      ];
    }

    // Workspace filter: email jobs via the rule→message chain OR pdf-import jobs
    // directly scoped by workspaceId (synthetic messages have no ruleId).
    if (workspaceId) {
      if (!isValidObjectId(workspaceId)) {
        res.status(400).json({ message: 'Invalid workspaceId' });
        return;
      }

      const workspaceRules = await DocTidyRule.find({ workspaceId }).select('_id').lean();

      const messages = workspaceRules.length > 0
        ? await DocTidyMessage
            .find({ ruleId: { $in: workspaceRules.map((r) => r._id) } })
            .select('_id')
            .lean()
        : [];

      // Combine: (email job whose message belongs to this workspace)
      //       OR (pdf-import job directly tagged with this workspaceId)
      const workspaceOid = new Types.ObjectId(workspaceId);
      const conditions: Record<string, unknown>[] = [
        { source: 'pdf-import', workspaceId: workspaceOid },
      ];
      if (messages.length > 0) {
        conditions.push({ messageId: { $in: messages.map((m) => m._id) } });
      }

      // Merge into any existing $or, or create one
      if (filter.$or) {
        // Already has $or from the search term — wrap everything in $and
        filter.$and = [{ $or: filter.$or }, { $or: conditions }];
        delete filter.$or;
      } else {
        filter.$or = conditions;
      }
    }

    const pg = Math.max(1, parseInt(page, 10));
    const size = Math.min(500, Math.max(1, parseInt(pageSize, 10)));

    const [jobs, total] = await Promise.all([
      DocTidyParseJob.find(filter)
        .select('-thinking -documentTextSample')
        .sort({ completedAt: -1, createdAt: -1 })
        .skip((pg - 1) * size)
        .limit(size)
        .lean(),
      DocTidyParseJob.countDocuments(filter),
    ]);

    res.json({
      data: jobs,
      pagination: { page: pg, pageSize: size, total, pages: Math.max(1, Math.ceil(total / size)) },
    });
  } catch (error) {
    fail(res, error, 'Failed to load parse jobs');
  }
};

export const getParseJob = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid parse job id' });
      return;
    }

    const job = await DocTidyParseJob.findById(id).lean();
    if (!job) {
      res.status(404).json({ message: 'Parse job not found' });
      return;
    }

    res.json({ data: job });
  } catch (error) {
    fail(res, error, 'Failed to load parse job');
  }
};

/**
 * Live transcript for one job.
 *
 * Replays whatever reasoning is already stored before attaching, so opening the
 * panel late — or after a refresh — shows the run from the beginning rather than
 * from the next token. A finished job is served entirely from storage and the
 * stream is closed immediately; there is nothing more coming.
 */
export const streamParseJob = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid parse job id' });
    return;
  }

  try {
    const job = await DocTidyParseJob.findById(id).lean();
    if (!job) {
      res.status(404).json({ message: 'Parse job not found' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const send = (type: string, payload: Record<string, unknown>): void => {
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    send('connected', { status: job.status });
    if (job.thinking) send('thinking', { content: job.thinking });

    if (job.status === 'completed') {
      send('done', { json: job.jsonOutput ?? null, table: job.tableOutput ?? null });
      res.end();
      return;
    }

    if (job.status === 'failed') {
      send('error', { message: job.error ?? 'The agent failed to parse this document' });
      res.end();
      return;
    }

    const remove = addJobClient(id, res);

    // Proxies drop an idle stream, and a job can spend a long time inside a
    // single model call without emitting anything.
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 20_000);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    req.on('close', () => {
      clearInterval(heartbeat);
      remove();
    });
  } catch (error) {
    if (!res.headersSent) fail(res, error, 'Failed to open the reasoning stream');
  }
};

/**
 * Binds a user-confirmed vendor to a job.
 *
 * Needed when the agent could not name the vendor from the document: storing it
 * here lets a re-run resolve the now-registered vendor even though nothing in
 * the PDF identifies it.
 */
export const setParseJobVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { vendorName } = req.body as { vendorName?: unknown };

    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid parse job id' });
      return;
    }
    if (typeof vendorName !== 'string' || !vendorName.trim()) {
      res.status(400).json({ message: 'vendorName is required' });
      return;
    }

    const job = await DocTidyParseJob.findByIdAndUpdate(
      id,
      { $set: { vendorName: vendorName.trim(), vendorNeedsSetup: false } },
      { new: true }
    ).lean();

    if (!job) {
      res.status(404).json({ message: 'Parse job not found' });
      return;
    }

    res.json({ data: job });
  } catch (error) {
    fail(res, error, 'Failed to set the vendor');
  }
};

/* ----------------------------------------------------------- corrections */

/**
 * Key-order-independent serialisation, so two corrections holding the same data
 * compare equal regardless of how the editor happened to order its keys.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export const listJobCorrections = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid parse job id' });
      return;
    }

    const corrections = await DocTidyCorrection.find({ parseJobId: id })
      .select('-embedding')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ data: corrections });
  } catch (error) {
    fail(res, error, 'Failed to load corrections');
  }
};

/**
 * Records a correction and embeds the source document so later, similar
 * documents can retrieve it.
 *
 * The same output submitted again with a *different* note is a distinct
 * correction: the note is the instruction the agent is asked to follow, so it
 * carries signal the output alone does not.
 */
export const createJobCorrection = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { correctedOutput, note, mode, correctedTables } = req.body as {
      correctedOutput?: unknown;
      note?: unknown;
      mode?: unknown;
      correctedTables?: unknown;
    };

    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid parse job id' });
      return;
    }
    if (!correctedOutput || typeof correctedOutput !== 'object' || Array.isArray(correctedOutput)) {
      res.status(400).json({ message: 'correctedOutput must be a JSON object' });
      return;
    }
    if (note !== undefined && typeof note !== 'string') {
      res.status(400).json({ message: 'note must be a string' });
      return;
    }
    if (mode !== undefined && mode !== 'json' && mode !== 'tabular') {
      res.status(400).json({ message: "mode must be 'json' or 'tabular'" });
      return;
    }
    if (correctedTables !== undefined && !Array.isArray(correctedTables)) {
      res.status(400).json({ message: 'correctedTables must be an array' });
      return;
    }

    const job = await DocTidyParseJob.findById(id);
    if (!job) {
      res.status(404).json({ message: 'Parse job not found' });
      return;
    }

    const normalizedNote = typeof note === 'string' && note.trim() ? note.trim() : undefined;

    const existing = await DocTidyCorrection.find({ parseJobId: id }).select('-embedding').lean();
    const target = canonicalJson(correctedOutput);
    const duplicate = existing.find(
      (c) =>
        canonicalJson(c.correctedOutput) === target && (c.note ?? undefined) === normalizedNote
    );
    if (duplicate) {
      res.json({ data: { duplicate: true, correctionId: String(duplicate._id) } });
      return;
    }

    const documentTextSample = (job.documentTextSample ?? '').slice(
      0,
      CORRECTION_TEXT_SAMPLE_CHARS
    );
    const embedding = documentTextSample ? await embedText(documentTextSample) : null;

    const correction = await DocTidyCorrection.create({
      parseJobId: job._id,
      filename: job.filename,
      vendorName: job.vendorName ?? null,
      documentTextSample,
      embedding,
      originalOutput: job.jsonOutput ?? null,
      correctedOutput: correctedOutput as Record<string, unknown>,
      mode: mode as CorrectionMode | undefined,
      correctedTables: Array.isArray(correctedTables) ? correctedTables : undefined,
      note: normalizedNote,
      createdByName: req.user?.name,
    });

    res.status(201).json({
      data: {
        duplicate: false,
        correctionId: String(correction._id),
        embedded: embedding !== null,
      },
    });
  } catch (error) {
    fail(res, error, 'Failed to record the correction');
  }
};

export const listCorrections = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.query as Record<string, string | undefined>;

    let correctionFilter: Record<string, unknown> = {};

    // Scope corrections to vendors that belong to the specified workspace.
    if (workspaceId && isValidObjectId(workspaceId)) {
      // Select both name and normalizedName so v.name is available for the filter.
      const vendors = await DocTidyVendor.find({ workspaceId }).select('name normalizedName').lean();
      if (vendors.length === 0) {
        res.json({ data: [] });
        return;
      }
      // Match corrections by exact vendor name (as stored on the correction).
      // Post-filter by normalizedName handles any capitalisation drift.
      const nameSet = vendors.map((v) => v.name);
      correctionFilter.vendorName = { $in: nameSet };
    }

    // The Vendors page groups this whole set by vendor, so it needs more than a
    // recent slice. `documentTextSample` is excluded alongside the embedding: it
    // is 2000 characters per row that nothing renders.
    const corrections = await DocTidyCorrection.find(correctionFilter)
      .select('-embedding -documentTextSample')
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();
    res.json({ data: corrections });
  } catch (error) {
    fail(res, error, 'Failed to load corrections');
  }
};

/**
 * Deletes a correction. The worker reads corrections fresh on every job, so the
 * delete is the whole update — the agent stops using it from the next run.
 */
export const deleteCorrection = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid correction id' });
      return;
    }

    const result = await DocTidyCorrection.deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      res.status(404).json({ message: 'Correction not found' });
      return;
    }

    res.json({ data: { deleted: true } });
  } catch (error) {
    fail(res, error, 'Failed to delete the correction');
  }
};

/* --------------------------------------------------------------- vendors */

export const listVendors = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (workspaceId && isValidObjectId(workspaceId)) filter.workspaceId = workspaceId;

    const vendors = await DocTidyVendor.find(filter).sort({ name: 1 }).lean();

    // Scope correction counts to exactly these vendors so the badge matches what
    // the corrections endpoint returns for the same workspace (no cross-workspace bleed).
    const vendorNames = vendors.map((v) => v.name);
    const countFilter = vendorNames.length > 0 ? { vendorName: { $in: vendorNames } } : { _id: null };
    const counts = await DocTidyCorrection.aggregate<{ _id: string | null; count: number }>([
      { $match: countFilter },
      { $group: { _id: '$vendorName', count: { $sum: 1 } } },
    ]);
    const byVendor = new Map<string, number>();
    for (const row of counts) {
      if (row._id) byVendor.set(normalizeVendorName(row._id), row.count);
    }

    res.json({
      data: vendors.map((v) => ({
        ...v,
        correctionCount: byVendor.get(v.normalizedName) ?? 0,
      })),
    });
  } catch (error) {
    fail(res, error, 'Failed to load vendors');
  }
};

/**
 * Registers a vendor, or adds another sample SKU to one already registered.
 *
 * Samples accumulate rather than replace: a vendor can legitimately use several
 * SKU formats, and the agent matches each row against whichever sample fits.
 */
export const upsertVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, skuSample, workspaceId } = req.body as {
      name?: unknown;
      skuSample?: unknown;
      workspaceId?: unknown;
    };

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ message: 'name is required' });
      return;
    }
    if (typeof workspaceId !== 'string' || !isValidObjectId(workspaceId)) {
      res.status(400).json({ message: 'A valid workspaceId is required' });
      return;
    }

    const sample = typeof skuSample === 'string' ? skuSample.trim() : '';
    const trimmedName = name.trim();

    const vendor = await DocTidyVendor.findOneAndUpdate(
      { workspaceId, normalizedName: normalizeVendorName(trimmedName) },
      {
        $set: { name: trimmedName, workspaceId },
        ...(sample ? { $addToSet: { skuSamples: sample } } : {}),
        $setOnInsert: {
          normalizedName: normalizeVendorName(trimmedName),
          createdByName: req.user?.name,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    // Clear vendorNeedsSetup on all existing parse jobs for this vendor within
    // the workspace, so previously-parsed emails no longer show the setup card.
    if (vendor) {
      // Resolve message IDs that belong to this workspace via its rules.
      const workspaceRules = await DocTidyRule
        .find({ workspaceId })
        .select('_id')
        .lean();
      const ruleIds = workspaceRules.map((r) => r._id);
      const messages = await DocTidyMessage.find({ ruleId: { $in: ruleIds } }).select('_id').lean();
      const messageIds = messages.map((m) => m._id);
      await DocTidyParseJob.updateMany(
        {
          messageId: { $in: messageIds },
          vendorName: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          vendorNeedsSetup: true,
        },
        { $set: { vendorNeedsSetup: false } }
      );
    }

    res.json({ data: vendor });
  } catch (error) {
    fail(res, error, 'Failed to save the vendor');
  }
};

export const removeVendorSample = async (req: Request, res: Response): Promise<void> => {
  try {
    const { skuSample, workspaceId } = req.body as { skuSample?: unknown; workspaceId?: unknown };
    if (typeof skuSample !== 'string' || !skuSample.trim()) {
      res.status(400).json({ message: 'skuSample is required' });
      return;
    }

    const normalizedName = normalizeVendorName(req.params.name);
    const sample = skuSample.trim();
    const wsFilter = typeof workspaceId === 'string' && isValidObjectId(workspaceId)
      ? { workspaceId }
      : {};

    await DocTidyVendor.updateOne({ ...wsFilter, normalizedName }, { $pull: { skuSamples: sample } });
    // Clear the legacy single field too, or the removed format keeps anchoring.
    await DocTidyVendor.updateOne(
      { ...wsFilter, normalizedName, skuSample: sample },
      { $set: { skuSample: null } }
    );

    const vendor = await DocTidyVendor.findOne({ ...wsFilter, normalizedName }).lean();
    if (!vendor) {
      res.status(404).json({ message: 'Vendor not found' });
      return;
    }

    res.json({ data: vendor });
  } catch (error) {
    fail(res, error, 'Failed to remove the sample SKU');
  }
};

/**
 * Deletes a vendor and everything it taught the agent.
 *
 * The cascade is the point: leaving corrections behind for a vendor nobody can
 * see any more means the agent keeps applying rules the user believes they
 * removed.
 */
export const deleteVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const normalizedName = normalizeVendorName(req.params.name);
    const { workspaceId } = req.query as Record<string, string | undefined>;
    const wsFilter = workspaceId && isValidObjectId(workspaceId) ? { workspaceId } : {};

    const vendor = await DocTidyVendor.findOneAndDelete({ ...wsFilter, normalizedName });
    if (!vendor) {
      res.status(404).json({ message: 'Vendor not found' });
      return;
    }

    // Corrections store the vendor name as it was written, so they are matched
    // on the normalised form rather than with an equality filter.
    const candidates = await DocTidyCorrection.find({ vendorName: { $ne: null } })
      .select('_id vendorName')
      .lean();
    const ids = candidates
      .filter((c) => c.vendorName && normalizeVendorName(c.vendorName) === normalizedName)
      .map((c) => c._id);

    let correctionsDeleted = 0;
    if (ids.length > 0) {
      const result = await DocTidyCorrection.deleteMany({ _id: { $in: ids } });
      correctionsDeleted = result.deletedCount ?? 0;
    }

    res.json({ data: { deleted: true, correctionsDeleted } });
  } catch (error) {
    fail(res, error, 'Failed to delete the vendor');
  }
};
