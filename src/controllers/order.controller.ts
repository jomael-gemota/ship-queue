import { Request, Response } from 'express';
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

export const syncOrders = async (_req: Request, res: Response): Promise<void> => {
  if (syncState.running) {
    res.json({ message: 'Sync already in progress', data: { ...syncState } });
    return;
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

  res.json({ message: 'Sync started', data: { ...syncState } });
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
      page = '1',
      pageSize = '50',
    } = req.query as {
      status?: string;
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

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ orderDate: -1 })
        .skip(skip)
        .limit(size)
        .lean(),
      Order.countDocuments(filter),
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
