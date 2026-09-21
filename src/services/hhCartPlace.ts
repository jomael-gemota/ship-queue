import HHOrderGroup, {
  IHHChildOrder,
  IHHOrderGroup,
  rollupHhCartStatus,
  rollupHhDetailsStatus,
} from '../models/HHOrderGroup';
import { HhB2bAuthError, HhB2bDraftError, isHhPlaceOrderEnabled, loadHhB2bConfig, loadHhB2bCookie } from '../lib/hhB2bConfig';
import { hhBrandId } from '../lib/hhBrand';
import { looksLikeMongoObjectId, submitHellyHansenSportsOrder } from '../lib/hhB2bHellyHansen';
import { childCanPlace, liveCompareHhCarts } from './hhCartVerify';
import { withHhGroupLock } from '../lib/hhGroupLock';

const LOG = '[hh-cart-place]';
const MAX_ERROR_LEN = 1000;

export interface HhCartPlaceRunResult {
  placed: number;
  preview: number;
  skipped: number;
  failed: number;
}

export interface HhCartPlaceRuntime {
  running: boolean;
  currentGroupId: string | null;
  currentOrderId: string | null;
  queued: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastRun: HhCartPlaceRunResult | null;
}

interface HhCartPlaceJob {
  groupId: string;
  childId?: string;
}

const queue: HhCartPlaceJob[] = [];
let draining = false;
let currentGroupId: string | null = null;
let currentOrderId: string | null = null;
let lastRunAt: Date | null = null;
let lastSuccessAt: Date | null = null;
let lastError: string | null = null;
let lastRun: HhCartPlaceRunResult | null = null;

function truncateError(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= MAX_ERROR_LEN) return trimmed;
  return `${trimmed.slice(0, MAX_ERROR_LEN)}…`;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function jobLabel(job: HhCartPlaceJob): string {
  return job.childId ? `${job.groupId} order ${job.childId}` : job.groupId;
}

function jobCovers(existing: HhCartPlaceJob, incoming: HhCartPlaceJob): boolean {
  if (existing.groupId !== incoming.groupId) return false;
  if (!existing.childId) return true;
  return existing.childId === incoming.childId;
}

function applyGroupRollup(group: IHHOrderGroup): void {
  group.detailsStatus = rollupHhDetailsStatus(group.children.map((child) => child.detailsStatus));
  group.cartStatus = rollupHhCartStatus(group.children.map((child) => child.cartStatus));
}

export function getHhCartPlaceRuntime(): HhCartPlaceRuntime {
  return {
    running: draining,
    currentGroupId,
    currentOrderId,
    queued: queue.length,
    lastRunAt: iso(lastRunAt),
    lastSuccessAt: iso(lastSuccessAt),
    lastError,
    lastRun,
  };
}

async function persistPlaced(groupId: string, childId: string): Promise<IHHChildOrder | null> {
  return withHhGroupLock(groupId, async () => {
    const group = await HHOrderGroup.findById(groupId);
    if (!group) return null;
    const child = group.children.id(childId);
    if (!child) return null;
    if (child.cartStatus !== 'ready') return child;
    child.cartStatus = 'placed';
    child.placeError = '';
    applyGroupRollup(group);
    group.markModified('children');
    await group.save();
    return child;
  });
}

async function persistPlaceError(groupId: string, childId: string, message: string): Promise<void> {
  await withHhGroupLock(groupId, async () => {
    const group = await HHOrderGroup.findById(groupId);
    if (!group) return;
    const child = group.children.id(childId);
    if (!child) return;
    if (child.cartStatus === 'placed') return;
    child.placeError = truncateError(message);
    group.markModified('children');
    await group.save();
  });
}

function pickNextChild(
  group: IHHOrderGroup,
  job: HhCartPlaceJob,
  attempted: Set<string>
): IHHChildOrder | undefined {
  return group.children.find((child) => {
    const id = String(child._id);
    if (attempted.has(id)) return false;
    if (job.childId && id !== job.childId) return false;
    return childCanPlace(child);
  });
}

async function placeChild(group: IHHOrderGroup, child: IHHChildOrder, run: HhCartPlaceRunResult): Promise<void> {
  currentOrderId = child.orderId;
  const childId = String(child._id);
  const [compare] = await liveCompareHhCarts(String(group._id), childId);
  if (!compare || !compare.canPlace || compare.cartStatus !== 'ready') {
    run.skipped += 1;
    console.log(`${LOG} Skipped ${child.orderId} — not Ready after live check`);
    return;
  }

  const brand = hhBrandId(group.brand);
  const enabled = await isHhPlaceOrderEnabled(brand);
  if (!enabled) {
    run.preview += 1;
    lastSuccessAt = new Date();
    lastError = null;
    console.log(`${LOG} Place Order is off — re-checked ${child.orderId}, did not submit`);
    return;
  }

  const documentId = (child.b2bDraftId ?? '').trim();
  if (!documentId || !looksLikeMongoObjectId(documentId) || documentId.startsWith('local:')) {
    run.skipped += 1;
    console.log(`${LOG} Skipped ${child.orderId} — no live B2B document`);
    return;
  }

  const config = await loadHhB2bConfig(brand);
  const cookie = await loadHhB2bCookie(brand);
  await submitHellyHansenSportsOrder(config, cookie, documentId);
  const saved = await persistPlaced(String(group._id), childId);
  if (!saved || saved.cartStatus !== 'placed') {
    run.skipped += 1;
    console.log(`${LOG} Skipped ${child.orderId} — no longer Ready when marking Placed`);
    return;
  }
  run.placed += 1;
  lastSuccessAt = new Date();
  lastError = null;
  console.log(`${LOG} Placed ${child.orderId}`);
}

async function placeGroup(job: HhCartPlaceJob): Promise<void> {
  lastRunAt = new Date();
  const run: HhCartPlaceRunResult = { placed: 0, preview: 0, skipped: 0, failed: 0 };
  const attempted = new Set<string>();
  console.log(`${LOG} Placing ${jobLabel(job)}`);

  while (true) {
    const group = await HHOrderGroup.findById(job.groupId);
    if (!group) {
      console.warn(`${LOG} Group ${job.groupId} was deleted before place started`);
      lastRun = run;
      return;
    }

    const child = pickNextChild(group, job, attempted);
    if (!child) {
      if (attempted.size === 0) {
        console.log(`${LOG} Group ${job.groupId} has no Ready orders to place`);
      }
      break;
    }

    attempted.add(String(child._id));
    try {
      await placeChild(group, child, run);
    } catch (err) {
      run.failed += 1;
      lastError = truncateError(err instanceof Error ? err.message : String(err));
      await persistPlaceError(String(group._id), String(child._id), lastError);
      if (err instanceof HhB2bAuthError || err instanceof HhB2bDraftError) {
        console.warn(`${LOG} ${child.orderId} ${lastError}`);
      } else {
        console.error(`${LOG} ${child.orderId} failed: ${lastError}`);
      }
    }
  }

  lastRun = run;
  console.log(
    `${LOG} Group ${job.groupId} done — placed ${run.placed}, preview ${run.preview}, skipped ${run.skipped}, failed ${run.failed}`
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
        await placeGroup(job);
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

/** Live-rechecks Ready orders, then submits only if Place Order is enabled in Configurations. */
export function enqueueHhCartPlace(groupId: string, childId?: string): void {
  if (!groupId) return;
  const job: HhCartPlaceJob = { groupId, childId };

  if (queue.some((queued) => jobCovers(queued, job))) {
    console.log(`${LOG} ${jobLabel(job)} is already queued`);
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
