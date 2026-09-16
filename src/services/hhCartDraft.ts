import HHOrderGroup, {
  IHHChildOrder,
  IHHOrderGroup,
  rollupHhCartStatus,
  rollupHhDetailsStatus,
} from '../models/HHOrderGroup';
import { createHhB2bDraft, HhB2bDraftError, HhB2bDraftRequest } from '../lib/hhB2b';
import { HhB2bAuthError, loadHhB2bConfig, loadHhB2bCookie } from '../lib/hhB2bConfig';
import { fetchHhB2bOrderNumber, looksLikeMongoObjectId } from '../lib/hhB2bHellyHansen';
import { withHhGroupLock } from '../lib/hhGroupLock';

const LOG = '[hh-cart-draft]';
const MAX_ERROR_LEN = 1000;

export interface HhCartDraftRunResult {
  drafted: number;
  skipped: number;
  failed: number;
}

export interface HhCartDraftRuntime {
  running: boolean;
  currentGroupId: string | null;
  currentOrderId: string | null;
  queued: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastRun: HhCartDraftRunResult | null;
}

interface HhCartDraftJob {
  groupId: string;
  childId?: string;
}

const queue: HhCartDraftJob[] = [];
let draining = false;
let currentGroupId: string | null = null;
let currentOrderId: string | null = null;
let lastRunAt: Date | null = null;
let lastSuccessAt: Date | null = null;
let lastError: string | null = null;
let lastRun: HhCartDraftRunResult | null = null;

function jobLabel(job: HhCartDraftJob): string {
  return job.childId ? `${job.groupId} order ${job.childId}` : job.groupId;
}

function jobCovers(existing: HhCartDraftJob, incoming: HhCartDraftJob): boolean {
  if (existing.groupId !== incoming.groupId) return false;
  if (!existing.childId) return true;
  return existing.childId === incoming.childId;
}

function truncateError(message: string): string {
  if (message.length <= MAX_ERROR_LEN) return message;
  return `${message.slice(0, MAX_ERROR_LEN)}…`;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function getHhCartDraftRuntime(): HhCartDraftRuntime {
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

export async function countUndraftedHhOrders(): Promise<number> {
  const rows = await HHOrderGroup.aggregate<{ count: number }>([
    { $unwind: '$children' },
    {
      $match: {
        'children.detailsStatus': 'synced',
        $or: [{ 'children.cartStatus': 'none' }, { 'children.b2bDraftId': /^local:/ }],
      },
    },
    { $count: 'count' },
  ]);
  return rows[0]?.count ?? 0;
}

function applyGroupRollup(group: IHHOrderGroup): void {
  group.detailsStatus = rollupHhDetailsStatus(group.children.map((child) => child.detailsStatus));
  group.cartStatus = rollupHhCartStatus(group.children.map((child) => child.cartStatus));
}

function isLocalB2bDraft(child: IHHChildOrder): boolean {
  return (child.b2bDraftId ?? '').startsWith('local:');
}

function childNeedsDraft(child: IHHChildOrder): boolean {
  if (child.detailsStatus !== 'synced') return false;
  if ((child.items ?? []).length === 0) return false;
  if (child.cartStatus === 'none') return true;
  return child.cartStatus === 'draft' && isLocalB2bDraft(child);
}

function toDraftRequest(child: IHHChildOrder): HhB2bDraftRequest {
  return {
    amazonOrderId: child.orderId,
    po: child.po,
    address: {
      name: child.customerName ?? '',
      line1: child.addressLine1 ?? '',
      city: child.city ?? '',
      state: child.state ?? '',
      postalCode: child.postalCode ?? '',
      country: child.country || 'US',
      phone: child.customerPhone ?? '',
    },
    items: (child.items ?? []).map((item) => ({
      sku: item.sku,
      asin: item.asin ?? '',
      title: item.title,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
  };
}

async function persistDraft(
  groupId: string,
  childId: string,
  draftId: string,
  orderNumber: string
): Promise<IHHChildOrder | null> {
  return withHhGroupLock(groupId, async () => {
    const group = await HHOrderGroup.findById(groupId);
    if (!group) return null;
    const child = group.children.id(childId);
    if (!child) return null;
    if (child.detailsStatus !== 'synced') return child;
    if (child.cartStatus !== 'none' && !isLocalB2bDraft(child)) return child;
    if (!draftId || draftId.startsWith('local:')) return child;
    if (!orderNumber) return child;
    child.cartStatus = 'draft';
    child.b2bDraftId = draftId;
    child.referenceNumber = orderNumber;
    applyGroupRollup(group);
    group.markModified('children');
    await group.save();
    return child;
  });
}

function pickNextChild(
  group: IHHOrderGroup,
  job: HhCartDraftJob,
  attempted: Set<string>
): IHHChildOrder | undefined {
  return group.children.find((child) => {
    const id = String(child._id);
    if (attempted.has(id)) return false;
    if (job.childId && id !== job.childId) return false;
    return childNeedsDraft(child);
  });
}

async function draftChild(group: IHHOrderGroup, child: IHHChildOrder, run: HhCartDraftRunResult): Promise<void> {
  currentOrderId = child.orderId;
  const childId = String(child._id);
  const result = await createHhB2bDraft(toDraftRequest(child));
  const saved = await persistDraft(String(group._id), childId, result.draftId, result.orderNumber);
  if (!saved || saved.cartStatus !== 'draft') {
    run.skipped += 1;
    console.log(`${LOG} Skipped ${child.orderId} — no longer waiting for a cart`);
    return;
  }
  run.drafted += 1;
  lastSuccessAt = new Date();
  lastError = null;
  console.log(
    `${LOG} Drafted ${child.orderId}${result.remote ? '' : ' (local)'} · Order #${result.orderNumber}`
  );
}

async function draftGroup(job: HhCartDraftJob): Promise<void> {
  lastRunAt = new Date();
  const run: HhCartDraftRunResult = { drafted: 0, skipped: 0, failed: 0 };
  const attempted = new Set<string>();
  console.log(`${LOG} Drafting ${jobLabel(job)}`);

  while (true) {
    const group = await HHOrderGroup.findById(job.groupId);
    if (!group) {
      console.warn(`${LOG} Group ${job.groupId} was deleted before draft started`);
      lastRun = run;
      return;
    }

    const child = pickNextChild(group, job, attempted);
    if (!child) {
      if (attempted.size === 0) {
        console.log(`${LOG} Group ${job.groupId} has no orders waiting for a cart`);
      }
      break;
    }

    attempted.add(String(child._id));
    try {
      await draftChild(group, child, run);
    } catch (err) {
      run.failed += 1;
      lastError = truncateError(err instanceof Error ? err.message : String(err));
      if (err instanceof HhB2bDraftError) {
        console.warn(`${LOG} ${child.orderId} ${lastError}`);
      } else {
        console.error(`${LOG} ${child.orderId} failed: ${lastError}`);
      }
    }
  }

  lastRun = run;
  console.log(
    `${LOG} Group ${job.groupId} done — drafted ${run.drafted}, skipped ${run.skipped}, failed ${run.failed}`
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
        await draftGroup(job);
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

/** Replace stored ObjectIds in Reference Number with the B2B Order #. */
export async function repairHhB2bReferenceNumbers(): Promise<void> {
  const groups = await HHOrderGroup.find({
    children: {
      $elemMatch: {
        cartStatus: 'draft',
        b2bDraftId: { $exists: true, $nin: [null, ''] },
      },
    },
  });

  const targets = groups.flatMap((group) =>
    group.children.filter((child) => {
      if (child.cartStatus !== 'draft') return false;
      const documentId = (child.b2bDraftId ?? '').trim();
      if (!documentId || !looksLikeMongoObjectId(documentId)) return false;
      const reference = (child.referenceNumber ?? '').trim();
      return !reference || looksLikeMongoObjectId(reference);
    })
  );
  if (targets.length === 0) return;

  let config;
  let cookie;
  try {
    config = await loadHhB2bConfig();
    cookie = await loadHhB2bCookie();
  } catch (err) {
    if (err instanceof HhB2bAuthError) return;
    throw err;
  }

  let updated = 0;
  for (const group of groups) {
    let changed = false;
    for (const child of group.children) {
      if (child.cartStatus !== 'draft') continue;
      const documentId = (child.b2bDraftId ?? '').trim();
      if (!documentId || !looksLikeMongoObjectId(documentId)) continue;
      const reference = (child.referenceNumber ?? '').trim();
      if (reference && !looksLikeMongoObjectId(reference)) continue;
      try {
        const orderNumber = await fetchHhB2bOrderNumber(config, cookie, documentId);
        if (!orderNumber || orderNumber === child.referenceNumber) continue;
        child.referenceNumber = orderNumber;
        changed = true;
        updated += 1;
      } catch (err) {
        console.warn(
          `${LOG} Could not load Order # for ${child.orderId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    if (!changed) continue;
    group.markModified('children');
    await group.save();
  }

  if (updated > 0) {
    console.log(`${LOG} Filled ${updated} B2B Order # into Reference Number`);
  }
}

/** Starts drafting carts for synced Order IDs that still have Cart —. Safe after the HTTP response. */
export function enqueueHhCartDraft(groupId: string, childId?: string): void {
  if (!groupId) return;
  const job: HhCartDraftJob = { groupId, childId };

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
