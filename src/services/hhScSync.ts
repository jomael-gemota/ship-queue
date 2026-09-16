import HHOrderGroup, {
  HHDetailsStatus,
  IHHChildOrder,
  IHHOrderGroup,
  rollupHhCartStatus,
  rollupHhDetailsStatus,
} from '../models/HHOrderGroup';
import {
  HhScAuthError,
  HhScNotFoundError,
  HhScRateLimitError,
  fetchScBuyerInfo,
  fetchScOrder,
  loadSellerCentralCookie,
} from '../lib/hhSellerCentral';
import { HhScFill, mapScFill } from '../lib/hhScDetails';

const LOG = '[hh-sc-sync]';
const MAX_ERROR_LEN = 1000;

export interface HhScSyncRunResult {
  synced: number;
  flagged: number;
  failed: number;
}

export interface HhScSyncRuntime {
  running: boolean;
  currentGroupId: string | null;
  currentOrderId: string | null;
  queuedGroups: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastRun: HhScSyncRunResult | null;
}

interface HhScSyncJob {
  groupId: string;
  childId?: string;
}

const queue: HhScSyncJob[] = [];
let draining = false;
let currentGroupId: string | null = null;
let currentOrderId: string | null = null;
let lastRunAt: Date | null = null;
let lastSuccessAt: Date | null = null;
let lastError: string | null = null;
let lastRun: HhScSyncRunResult | null = null;

function jobLabel(job: HhScSyncJob): string {
  return job.childId ? `${job.groupId} order ${job.childId}` : job.groupId;
}

function jobCovers(existing: HhScSyncJob, incoming: HhScSyncJob): boolean {
  if (existing.groupId !== incoming.groupId) return false;
  if (!existing.childId) return true;
  return existing.childId === incoming.childId;
}

const EMPTY_FILL: HhScFill = {
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'US',
  items: [],
  sellerNotes: '',
};

function truncateError(message: string): string {
  if (message.length <= MAX_ERROR_LEN) return message;
  return `${message.slice(0, MAX_ERROR_LEN)}…`;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function getHhScSyncRuntime(): HhScSyncRuntime {
  return {
    running: draining,
    currentGroupId,
    currentOrderId,
    queuedGroups: queue.length,
    lastRunAt: iso(lastRunAt),
    lastSuccessAt: iso(lastSuccessAt),
    lastError,
    lastRun,
  };
}

export async function countUnsyncedHhOrders(): Promise<number> {
  const rows = await HHOrderGroup.aggregate<{ count: number }>([
    { $unwind: '$children' },
    { $match: { 'children.detailsStatus': 'pending' } },
    { $count: 'count' },
  ]);
  return rows[0]?.count ?? 0;
}

function applyFill(child: IHHChildOrder, fill: HhScFill, detailsStatus: HHDetailsStatus): void {
  child.customerName = fill.customerName;
  child.customerEmail = fill.customerEmail;
  child.customerPhone = fill.customerPhone;
  child.addressLine1 = fill.addressLine1;
  child.addressLine2 = fill.addressLine2;
  child.city = fill.city;
  child.state = fill.state;
  child.postalCode = fill.postalCode;
  child.country = fill.country || 'US';
  const items = child.items as unknown as { splice: (start: number, del: number, ...rest: HhScFill['items']) => void };
  items.splice(0, (child.items as unknown[]).length, ...fill.items);
  child.detailsStatus = detailsStatus;
}

function applyGroupRollup(group: IHHOrderGroup): void {
  group.detailsStatus = rollupHhDetailsStatus(group.children.map((child) => child.detailsStatus));
  group.cartStatus = rollupHhCartStatus(group.children.map((child) => child.cartStatus));
}

async function persistChild(group: IHHOrderGroup): Promise<void> {
  applyGroupRollup(group);
  group.markModified('children');
  await group.save();
}

class StopGroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StopGroupError';
  }
}

function childNeedsFill(child: IHHChildOrder): boolean {
  if (child.detailsStatus === 'pending') return true;
  if (child.detailsStatus === 'failed') return false;
  return (child.items ?? []).some((item) => item.imageUrl == null || typeof item.tax !== 'number');
}

async function fillChild(group: IHHOrderGroup, child: IHHChildOrder, cookie: string, run: HhScSyncRunResult): Promise<void> {
  currentOrderId = child.orderId;
  const scOrder = await fetchScOrder(child.orderId, cookie);
  if (scOrder.sellerNotes && scOrder.sellerNotes !== child.po) {
    console.warn(
      `${LOG} ${child.orderId} sellerNotes "${scOrder.sellerNotes}" does not match spreadsheet PO "${child.po}"`
    );
  }

  if (!scOrder.blob) {
    if (child.detailsStatus !== 'pending') {
      console.warn(`${LOG} Skipped ${child.orderId} — missing order.blob on refresh`);
      return;
    }
    applyFill(child, mapScFill(scOrder, null), 'failed');
    await persistChild(group);
    run.flagged += 1;
    console.warn(`${LOG} Failed ${child.orderId} — missing order.blob`);
    return;
  }

  const buyer = await fetchScBuyerInfo(child.orderId, scOrder.blob, cookie);
  applyFill(child, mapScFill(scOrder, buyer), 'synced');
  await persistChild(group);
  run.synced += 1;
  lastSuccessAt = new Date();
  lastError = null;
  console.log(`${LOG} Synced ${child.orderId} (${child.items.length} item${child.items.length === 1 ? '' : 's'})`);
}

function pickNextChild(group: IHHOrderGroup, job: HhScSyncJob, attempted: Set<string>): IHHChildOrder | undefined {
  return group.children.find((child) => {
    const id = String(child._id);
    if (attempted.has(id)) return false;
    if (job.childId && id !== job.childId) return false;
    return childNeedsFill(child);
  });
}

async function fillGroup(job: HhScSyncJob): Promise<void> {
  lastRunAt = new Date();
  const run: HhScSyncRunResult = { synced: 0, flagged: 0, failed: 0 };
  let cookie: string;
  try {
    cookie = await loadSellerCentralCookie();
  } catch (err) {
    lastError = truncateError(err instanceof Error ? err.message : String(err));
    console.warn(`${LOG} ${lastError}`);
    lastRun = run;
    return;
  }

  const attempted = new Set<string>();
  console.log(`${LOG} Filling ${jobLabel(job)}`);

  try {
    while (true) {
      const group = await HHOrderGroup.findById(job.groupId);
      if (!group) {
        console.warn(`${LOG} Group ${job.groupId} was deleted before fill started`);
        return;
      }

      const child = pickNextChild(group, job, attempted);
      if (!child) {
        if (attempted.size === 0) {
          console.log(`${LOG} Group ${job.groupId} has no orders to fill`);
        }
        break;
      }

      attempted.add(String(child._id));
      try {
        await fillChild(group, child, cookie, run);
      } catch (err) {
        if (err instanceof HhScAuthError || err instanceof HhScRateLimitError) {
          throw new StopGroupError(err.message);
        }
        if (err instanceof HhScNotFoundError) {
          if (child.detailsStatus !== 'pending') {
            console.warn(`${LOG} Skipped ${child.orderId} — ${err.message}`);
            continue;
          }
          applyFill(child, { ...EMPTY_FILL, country: child.country || 'US' }, 'failed');
          await persistChild(group);
          run.flagged += 1;
          lastError = truncateError(`${child.orderId}: ${err.message}`);
          console.warn(`${LOG} Failed ${child.orderId} — ${err.message}`);
          continue;
        }
        run.failed += 1;
        lastError = truncateError(err instanceof Error ? err.message : String(err));
        console.error(`${LOG} ${child.orderId} failed: ${lastError}`);
      }
    }
  } catch (err) {
    lastError = truncateError(err instanceof Error ? err.message : String(err));
    console.warn(`${LOG} Stopped group ${job.groupId}: ${lastError}`);
  }

  lastRun = run;
  console.log(
    `${LOG} Group ${job.groupId} done — synced ${run.synced}, flagged ${run.flagged}, failed ${run.failed}`
  );
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) break;
      currentGroupId = job.groupId;
      currentOrderId = null;
      try {
        await fillGroup(job);
      } catch (err) {
        lastError = truncateError(err instanceof Error ? err.message : String(err));
        console.error(`${LOG} Group ${job.groupId} failed: ${lastError}`);
      }
    }
  } finally {
    currentGroupId = null;
    currentOrderId = null;
    draining = false;
    if (queue.length > 0) void drainQueue();
  }
}

/** Starts filling pending (and image/tax backfill) Order IDs. Safe to call after the HTTP response. */
export function enqueueHhGroupScSync(groupId: string, childId?: string): void {
  if (!groupId) return;
  const job: HhScSyncJob = { groupId, childId };

  if (queue.some((queued) => jobCovers(queued, job))) {
    console.log(`${LOG} Group ${jobLabel(job)} is already queued`);
    return;
  }

  if (!job.childId) {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].groupId === job.groupId) queue.splice(i, 1);
    }
  }

  queue.push(job);
  console.log(`${LOG} Queued ${jobLabel(job)} (${queue.length} waiting)`);
  void drainQueue();
}
