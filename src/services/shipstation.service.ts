import https from 'https';
import zlib from 'zlib';
import { Readable } from 'stream';
import { URL } from 'url';
import Order from '../models/Order';
import type { OrderStatus } from '../models/Order';

interface ShipStationAddress {
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  street3?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  residential?: boolean;
  addressVerified?: string;
}

interface ShipStationOrderItem {
  orderItemId?: number;
  lineItemKey?: string;
  sku?: string;
  name?: string;
  imageUrl?: string;
  weight?: { value?: number; units?: string };
  quantity?: number;
  unitPrice?: number;
  taxAmount?: number;
  shippingAmount?: number;
  warehouseLocation?: string;
  options?: { name: string; value: string }[];
  productId?: number;
  fulfillmentSku?: string;
  adjustment?: boolean;
  upc?: string;
  createDate?: string;
  modifyDate?: string;
}

interface ShipStationAdvancedOptions {
  warehouseId?: number;
  storeId?: number;
  source?: string;
  [key: string]: unknown;
}

interface ShipStationOrder {
  orderId: number;
  orderNumber: string;
  orderKey?: string;
  orderDate: string;
  createDate?: string;
  modifyDate?: string;
  paymentDate?: string;
  shipByDate?: string;
  orderStatus: OrderStatus;
  customerId?: number;
  customerUsername?: string;
  customerEmail?: string;
  billTo?: ShipStationAddress;
  shipTo?: ShipStationAddress;
  items?: ShipStationOrderItem[];
  orderTotal?: number;
  amountPaid?: number;
  taxAmount?: number;
  shippingAmount?: number;
  customerNotes?: string;
  internalNotes?: string;
  gift?: boolean;
  giftMessage?: string;
  paymentMethod?: string;
  requestedShippingService?: string;
  carrierCode?: string;
  serviceCode?: string;
  packageCode?: string;
  confirmation?: string;
  shipDate?: string;
  holdUntilDate?: string;
  weight?: { value?: number; units?: string };
  advancedOptions?: ShipStationAdvancedOptions;
  externallyFulfilled?: boolean;
  externallyFulfilledBy?: string;
  externallyFulfilledByName?: string;
}

interface ShipStationOrdersResponse {
  orders: ShipStationOrder[];
  total: number;
  page: number;
  pages: number;
}

export interface SyncProgress {
  page: number;
  totalPages: number;
  synced: number;
  total: number;
}

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  total: number;
  pages: number;
  isIncremental: boolean;
}

export type ProgressCallback = (progress: SyncProgress) => void;

function getAuthHeader(): string {
  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('SHIPSTATION_API_KEY and SHIPSTATION_API_SECRET must be set');
  }

  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
}

function fetchShipStationPage(urlString: string): Promise<ShipStationOrdersResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    };

    https
      .get(options, (res) => {
        if (res.statusCode === 429) {
          const retryAfter = parseInt((res.headers['retry-after'] as string) || '60', 10);
          console.log(`[ShipStation] Rate limited — retrying in ${retryAfter}s`);
          res.resume(); // drain so the socket can be reused
          setTimeout(() => {
            fetchShipStationPage(urlString).then(resolve).catch(reject);
          }, retryAfter * 1000);
          return;
        }

        const encoding = (res.headers['content-encoding'] || '').toLowerCase();
        let stream: Readable = res;
        if (encoding === 'gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        } else if (encoding === 'br') {
          stream = res.pipe(zlib.createBrotliDecompress());
        }

        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        stream.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve(JSON.parse(raw) as ShipStationOrdersResponse);
          } catch (e) {
            reject(new Error(`Failed to parse ShipStation response: ${(e as Error).message}`));
          }
        });
        stream.on('error', reject);
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function buildOrdersUrl(page: number, pageSize: number, filterParams: Record<string, string>): string {
  const params = new URLSearchParams({
    pageSize: String(pageSize),
    page: String(page),
    sortBy: 'ModifyDate',
    sortDir: 'ASC',
    ...filterParams,
  });
  return `https://ssapi.shipstation.com/orders?${params.toString()}`;
}

function mapToDocument(order: ShipStationOrder): Record<string, unknown> {
  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    orderKey: order.orderKey,
    orderDate: order.orderDate ? new Date(order.orderDate) : undefined,
    createDate: order.createDate ? new Date(order.createDate) : undefined,
    modifyDate: order.modifyDate ? new Date(order.modifyDate) : undefined,
    paymentDate: order.paymentDate ? new Date(order.paymentDate) : undefined,
    shipByDate: order.shipByDate ? new Date(order.shipByDate) : undefined,
    orderStatus: order.orderStatus,
    customerId: order.customerId,
    customerUsername: order.customerUsername,
    customerEmail: order.customerEmail,
    billTo: order.billTo,
    shipTo: order.shipTo,
    items: order.items?.map((item) => ({
      ...item,
      createDate: item.createDate ? new Date(item.createDate) : undefined,
      modifyDate: item.modifyDate ? new Date(item.modifyDate) : undefined,
    })),
    orderTotal: order.orderTotal,
    amountPaid: order.amountPaid,
    taxAmount: order.taxAmount,
    shippingAmount: order.shippingAmount,
    customerNotes: order.customerNotes,
    internalNotes: order.internalNotes,
    gift: order.gift,
    giftMessage: order.giftMessage,
    paymentMethod: order.paymentMethod,
    requestedShippingService: order.requestedShippingService,
    carrierCode: order.carrierCode,
    serviceCode: order.serviceCode,
    packageCode: order.packageCode,
    confirmation: order.confirmation,
    shipDate: order.shipDate ? new Date(order.shipDate) : undefined,
    holdUntilDate: order.holdUntilDate ? new Date(order.holdUntilDate) : undefined,
    weight: order.weight,
    storeId: order.advancedOptions?.storeId,
    source: order.advancedOptions?.source,
    externallyFulfilled: order.externallyFulfilled,
    externallyFulfilledBy: order.externallyFulfilledBy,
    externallyFulfilledByName: order.externallyFulfilledByName,
    // lastSyncedAt intentionally excluded — tracked via $setOnInsert so it never
    // causes a false "modified" count on existing unchanged records
  };
}

/**
 * Determines sync filter params:
 * - First sync (no orders in DB): orderDateStart = Jan 1, 2026
 * - Subsequent syncs: modifyDateStart = lastCompletedAt minus 5 min buffer
 *   Falls back to max(modifyDate) in DB when lastCompletedAt is unavailable (server restart)
 */
async function resolveSyncParams(
  lastCompletedAt: string | null
): Promise<{ params: Record<string, string>; isIncremental: boolean }> {
  if (lastCompletedAt) {
    const since = new Date(lastCompletedAt);
    since.setMinutes(since.getMinutes() - 5);
    console.log(`[ShipStation] Incremental sync — modifyDateStart: ${since.toISOString()}`);
    return { params: { modifyDateStart: since.toISOString() }, isIncremental: true };
  }

  // Server restart or very first run — fall back to DB
  const latest = await Order.findOne({}, { modifyDate: 1 })
    .sort({ modifyDate: -1 })
    .lean();

  if (!latest?.modifyDate) {
    console.log('[ShipStation] No existing orders — full sync from 2026-01-01');
    return { params: { orderDateStart: '2026-01-01' }, isIncremental: false };
  }

  const since = new Date(latest.modifyDate);
  since.setMinutes(since.getMinutes() - 5);
  console.log(`[ShipStation] Incremental sync (DB fallback) — modifyDateStart: ${since.toISOString()}`);
  return { params: { modifyDateStart: since.toISOString() }, isIncremental: true };
}

// Max number of ShipStation pages fetched/persisted concurrently. Kept modest
// to stay well under ShipStation's ~40 requests/minute rate limit (429s are
// retried automatically in fetchShipStationPage).
const PAGE_CONCURRENCY = 4;

export async function syncOrdersFromShipStation(
  lastCompletedAt: string | null,
  onProgress?: ProgressCallback
): Promise<SyncResult> {
  const { params: filterParams, isIncremental } = await resolveSyncParams(lastCompletedAt);

  const PAGE_SIZE = 500;
  let totalPages = 1;
  let grandTotal = 0;
  let totalFetched = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let completedPages = 0;

  // Fetches a single page and persists it. Returns the raw response so the
  // caller can read pagination metadata from page 1.
  const fetchAndPersistPage = async (page: number): Promise<ShipStationOrdersResponse> => {
    const url = buildOrdersUrl(page, PAGE_SIZE, filterParams);
    console.log(`[ShipStation] Fetching page ${page}/${totalPages} ...`);

    const response = await fetchShipStationPage(url);

    if (response.orders && response.orders.length > 0) {
      const bulkOps = response.orders.map((order) => ({
        updateOne: {
          filter: { orderId: order.orderId },
          update: {
            $set: mapToDocument(order),
            $setOnInsert: { lastSyncedAt: new Date() },
          },
          upsert: true,
        },
      }));

      const result = await Order.bulkWrite(bulkOps, { ordered: false, timestamps: false });
      // These increments are safe without locking: Node is single-threaded and
      // the mutations happen synchronously after each await resolves.
      totalFetched += response.orders.length;
      totalInserted += result.upsertedCount;
      totalUpdated += result.modifiedCount;

      console.log(
        `[ShipStation] Page ${page}/${totalPages} — ` +
        `fetched ${response.orders.length}, inserted ${result.upsertedCount}, updated ${result.modifiedCount}`
      );
    }

    completedPages += 1;
    onProgress?.({ page: completedPages, totalPages, synced: totalFetched, total: grandTotal });
    return response;
  };

  // Page 1 establishes the total page count, then the rest are fetched in
  // parallel using a bounded worker pool.
  const firstPage = await fetchAndPersistPage(1);
  grandTotal = firstPage.total;
  totalPages = firstPage.pages || 1;

  if (totalPages > 1 && firstPage.orders && firstPage.orders.length > 0) {
    const remainingPages: number[] = [];
    for (let p = 2; p <= totalPages; p++) remainingPages.push(p);

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < remainingPages.length) {
        const page = remainingPages[cursor];
        cursor += 1;
        await fetchAndPersistPage(page);
      }
    };

    const workerCount = Math.min(PAGE_CONCURRENCY, remainingPages.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  return { fetched: totalFetched, inserted: totalInserted, updated: totalUpdated, total: grandTotal, pages: totalPages, isIncremental };
}
