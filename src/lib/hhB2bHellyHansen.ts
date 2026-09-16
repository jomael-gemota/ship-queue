import type { HhB2bDraftItem, HhB2bDraftRequest } from './hhB2b';
import { HhB2bAuthError, HhB2bDraftError } from './hhB2bConfig';
import type { HhB2bConfig } from './hhB2bConfig';

const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface PageItem {
  stock_item_key: string;
  stock_item_sku: string;
  stock_item_upc: string;
  quantity: number;
  reference_quantity: null;
  quantity_source?: { source: string; quantity: number }[];
}

interface PageProduct {
  product_number: string;
  color_code: string;
  position: number;
  page_items: PageItem[];
  coordination_group: null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return typeof value === 'string' ? value.trim() : '';
}

export function looksLikeMongoObjectId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value.trim());
}

function parseOrderNumber(record: Record<string, unknown> | null): string {
  if (!record) return '';
  return asString(record.number) || asString(record.order_number) || asString(record.orderNumber);
}

export function parseHhB2bSku(sku: string): { styleCode: string; colorCode: string } | null {
  const trimmed = sku.trim();
  const styleCode = trimmed.split('_')[0] || '';
  const colorCode = trimmed.split('_')[1]?.split('-')[0] || '';
  if (!styleCode || !colorCode) return null;
  return { styleCode, colorCode };
}

function b2bHeaders(config: HhB2bConfig, cookie: string): Headers {
  const headers = new Headers();
  headers.set('Cookie', cookie);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/javascript, application/json');
  headers.set('Accept-Language', 'en-US,en;q=0.9');
  headers.set('X-Requested-With', 'XMLHttpRequest');
  headers.set('Origin', config.baseUrl);
  headers.set('Referer', `${config.baseUrl}/`);
  headers.set('User-Agent', USER_AGENT);
  return headers;
}

async function b2bRequest(
  config: HhB2bConfig,
  cookie: string,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const url = `${config.baseUrl}${path}`;
  const headers = b2bHeaders(config, cookie);
  if (init.headers) {
    const extra = new Headers(init.headers);
    extra.forEach((value, key) => headers.set(key, value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HhB2bDraftError(`B2B request timed out: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const looksHtml = /^\s*</.test(text) || /<html/i.test(text);
  if (res.status === 401 || res.status === 403 || looksHtml) {
    throw new HhB2bAuthError('Helly Hansen Sports B2B session is stale — refresh the cookie');
  }
  if (!res.ok) {
    throw new HhB2bDraftError(`B2B ${res.status} on ${path}: ${text.slice(0, 240)}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HhB2bDraftError(`B2B returned non-JSON from ${path}`);
  }
}

function formatPageItems(raw: unknown, sku: string, quantity: number): PageItem[] {
  const parsed = parseHhB2bSku(sku);
  const root = asRecord(raw);
  const results = asRecord(root?.results);
  const products = Array.isArray(results?.products) ? results.products : [];
  if (!parsed || products.length === 0) return [];

  const pageItems: PageItem[] = [];
  for (const productRaw of products) {
    const product = asRecord(productRaw);
    if (!product || asString(product.number) !== parsed.styleCode) continue;
    const variations = Array.isArray(product.variations) ? product.variations : [];
    for (const variationRaw of variations) {
      const variation = asRecord(variationRaw);
      if (!variation || asString(variation.code) !== parsed.colorCode) continue;
      const stockItems = Array.isArray(variation.stock_items) ? variation.stock_items : [];
      for (const stockRaw of stockItems) {
        const stock = asRecord(stockRaw);
        if (!stock) continue;
        const stockSku = asString(stock.sku);
        const selected = stockSku === sku;
        const pageItem: PageItem = {
          stock_item_key: asString(stock.key),
          stock_item_sku: stockSku,
          stock_item_upc: asString(stock.upc),
          quantity: selected ? quantity : 0,
          reference_quantity: null,
        };
        if (selected) {
          pageItem.quantity_source = [{ source: 'NA', quantity }];
        }
        pageItems.push(pageItem);
      }
    }
  }
  return pageItems;
}

function addToCartPayload(
  config: HhB2bConfig,
  arriveOn: string,
  cancelOn: string,
  pageProducts: PageProduct[]
): Record<string, unknown> {
  return {
    name: 'Elastic Order',
    note: '',
    notes: '',
    catalog_key: config.catalog,
    customer: config.accountId,
    payment: null,
    version_created: 'dbf01d3',
    version_updated: 'dbf01d3',
    client_created: 'scramble',
    client_updated: 'scramble',
    platform_created: USER_AGENT,
    platform_updated: USER_AGENT,
    programs: [],
    do_submit: false,
    do_review: false,
    do_reject: false,
    duplicated_from_id: null,
    duplicated_for: null,
    share_to: null,
    share_to_selection: null,
    shared_to: null,
    shared_by: null,
    copied_to: null,
    pages: [
      {
        name: 'Shipment 1',
        type: '',
        note: null,
        arrive_on: arriveOn,
        cancel_on: cancelOn,
        purchase_order: null,
        customer_number: config.accountId,
        location_number: null,
        client_fields: { ship_via: '-' },
        programs: [],
        page_products: pageProducts,
        drop_ship_address: null,
      },
    ],
    whiteboard: null,
    client_fields: {},
  };
}

async function searchStyle(config: HhB2bConfig, cookie: string, styleCode: string): Promise<unknown> {
  const query = new URLSearchParams({
    catalog: config.catalog,
    customer: config.accountId,
    dropped: 'false',
    keyword: styleCode,
    'sort[type]': 'workbook',
    'sort[direction]': 'asc',
    variations: 'true',
    tag_facets: 'true',
    Range: '0-49',
    hoist_quantities: 'true',
  });
  return b2bRequest(config, cookie, `/api/products/?${query.toString()}`);
}

export interface HhB2bCreatedDraft {
  documentId: string;
  orderNumber: string;
}

async function fetchDocument(
  config: HhB2bConfig,
  cookie: string,
  documentId: string
): Promise<Record<string, unknown> | null> {
  const raw = await b2bRequest(config, cookie, `/api/documents/${documentId}?hoist_quantities=true`);
  return asRecord(raw);
}

export async function fetchHhB2bOrderNumber(
  config: HhB2bConfig,
  cookie: string,
  documentId: string
): Promise<string> {
  const record = await fetchDocument(config, cookie, documentId);
  const error = record?.error;
  if (error) {
    throw new HhB2bDraftError(`B2B document lookup failed: ${typeof error === 'string' ? error : JSON.stringify(error)}`);
  }
  return parseOrderNumber(record);
}

export async function createHellyHansenSportsDraft(
  config: HhB2bConfig,
  cookie: string,
  request: HhB2bDraftRequest,
  arriveOn: string,
  cancelOn: string
): Promise<HhB2bCreatedDraft> {
  const groups = new Map<string, { styleCode: string; colorCode: string; items: HhB2bDraftItem[] }>();
  for (const item of request.items) {
    const parsed = parseHhB2bSku(item.sku);
    if (!parsed) {
      throw new HhB2bDraftError(`SKU "${item.sku}" is not a Helly Hansen style_color-size code`);
    }
    const key = `${parsed.styleCode}_${parsed.colorCode}`;
    const group = groups.get(key) ?? { ...parsed, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }

  const pageProducts: PageProduct[] = [];
  let position = 1;
  for (const group of groups.values()) {
    const raw = await searchStyle(config, cookie, group.styleCode);
    const searchError = asRecord(raw)?.error;
    if (searchError) {
      throw new HhB2bDraftError(`Catalog search failed for ${group.styleCode}: ${String(searchError)}`);
    }

    const first = group.items[0];
    const pageItems = formatPageItems(raw, first.sku, first.quantity);
    if (pageItems.length === 0) {
      throw new HhB2bDraftError(`SKU ${first.sku} was not found in ${config.catalog}`);
    }
    for (const item of group.items) {
      const match = pageItems.find((row) => row.stock_item_sku === item.sku);
      if (!match) {
        throw new HhB2bDraftError(`SKU ${item.sku} was not found in ${config.catalog}`);
      }
      match.quantity = item.quantity;
      match.quantity_source = [{ source: 'NA', quantity: item.quantity }];
    }

    pageProducts.push({
      product_number: group.styleCode,
      color_code: group.colorCode,
      position: position++,
      page_items: pageItems,
      coordination_group: null,
    });
  }

  const payload = addToCartPayload(config, arriveOn, cancelOn, pageProducts);
  const created = await b2bRequest(config, cookie, '/api/documents/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const record = asRecord(created);
  const error = record?.error;
  if (error) {
    throw new HhB2bDraftError(`B2B draft failed: ${typeof error === 'string' ? error : JSON.stringify(error)}`);
  }
  const documentId = asString(record?._id) || asString(record?.id);
  if (!documentId) {
    throw new HhB2bDraftError('B2B draft did not return a document id');
  }
  const orderNumber = parseOrderNumber(record) || (await fetchHhB2bOrderNumber(config, cookie, documentId));
  if (!orderNumber) {
    throw new HhB2bDraftError('B2B draft did not return an Order #');
  }
  return { documentId, orderNumber };
}
