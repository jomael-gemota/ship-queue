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
import { effectiveThorogoodSkuInitials, thorogoodPortalSku, thorogoodPortalSkuCandidates } from './hhThorogoodSku';

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

const CATALOG_ITEM_FIELDS = [
  'code',
  'style',
  'image',
  'languages.name',
  'languages.color',
  'languages.language',
  'languages.country',
  'skus.code',
  'skus.attributes',
].join(',');
const IMAGE_EDGE = 160;

export function isThorogoodImageResource(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(value);
}

function imageContentType(resource: string, header: string): string {
  const lower = resource.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  const reported = header.split(';')[0]?.trim().toLowerCase() ?? '';
  if (reported.startsWith('image/') && reported !== 'image') return reported;
  return 'image/jpeg';
}

/** Portal images require the Thorogood session. Callers proxy the bytes to the browser. */
export async function fetchThorogoodProductImage(
  baseUrl: string,
  cookie: string,
  resource: string
): Promise<{ body: Buffer; contentType: string }> {
  if (!isThorogoodImageResource(resource)) throw new HhB2bDraftError('Invalid product image.');
  const headers = new Headers();
  headers.set('Cookie', cookie);
  headers.set('Accept', 'image/avif,image/webp,image/*,*/*');
  headers.set('User-Agent', USER_AGENT);
  const xsrf = cookieValue(cookie, 'XSRF-TOKEN');
  if (xsrf) headers.set('X-XSRF-TOKEN', xsrf);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const path = `/api/resources/${encodeURIComponent(resource)}?x=${IMAGE_EDGE}&y=${IMAGE_EDGE}`;
  try {
    const res = await fetch(`${baseUrl}${path}`, { headers, signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      throw new HhB2bAuthError('Thorogood session is stale — paste a new cookie on Configurations');
    }
    if (!res.ok) throw new HhB2bDraftError('Thorogood product image was not found.');
    return {
      body: Buffer.from(await res.arrayBuffer()),
      contentType: imageContentType(resource, res.headers.get('content-type') || ''),
    };
  } catch (err) {
    if (err instanceof HhB2bDraftError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HhB2bDraftError('Thorogood product image timed out.');
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new HhB2bDraftError(`Thorogood product image failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }
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

export interface ThorogoodShipToOption {
  code: string;
  label: string;
}

/** Street line the Thorogood Create Order screen shows for a ship-to, not the ship-to code. */
export function thorogoodShipToLabel(record: Record<string, unknown>): string {
  const street = [asString(record.address1), asString(record.address2), asString(record.address3)]
    .filter(Boolean)
    .join(', ');
  const region = [asString(record.state), asString(record.postalCode) || asString(record.zip)].filter(Boolean).join(' ');
  const locality = [asString(record.city), region].filter(Boolean).join(', ');
  return [street, locality].filter(Boolean).join(', ');
}

export const THOROGOOD_DEFAULT_SHIP_TO: ThorogoodShipToOption = {
  code: DEFAULT_SHIP_TO_CODE,
  label: thorogoodShipToLabel(DEFAULT_SHIP_TO_ADDRESS),
};

/** Addresses on the customer record. The portal sends the session cookie on this call. */
export async function listThorogoodShipTos(
  baseUrl: string,
  cookie: string,
  customerCode: string
): Promise<ThorogoodShipToOption[]> {
  const code = customerCode.trim();
  if (!code) throw new HhB2bDraftError('Thorogood customer code is missing');
  const payload = unwrap(await envoyRequest(baseUrl, cookie, `/api/b2b/customers/${encodeURIComponent(code)}`));
  const raw = Array.isArray(payload.addresses) ? payload.addresses : [];
  const options: ThorogoodShipToOption[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const shipCode = asString(record.code);
    const label = thorogoodShipToLabel(record);
    if (!shipCode || !label) continue;
    options.push({ code: shipCode, label });
  }
  if (options.length === 0) throw new HhB2bDraftError('Thorogood customer has no ship-to addresses');
  return options;
}

export interface ThorogoodShipToDetail extends ThorogoodShipToOption {
  address: Record<string, string>;
}

/** Ship-to choices with the full address the order payload needs. */
export async function listThorogoodShipToDetails(
  baseUrl: string,
  cookie: string,
  customerCode: string
): Promise<ThorogoodShipToDetail[]> {
  const code = customerCode.trim();
  if (!code) throw new HhB2bDraftError('Thorogood customer code is missing');
  const payload = unwrap(await envoyRequest(baseUrl, cookie, `/api/b2b/customers/${encodeURIComponent(code)}`));
  const raw = Array.isArray(payload.addresses) ? payload.addresses : [];
  const options: ThorogoodShipToDetail[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const shipCode = asString(record.code);
    const label = thorogoodShipToLabel(record);
    const address = addressFrom(record);
    if (!shipCode || !label || !address) continue;
    options.push({ code: shipCode, label, address });
  }
  if (options.length === 0) throw new HhB2bDraftError('Thorogood customer has no ship-to addresses');
  return options;
}

export interface ThorogoodCatalogOption {
  code: string;
  name: string;
}

export const THOROGOOD_DEFAULT_CATALOG: ThorogoodCatalogOption = {
  code: 'thorogood-boots',
  name: 'Thorogood Boots',
};

function preferredLanguage(record: Record<string, unknown>): Record<string, unknown> | null {
  const languages = Array.isArray(record.languages) ? record.languages : [];
  const named: { entry: Record<string, unknown>; language: string; country: string }[] = [];
  for (const item of languages) {
    const entry = asRecord(item);
    if (!entry || !asString(entry.name)) continue;
    named.push({
      entry,
      language: asString(entry.language).toLowerCase(),
      country: asString(entry.country).toUpperCase(),
    });
  }
  const usEnglish = named.find((item) => item.language === 'en' && item.country === 'US');
  if (usEnglish) return usEnglish.entry;
  const english = named.find((item) => item.language === 'en');
  if (english) return english.entry;
  return named[0]?.entry ?? null;
}

function collectionName(record: Record<string, unknown>): string {
  return asString(preferredLanguage(record)?.name);
}

/** Catalogs (collections) the Create Order screen lists. The portal sends the session cookie on this call. */
export async function listThorogoodCatalogs(baseUrl: string, cookie: string): Promise<ThorogoodCatalogOption[]> {
  const query = new URLSearchParams({
    fields: 'code,image,languages.description,languages.name,sort',
    includeOrderDate: 'true',
  });
  const payload = asRecord(
    await envoyRequest(baseUrl, cookie, `/api/b2b/collections/search?${query.toString()}`, {
      method: 'POST',
      body: '{}',
    })
  );
  const raw = Array.isArray(payload?.data) ? payload.data : [];
  const options: ThorogoodCatalogOption[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const code = asString(record.code);
    const name = collectionName(record);
    if (!code || !name) continue;
    options.push({ code, name });
  }
  if (options.length === 0) throw new HhB2bDraftError('Thorogood returned no catalogs');
  return options;
}

export interface ThorogoodCatalogQuery {
  collectionCode: string;
  customerCode: string;
  shipToCode: string;
  requestedShipDate: string;
}

export interface ThorogoodCatalogLine extends ThorogoodLineItem {
  name: string;
  price: number | null;
  currencyCode: string;
  imageResource: string;
  styleCode: string;
  size: string;
  width: string;
}

function catalogLine(item: ThorogoodLineItem, detail?: Omit<ThorogoodCatalogLine, 'sku' | 'quantity'>): ThorogoodCatalogLine {
  return {
    sku: item.sku,
    quantity: item.quantity,
    name: detail?.name ?? '',
    price: detail?.price ?? null,
    currencyCode: detail?.currencyCode ?? '',
    imageResource: detail?.imageResource ?? '',
    styleCode: detail?.styleCode ?? '',
    size: detail?.size ?? '',
    width: detail?.width ?? '',
  };
}

function attributeValue(sku: Record<string, unknown>, name: string): string {
  const attributes = Array.isArray(sku.attributes) ? sku.attributes : [];
  const wanted = name.toLowerCase();
  for (const raw of attributes) {
    const attribute = asRecord(raw);
    if (!attribute || asString(attribute.code).toLowerCase() !== wanted) continue;
    return asString(attribute.value);
  }
  return '';
}

interface SkuDetail {
  code: string;
  size: string;
  width: string;
}

function skuDetails(product: Record<string, unknown>): SkuDetail[] {
  const skus = Array.isArray(product.skus) ? product.skus : [];
  const details: SkuDetail[] = [];
  for (const raw of skus) {
    if (typeof raw === 'string') {
      const code = raw.trim();
      if (code) details.push({ code, size: '', width: '' });
      continue;
    }
    const sku = asRecord(raw);
    const code = asString(sku?.code) || asString(sku?.skuCode) || asString(sku?.sku);
    if (!code || !sku) continue;
    details.push({ code, size: attributeValue(sku, 'size'), width: attributeValue(sku, 'width') });
  }
  return details;
}

function imageResourceOf(product: Record<string, unknown>): string {
  const image = asRecord(product.image);
  const resources = Array.isArray(image?.resources) ? image.resources : [];
  for (const raw of resources) {
    const name = asString(raw);
    if (isThorogoodImageResource(name)) return name;
  }
  return '';
}

function asPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function displayName(product: Record<string, unknown>): string {
  const language = preferredLanguage(product);
  const name = asString(language?.name).replace(/\s+/g, ' ').trim();
  const color = asString(language?.color).replace(/\s+/g, ' ').trim();
  if (!name) return '';
  if (!color) return name;
  return `${name} - ${color}`;
}

interface SkuCatalogHit {
  productCode: string;
  skuCode: string;
  name: string;
  imageResource: string;
  styleCode: string;
  size: string;
  width: string;
}

/** The order screen loads wholesale prices with this call. A missing price comes back empty instead of failing the catalog. */
async function searchCatalogPrices(
  baseUrl: string,
  cookie: string,
  query: ThorogoodCatalogQuery
): Promise<{ prices: Record<string, unknown>; currencyCode: string }> {
  const payload = unwrap(
    await envoyRequest(baseUrl, cookie, '/api/b2b/prices/search-no-throw', {
      method: 'POST',
      body: JSON.stringify({
        collectionCode: query.collectionCode,
        customerCode: query.customerCode,
        requestedShipDate: query.requestedShipDate,
      }),
    })
  );
  const prices = asRecord(payload.prices) ?? {};
  const priceCode = asRecord(asRecord(payload.priceCodes)?.priceCode);
  return { prices, currencyCode: asString(priceCode?.currencyCode) || 'USD' };
}

function priceForSku(productPrices: Record<string, unknown> | null, skuCode: string): number | null {
  if (!productPrices) return null;
  const skus = asRecord(productPrices.skus);
  if (skus) {
    if (Object.prototype.hasOwnProperty.call(skus, skuCode)) {
      return asPrice(asRecord(skus[skuCode])?.price);
    }
    const wanted = skuMatchKey(skuCode);
    for (const [code, raw] of Object.entries(skus)) {
      if (skuMatchKey(code) !== wanted) continue;
      return asPrice(asRecord(raw)?.price);
    }
  }
  return asPrice(productPrices.priceMin);
}

/**
 * Name and image come from the catalog product search. Wholesale price comes from
 * the prices search, matched to the same SKU. Callers store the result on the order.
 */
export async function describeThorogoodLineItems(
  baseUrl: string,
  cookie: string,
  query: ThorogoodCatalogQuery,
  items: ThorogoodLineItem[]
): Promise<ThorogoodCatalogLine[]> {
  if (items.length === 0) return [];
  const collectionCode = query.collectionCode.trim();
  const customerCode = query.customerCode.trim();
  const shipToCode = query.shipToCode.trim();
  const requestedShipDate = query.requestedShipDate.trim();
  if (!collectionCode || !customerCode || !shipToCode || !requestedShipDate) {
    return items.map((item) => catalogLine(item));
  }

  const wanted = new Set(items.map((item) => skuMatchKey(item.sku)));
  const params = new URLSearchParams({ fields: CATALOG_ITEM_FIELDS });
  const payload = await envoyRequest(baseUrl, cookie, `/api/b2b/products/search?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify({ collectionCode, customerCode, shipToCode, requestedShipDate }),
  });

  const hits = new Map<string, SkuCatalogHit>();
  for (const product of productRecords(payload)) {
    const productCode = asString(product.code);
    if (!productCode) continue;
    const name = displayName(product);
    const imageResource = imageResourceOf(product);
    const styleCode = asString(product.style) || productCode;
    for (const detail of skuDetails(product)) {
      const key = skuMatchKey(detail.code);
      if (!wanted.has(key) || hits.has(key)) continue;
      hits.set(key, {
        productCode,
        skuCode: detail.code,
        name,
        imageResource,
        styleCode,
        size: detail.size,
        width: detail.width,
      });
    }
  }

  let prices: Record<string, unknown> = {};
  let currencyCode = '';
  if (hits.size > 0) {
    try {
      const book = await searchCatalogPrices(baseUrl, cookie, {
        collectionCode,
        customerCode,
        shipToCode,
        requestedShipDate,
      });
      prices = book.prices;
      currencyCode = book.currencyCode;
    } catch (err) {
      if (err instanceof HhB2bAuthError) throw err;
    }
  }

  return items.map((item) => {
    const hit = hits.get(skuMatchKey(item.sku));
    if (!hit) return catalogLine(item);
    const price = priceForSku(asRecord(prices[hit.productCode]), hit.skuCode);
    return catalogLine(item, {
      name: hit.name,
      price,
      currencyCode: price == null ? '' : currencyCode,
      imageResource: hit.imageResource,
      styleCode: hit.styleCode,
      size: hit.size,
      width: hit.width,
    });
  });
}

export interface ThorogoodSoldToOption {
  code: string;
  name: string;
  label: string;
}

export function thorogoodSoldToLabel(code: string, name: string): string {
  const customerName = name.trim();
  return customerName ? `${code} - ${customerName}` : code;
}

export const THOROGOOD_DEFAULT_SOLD_TO: ThorogoodSoldToOption = {
  code: '23550',
  name: 'OUTDOOR EQUIPPED',
  label: thorogoodSoldToLabel('23550', 'OUTDOOR EQUIPPED'),
};

/** Customers the Create Order Sold To list shows. The portal sends the session cookie on this call. */
export async function listThorogoodCustomers(baseUrl: string, cookie: string): Promise<ThorogoodSoldToOption[]> {
  const query = new URLSearchParams({
    fields: 'code,name,props,requireDropShipAddress,shipMethodType',
  });
  const payload = asRecord(await envoyRequest(baseUrl, cookie, `/api/b2b/customers?${query.toString()}`));
  const raw = Array.isArray(payload?.data) ? payload.data : [];
  const options: ThorogoodSoldToOption[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const code = asString(record.code);
    const name = asString(record.name);
    if (!code) continue;
    options.push({ code, name, label: thorogoodSoldToLabel(code, name) });
  }
  if (options.length === 0) throw new HhB2bDraftError('Thorogood returned no customers');
  return options;
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

/** Midnight America/Detroit on the calendar day the bulk form picked. */
function requestedShipDateOn(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) throw new HhB2bDraftError('Requested ship date must be a calendar date.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, date));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
    throw new HhB2bDraftError('Requested ship date must be a calendar date.');
  }
  for (let hour = 3; hour <= 6; hour += 1) {
    const candidate = new Date(Date.UTC(year, month - 1, date, hour, 0, 0));
    const parts = detroitParts(candidate);
    if (parts.year === year && parts.month === month && parts.day === date && parts.hour === 0) {
      return candidate.toISOString();
    }
  }
  return new Date(Date.UTC(year, month - 1, date, 4, 0, 0)).toISOString();
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

export interface ThorogoodBulkShipmentInput {
  customerPo: string;
  shipToCode: string;
  catalogName: string;
  catalogCode?: string;
  useDropShip: boolean;
  dropShip?: { name: string; address: string; postalCode: string };
  requestedShipDate: string;
  /** Portal shipment to keep line items from. Defaults to this shipment's position. */
  sourceIndex?: number;
}

export interface ThorogoodBulkDraftInput {
  orderName: string;
  soldToCode: string;
  shipToCode: string;
  shipments: ThorogoodBulkShipmentInput[];
}

export interface ThorogoodBulkDraftShipment {
  customerPo: string;
  shipToCode: string;
  shipToLabel: string;
  catalogCode: string;
  catalogName: string;
  useDropShip: boolean;
  dropShipName: string;
  dropShipAddress: string;
  dropShipPostalCode: string;
  requestedShipDate: string;
}

export interface ThorogoodBulkDraftResult {
  portalOrderCode: string;
  soldToLabel: string;
  shipToCode: string;
  shipToLabel: string;
  shipments: ThorogoodBulkDraftShipment[];
  warning: string;
}

function resolveCatalog(
  catalogs: ThorogoodCatalogOption[],
  name: string,
  codeHint: string
): ThorogoodCatalogOption {
  const hint = codeHint.trim();
  const byCode = hint ? catalogs.find((catalog) => catalog.code === hint) : undefined;
  if (byCode && byCode.name.toLowerCase() === name.toLowerCase()) return byCode;
  const exact = catalogs.find((catalog) => catalog.name === name);
  if (exact) return exact;
  const loose = catalogs.find((catalog) => catalog.name.toLowerCase() === name.toLowerCase());
  if (loose) return loose;
  throw new HhB2bDraftError(`Catalog "${name}" was not found on Thorogood.`);
}

function shipToDetail(
  shipTos: ThorogoodShipToDetail[],
  code: string
): ThorogoodShipToDetail {
  const match = shipTos.find((option) => option.code === code);
  if (match) return match;
  if (code === DEFAULT_SHIP_TO_CODE) {
    return {
      code: DEFAULT_SHIP_TO_CODE,
      label: thorogoodShipToLabel(DEFAULT_SHIP_TO_ADDRESS),
      address: { ...DEFAULT_SHIP_TO_ADDRESS },
    };
  }
  throw new HhB2bDraftError(`Ship to "${code}" was not found for this customer.`);
}

/** Drop ship only collects name, street, and zip. City, state, and country stay with the selected ship-to. */
function bulkDropShipAddress(
  shipTo: ThorogoodShipToDetail,
  drop: { name: string; address: string; postalCode: string }
): Record<string, string> {
  const name = drop.name.trim();
  const address1 = drop.address.trim();
  const postalCode = drop.postalCode.trim();
  if (!name || !address1 || !postalCode) {
    throw new HhB2bDraftError('Drop ship needs a name, address, and zip / postal code.');
  }
  return {
    ...shipTo.address,
    name,
    address1,
    address2: '',
    address3: '',
    postalCode,
  };
}

interface PreparedBulkDraft {
  orderName: string;
  soldToCode: string;
  soldToLabel: string;
  orderShipTo: ThorogoodShipToDetail;
  planned: {
    customerPo: string;
    shipTo: ThorogoodShipToDetail;
    catalog: ThorogoodCatalogOption;
    useDropShip: boolean;
    address: Record<string, string>;
    requestedShipDate: string;
    sourceIndex: number;
    saved: ThorogoodBulkDraftShipment;
  }[];
}

/** Header fields for a Bulk Order draft. Does not create or submit the cart. */
async function prepareThorogoodBulkDraft(
  baseUrl: string,
  cookie: string,
  input: ThorogoodBulkDraftInput
): Promise<PreparedBulkDraft> {
  const orderName = input.orderName.trim();
  if (!orderName) throw new HhB2bDraftError('Enter an order name.');
  if (orderName.length > MAX_PO_LEN) {
    throw new HhB2bDraftError(`Order name cannot be longer than ${MAX_PO_LEN} characters.`);
  }
  const soldToCode = input.soldToCode.trim();
  if (!/^\d+$/.test(soldToCode)) throw new HhB2bDraftError('Sold to must be a customer number.');
  if (input.shipments.length === 0) throw new HhB2bDraftError('Add at least one shipment.');

  const [customers, shipTos, catalogs] = await Promise.all([
    listThorogoodCustomers(baseUrl, cookie),
    listThorogoodShipToDetails(baseUrl, cookie, soldToCode),
    listThorogoodCatalogs(baseUrl, cookie),
  ]);
  const soldTo = customers.find((customer) => customer.code === soldToCode);
  const soldToLabel = soldTo?.label || thorogoodSoldToLabel(soldToCode, soldToCode === THOROGOOD_DEFAULT_SOLD_TO.code ? THOROGOOD_DEFAULT_SOLD_TO.name : '');
  const orderShipTo = shipToDetail(shipTos, input.shipToCode.trim());

  const planned = input.shipments.map((shipment, index) => {
    const label = input.shipments.length === 1 ? 'Shipment' : `Shipment ${index + 1}`;
    const customerPo = shipment.customerPo.trim();
    if (!customerPo) throw new HhB2bDraftError(`${label} needs a customer PO.`);
    if (customerPo.length > MAX_PO_LEN) {
      throw new HhB2bDraftError(`${label} customer PO cannot be longer than ${MAX_PO_LEN} characters.`);
    }
    const shipTo = shipToDetail(shipTos, shipment.shipToCode.trim());
    const catalog = resolveCatalog(catalogs, shipment.catalogName.trim(), shipment.catalogCode ?? '');
    const requestedShipDate = shipment.requestedShipDate.trim();
    const address = shipment.useDropShip
      ? bulkDropShipAddress(shipTo, shipment.dropShip ?? { name: '', address: '', postalCode: '' })
      : shipTo.address;
    const sourceIndex =
      Number.isInteger(shipment.sourceIndex) && (shipment.sourceIndex as number) >= 0
        ? (shipment.sourceIndex as number)
        : index;
    return {
      customerPo,
      shipTo,
      catalog,
      useDropShip: shipment.useDropShip,
      address,
      requestedShipDate,
      sourceIndex,
      saved: {
        customerPo,
        shipToCode: shipTo.code,
        shipToLabel: shipTo.label,
        catalogCode: catalog.code,
        catalogName: catalog.name,
        useDropShip: shipment.useDropShip,
        dropShipName: shipment.useDropShip ? (shipment.dropShip?.name ?? '').trim() : '',
        dropShipAddress: shipment.useDropShip ? (shipment.dropShip?.address ?? '').trim() : '',
        dropShipPostalCode: shipment.useDropShip ? (shipment.dropShip?.postalCode ?? '').trim() : '',
        requestedShipDate,
      },
    };
  });

  return { orderName, soldToCode, soldToLabel, orderShipTo, planned };
}

function bulkDraftResult(prepared: PreparedBulkDraft, portalOrderCode: string, warning = ''): ThorogoodBulkDraftResult {
  return {
    portalOrderCode,
    soldToLabel: prepared.soldToLabel,
    shipToCode: prepared.orderShipTo.code,
    shipToLabel: prepared.orderShipTo.label,
    shipments: prepared.planned.map((shipment) => shipment.saved),
    warning,
  };
}

/**
 * Header-only Thorogood draft for Bulk Order.
 * Stops at status DRAFT. Does not submit, and does not send notes or line items.
 */
export async function createThorogoodBulkDraft(
  baseUrl: string,
  cookie: string,
  input: ThorogoodBulkDraftInput
): Promise<ThorogoodBulkDraftResult> {
  const prepared = await prepareThorogoodBulkDraft(baseUrl, cookie, input);
  const { orderName, soldToCode, orderShipTo, planned } = prepared;

  const orderCode = randomUUID();
  const shipments = planned.map((shipment) => ({
    code: randomUUID(),
    props: {},
    useDefaultShipTo: true,
    shouldCopyNameToPO: shipment.customerPo === orderName,
    po: shipment.customerPo,
    shipToCode: shipment.shipTo.code,
    shipToAddress: shipment.address,
    collectionCode: shipment.catalog.code,
    isDropShip: shipment.useDropShip,
    requestedShipDate: requestedShipDateOn(shipment.requestedShipDate),
    shipNotificationEmails: [null],
    products: [] as { code: string; key: string; skus: { code: string; distributionCenter: string; qty: number }[] }[],
  }));
  const headerShipments = shipments.map((shipment) => {
    const { products: _products, ...header } = shipment;
    return header;
  });

  const posted = unwrap(
    await envoyRequest(baseUrl, cookie, '/api/b2b/orders', {
      method: 'POST',
      body: JSON.stringify({
        code: orderCode,
        props: {},
        shipments: headerShipments,
        customerCode: soldToCode,
        defaultShipToAddress: orderShipTo.address,
        defaultShipToCode: orderShipTo.code,
        orderName,
        isHeaderIncomplete: false,
      }),
    })
  );

  const code = asString(posted.code) || orderCode;
  let created = posted;
  const postedShipments = Array.isArray(posted.shipments) ? posted.shipments : [];
  if (!asString(posted._id) || postedShipments.length === 0) {
    created = unwrap(await envoyRequest(baseUrl, cookie, `/api/b2b/orders/${encodeURIComponent(code)}`));
  }
  created.code = asString(created.code) || code;
  created.status = 'DRAFT';
  created.isSubmitting = false;
  const savedShipments = Array.isArray(created.shipments) && created.shipments.length > 0
    ? created.shipments
    : headerShipments;
  created.shipments = savedShipments.map((raw, index) => {
    const shipment = asRecord(raw) ?? {};
    const plannedShipment = shipments[index];
    return {
      ...shipment,
      products: plannedShipment?.products ?? [],
    };
  });

  let warning = '';
  try {
    await envoyRequest(baseUrl, cookie, `/api/b2b/orders/${encodeURIComponent(code)}`, {
      method: 'PUT',
      body: JSON.stringify(created),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warning = `Thorogood draft ${code} was created, but saving the draft failed. ${message}`;
  }

  return bulkDraftResult(prepared, code, warning);
}

/**
 * Saves header changes onto the existing Thorogood draft.
 * Keeps the same order code and status DRAFT. Does not submit.
 * Line items already on a shipment stay when that shipment's catalog is unchanged.
 */
export async function updateThorogoodBulkDraft(
  baseUrl: string,
  cookie: string,
  portalOrderCode: string,
  input: ThorogoodBulkDraftInput
): Promise<ThorogoodBulkDraftResult> {
  const code = portalOrderCode.trim();
  if (!code) throw new HhB2bDraftError('This order has no Thorogood draft to edit.');
  const prepared = await prepareThorogoodBulkDraft(baseUrl, cookie, input);
  const existing = unwrap(await envoyRequest(baseUrl, cookie, `/api/b2b/orders/${encodeURIComponent(code)}`));
  const status = asString(existing.status).toUpperCase();
  if (status && status !== 'DRAFT') {
    throw new HhB2bDraftError(`This Thorogood order is ${status} and can no longer be edited.`);
  }

  const existingShipments = Array.isArray(existing.shipments) ? existing.shipments : [];
  const shipments = prepared.planned.map((shipment) => {
    const previous = asRecord(existingShipments[shipment.sourceIndex]) ?? {};
    const previousProducts = Array.isArray(previous.products) ? previous.products : [];
    const sameCatalog = asString(previous.collectionCode) === shipment.catalog.code;
    return {
      ...previous,
      code: asString(previous.code) || randomUUID(),
      props: asRecord(previous.props) ?? {},
      useDefaultShipTo: true,
      shouldCopyNameToPO: shipment.customerPo === prepared.orderName,
      po: shipment.customerPo,
      shipToCode: shipment.shipTo.code,
      shipToAddress: shipment.address,
      collectionCode: shipment.catalog.code,
      isDropShip: shipment.useDropShip,
      requestedShipDate: requestedShipDateOn(shipment.requestedShipDate),
      shipNotificationEmails: Array.isArray(previous.shipNotificationEmails) ? previous.shipNotificationEmails : [null],
      products: sameCatalog ? previousProducts : [],
    };
  });

  const updated = {
    ...existing,
    code: asString(existing.code) || code,
    customerCode: prepared.soldToCode,
    defaultShipToAddress: prepared.orderShipTo.address,
    defaultShipToCode: prepared.orderShipTo.code,
    orderName: prepared.orderName,
    shipments,
    status: 'DRAFT',
    isSubmitting: false,
    isHeaderIncomplete: false,
  };

  await envoyRequest(baseUrl, cookie, `/api/b2b/orders/${encodeURIComponent(code)}`, {
    method: 'PUT',
    body: JSON.stringify(updated),
  });

  return bulkDraftResult(prepared, asString(updated.code) || code);
}

export interface ThorogoodLineItem {
  sku: string;
  quantity: number;
}

export interface ThorogoodImportLine {
  sellerSku: string;
  portalSku: string;
  quantity: number;
}

export interface ThorogoodImportedLine {
  portalSku: string;
  sellerSku: string;
  quantity: number;
}

interface CatalogSkuHit {
  productCode: string;
  collectionCode: string;
  skuCode: string;
  key: string;
}

function styleCodeOf(value: string): string {
  const match = value.toUpperCase().match(/\d{3}-\d{4}/);
  if (match) return match[0];
  const token = value.trim().split(/\s+/)[0] ?? '';
  return /^\d+-\d+$/.test(token) ? token : '';
}

function joinSellerCodes(current: string, next: string): string {
  const add = next.trim();
  if (!add) return current;
  if (!current) return add;
  const parts = current.split(', ');
  if (parts.some((part) => part.toUpperCase() === add.toUpperCase())) return current;
  return `${current}, ${add}`;
}

function importLineLabel(line: { sellerSku: string; portalSku: string }): string {
  const seller = line.sellerSku.trim();
  const portal = line.portalSku.trim();
  if (seller && portal) return `${seller} (B2B SKU ${portal})`;
  return portal || seller;
}

async function catalogSkus(
  baseUrl: string,
  cookie: string,
  customerCode: string,
  textSearch: string,
  cache: Map<string, CatalogSkuHit[]>,
): Promise<CatalogSkuHit[]> {
  const cacheKey = textSearch.trim().toUpperCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const query = new URLSearchParams({ fields: SEARCH_FIELDS });
  const payload = await envoyRequest(baseUrl, cookie, `/api/b2b/products/search-with-facets?${query.toString()}`, {
    method: 'POST',
    body: JSON.stringify({
      props: {},
      customerCode,
      textSearch,
      allActiveCollections: true,
    }),
  });
  const hits: CatalogSkuHit[] = [];
  for (const product of productRecords(payload)) {
    const productCode = asString(product.code);
    const collectionCode = collectionCodeOf(product);
    if (!productCode) continue;
    for (const skuCode of skuCodes(product)) {
      hits.push({ productCode, collectionCode, skuCode, key: skuMatchKey(skuCode) });
    }
  }
  cache.set(cacheKey, hits);
  return hits;
}

function matchPortalCandidate(
  hits: CatalogSkuHit[],
  candidates: string[],
  collectionCode: string,
): CatalogSkuHit | undefined {
  for (const candidate of candidates) {
    const key = skuMatchKey(candidate);
    const hit = hits.find((row) => row.key === key && row.collectionCode === collectionCode);
    if (hit) return hit;
  }
  for (const candidate of candidates) {
    const key = skuMatchKey(candidate);
    const hit = hits.find((row) => row.key === key);
    if (hit) return hit;
  }
  return undefined;
}

interface ImportLineResolution {
  tried: string[];
  match: (ResolvedSku & { sellerSku: string }) | null;
  message: string;
}

async function resolveImportLine(
  baseUrl: string,
  cookie: string,
  customerCode: string,
  collectionCode: string,
  line: ThorogoodImportLine,
  affixes: { prefixes: readonly string[]; suffixes: readonly string[] },
  cache: Map<string, CatalogSkuHit[]>,
): Promise<ImportLineResolution> {
  const sellerSku = line.sellerSku.trim();
  const portalSku = line.portalSku.trim().replace(/\s+/g, ' ');
  const candidates = portalSku
    ? [portalSku]
    : thorogoodPortalSkuCandidates(sellerSku, affixes.prefixes, affixes.suffixes);
  if (candidates.length === 0) {
    return { tried: [], match: null, message: 'Could not be turned into a Thorogood portal code.' };
  }

  const style = styleCodeOf(candidates[0]) || candidates[0];
  const queries = [style, ...candidates].filter((query, index, all) => {
    const key = skuMatchKey(query);
    return key.length > 0 && all.findIndex((item) => skuMatchKey(item) === key) === index;
  });
  let hit: CatalogSkuHit | undefined;
  let otherCollection: CatalogSkuHit | undefined;
  for (const query of queries) {
    const found = matchPortalCandidate(
      await catalogSkus(baseUrl, cookie, customerCode, query, cache),
      candidates,
      collectionCode,
    );
    if (!found) continue;
    if (found.collectionCode === collectionCode) {
      hit = found;
      break;
    }
    otherCollection ??= found;
  }
  hit ??= otherCollection;
  if (!hit) return { tried: candidates, match: null, message: 'Not found in the Thorogood catalog.' };
  if (!hit.collectionCode) {
    return {
      tried: candidates,
      match: null,
      message: `Thorogood product ${hit.productCode} did not include a collection.`,
    };
  }
  return {
    tried: candidates,
    match: {
      productCode: hit.productCode,
      collectionCode: hit.collectionCode,
      skuCode: hit.skuCode,
      qty: line.quantity,
      sellerSku,
    },
    message: '',
  };
}

export interface ThorogoodImportReady {
  sellerSku: string;
  portalSku: string;
  quantity: number;
}

export interface ThorogoodImportIssue {
  sellerSku: string;
  portalSku: string;
  quantity: number;
  tried: string[];
  message: string;
}

interface ClassifiedImport {
  ready: ThorogoodImportReady[];
  issues: ThorogoodImportIssue[];
  resolved: Array<ResolvedSku & { sellerSku: string }>;
  existing: Record<string, unknown>;
  existingShipments: unknown[];
  code: string;
}

const MAX_IMPORT_SKUS = 200;

async function classifyThorogoodImportLines(
  baseUrl: string,
  cookie: string,
  portalOrderCode: string,
  shipmentIndex: number,
  lines: ThorogoodImportLine[],
  customerCodeHint: string,
  affixes: { prefixes: readonly string[]; suffixes: readonly string[] },
): Promise<ClassifiedImport> {
  if (lines.length === 0) throw new HhB2bDraftError('The file has no items.');
  if (lines.length > MAX_IMPORT_SKUS) {
    throw new HhB2bDraftError(`The file has too many SKUs (max ${MAX_IMPORT_SKUS}).`);
  }
  const code = portalOrderCode.trim();
  if (!code) throw new HhB2bDraftError('This order has no Thorogood draft to edit.');

  const existing = unwrap(await envoyRequest(baseUrl, cookie, `/api/b2b/orders/${encodeURIComponent(code)}`));
  const status = asString(existing.status).toUpperCase();
  if (status && status !== 'DRAFT') {
    throw new HhB2bDraftError(`This Thorogood order is ${status} and can no longer be edited.`);
  }
  const existingShipments = Array.isArray(existing.shipments) ? existing.shipments : [];
  const current = asRecord(existingShipments[shipmentIndex]);
  if (!current) throw new HhB2bDraftError('Shipment not found on the Thorogood draft.');
  const collectionCode = asString(current.collectionCode);
  if (!collectionCode) throw new HhB2bDraftError('This shipment has no catalog on the Thorogood draft.');

  const customerCode = asString(existing.customerCode) || customerCodeHint.trim();
  if (!/^\d+$/.test(customerCode)) throw new HhB2bDraftError('Sold to must be a customer number.');

  const cache = new Map<string, CatalogSkuHit[]>();
  const resolved: Array<ResolvedSku & { sellerSku: string }> = [];
  const issues: ThorogoodImportIssue[] = [];
  for (const line of lines) {
    const found = await resolveImportLine(baseUrl, cookie, customerCode, collectionCode, line, affixes, cache);
    const match = found.match;
    if (!match || match.collectionCode !== collectionCode) {
      issues.push({
        sellerSku: line.sellerSku.trim(),
        portalSku: line.portalSku.trim(),
        quantity: line.quantity,
        tried: found.tried,
        message: match ? "Not in this shipment's catalog." : found.message,
      });
      continue;
    }
    const existingLine = resolved.find((row) => row.productCode === match.productCode && row.skuCode === match.skuCode);
    if (existingLine) {
      existingLine.qty += match.qty;
      existingLine.sellerSku = joinSellerCodes(existingLine.sellerSku, match.sellerSku);
    } else {
      resolved.push({ ...match });
    }
  }

  return {
    ready: resolved.map((line) => ({
      sellerSku: line.sellerSku,
      portalSku: line.skuCode,
      quantity: line.qty,
    })),
    issues,
    resolved,
    existing,
    existingShipments,
    code: asString(existing.code) || code,
  };
}

/** Catalog check only. Nothing is written to the Thorogood draft. */
export async function previewThorogoodImportLines(
  baseUrl: string,
  cookie: string,
  portalOrderCode: string,
  shipmentIndex: number,
  lines: ThorogoodImportLine[],
  customerCodeHint: string,
  affixes: { prefixes: readonly string[]; suffixes: readonly string[] },
): Promise<{ ready: ThorogoodImportReady[]; issues: ThorogoodImportIssue[] }> {
  const classified = await classifyThorogoodImportLines(
    baseUrl,
    cookie,
    portalOrderCode,
    shipmentIndex,
    lines,
    customerCodeHint,
    affixes,
  );
  return { ready: classified.ready, issues: classified.issues };
}

/**
 * Replaces one draft shipment's sizes from SKU, B2B SKU, and quantity rows.
 * A filled B2B SKU is ordered as written. Otherwise the seller SKU is converted
 * with the Bulk Order start and end strings, then confirmed against the catalog.
 * Other shipments stay as they are. Does not submit the order.
 */
export async function importThorogoodShipmentItems(
  baseUrl: string,
  cookie: string,
  portalOrderCode: string,
  shipmentIndex: number,
  lines: ThorogoodImportLine[],
  customerCodeHint: string,
  affixes: { prefixes: readonly string[]; suffixes: readonly string[] },
): Promise<ThorogoodImportedLine[]> {
  const classified = await classifyThorogoodImportLines(
    baseUrl,
    cookie,
    portalOrderCode,
    shipmentIndex,
    lines,
    customerCodeHint,
    affixes,
  );
  const firstIssue = classified.issues[0];
  if (firstIssue) {
    const tried = firstIssue.tried.length ? ` Searched ${firstIssue.tried.join(', ')}.` : '';
    throw new HhB2bDraftError(`${importLineLabel(firstIssue)}: ${firstIssue.message}${tried}`);
  }
  const { existing, existingShipments, resolved, code } = classified;

  const byProduct = new Map<string, ResolvedSku[]>();
  for (const line of resolved) {
    const rows = byProduct.get(line.productCode) ?? [];
    rows.push(line);
    byProduct.set(line.productCode, rows);
  }
  const products = [...byProduct.entries()].map(([productCode, skus]) => ({
    code: productCode,
    key: randomUUID(),
    skus: skus.map((sku) => ({
      code: sku.skuCode,
      distributionCenter: DISTRIBUTION_CENTER,
      qty: sku.qty,
    })),
  }));

  const shipments = existingShipments.map((raw, index) => {
    const shipment = asRecord(raw) ?? {};
    if (index !== shipmentIndex) return shipment;
    return { ...shipment, products };
  });
  const updated = {
    ...existing,
    code: asString(existing.code) || code,
    shipments,
    status: 'DRAFT',
    isSubmitting: false,
  };
  await envoyRequest(baseUrl, cookie, `/api/b2b/orders/${encodeURIComponent(code)}`, {
    method: 'PUT',
    body: JSON.stringify(updated),
  });

  return resolved.map((line) => ({
    portalSku: line.skuCode,
    sellerSku: line.sellerSku,
    quantity: line.qty,
  }));
}

function lineItemsFromShipment(shipment: Record<string, unknown> | null): ThorogoodLineItem[] {
  const products = Array.isArray(shipment?.products) ? shipment.products : [];
  const items: ThorogoodLineItem[] = [];
  for (const productRaw of products) {
    const product = asRecord(productRaw);
    const skus = Array.isArray(product?.skus) ? product.skus : [];
    for (const skuRaw of skus) {
      const sku = asRecord(skuRaw);
      const code = asString(sku?.code);
      const qty = asQty(sku?.qty);
      if (!code || qty <= 0) continue;
      const existing = items.find((item) => item.sku === code);
      if (existing) existing.quantity += qty;
      else items.push({ sku: code, quantity: qty });
    }
  }
  return items;
}

/** SKUs on every shipment of an existing Thorogood draft, in shipment order. */
export async function listThorogoodOrderItems(
  baseUrl: string,
  cookie: string,
  orderCode: string
): Promise<ThorogoodLineItem[][]> {
  const order = unwrap(await envoyRequest(baseUrl, cookie, `/api/b2b/orders/${encodeURIComponent(orderCode)}`));
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  return shipments.map((raw) => lineItemsFromShipment(asRecord(raw)));
}

/** SKUs on one shipment of an existing Thorogood draft. */
export async function listThorogoodShipmentItems(
  baseUrl: string,
  cookie: string,
  orderCode: string,
  shipmentIndex: number
): Promise<ThorogoodLineItem[]> {
  const shipments = await listThorogoodOrderItems(baseUrl, cookie, orderCode);
  return shipments[shipmentIndex] ?? [];
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
