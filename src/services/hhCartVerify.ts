import HHOrderGroup, {
  IHHChildOrder,
  IHHOrderGroup,
  rollupHhCartStatus,
  rollupHhDetailsStatus,
} from '../models/HHOrderGroup';
import { HhB2bAuthError, loadHhB2bConfig, loadHhB2bCookie } from '../lib/hhB2bConfig';
import { hhBrandId, isOrderDetailsDraftId } from '../lib/hhBrand';
import { fetchHhB2bDocument, looksLikeMongoObjectId } from '../lib/hhB2bHellyHansen';
import {
  alignResolvedThorogoodSnapshots,
  fetchThorogoodOrder,
  isEnvoyOrderCode,
  snapshotFromThorogoodOrder,
} from '../lib/hhB2bThorogood';
import { thorogoodPortalSku } from '../lib/hhThorogoodSku';
import { hhCartItems } from '../lib/hhLineItems';
import {
  compareSnapshots,
  issuesFromCompareRows,
  snapshotFromB2bDocument,
  snapshotFromChild,
  snapshotFromChildCartSkus,
  snapshotRespectingCartSkus,
  type HhCompareRow,
  type HhVerifyIssue,
  type HhVerifySnapshot,
} from '../lib/hhB2bVerify';
import { withHhGroupLock } from '../lib/hhGroupLock';

const LOG = '[hh-cart-verify]';

interface HhCartVerifyJob {
  groupId: string;
  childId?: string;
}

const queue: HhCartVerifyJob[] = [];
let draining = false;
let verifyCurrentGroupId: string | null = null;
let verifyCurrentOrderId: string | null = null;

function cartSkuOverrides(child: IHHChildOrder): Set<string> {
  return new Set(
    hhCartItems(child.items)
      .map((item) => (item.cartSku ?? '').trim().toUpperCase())
      .filter(Boolean)
  );
}

function thorogoodDetailsSnapshot(child: IHHChildOrder, initials: readonly string[]): HhVerifySnapshot {
  const base = snapshotFromChild(child);
  const qtyBySku = new Map<string, number>();
  for (const item of hhCartItems(child.items)) {
    const sku = (item.cartSku ?? '').trim() || thorogoodPortalSku(item.sku ?? '', initials);
    if (!sku || item.quantity <= 0) continue;
    qtyBySku.set(sku, (qtyBySku.get(sku) ?? 0) + item.quantity);
  }
  return {
    ...base,
    items: [...qtyBySku.entries()]
      .map(([sku, quantity]) => ({ sku, quantity }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
  };
}

function jobLabel(job: HhCartVerifyJob): string {
  return job.childId ? `${job.groupId} order ${job.childId}` : job.groupId;
}

function jobCovers(existing: HhCartVerifyJob, incoming: HhCartVerifyJob): boolean {
  if (existing.groupId !== incoming.groupId) return false;
  if (!existing.childId) return true;
  return existing.childId === incoming.childId;
}

function applyGroupRollup(group: IHHOrderGroup): void {
  group.detailsStatus = rollupHhDetailsStatus(group.children.map((child) => child.detailsStatus));
  group.cartStatus = rollupHhCartStatus(group.children.map((child) => child.cartStatus));
}

export function clearHhCartVerification(child: IHHChildOrder): void {
  child.verifyIssues = [];
  child.verifyRows = [];
  child.verifiedAt = null;
}

export function childCanPlace(child: IHHChildOrder): boolean {
  return child.cartStatus === 'ready' && childCanVerify(child);
}

export function childCanVerify(child: IHHChildOrder): boolean {
  if (child.detailsStatus !== 'synced') return false;
  if (child.cartStatus === 'none' || child.cartStatus === 'placed') return false;
  const documentId = (child.b2bDraftId ?? '').trim();
  if (isOrderDetailsDraftId(documentId) || isEnvoyOrderCode(documentId)) return true;
  return Boolean(documentId) && looksLikeMongoObjectId(documentId) && !documentId.startsWith('local:');
}

export function invalidateHhCartVerification(child: IHHChildOrder): void {
  if (child.cartStatus !== 'ready' && child.cartStatus !== 'review') return;
  child.cartStatus = 'draft';
  clearHhCartVerification(child);
}

function rowsFromIssues(issues: HhVerifyIssue[]): HhCompareRow[] {
  return issues.map((issue) => ({
    field: issue.field,
    label: issue.label,
    expected: issue.expected,
    actual: issue.actual,
    match: false,
  }));
}

async function persistVerification(
  groupId: string,
  childId: string,
  cartStatus: 'ready' | 'review',
  issues: HhVerifyIssue[],
  rows?: HhCompareRow[]
): Promise<IHHChildOrder | null> {
  return withHhGroupLock(groupId, async () => {
    const group = await HHOrderGroup.findById(groupId);
    if (!group) return null;
    const child = group.children.id(childId);
    if (!child) return null;
    if (!childCanVerify(child)) return child;
    child.cartStatus = cartStatus;
    child.verifyIssues = issues;
    child.verifyRows = (rows && rows.length > 0 ? rows : rowsFromIssues(issues)).map((row) => ({
      field: row.field,
      label: row.label,
      expected: row.expected,
      actual: row.actual,
      matched: row.match,
    }));
    child.verifiedAt = new Date();
    applyGroupRollup(group);
    group.markModified('children');
    await group.save();
    return child;
  });
}

export async function verifyHhCart(groupId: string, childId?: string): Promise<void> {
  const group = await HHOrderGroup.findById(groupId);
  if (!group) return;

  const targets = (childId ? group.children.filter((child) => String(child._id) === childId) : [...group.children]).filter(
    childCanVerify
  );
  if (targets.length === 0) return;

  const liveTargets: IHHChildOrder[] = [];
  const envoyTargets: IHHChildOrder[] = [];
  for (const child of targets) {
    verifyCurrentOrderId = child.orderId;
    if (isOrderDetailsDraftId(child.b2bDraftId)) {
      const snapshot = snapshotFromChild(child);
      const rows = compareSnapshots(snapshot, snapshot);
      await persistVerification(groupId, String(child._id), 'ready', [], rows);
      console.log(`${LOG} ${child.orderId} → ready (order details)`);
      continue;
    }
    if (isEnvoyOrderCode(child.b2bDraftId)) {
      envoyTargets.push(child);
      continue;
    }
    liveTargets.push(child);
  }

  const envoyInitials =
    envoyTargets.length > 0 ? (await loadHhB2bConfig('thorogood')).skuInitials : [];
  for (const child of envoyTargets) {
    verifyCurrentOrderId = child.orderId;
    try {
      const compared = await compareEnvoyDraft(child, envoyInitials);
      const nextStatus = compared.issues.length === 0 ? 'ready' : 'review';
      await persistVerification(groupId, String(child._id), nextStatus, compared.issues, compared.rows);
      console.log(
        `${LOG} ${child.orderId} → ${nextStatus}${compared.issues.length > 0 ? ` (${compared.issues.map((issue) => issue.label).join(', ')})` : ''}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof HhB2bAuthError) {
        console.warn(`${LOG} ${child.orderId} ${message}`);
        return;
      }
      await persistVerification(groupId, String(child._id), 'review', [
        {
          field: 'document',
          label: 'B2B draft',
          expected: 'Live Thorogood draft',
          actual: message.slice(0, 240),
        },
      ]);
      console.warn(`${LOG} ${child.orderId} ${message}`);
    }
  }
  if (liveTargets.length === 0) return;

  let config;
  let cookie;
  try {
    config = await loadHhB2bConfig(hhBrandId(group.brand));
    cookie = await loadHhB2bCookie(hhBrandId(group.brand));
  } catch (err) {
    if (err instanceof HhB2bAuthError) {
      console.warn(`${LOG} ${err.message}`);
      return;
    }
    throw err;
  }

  for (const child of liveTargets) {
    verifyCurrentOrderId = child.orderId;
    const documentId = (child.b2bDraftId ?? '').trim();
    try {
      const document = await fetchHhB2bDocument(config, cookie, documentId);
      const rows = compareSnapshots(
        snapshotFromChildCartSkus(child, config.skuPrefixes, config.skuSuffixes),
        snapshotRespectingCartSkus(
          snapshotFromB2bDocument(document),
          cartSkuOverrides(child),
          config.skuPrefixes,
          config.skuSuffixes
        )
      );
      const issues = issuesFromCompareRows(rows);
      const nextStatus = issues.length === 0 ? 'ready' : 'review';
      await persistVerification(groupId, String(child._id), nextStatus, issues, rows);
      console.log(
        `${LOG} ${child.orderId} → ${nextStatus}${issues.length > 0 ? ` (${issues.map((issue) => issue.label).join(', ')})` : ''}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof HhB2bAuthError) {
        console.warn(`${LOG} ${child.orderId} ${message}`);
        return;
      }
      const fetchIssues: HhVerifyIssue[] = [
        {
          field: 'document',
          label: 'B2B draft',
          expected: 'Live Helly Hansen cart',
          actual: message.slice(0, 240),
        },
      ];
      await persistVerification(groupId, String(child._id), 'review', fetchIssues);
      console.warn(`${LOG} ${child.orderId} ${message}`);
    }
  }
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) break;
      verifyCurrentGroupId = job.groupId;
      verifyCurrentOrderId = null;
      try {
        await verifyHhCart(job.groupId, job.childId);
      } catch (err) {
        console.error(`${LOG} ${jobLabel(job)} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    verifyCurrentGroupId = null;
    verifyCurrentOrderId = null;
    draining = false;
    if (queue.length > 0) void drainQueue();
  }
}

/** Compare stored order details to the live B2B document. Safe after the HTTP response. */
export function enqueueHhCartVerify(groupId: string, childId?: string): void {
  if (!groupId) return;
  const job: HhCartVerifyJob = { groupId, childId };

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

export function getHhCartVerifyQueued(): number {
  return queue.length + (draining ? 1 : 0);
}

export function getHhCartVerifyRuntime(): {
  running: boolean;
  currentGroupId: string | null;
  currentOrderId: string | null;
  queuedGroupIds: string[];
} {
  return {
    running: draining,
    currentGroupId: verifyCurrentGroupId,
    currentOrderId: verifyCurrentOrderId,
    queuedGroupIds: [...new Set(queue.map((job) => job.groupId))],
  };
}

export interface HhLiveCompareOrder {
  id: string;
  orderId: string;
  cartStatus: IHHChildOrder['cartStatus'];
  skipped?: string;
  error?: string;
  rows: HhCompareRow[];
  details: HhVerifySnapshot;
  cart: HhVerifySnapshot | null;
  canPlace: boolean;
  verifiedAt: string | null;
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function compareEnvoyDraft(
  child: IHHChildOrder,
  initials: readonly string[]
): Promise<{
  rows: HhCompareRow[];
  issues: HhVerifyIssue[];
  cart: HhVerifySnapshot;
}> {
  const order = await fetchThorogoodOrder((child.b2bDraftId ?? '').trim());
  const aligned = alignResolvedThorogoodSnapshots(
    thorogoodDetailsSnapshot(child, initials),
    snapshotFromThorogoodOrder(order)
  );
  const rows = compareSnapshots(aligned.details, aligned.cart);
  return { rows, issues: issuesFromCompareRows(rows), cart: aligned.cart };
}

function emptySnapshot(): HhVerifySnapshot {
  return {
    name: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    po: '',
    orderNumber: '',
    items: [],
  };
}

/**
 * Live GET of the Helly Hansen document vs stored order details.
 * Ready is not forever-safe — Place Order must call this again and refuse unless canPlace.
 */
export async function liveCompareHhCarts(groupId: string, childId?: string): Promise<HhLiveCompareOrder[]> {
  const group = await HHOrderGroup.findById(groupId);
  if (!group) return [];

  const targets = childId
    ? group.children.filter((child) => String(child._id) === childId)
    : [...group.children];
  if (targets.length === 0) return [];

  let config;
  let cookie;
  const needsLive = targets.some((child) => {
    const documentId = (child.b2bDraftId ?? '').trim();
    if (isOrderDetailsDraftId(documentId) || isEnvoyOrderCode(documentId)) return false;
    return Boolean(documentId) && looksLikeMongoObjectId(documentId) && !documentId.startsWith('local:');
  });
  if (needsLive) {
    config = await loadHhB2bConfig(hhBrandId(group.brand));
    cookie = await loadHhB2bCookie(hhBrandId(group.brand));
  }
  const needsEnvoy = targets.some((child) => isEnvoyOrderCode(child.b2bDraftId));
  const envoyInitials = needsEnvoy ? (await loadHhB2bConfig('thorogood')).skuInitials : [];

  const results: HhLiveCompareOrder[] = [];
  for (const child of targets) {
    const details = snapshotFromChild(child);
    const documentId = (child.b2bDraftId ?? '').trim();
    if (isOrderDetailsDraftId(documentId)) {
      const rows = compareSnapshots(details, details);
      const issues = issuesFromCompareRows(rows);
      let cartStatus = child.cartStatus;
      let verifiedAt = isoDate(child.verifiedAt);
      if (childCanVerify(child)) {
        const saved = await persistVerification(groupId, String(child._id), 'ready', issues, rows);
        if (saved) {
          cartStatus = saved.cartStatus;
          verifiedAt = isoDate(saved.verifiedAt);
        }
      }
      results.push({
        id: String(child._id),
        orderId: child.orderId,
        cartStatus,
        rows,
        details,
        cart: details,
        canPlace: false,
        verifiedAt,
      });
      continue;
    }
    if (isEnvoyOrderCode(documentId)) {
      try {
        const compared = await compareEnvoyDraft(child, envoyInitials);
        const matched = compared.issues.length === 0;
        let cartStatus = child.cartStatus;
        let verifiedAt = isoDate(child.verifiedAt);
        if (childCanVerify(child)) {
          const saved = await persistVerification(
            groupId,
            String(child._id),
            matched ? 'ready' : 'review',
            compared.issues,
            compared.rows
          );
          if (saved) {
            cartStatus = saved.cartStatus;
            verifiedAt = isoDate(saved.verifiedAt);
          }
        }
        results.push({
          id: String(child._id),
          orderId: child.orderId,
          cartStatus,
          rows: compared.rows,
          details,
          cart: compared.cart,
          canPlace: false,
          verifiedAt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof HhB2bAuthError) throw err;
        if (childCanVerify(child)) {
          await persistVerification(groupId, String(child._id), 'review', [
            {
              field: 'document',
              label: 'B2B draft',
              expected: 'Live Thorogood draft',
              actual: message.slice(0, 240),
            },
          ]);
        }
        results.push({
          id: String(child._id),
          orderId: child.orderId,
          cartStatus: childCanVerify(child) ? 'review' : child.cartStatus,
          error: message.slice(0, 240),
          rows: [],
          details,
          cart: emptySnapshot(),
          canPlace: false,
          verifiedAt: new Date().toISOString(),
        });
      }
      continue;
    }
    const hasLiveId = Boolean(documentId) && looksLikeMongoObjectId(documentId) && !documentId.startsWith('local:');

    if (!hasLiveId) {
      results.push({
        id: String(child._id),
        orderId: child.orderId,
        cartStatus: child.cartStatus,
        skipped: 'No live B2B cart',
        rows: [],
        details,
        cart: null,
        canPlace: false,
        verifiedAt: isoDate(child.verifiedAt),
      });
      continue;
    }

    if (!config || !cookie) {
      results.push({
        id: String(child._id),
        orderId: child.orderId,
        cartStatus: child.cartStatus,
        error: 'Helly Hansen B2B session is not available',
        rows: [],
        details,
        cart: null,
        canPlace: false,
        verifiedAt: isoDate(child.verifiedAt),
      });
      continue;
    }

    try {
      const document = await fetchHhB2bDocument(config, cookie, documentId);
      const cart = snapshotRespectingCartSkus(
        snapshotFromB2bDocument(document),
        cartSkuOverrides(child),
        config.skuPrefixes,
        config.skuSuffixes
      );
      const rows = compareSnapshots(snapshotFromChildCartSkus(child, config.skuPrefixes, config.skuSuffixes), cart);
      const issues = issuesFromCompareRows(rows);
      const matched = issues.length === 0;
      let cartStatus = child.cartStatus;
      let verifiedAt = isoDate(child.verifiedAt);

      if (childCanVerify(child)) {
        const saved = await persistVerification(
          groupId,
          String(child._id),
          matched ? 'ready' : 'review',
          issues,
          rows
        );
        if (saved) {
          cartStatus = saved.cartStatus;
          verifiedAt = isoDate(saved.verifiedAt);
        }
      }

      results.push({
        id: String(child._id),
        orderId: child.orderId,
        cartStatus,
        rows,
        details,
        cart,
        canPlace: matched && cartStatus === 'ready',
        verifiedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof HhB2bAuthError) {
        throw err;
      }
      if (childCanVerify(child)) {
        await persistVerification(groupId, String(child._id), 'review', [
          {
            field: 'document',
            label: 'B2B draft',
            expected: 'Live Helly Hansen cart',
            actual: message.slice(0, 240),
          },
        ]);
      }
      results.push({
        id: String(child._id),
        orderId: child.orderId,
        cartStatus: childCanVerify(child) ? 'review' : child.cartStatus,
        error: message.slice(0, 240),
        rows: [],
        details,
        cart: emptySnapshot(),
        canPlace: false,
        verifiedAt: new Date().toISOString(),
      });
    }
  }

  return results;
}
