import type { HhB2bDraftAddress, HhB2bDraftItem, HhB2bDraftRequest } from './hhB2b';
import { HhB2bAuthError, HhB2bDraftError } from './hhB2bConfig';
import type { HhB2bConfig } from './hhB2bConfig';

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_RETRY_MS = 750;
/** Portal Ship Via option labeled Default. */
const HH_B2B_DEFAULT_SHIP_VIA = '-';
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

function fetchFailureDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  const cause = 'cause' in err ? err.cause : undefined;
  if (cause instanceof Error) {
    const code = 'code' in cause && cause.code != null ? String(cause.code) : '';
    if (code && !cause.message.includes(code) && !err.message.includes(code)) parts.push(code);
    if (cause.message && cause.message !== err.message) parts.push(cause.message);
  } else if (cause != null && typeof cause === 'object' && 'code' in cause) {
    parts.push(String((cause as { code?: unknown }).code));
  }
  return parts.filter(Boolean).join(' — ');
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

/** Catalog and document lookups are safe to repeat. Place and Ship Via writes are not. */
function isReadRequest(init: RequestInit): boolean {
  const method = (init.method ?? 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

export function isHhB2bRequestTimeout(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message.startsWith('B2B request timed out:');
}

/** Shown when Place could not read the draft. The document was not submitted. */
export const HH_B2B_READ_TIMEOUT_PLACE_MESSAGE =
  'B2B timed out reading the cart. Place this order again — the draft was not changed.';

const HH_B2B_PLACE_UNCONFIRMED_MESSAGE =
  'B2B place timed out before the order could be confirmed. Place this order again without regenerating the cart.';

const HH_B2B_PLACE_STILL_DRAFT_MESSAGE =
  'B2B place timed out. The cart is still a draft — place this order again.';

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

  const read = isReadRequest(init);
  let res: Response | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(url, { ...init, headers, signal: controller.signal });
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      const timedOut = isAbortError(err);
      const retry = attempt === 0 && (read || !timedOut);
      if (retry) {
        console.warn(`[hh-b2b] ${path} ${timedOut ? 'timed out' : fetchFailureDetail(err)} — retrying`);
        await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_MS));
        continue;
      }
      if (timedOut) {
        throw new HhB2bDraftError(`B2B request timed out: ${path}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  if (!res) {
    throw new HhB2bDraftError(`B2B request failed on ${path}: ${fetchFailureDetail(lastErr)}`);
  }

  const text = await res.text();
  const looksHtml = /^\s*</.test(text) || /<html/i.test(text);
  if (res.status === 401 || res.status === 403 || looksHtml) {
    throw new HhB2bAuthError('B2B session is stale — refresh the cookie');
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

/** Same keys as submitted Helly Hansen drop-ship carts. Address * binds to address1. */
function toDropShipAddress(address: HhB2bDraftAddress): Record<string, string> {
  return {
    name: asString(address.name),
    address1: asString(address.line1),
    address2: asString(address.line2),
    address3: '',
    city: asString(address.city),
    state: asString(address.state),
    zip: asString(address.postalCode),
    country: asString(address.country) || 'US',
    phone: asString(address.phone),
    email: '',
  };
}

function addToCartPayload(
  config: HhB2bConfig,
  request: HhB2bDraftRequest,
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
        purchase_order: asString(request.po) || null,
        customer_number: config.accountId,
        location_number: null,
        client_fields: { ship_via: request.shipVia === 'MSB' ? 'MSB' : HH_B2B_DEFAULT_SHIP_VIA },
        programs: [],
        page_products: pageProducts,
        drop_ship_address: toDropShipAddress(request.address),
      },
    ],
    whiteboard: null,
    client_fields: {},
  };
}

/** Read-only catalog search. Empty results still prove the session and API are up. */
export async function probeHhB2bSession(config: HhB2bConfig, cookie: string): Promise<void> {
  await searchStyle(config, cookie, 'hh-session-probe');
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

export async function fetchHhB2bDocument(
  config: HhB2bConfig,
  cookie: string,
  documentId: string
): Promise<Record<string, unknown>> {
  const record = await fetchDocument(config, cookie, documentId);
  if (!record) {
    throw new HhB2bDraftError('B2B document lookup returned an empty body');
  }
  const error = record.error;
  if (error) {
    throw new HhB2bDraftError(`B2B document lookup failed: ${typeof error === 'string' ? error : JSON.stringify(error)}`);
  }
  return record;
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

function slimPageItem(item: Record<string, unknown>): PageItem {
  const quantity = Number(item.quantity);
  const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
  const pageItem: PageItem = {
    stock_item_key: asString(item.stock_item_key),
    stock_item_sku: asString(item.stock_item_sku),
    stock_item_upc: asString(item.stock_item_upc),
    quantity: safeQuantity,
    reference_quantity: null,
  };
  if (safeQuantity > 0) {
    pageItem.quantity_source = [{ source: 'NA', quantity: safeQuantity }];
  }
  return pageItem;
}

/** Create-shaped body. Posting the raw GET document back 404s; the portal saves with this shape. */
function placeOrderPayload(document: Record<string, unknown>, documentId: string): Record<string, unknown> {
  const pages = Array.isArray(document.pages) ? document.pages : [];
  return {
    _id: documentId,
    name: asString(document.name) || 'Elastic Order',
    note: asString(document.note),
    notes: asString(document.notes),
    catalog_key: asString(document.catalog_key),
    customer: asString(document.customer),
    payment: null,
    version_created: asString(document.version_created) || 'dbf01d3',
    version_updated: asString(document.version_updated) || 'dbf01d3',
    client_created: asString(document.client_created) || 'scramble',
    client_updated: 'scramble',
    platform_created: asString(document.platform_created) || USER_AGENT,
    platform_updated: USER_AGENT,
    programs: [],
    do_submit: true,
    do_review: false,
    do_reject: false,
    duplicated_from_id: null,
    duplicated_for: null,
    share_to: null,
    share_to_selection: null,
    shared_to: null,
    shared_by: null,
    copied_to: null,
    pages: pages.map((pageRaw) => {
      const page = asRecord(pageRaw) ?? {};
      const products = Array.isArray(page.page_products) ? page.page_products : [];
      return {
        name: asString(page.name) || 'Shipment 1',
        type: asString(page.type),
        note: page.note ?? null,
        arrive_on: asString(page.arrive_on),
        cancel_on: asString(page.cancel_on),
        purchase_order: asString(page.purchase_order) || null,
        customer_number: asString(page.customer_number) || asString(document.customer),
        location_number: page.location_number ?? null,
        client_fields: asRecord(page.client_fields) ?? {},
        programs: [],
        page_products: products.map((productRaw, index) => {
          const product = asRecord(productRaw) ?? {};
          const items = Array.isArray(product.page_items) ? product.page_items : [];
          return {
            product_number: asString(product.product_number),
            color_code: asString(product.color_code),
            position: Number(product.position) || index + 1,
            page_items: items.map((item) => slimPageItem(asRecord(item) ?? {})),
            coordination_group: null,
          };
        }),
        drop_ship_address: asRecord(page.drop_ship_address) ?? {},
      };
    }),
    whiteboard: null,
    client_fields: asRecord(document.client_fields) ?? {},
  };
}

function assertOrderSubmitted(record: Record<string, unknown> | null): void {
  const error = record?.error;
  if (error) {
    throw new HhB2bDraftError(`B2B place failed: ${typeof error === 'string' ? error : JSON.stringify(error)}`);
  }
  if (asString(record?.type) === 'error') {
    throw new HhB2bDraftError(asString(record?.content) || 'B2B place failed');
  }
  if (asString(record?.state) === 'draft') {
    throw new HhB2bDraftError('B2B place did not submit the draft');
  }
}

function pageShipVia(document: Record<string, unknown>): string {
  const pages = Array.isArray(document.pages) ? document.pages : [];
  const page = asRecord(pages[0]);
  const fields = asRecord(page?.client_fields);
  return asString(fields?.ship_via);
}

/** Change Ship Via on the existing draft. The document id and order number stay. */
export async function updateHellyHansenSportsShipVia(
  config: HhB2bConfig,
  cookie: string,
  documentId: string,
  shipVia: string
): Promise<void> {
  const id = documentId.trim();
  if (!id || !looksLikeMongoObjectId(id)) {
    throw new HhB2bDraftError('Cannot change Ship Via without a live Helly Hansen document id');
  }
  const code = shipVia === 'MSB' ? 'MSB' : HH_B2B_DEFAULT_SHIP_VIA;
  const document = await fetchHhB2bDocument(config, cookie, id);
  const payload = placeOrderPayload(document, id);
  payload.do_submit = false;
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  for (const pageRaw of pages) {
    const page = asRecord(pageRaw);
    if (!page) continue;
    const fields = asRecord(page.client_fields) ?? {};
    page.client_fields = { ...fields, ship_via: code };
  }
  const updated = await b2bRequest(config, cookie, `/api/documents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  const record = asRecord(updated);
  const error = record?.error;
  if (error) {
    throw new HhB2bDraftError(`B2B Ship Via update failed: ${typeof error === 'string' ? error : JSON.stringify(error)}`);
  }
  if (asString(record?.type) === 'error') {
    throw new HhB2bDraftError(asString(record?.content) || 'B2B Ship Via update failed');
  }
  const fresh = await fetchHhB2bDocument(config, cookie, id);
  const actual = pageShipVia(fresh);
  if (actual !== code) {
    throw new HhB2bDraftError(`B2B kept Ship Via "${actual || 'blank'}" instead of "${code}"`);
  }
}

type DocumentSubmitState = 'draft' | 'submitted' | 'unknown';

/** A missing state is unknown. Only a non-draft state means the order was already sent. */
function documentSubmitState(record: Record<string, unknown> | null): DocumentSubmitState {
  if (!record || record.error || asString(record.type) === 'error') return 'unknown';
  const state = asString(record.state).toLowerCase();
  if (!state) return 'unknown';
  if (state === 'draft') return 'draft';
  return 'submitted';
}

async function fetchPlaceDocument(
  config: HhB2bConfig,
  cookie: string,
  id: string,
  purpose: 'before-place' | 'confirm'
): Promise<Record<string, unknown>> {
  try {
    return await fetchHhB2bDocument(config, cookie, id);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[hh-b2b] ${id} ${detail}`);
    if (!isHhB2bRequestTimeout(err)) throw err;
    throw new HhB2bDraftError(
      purpose === 'before-place' ? HH_B2B_READ_TIMEOUT_PLACE_MESSAGE : HH_B2B_PLACE_UNCONFIRMED_MESSAGE
    );
  }
}

async function putPlaceOrder(
  config: HhB2bConfig,
  cookie: string,
  id: string,
  document: Record<string, unknown>
): Promise<void> {
  const created = await b2bRequest(config, cookie, `/api/documents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(placeOrderPayload(document, id)),
  });
  assertOrderSubmitted(asRecord(created));
}

/**
 * Submit a draft once. A timed-out submit is checked with a fresh read.
 * A second submit happens only when that read still shows a draft.
 */
export async function submitHellyHansenSportsOrder(
  config: HhB2bConfig,
  cookie: string,
  documentId: string
): Promise<void> {
  const id = documentId.trim();
  if (!id || !looksLikeMongoObjectId(id)) {
    throw new HhB2bDraftError('Cannot place an order without a live Helly Hansen document id');
  }

  const document = await fetchPlaceDocument(config, cookie, id, 'before-place');
  if (documentSubmitState(document) === 'submitted') {
    console.log(`[hh-b2b] ${id} is already submitted — not placing again`);
    return;
  }

  try {
    await putPlaceOrder(config, cookie, id, document);
    return;
  } catch (err) {
    if (!isHhB2bRequestTimeout(err)) throw err;
    console.warn(`[hh-b2b] ${id} place timed out — checking the document before another submit`);
  }

  const fresh = await fetchPlaceDocument(config, cookie, id, 'confirm');
  const freshState = documentSubmitState(fresh);
  if (freshState === 'submitted') {
    console.log(`[hh-b2b] ${id} is submitted after the place timeout`);
    return;
  }
  if (freshState !== 'draft') {
    throw new HhB2bDraftError(HH_B2B_PLACE_UNCONFIRMED_MESSAGE);
  }

  console.warn(`[hh-b2b] ${id} is still a draft — submitting once more`);
  try {
    await putPlaceOrder(config, cookie, id, fresh);
  } catch (err) {
    if (!isHhB2bRequestTimeout(err)) throw err;
    console.warn(`[hh-b2b] ${id} follow-up place timed out — checking the document`);
    const confirmed = await fetchPlaceDocument(config, cookie, id, 'confirm');
    const confirmedState = documentSubmitState(confirmed);
    if (confirmedState === 'submitted') {
      console.log(`[hh-b2b] ${id} is submitted after the follow-up place`);
      return;
    }
    throw new HhB2bDraftError(
      confirmedState === 'draft' ? HH_B2B_PLACE_STILL_DRAFT_MESSAGE : HH_B2B_PLACE_UNCONFIRMED_MESSAGE
    );
  }
}

function skuLabel(item: HhB2bDraftItem): string {
  const sku = item.sku.trim();
  const title = item.title.trim();
  return title ? `SKU ${sku} (${title})` : `SKU ${sku}`;
}

function skuNotInCatalogMessage(items: HhB2bDraftItem[], catalog: string): string {
  const labels = items.map(skuLabel);
  if (labels.length === 1) return `${labels[0]} was not found in ${catalog}`;
  return `${labels.join('; ')} were not found in ${catalog}`;
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
    const missing = group.items.filter(
      (item) => !pageItems.some((row) => row.stock_item_sku === item.sku)
    );
    if (pageItems.length === 0 || missing.length > 0) {
      throw new HhB2bDraftError(skuNotInCatalogMessage(missing.length > 0 ? missing : group.items, config.catalog));
    }
    for (const item of group.items) {
      const match = pageItems.find((row) => row.stock_item_sku === item.sku);
      if (!match) {
        throw new HhB2bDraftError(skuNotInCatalogMessage([item], config.catalog));
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

  const payload = addToCartPayload(config, request, arriveOn, cancelOn, pageProducts);
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
