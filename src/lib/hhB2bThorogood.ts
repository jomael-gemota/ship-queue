/**
 * Thorogood Envoy B2B cart draft.
 *
 * Header first (`POST /api/b2b/orders`), then sizes (`PUT /api/b2b/orders/:code`).
 * This stops at status DRAFT. It does not call submit.
 */

import { randomUUID } from 'node:crypto';
import type { HhB2bDraftRequest } from './hhB2b';
import { HhB2bAuthError, HhB2bDraftError, loadHhB2bConfig, loadHhB2bCookie } from './hhB2bConfig';
import type { HhVerifySnapshot } from './hhB2bVerify';
import { hhBrand } from './hhBrand';
import { thorogoodPortalSku } from './hhThorogoodSku';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_PO_LEN = 20;
const DISTRIBUTION_CENTER = 'DEFAULT-LOCATION';
const SEARCH_FIELDS = [
  'languages.name',
  'languages.color',
  'languages.colorFamily',
  'languages.description',
  'languages.featuresAndBenefits',
  'flags',
  'image',
  'isActive',
  'spin',
  'code',
  'status',
  'style',
  'prices',
  'family',
  'productGridCode',
  'availableDate',
  'leadTime',
  'languages.gender',
  'props',
  'skus',
  'sizingSystems',
  'similarProducts',
  'uom',
  'videoAssetIds',
  'presetSizeCurveCodes',
  'productBannerId',
  'embroideryTypes',
  'forceShowAts',
  'forceShowAtp',
  'rejectAtsMode',
  'segmentationCodes',
  'marketingAssets',
  'hasVntanaEnabled',
  'productMultiple',
  'isCustomizable',
  'isCustomized',
  'customizationDetails',
  'productType',
  'collectionCode',
  'collections',
].join(',');

/** Outdoor Equipped's default ship-to on the Thorogood portal, used when the customer record does not name one. */
const DEFAULT_SHIP_TO_CODE = 'NCWH';
const DEFAULT_SHIP_TO_ADDRESS = {
  name: 'OUTDOOR EQUIPPED NC WAREHOUSE',
  address1: '312 RALEIGH STREET STE 4',
  address2: '',
  address3: '',
  city: 'WILMINGTON',
  state: 'NC',
  postalCode: '28412',
  country: 'US',
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function isEnvoyOrderCode(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((value ?? '').trim());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function asString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).trim();
  return typeof value === 'string' ? value.trim() : '';
}

function asQty(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function skuMatchKey(sku: string): string {
  return sku.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cookieValue(cookie: string, name: string): string {
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const raw = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return '';
}

function unwrap(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  if (!record) throw new HhB2bDraftError('Thorogood returned an empty body');
  const error = record.error;
  if (error) {
    throw new HhB2bDraftError(`Thorogood error: ${typeof error === 'string' ? error : JSON.stringify(error)}`);
  }
  if (Array.isArray(record.data)) return { products: record.data };
  const data = asRecord(record.data);
  if (data && !Array.isArray(record.products) && !record.code) return data;
  return record;
}

async function envoyRequest(
  baseUrl: string,
  cookie: string,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const headers = new Headers();
  headers.set('Cookie', cookie);
  headers.set('Accept', 'application/json, text/plain, */*');
  headers.set('Content-Type', 'application/json');
  headers.set('User-Agent', USER_AGENT);
  const xsrf = cookieValue(cookie, 'XSRF-TOKEN');
  if (xsrf) headers.set('X-XSRF-TOKEN', xsrf);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal });
    const text = await res.text();
    const looksHtml = res.ok && (/^\s*</.test(text) || /<html/i.test(text.slice(0, 400)));
    if (res.status === 401 || res.status === 403 || looksHtml) {
      throw new HhB2bAuthError('Thorogood session is stale — paste a new cookie on Configurations');
    }
    if (!res.ok) {
      throw new HhB2bDraftError(`Thorogood ${res.status} on ${path}: ${text.slice(0, 240)}`);
    }
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HhB2bDraftError(`Thorogood returned non-JSON from ${path}`);
    }
  } catch (err) {
    if (err instanceof HhB2bDraftError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HhB2bDraftError(`Thorogood request timed out: ${path}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new HhB2bDraftError(`Thorogood request failed on ${path}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

function productRecords(payload: unknown): Record<string, unknown>[] {
  const record = unwrap(payload);
  const lists = [record.products, record.results, record.items];
  const products = lists.find(Array.isArray) ?? [];
  return products.map(asRecord).filter((product): product is Record<string, unknown> => Boolean(product));
}

function skuCodes(product: Record<string, unknown>): string[] {
  const skus = Array.isArray(product.skus) ? product.skus : [];
  const codes: string[] = [];
  for (const raw of skus) {
    if (typeof raw === 'string') {
      const code = raw.trim();
      if (code) codes.push(code);
      continue;
    }
    const sku = asRecord(raw);
    const code = asString(sku?.code) || asString(sku?.skuCode) || asString(sku?.sku);
    if (code) codes.push(code);
  }
  return codes;
}

function collectionCodeOf(product: Record<string, unknown>): string {
  const direct = asString(product.collectionCode);
  if (direct) return direct;
  const collection = asRecord(product.collection);
  const fromCollection = asString(collection?.code);
  if (fromCollection) return fromCollection;
  const collectionCodes = Array.isArray(product.collectionCodes) ? product.collectionCodes : [];
  for (const raw of collectionCodes) {
    const code = asString(raw);
    if (code) return code;
  }
  const collections = Array.isArray(product.collections) ? product.collections : [];
  for (const raw of collections) {
    const code = asString(asRecord(raw)?.code) || asString(raw);
    if (code) return code;
  }
  const underscored = Array.isArray(product._collectionCodes) ? product._collectionCodes : [];
  for (const raw of underscored) {
    const code = asString(asRecord(raw)?.code) || asString(raw);
    if (code) return code;
  }
  return '';
}

interface ResolvedSku {
  productCode: string;
  collectionCode: string;
  skuCode: string;
  qty: number;
}

async function resolveSku(
  baseUrl: string,
  cookie: string,
  customerCode: string,
  sku: string,
  qty: number,
  initials: readonly string[],
  cartSku = ''
): Promise<ResolvedSku> {
  const sellerSku = sku.trim();
  const chosen = cartSku.trim();
  const textSearch = chosen || thorogoodPortalSku(sellerSku, initials);
  if (!textSearch) {
    throw new HhB2bDraftError(`SKU "${sellerSku}" could not be turned into a Thorogood portal code.`);
  }
  const query = new URLSearchParams({ fields: SEARCH_FIELDS });
  const wanted = skuMatchKey(textSearch);
  const payload = await envoyRequest(baseUrl, cookie, `/api/b2b/products/search-with-facets?${query.toString()}`, {
    method: 'POST',
    body: JSON.stringify({
      props: {},
      customerCode,
      textSearch,
      allActiveCollections: true,
    }),
  });
  for (const product of productRecords(payload)) {
    const productCode = asString(product.code);
    const collectionCode = collectionCodeOf(product);
    const match = skuCodes(product).find((code) => skuMatchKey(code) === wanted);
    if (!productCode || !match) continue;
    if (!collectionCode) {
      throw new HhB2bDraftError(`Thorogood product ${productCode} did not include a collection for ${textSearch}`);
    }
    return { productCode, collectionCode, skuCode: match, qty };
  }
  const searchedAs = textSearch === sellerSku ? '' : ` (searched as "${textSearch}")`;
  throw new HhB2bDraftError(
    `SKU "${sellerSku}"${searchedAs} was not found in the Thorogood catalog for customer ${customerCode}`
  );
}

interface ShipTo {
  code: string;
  address: Record<string, string>;
}

function addressFrom(record: Record<string, unknown> | null): Record<string, string> | null {
  if (!record) return null;
  const address1 = asString(record.address1);
  const city = asString(record.city);
  if (!address1 || !city) return null;
  return {
    name: asString(record.name),
    address1,
    address2: asString(record.address2),
    address3: asString(record.address3),
    city,
    state: asString(record.state),
    postalCode: asString(record.postalCode) || asString(record.zip),
    country: asString(record.country) || 'US',
  };
}

/** Read-only customer lookup. A JSON body proves the session and API are up. */
export async function probeThorogoodSession(baseUrl: string, cookie: string, customerCode: string): Promise<void> {
  const code = customerCode.trim();
  if (!code) throw new HhB2bDraftError('Thorogood customer code is missing');
  unwrap(await envoyRequest(baseUrl, cookie, `/api/b2b/customers/${encodeURIComponent(code)}`));
}

async function loadDefaultShipTo(baseUrl: string, cookie: string, customerCode: string): Promise<ShipTo> {
  try {
    const payload = unwrap(
      await envoyRequest(baseUrl, cookie, `/api/b2b/customers/${encodeURIComponent(customerCode)}`)
    );
    const code = asString(payload.defaultShipToCode) || asString(payload.shipToCode);
    const address =
      addressFrom(asRecord(payload.defaultShipToAddress)) || addressFrom(asRecord(payload.shipToAddress));
    if (code && address) return { code, address };
  } catch (err) {
    if (err instanceof HhB2bAuthError) throw err;
  }
  return { code: DEFAULT_SHIP_TO_CODE, address: { ...DEFAULT_SHIP_TO_ADDRESS } };
}

function orderNameFor(request: HhB2bDraftRequest): string {
  const po = (request.po || '').trim() || (request.amazonOrderId || '').trim();
  if (!po) throw new HhB2bDraftError('Cannot draft a Thorogood cart without a PO Number.');
  if (po.length > MAX_PO_LEN) {
    throw new HhB2bDraftError(
      `PO "${po}" is ${po.length} characters. Thorogood order names cannot be longer than ${MAX_PO_LEN}.`
    );
  }
  return po;
}

function dropShipAddress(request: HhB2bDraftRequest): Record<string, string> {
  const address = request.address;
  const name = address.name.trim();
  const address1 = address.line1.trim();
  const city = address.city.trim();
  const state = address.state.trim();
  const postalCode = address.postalCode.trim();
  if (!name || !address1 || !city || !state || !postalCode) {
    throw new HhB2bDraftError(`Order ${request.amazonOrderId} is missing a drop-ship name or address.`);
  }
  const result: Record<string, string> = {
    name,
    address1,
    city,
    state,
    postalCode,
    country: address.country.trim() || 'US',
  };
  const address2 = address.line2.trim();
  if (address2) result.address2 = address2;
  return result;
}

function detroitParts(date: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour') };
}

/** Next calendar day at midnight in America/Detroit, matching the portal's requested ship date. */
function requestedShipDate(): string {
  const today = detroitParts(new Date());
  const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const year = next.getUTCFullYear();
  const month = next.getUTCMonth();
  const day = next.getUTCDate();
  for (let hour = 3; hour <= 6; hour += 1) {
    const candidate = new Date(Date.UTC(year, month, day, hour, 0, 0));
    const parts = detroitParts(candidate);
    if (parts.year === year && parts.month === month + 1 && parts.day === day && parts.hour === 0) {
      return candidate.toISOString();
    }
  }
  return new Date(Date.UTC(year, month, day, 4, 0, 0)).toISOString();
}

function customerCodeFromConfig(accountId: string): string {
  const trimmed = accountId.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return hhBrand('thorogood').accountId;
}

export async function createThorogoodDraft(
  request: HhB2bDraftRequest
): Promise<{ draftId: string; orderNumber: string }> {
  if (request.items.length === 0) {
    throw new HhB2bDraftError('Cannot draft a Thorogood cart with no line items.');
  }
  const config = await loadHhB2bConfig('thorogood');
  const cookie = await loadHhB2bCookie('thorogood');
  const customerCode = customerCodeFromConfig(config.accountId);
  const orderName = orderNameFor(request);
  const shipTo = dropShipAddress(request);
  const accountShipTo = await loadDefaultShipTo(config.baseUrl, cookie, customerCode);

  const resolved: ResolvedSku[] = [];
  for (const item of request.items) {
    if (item.quantity <= 0) continue;
    const line = await resolveSku(
      config.baseUrl,
      cookie,
      customerCode,
      item.sku,
      item.quantity,
      config.skuInitials,
      item.cartSku
    );
    const existing = resolved.find((row) => row.productCode === line.productCode && row.skuCode === line.skuCode);
    if (existing) existing.qty += line.qty;
    else resolved.push(line);
  }
  if (resolved.length === 0) {
    throw new HhB2bDraftError('Cannot draft a Thorogood cart with no line items.');
  }

  const byCollection = new Map<string, ResolvedSku[]>();
  for (const line of resolved) {
    const rows = byCollection.get(line.collectionCode) ?? [];
    rows.push(line);
    byCollection.set(line.collectionCode, rows);
  }

  const orderCode = randomUUID();
  const shipments = [...byCollection.entries()].map(([collectionCode, lines]) => {
    const byProduct = new Map<string, ResolvedSku[]>();
    for (const line of lines) {
      const rows = byProduct.get(line.productCode) ?? [];
      rows.push(line);
      byProduct.set(line.productCode, rows);
    }
    return {
      code: randomUUID(),
      props: {},
      useDefaultShipTo: true,
      shouldCopyNameToPO: true,
      po: orderName,
      shipToCode: accountShipTo.code,
      shipToAddress: shipTo,
      collectionCode,
      isDropShip: true,
      requestedShipDate: requestedShipDate(),
      shipNotificationEmails: [null],
      products: [...byProduct.entries()].map(([productCode, skus]) => ({
        code: productCode,
        key: randomUUID(),
        skus: skus.map((sku) => ({
          code: sku.skuCode,
          distributionCenter: DISTRIBUTION_CENTER,
          qty: sku.qty,
        })),
      })),
    };
  });

  const headerShipments = shipments.map((shipment) => {
    const { products: _products, ...header } = shipment;
    return header;
  });
  const posted = unwrap(
    await envoyRequest(config.baseUrl, cookie, '/api/b2b/orders', {
      method: 'POST',
      body: JSON.stringify({
        code: orderCode,
        props: {},
        shipments: headerShipments,
        customerCode,
        defaultShipToAddress: accountShipTo.address,
        defaultShipToCode: accountShipTo.code,
        orderName,
        isHeaderIncomplete: false,
      }),
    })
  );

  const code = asString(posted.code) || orderCode;
  let created = posted;
  const postedShipments = Array.isArray(posted.shipments) ? posted.shipments : [];
  if (!asString(posted._id) || postedShipments.length === 0) {
    created = unwrap(
      await envoyRequest(config.baseUrl, cookie, `/api/b2b/orders/${encodeURIComponent(code)}`)
    );
  }
  created.code = asString(created.code) || code;
  created.status = 'DRAFT';
  created.isSubmitting = false;
  const savedShipments = Array.isArray(created.shipments) && created.shipments.length > 0
    ? created.shipments
    : headerShipments;
  created.shipments = savedShipments.map((raw, index) => {
    const shipment = asRecord(raw) ?? {};
    const planned = shipments[index];
    return {
      ...shipment,
      products: planned?.products ?? [],
    };
  });

  try {
    await envoyRequest(config.baseUrl, cookie, `/api/b2b/orders/${encodeURIComponent(code)}`, {
      method: 'PUT',
      body: JSON.stringify(created),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HhB2bDraftError(`Thorogood draft ${code} was created, but the sizes were not saved. ${message}`);
  }

  return { draftId: code, orderNumber: orderName };
}

export async function fetchThorogoodOrder(orderCode: string): Promise<Record<string, unknown>> {
  const config = await loadHhB2bConfig('thorogood');
  const cookie = await loadHhB2bCookie('thorogood');
  return unwrap(await envoyRequest(config.baseUrl, cookie, `/api/b2b/orders/${encodeURIComponent(orderCode)}`));
}

export function snapshotFromThorogoodOrder(order: Record<string, unknown>): HhVerifySnapshot {
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  const shipment =
    shipments.map(asRecord).find((row) => row?.isDropShip) ?? asRecord(shipments[0]) ?? {};
  const address = asRecord(shipment?.shipToAddress) ?? {};
  const qtyBySku = new Map<string, number>();
  for (const shipmentRaw of shipments) {
    const row = asRecord(shipmentRaw);
    const products = Array.isArray(row?.products) ? row.products : [];
    for (const productRaw of products) {
      const product = asRecord(productRaw);
      const skus = Array.isArray(product?.skus) ? product.skus : [];
      for (const skuRaw of skus) {
        const sku = asRecord(skuRaw);
        const code = asString(sku?.code);
        const qty = asQty(sku?.qty);
        if (!code || qty <= 0) continue;
        qtyBySku.set(code, (qtyBySku.get(code) ?? 0) + qty);
      }
    }
  }
  return {
    name: asString(address.name),
    address1: asString(address.address1),
    address2: asString(address.address2),
    city: asString(address.city),
    state: asString(address.state),
    zip: asString(address.postalCode) || asString(address.zip),
    country: asString(address.country),
    po: asString(shipment?.po) || asString(order.orderName),
    orderNumber: asString(order.orderName),
    items: [...qtyBySku.entries()]
      .map(([sku, quantity]) => ({ sku, quantity }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
  };
}

/** Match already-resolved portal codes to the cart's own spelling. */
export function alignResolvedThorogoodSnapshots(
  details: HhVerifySnapshot,
  cart: HhVerifySnapshot
): { details: HhVerifySnapshot; cart: HhVerifySnapshot } {
  const cartByKey = new Map(cart.items.map((item) => [skuMatchKey(item.sku), item.sku]));
  return {
    details: {
      ...details,
      items: details.items.map((item) => ({
        sku: cartByKey.get(skuMatchKey(item.sku)) ?? item.sku,
        quantity: item.quantity,
      })),
    },
    cart,
  };
}

export function alignThorogoodSnapshots(
  details: HhVerifySnapshot,
  cart: HhVerifySnapshot,
  initials: readonly string[]
): { details: HhVerifySnapshot; cart: HhVerifySnapshot } {
  const cartByKey = new Map(cart.items.map((item) => [skuMatchKey(item.sku), item.sku]));
  return {
    details: {
      ...details,
      items: details.items.map((item) => {
        const portalSku = thorogoodPortalSku(item.sku, initials);
        return {
          sku: cartByKey.get(skuMatchKey(portalSku)) ?? portalSku,
          quantity: item.quantity,
        };
      }),
    },
    cart,
  };
}
