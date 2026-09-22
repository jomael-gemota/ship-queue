import type { IHHChildOrder } from '../models/HHOrderGroup';
import { hhCartItems } from './hhLineItems';

export interface HhVerifyIssue {
  field: string;
  label: string;
  expected: string;
  actual: string;
}

export interface HhVerifyItem {
  sku: string;
  quantity: number;
}

export interface HhVerifySnapshot {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  po: string;
  orderNumber: string;
  items: HhVerifyItem[];
}

export interface HhCompareRow {
  field: string;
  label: string;
  expected: string;
  actual: string;
  match: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
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

function fold(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeCountry(value: string): string {
  const folded = fold(value);
  if (!folded || folded === 'US' || folded === 'USA' || folded === 'UNITED STATES') return 'US';
  return folded;
}

function normalizeZip(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 5) return digits.slice(0, 5);
  return fold(value);
}

function firstPage(document: Record<string, unknown>): Record<string, unknown> {
  const pages = Array.isArray(document.pages) ? document.pages : [];
  return asRecord(pages[0]) ?? {};
}

function dropShipAddress(page: Record<string, unknown>): Record<string, unknown> {
  return asRecord(page.drop_ship_address) ?? {};
}

function display(value: string): string {
  return value.trim() || '—';
}

function itemsFromQty(qtyBySku: Map<string, number>): HhVerifyItem[] {
  return [...qtyBySku.entries()]
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Live Helly Hansen street line — submitted carts use address1; older drafts used street1/address. */
export function liveDropShipStreet1(address: Record<string, unknown>): string {
  const nested = asRecord(address.address);
  return (
    asString(address.address1) ||
    asString(address.street1) ||
    asString(address.address) ||
    asString(nested?.street1) ||
    asString(nested?.address1)
  );
}

export function liveDropShipStreet2(address: Record<string, unknown>): string {
  const nested = asRecord(address.address);
  return asString(address.address2) || asString(address.street2) || asString(nested?.street2) || asString(nested?.address2);
}

export function liveB2bQuantities(document: Record<string, unknown>): Map<string, number> {
  const qtyBySku = new Map<string, number>();
  const page = firstPage(document);
  const products = Array.isArray(page.page_products) ? page.page_products : [];
  for (const productRaw of products) {
    const product = asRecord(productRaw);
    const items = Array.isArray(product?.page_items) ? product.page_items : [];
    for (const itemRaw of items) {
      const item = asRecord(itemRaw);
      if (!item) continue;
      const sku = asString(item.stock_item_sku);
      const quantity = asQty(item.quantity);
      if (!sku || quantity <= 0) continue;
      qtyBySku.set(sku, (qtyBySku.get(sku) ?? 0) + quantity);
    }
  }
  return qtyBySku;
}

function detailQuantities(child: IHHChildOrder): Map<string, number> {
  const qtyBySku = new Map<string, number>();
  for (const item of hhCartItems(child.items)) {
    const sku = (item.sku ?? '').trim();
    if (!sku || item.quantity <= 0) continue;
    qtyBySku.set(sku, (qtyBySku.get(sku) ?? 0) + item.quantity);
  }
  return qtyBySku;
}

export function snapshotFromChild(child: IHHChildOrder): HhVerifySnapshot {
  return {
    name: child.customerName ?? '',
    address1: child.addressLine1 ?? '',
    address2: child.addressLine2 ?? '',
    city: child.city ?? '',
    state: child.state ?? '',
    zip: child.postalCode ?? '',
    country: child.country ?? '',
    po: child.po ?? '',
    orderNumber: child.referenceNumber ?? '',
    items: itemsFromQty(detailQuantities(child)),
  };
}

export function snapshotFromB2bDocument(document: Record<string, unknown>): HhVerifySnapshot {
  const page = firstPage(document);
  const address = dropShipAddress(page);
  return {
    name: asString(address.name),
    address1: liveDropShipStreet1(address),
    address2: liveDropShipStreet2(address),
    city: asString(address.city),
    state: asString(address.state),
    zip: asString(address.zip),
    country: asString(address.country),
    po: asString(page.purchase_order),
    orderNumber: asString(document.number) || asString(document.order_number) || asString(document.orderNumber),
    items: itemsFromQty(liveB2bQuantities(document)),
  };
}

function pushRow(
  rows: HhCompareRow[],
  field: string,
  label: string,
  expected: string,
  actual: string,
  match: boolean
): void {
  rows.push({
    field,
    label,
    expected: display(expected),
    actual: display(actual),
    match,
  });
}

/** Side-by-side rows for order details vs live B2B cart, including matches. */
export function compareSnapshots(details: HhVerifySnapshot, cart: HhVerifySnapshot): HhCompareRow[] {
  const rows: HhCompareRow[] = [];
  pushRow(rows, 'name', 'Name', details.name, cart.name, fold(details.name) === fold(cart.name));
  pushRow(rows, 'address1', 'Address', details.address1, cart.address1, fold(details.address1) === fold(cart.address1));
  pushRow(rows, 'address2', 'Address 2', details.address2, cart.address2, fold(details.address2) === fold(cart.address2));
  pushRow(rows, 'city', 'City', details.city, cart.city, fold(details.city) === fold(cart.city));
  pushRow(rows, 'state', 'State', details.state, cart.state, fold(details.state) === fold(cart.state));
  pushRow(rows, 'zip', 'ZIP', details.zip, cart.zip, normalizeZip(details.zip) === normalizeZip(cart.zip));
  pushRow(
    rows,
    'country',
    'Country',
    details.country,
    cart.country,
    normalizeCountry(details.country) === normalizeCountry(cart.country)
  );
  pushRow(rows, 'po', 'PO', details.po, cart.po, fold(details.po) === fold(cart.po));
  if (details.orderNumber || cart.orderNumber) {
    pushRow(
      rows,
      'orderNumber',
      'Order #',
      details.orderNumber,
      cart.orderNumber,
      fold(details.orderNumber) === fold(cart.orderNumber)
    );
  }

  const expectedItems = new Map(details.items.map((item) => [item.sku, item.quantity]));
  const actualItems = new Map(cart.items.map((item) => [item.sku, item.quantity]));
  const skuKeys = [...new Set([...expectedItems.keys(), ...actualItems.keys()])].sort();
  for (const sku of skuKeys) {
    const expectedQty = expectedItems.get(sku) ?? 0;
    const actualQty = actualItems.get(sku) ?? 0;
    pushRow(rows, `sku:${sku}`, `SKU ${sku}`, String(expectedQty), String(actualQty), expectedQty === actualQty);
  }

  return rows;
}

export function issuesFromCompareRows(rows: HhCompareRow[]): HhVerifyIssue[] {
  return rows
    .filter((row) => !row.match && row.field !== 'orderNumber')
    .map((row) => ({
      field: row.field,
      label: row.label,
      expected: row.expected,
      actual: row.actual,
    }));
}

/** Compare stored Seller Central order details to a live Helly Hansen B2B document. */
export function compareHhDetailsToB2bDraft(child: IHHChildOrder, document: Record<string, unknown>): HhVerifyIssue[] {
  return issuesFromCompareRows(compareSnapshots(snapshotFromChild(child), snapshotFromB2bDocument(document)));
}
