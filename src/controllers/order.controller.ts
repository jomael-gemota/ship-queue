import { Request, Response } from 'express';
import { isValidObjectId, PipelineStage } from 'mongoose';
import Order, { ORDER_STATUSES, OrderStatus } from '../models/Order';
import { syncOrdersFromShipStation } from '../services/shipstation.service';
import type { SyncProgress, SyncResult } from '../services/shipstation.service';

interface SyncState {
  running: boolean;
  startedAt: string | null;
  completedAt: string | null;
  progress: SyncProgress;
  error: string | null;
  result: SyncResult | null;
}

const syncState: SyncState = {
  running: false,
  startedAt: null,
  completedAt: null,
  progress: { page: 0, totalPages: 0, synced: 0, total: 0 },
  error: null,
  result: null,
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Kicks off a ShipStation sync if one isn't already running. Shared by the
 * HTTP endpoint and the background scheduler so both paths reuse the exact same
 * in-memory state machine. Fire-and-forget: returns immediately and updates
 * `syncState` as the sync progresses.
 *
 * @returns `true` when a new sync was started, `false` if one was already running.
 */
export function triggerSync(): boolean {
  if (syncState.running) {
    return false;
  }

  const previousCompletedAt = syncState.completedAt;

  syncState.running = true;
  syncState.startedAt = new Date().toISOString();
  syncState.completedAt = null;
  syncState.progress = { page: 0, totalPages: 0, synced: 0, total: 0 };
  syncState.error = null;
  syncState.result = null;

  // Fire and forget — do not await
  syncOrdersFromShipStation(previousCompletedAt, (progress) => {
    syncState.progress = progress;
  })
    .then((result) => {
      syncState.running = false;
      syncState.completedAt = new Date().toISOString();
      syncState.result = result;
    })
    .catch((err) => {
      syncState.running = false;
      syncState.completedAt = new Date().toISOString();
      syncState.error = err instanceof Error ? err.message : 'Unknown error during sync';
    });

  return true;
}

export function isSyncRunning(): boolean {
  return syncState.running;
}

export const syncOrders = async (_req: Request, res: Response): Promise<void> => {
  const started = triggerSync();

  res.json({
    message: started ? 'Sync started' : 'Sync already in progress',
    data: { ...syncState },
  });
};

export const getSyncStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    // Use completedAt from in-memory state as the authoritative "last synced" time.
    // Falls back to querying DB only when the server has freshly restarted and
    // no sync has been run yet in this process.
    let lastSyncedAt: string | null = syncState.completedAt;

    if (!lastSyncedAt) {
      const latest = await Order.findOne({}, { lastSyncedAt: 1 })
        .sort({ lastSyncedAt: -1 })
        .lean();
      lastSyncedAt = latest?.lastSyncedAt ? latest.lastSyncedAt.toISOString() : null;
    }

    res.json({ data: { ...syncState, lastSyncedAt } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch sync status', error });
  }
};

export const getOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      status,
      search,
      page = '1',
      pageSize = '50',
    } = req.query as {
      status?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const allowedSizes = [50, 100, 200, 500];
    const size = allowedSizes.includes(parseInt(pageSize, 10))
      ? parseInt(pageSize, 10)
      : 50;
    const skip = (pageNum - 1) * size;

    const filter: Record<string, unknown> = {};

    if (status && ORDER_STATUSES.includes(status as OrderStatus)) {
      filter.orderStatus = status;
    }

    const searchTerm = search?.trim();
    if (searchTerm) {
      const safeSearch = escapeRegExp(searchTerm);
      const searchRegex = new RegExp(safeSearch, 'i');
      filter.$or = [
        { orderNumber: searchRegex },
        { customerUsername: searchRegex },
        { customerEmail: searchRegex },
        { 'shipTo.name': searchRegex },
        { 'shipTo.street1': searchRegex },
        { 'shipTo.street2': searchRegex },
        { 'shipTo.city': searchRegex },
        { 'shipTo.state': searchRegex },
        { 'shipTo.postalCode': searchRegex },
        { 'shipTo.country': searchRegex },
      ];
    }

    const hasFilter = Object.keys(filter).length > 0;

    // Exclude the (potentially large) items array from the list payload — items
    // are loaded lazily per-order when a row is expanded. We still surface an
    // itemCount so the table can show the count without shipping every item.
    const listPipeline: PipelineStage[] = [
      { $match: filter },
      { $sort: { orderDate: -1 } },
      { $skip: skip },
      { $limit: size },
      { $addFields: { itemCount: { $size: { $ifNull: ['$items', []] } } } },
      { $project: { items: 0 } },
    ];

    const [orders, total] = await Promise.all([
      Order.aggregate(listPipeline),
      // estimatedDocumentCount uses collection metadata (near-instant) and is
      // safe when there is no filter; fall back to an exact count when filtering.
      hasFilter ? Order.countDocuments(filter) : Order.estimatedDocumentCount(),
    ]);

    res.json({
      data: orders,
      pagination: {
        page: pageNum,
        pageSize: size,
        total,
        pages: Math.ceil(total / size),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch orders', error });
  }
};

export const getOrderItems = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid order id' });
      return;
    }

    const order = await Order.findById(id, { items: 1 }).lean();

    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    res.json({ data: order.items ?? [] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch order items', error });
  }
};
