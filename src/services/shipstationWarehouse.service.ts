import https from 'https';
import zlib from 'zlib';
import { Readable } from 'stream';
import { ShipStationLabelAddress } from './shipstationLabel.service';

export interface ShipStationWarehouse {
  warehouseId: number;
  warehouseName?: string;
  originAddress?: ShipStationLabelAddress;
  returnAddress?: ShipStationLabelAddress;
  createDate?: string;
  isDefault?: boolean;
}

function getAuthHeader(): string {
  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('SHIPSTATION_API_KEY and SHIPSTATION_API_SECRET must be set');
  }

  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
}

function fetchWarehouses(): Promise<ShipStationWarehouse[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'ssapi.shipstation.com',
      path: '/warehouses',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    };

    https
      .get(options, (res) => {
        const status = res.statusCode || 0;

        if (status === 429) {
          const retryAfter = parseInt((res.headers['retry-after'] as string) || '60', 10);
          res.resume();
          setTimeout(() => {
            fetchWarehouses().then(resolve).catch(reject);
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
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');

          if (status < 200 || status >= 300) {
            reject(new Error(`ShipStation /warehouses failed (HTTP ${status}): ${raw}`));
            return;
          }

          try {
            // ShipStation returns a bare JSON array of warehouse objects.
            const parsed = raw ? JSON.parse(raw) : [];
            resolve(Array.isArray(parsed) ? (parsed as ShipStationWarehouse[]) : []);
          } catch (e) {
            reject(new Error(`Failed to parse ShipStation warehouses: ${(e as Error).message}`));
          }
        });
        stream.on('error', reject);
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

// Warehouses change very rarely; cache them so we don't hit the API once per
// row when preparing/creating a batch of labels.
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { data: ShipStationWarehouse[]; fetchedAt: number } | null = null;

export async function listWarehouses(forceRefresh = false): Promise<ShipStationWarehouse[]> {
  if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  const data = await fetchWarehouses();
  cache = { data, fetchedAt: Date.now() };
  return data;
}

/** Resolves a warehouse by its numeric warehouseId. */
export async function getWarehouseById(id: number): Promise<ShipStationWarehouse | undefined> {
  const warehouses = await listWarehouses();
  return warehouses.find((w) => w.warehouseId === id);
}

/**
 * Resolves a warehouse by (case-insensitive) name. Falls back to a partial
 * match, then to the account's default warehouse when no name matches.
 */
export async function getWarehouseByName(name: string): Promise<ShipStationWarehouse | undefined> {
  const warehouses = await listWarehouses();
  const target = name.trim().toLowerCase();

  return (
    warehouses.find((w) => (w.warehouseName || '').trim().toLowerCase() === target) ||
    warehouses.find((w) => (w.warehouseName || '').trim().toLowerCase().includes(target)) ||
    warehouses.find((w) => w.isDefault)
  );
}
