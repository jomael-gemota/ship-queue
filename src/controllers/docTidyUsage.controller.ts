import { Request, Response } from 'express';
import { Types, isValidObjectId } from 'mongoose';
import DocTidyUsageEvent from '../models/DocTidyUsageEvent';
import DocTidyModelPrice, { SERVICE_TIERS, type ServiceTier } from '../models/DocTidyModelPrice';
import DocTidyWorkspace from '../models/DocTidyWorkspace';
import DocTidyOrganization from '../models/DocTidyOrganization';
import DocTidyBilledRemainder from '../models/DocTidyBilledRemainder';
import { invalidatePriceCache, repriceRange } from '../services/docTidyUsage.service';
import { lastTrueUp, runTrueUp } from '../services/docTidyTrueUp.service';
import {
  DAY_MS,
  OpenAIAdminError,
  adminKey,
  fetchDailyCosts,
  usageApiKeyIds,
} from '../lib/openaiAdmin';

/**
 * Admin-only token usage & cost reporting. Every route here is mounted behind
 * `requireAdmin`. See design-log/2026-10-10-doc-tidy-token-usage-and-cost-dashboard.md.
 */

function fail(res: Response, error: unknown, fallback: string): void {
  res.status(500).json({ message: fallback, error: (error as Error).message });
}

const MAX_RANGE_DAYS = 180;

/** `from` inclusive, `to` exclusive; defaults to the last 30 days. */
function parseRange(input: Record<string, unknown>): { from: Date; to: Date } | null {
  const to = typeof input.to === 'string' ? new Date(input.to) : new Date();
  const from =
    typeof input.from === 'string' ? new Date(input.from) : new Date(to.getTime() - 30 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return null;
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) return null;
  return { from, to };
}

const TOKEN_SUMS = {
  costUsd: { $sum: '$costUsd' },
  estimatedCostUsd: { $sum: { $cond: [{ $eq: ['$costBasis', 'estimated'] }, '$costUsd', 0] } },
  inputTokens: { $sum: '$inputTokens' },
  cachedInputTokens: { $sum: '$cachedInputTokens' },
  cacheWriteTokens: { $sum: '$cacheWriteTokens' },
  outputTokens: { $sum: '$outputTokens' },
  reasoningTokens: { $sum: '$reasoningTokens' },
  calls: { $sum: 1 },
  unpricedCalls: { $sum: { $cond: ['$priced', 0, 1] } },
  missingUsageCalls: { $sum: { $cond: [{ $eq: ['$usageSource', 'missing'] }, 1, 0] } },
};

interface Sums {
  costUsd: number;
  /** The part of `costUsd` that is a calibrated estimate, not yet trued up. */
  estimatedCostUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  calls: number;
  unpricedCalls: number;
  missingUsageCalls: number;
  jobs: number;
}

const zeroSums = (): Sums => ({
  costUsd: 0,
  estimatedCostUsd: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  calls: 0,
  unpricedCalls: 0,
  missingUsageCalls: 0,
  jobs: 0,
});

const SUM_KEYS = Object.keys(zeroSums()) as Array<keyof Sums>;

/** Only the numeric keys: `target` is often an org row that also carries a name
 *  and its workspace list. */
function addSums(target: Sums, source: Sums): void {
  for (const key of SUM_KEYS) target[key] += source[key];
}

/* ------------------------------------------------------------- summary */

/**
 * Totals, organization → workspace rollup, purpose/model breakdown and daily
 * trend for one range, in a single response so the dashboard refetches once
 * per live hint. Every organization and workspace is listed, even at zero.
 */
export const getUsageSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req.query);
    if (!range) {
      res.status(400).json({ message: `Invalid range (max ${MAX_RANGE_DAYS} days)` });
      return;
    }
    const match = { $match: { createdAt: { $gte: range.from, $lt: range.to } } };

    const [byWorkspace, totalsRows, breakdown, daily, organizations, workspaces, remainders] =
      await Promise.all([
        DocTidyUsageEvent.aggregate([
          match,
          { $group: { _id: '$workspaceId', ...TOKEN_SUMS, jobIds: { $addToSet: '$jobId' } } },
        ]),
        DocTidyUsageEvent.aggregate([
          match,
          { $group: { _id: null, jobIds: { $addToSet: '$jobId' } } },
        ]),
        DocTidyUsageEvent.aggregate([
          match,
          {
            $group: {
              _id: {
                purpose: '$purpose',
                provider: '$provider',
                model: '$model',
                serviceTier: '$serviceTier',
                priced: '$priced',
              },
              ...TOKEN_SUMS,
            },
          },
          { $sort: { costUsd: -1 } },
        ]),
        DocTidyUsageEvent.aggregate([
          match,
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
              costUsd: { $sum: '$costUsd' },
              tokens: { $sum: { $add: ['$inputTokens', '$outputTokens'] } },
              calls: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        DocTidyOrganization.find({}).select('name').sort({ name: 1 }).lean(),
        DocTidyWorkspace.find({}).select('name organizationId').sort({ name: 1 }).lean(),
        DocTidyBilledRemainder.find({
          day: { $gte: new Date(Math.floor(range.from.getTime() / DAY_MS) * DAY_MS), $lt: range.to },
          untrackedUsd: { $gt: 0 },
        }).lean(),
      ]);

    const usageByWorkspace = new Map<string, Sums>();
    for (const { _id, jobIds, ...sums } of byWorkspace) {
      const jobs = (jobIds as Array<Types.ObjectId | null>).filter(Boolean).length;
      usageByWorkspace.set(_id ? String(_id) : 'none', { ...(sums as Omit<Sums, 'jobs'>), jobs });
    }

    const orgName = new Map(organizations.map((o) => [String(o._id), o.name]));
    type WorkspaceRow = Sums & {
      workspaceId: string | null;
      name: string;
      deleted?: boolean;
      untracked?: boolean;
    };
    type OrgRow = Sums & { organizationId: string | null; name: string; workspaces: WorkspaceRow[] };

    const orgRows = new Map<string, OrgRow>();
    const orgRow = (id: string | null, name: string): OrgRow => {
      const key = id ?? 'unassigned';
      let row = orgRows.get(key);
      if (!row) {
        row = { organizationId: id, name, workspaces: [], ...zeroSums() };
        orgRows.set(key, row);
      }
      return row;
    };
    for (const org of organizations) orgRow(String(org._id), org.name);

    const known = new Set<string>();
    for (const ws of workspaces) {
      const id = String(ws._id);
      known.add(id);
      const orgId = ws.organizationId && orgName.has(ws.organizationId) ? ws.organizationId : null;
      const target = orgId ? orgRow(orgId, orgName.get(orgId)!) : orgRow(null, 'Unassigned');
      const sums = usageByWorkspace.get(id) ?? zeroSums();
      target.workspaces.push({ workspaceId: id, name: ws.name, ...sums });
      addSums(target, sums);
    }

    // Usage whose workspace has since been deleted, or that never had one.
    for (const [id, sums] of usageByWorkspace) {
      if (known.has(id)) continue;
      const target = orgRow(null, 'Unassigned');
      target.workspaces.push(
        id === 'none'
          ? { workspaceId: null, name: 'No workspace', ...sums }
          : { workspaceId: id, name: 'Deleted workspace', deleted: true, ...sums }
      );
      addSums(target, sums);
    }

    // Billed spend the true-up couldn't match to any tracked call. A day is
    // counted whole when the range starts mid-day, as the bill is per day.
    const untrackedUsd = remainders.reduce((sum, r) => sum + r.untrackedUsd, 0);
    if (untrackedUsd > 0) {
      const target = orgRow(null, 'Unassigned');
      const sums = { ...zeroSums(), costUsd: untrackedUsd };
      target.workspaces.push({ workspaceId: null, name: 'Untracked Hermes usage', untracked: true, ...sums });
      addSums(target, sums);
    }

    const totals = zeroSums();
    for (const sums of usageByWorkspace.values()) addSums(totals, sums);
    totals.costUsd += untrackedUsd;
    totals.jobs = ((totalsRows[0]?.jobIds ?? []) as Array<Types.ObjectId | null>).filter(Boolean).length;

    const dailyRows = daily.map(({ _id, ...rest }) => ({ date: _id as string, untrackedUsd: 0, ...rest }));
    for (const remainder of remainders) {
      const date = remainder.day.toISOString().slice(0, 10);
      let row = dailyRows.find((d) => d.date === date);
      if (!row) {
        row = { date, untrackedUsd: 0, costUsd: 0, tokens: 0, calls: 0 };
        dailyRows.push(row);
      }
      row.untrackedUsd += remainder.untrackedUsd;
      row.costUsd += remainder.untrackedUsd;
    }
    dailyRows.sort((a, b) => a.date.localeCompare(b.date));

    const orgList = [...orgRows.values()]
      .map((org) => ({ ...org, workspaces: org.workspaces.sort((a, b) => b.costUsd - a.costUsd) }))
      .sort((a, b) =>
        a.organizationId === null ? 1 : b.organizationId === null ? -1 : b.costUsd - a.costUsd
      );

    res.json({
      data: {
        range: { from: range.from.toISOString(), to: range.to.toISOString() },
        totals,
        organizations: orgList,
        breakdown: breakdown.map(({ _id, ...sums }) => ({ ..._id, ...sums })),
        daily: dailyRows,
        untrackedUsd,
      },
    });
  } catch (error) {
    fail(res, error, 'Failed to load token usage');
  }
};

/* -------------------------------------------------------------- prices */

const RATE_FIELDS = [
  'inputPer1M',
  'cachedInputPer1M',
  'cacheWritePer1M',
  'outputPer1M',
  'longContextThreshold',
  'longInputPer1M',
  'longCachedInputPer1M',
  'longCacheWritePer1M',
  'longOutputPer1M',
] as const;

type PriceBody = Partial<Record<(typeof RATE_FIELDS)[number], number | null>> & {
  model?: string;
  serviceTier?: ServiceTier;
  upstreamModel?: string | null;
  notes?: string;
};

/** Validates and normalises a price body; returns an error message on failure. */
function readPriceBody(body: Record<string, unknown>, requireAll: boolean): PriceBody | string {
  const out: PriceBody = {};

  if (body.model !== undefined || requireAll) {
    if (typeof body.model !== 'string' || !body.model.trim()) return 'model is required';
    out.model = body.model.trim();
  }
  if (body.serviceTier !== undefined) {
    if (!SERVICE_TIERS.includes(body.serviceTier as ServiceTier)) return 'Invalid serviceTier';
    out.serviceTier = body.serviceTier as ServiceTier;
  }
  for (const field of RATE_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (value === null || value === '') {
      if (field === 'inputPer1M') return 'inputPer1M is required';
      out[field] = null;
      continue;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return `${field} must be a non-negative number`;
    out[field] = n;
  }
  if (requireAll && out.inputPer1M === undefined) return 'inputPer1M is required';
  if (body.upstreamModel !== undefined) {
    if (body.upstreamModel !== null && typeof body.upstreamModel !== 'string') {
      return 'upstreamModel must be a string';
    }
    out.upstreamModel = (body.upstreamModel as string | null)?.trim() || null;
  }
  if (typeof body.notes === 'string') out.notes = body.notes.trim();
  return out;
}

export const listPrices = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await DocTidyModelPrice.find({}).sort({ model: 1, serviceTier: 1 }).lean();
    res.json({ data });
  } catch (error) {
    fail(res, error, 'Failed to load prices');
  }
};

export const createPrice = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = readPriceBody(req.body ?? {}, true);
    if (typeof body === 'string') {
      res.status(400).json({ message: body });
      return;
    }
    const exists = await DocTidyModelPrice.exists({
      model: body.model,
      serviceTier: body.serviceTier ?? 'standard',
    });
    if (exists) {
      res.status(409).json({ message: 'A price for this model and tier already exists' });
      return;
    }
    const data = await DocTidyModelPrice.create({ ...body, updatedByName: req.user?.name });
    invalidatePriceCache();
    res.status(201).json({ data });
  } catch (error) {
    fail(res, error, 'Failed to create price');
  }
};

export const updatePrice = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isValidObjectId(req.params.id)) {
      res.status(400).json({ message: 'Invalid price id' });
      return;
    }
    const body = readPriceBody(req.body ?? {}, false);
    if (typeof body === 'string') {
      res.status(400).json({ message: body });
      return;
    }
    const data = await DocTidyModelPrice.findByIdAndUpdate(
      req.params.id,
      { $set: { ...body, updatedByName: req.user?.name } },
      { new: true, runValidators: true }
    ).lean();
    if (!data) {
      res.status(404).json({ message: 'Price not found' });
      return;
    }
    invalidatePriceCache();
    res.json({ data });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      res.status(409).json({ message: 'A price for this model and tier already exists' });
      return;
    }
    fail(res, error, 'Failed to update price');
  }
};

export const deletePrice = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isValidObjectId(req.params.id)) {
      res.status(400).json({ message: 'Invalid price id' });
      return;
    }
    await DocTidyModelPrice.findByIdAndDelete(req.params.id);
    invalidatePriceCache();
    res.json({ data: { deleted: true } });
  } catch (error) {
    fail(res, error, 'Failed to delete price');
  }
};

/** Re-applies the current price table to every event in the range. */
export const repriceUsage = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req.body ?? {});
    if (!range) {
      res.status(400).json({ message: `Invalid range (max ${MAX_RANGE_DAYS} days)` });
      return;
    }
    const updated = await repriceRange(range.from, range.to);
    res.json({ data: { updated } });
  } catch (error) {
    fail(res, error, 'Failed to re-price usage');
  }
};

/* ------------------------------------------------------- reconciliation */

const RECONCILE_TTL_MS = 10 * 60_000;
const reconcileCache = new Map<string, { at: number; body: Record<string, unknown> }>();

/** Calibration state changes on every true-up, so it is never cached. */
async function calibrationState() {
  const aliases = await DocTidyModelPrice.find({ upstreamModel: { $nin: [null, ''] } })
    .select('model upstreamModel calibrationFactor calibratedAt')
    .lean();
  return {
    calibrations: aliases.map((a) => ({
      model: a.model,
      upstreamModel: a.upstreamModel,
      calibrationFactor: a.calibrationFactor ?? null,
      calibratedAt: a.calibratedAt ?? null,
    })),
    lastTrueUp: lastTrueUp(),
  };
}

/**
 * OpenAI's own billed cost (Costs API, admin key) next to what we recorded over
 * the same whole UTC days. Hermes calls are included: its upstream calls bill
 * to the same key. The Costs API only has daily buckets, so the range is
 * widened to day boundaries on both sides.
 */
export const getReconciliation = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!adminKey()) {
      res.json({ data: { configured: false } });
      return;
    }
    const range = parseRange(req.query);
    if (!range) {
      res.status(400).json({ message: `Invalid range (max ${MAX_RANGE_DAYS} days)` });
      return;
    }

    const startMs = Math.floor(range.from.getTime() / DAY_MS) * DAY_MS;
    const endMs = Math.ceil(range.to.getTime() / DAY_MS) * DAY_MS;
    const cacheKey = `${startMs}:${endMs}`;
    const cached = reconcileCache.get(cacheKey);
    if (cached && Date.now() - cached.at < RECONCILE_TTL_MS && req.query.refresh !== '1') {
      res.json({ data: { ...cached.body, ...(await calibrationState()) } });
      return;
    }

    const lines = await fetchDailyCosts(startMs, endMs);
    const lineItems = new Map<string, number>();
    let billedUsd = 0;
    for (const line of lines) {
      billedUsd += line.amount;
      lineItems.set(line.lineItem, (lineItems.get(line.lineItem) ?? 0) + line.amount);
    }

    const window = { $gte: new Date(startMs), $lt: new Date(endMs) };
    const [[recorded], [untracked]] = await Promise.all([
      DocTidyUsageEvent.aggregate([
        { $match: { createdAt: window } },
        { $group: { _id: null, costUsd: { $sum: '$costUsd' }, calls: { $sum: 1 } } },
      ]),
      DocTidyBilledRemainder.aggregate([
        { $match: { day: window } },
        { $group: { _id: null, untrackedUsd: { $sum: '$untrackedUsd' } } },
      ]),
    ]);

    const result = {
      configured: true,
      filteredByApiKey: usageApiKeyIds().length > 0,
      from: new Date(startMs).toISOString(),
      to: new Date(endMs).toISOString(),
      currency: lines[0]?.currency ?? 'usd',
      billedUsd,
      recordedUsd: (recorded?.costUsd ?? 0) + (untracked?.untrackedUsd ?? 0),
      untrackedUsd: untracked?.untrackedUsd ?? 0,
      recordedCalls: recorded?.calls ?? 0,
      lineItems: [...lineItems.entries()]
        .map(([lineItem, amount]) => ({ lineItem, amount }))
        .sort((a, b) => b.amount - a.amount),
      fetchedAt: new Date().toISOString(),
    };
    reconcileCache.set(cacheKey, { at: Date.now(), body: result });
    res.json({ data: { ...result, ...(await calibrationState()) } });
  } catch (error) {
    if (error instanceof OpenAIAdminError) {
      res.status(502).json({ message: error.message, error: error.body });
      return;
    }
    fail(res, error, 'Failed to reconcile with OpenAI');
  }
};

/** Recalibrates alias models and trues up the last 7 complete UTC days. */
export const trueUpUsage = async (_req: Request, res: Response): Promise<void> => {
  try {
    if (!adminKey()) {
      res.status(400).json({ message: 'OPENAI_ADMIN_KEY is not set' });
      return;
    }
    const result = await runTrueUp();
    reconcileCache.clear();
    if (result.error) {
      res.status(502).json({ message: 'True-up failed', error: result.error });
      return;
    }
    res.json({ data: result });
  } catch (error) {
    fail(res, error, 'Failed to true up usage');
  }
};

