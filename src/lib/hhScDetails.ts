import type { ScOrderPayload } from './hhSellerCentral';

export interface HhScLineItem {
  title: string;
  sku: string;
  asin: string;
  imageUrl: string;
  quantity: number;
  unitPrice: number;
  tax: number;
}

export interface HhScFill {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  items: HhScLineItem[];
  sellerNotes: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function moneyAmount(value: unknown): number {
  const record = asRecord(value);
  const amount = asNumber(record?.Amount);
  return amount ?? 0;
}

export function composeCityStatePostal(city: string, state: string, postalCode: string): string {
  const cityState = [city, state].filter(Boolean).join(', ');
  return [cityState, postalCode].filter(Boolean).join(' ');
}

function mapItems(orderItems: unknown[]): HhScLineItem[] {
  const items: HhScLineItem[] = [];
  for (const raw of orderItems) {
    const item = asRecord(raw);
    if (!item) continue;
    const quantity = asNumber(item.QuantityOrdered) ?? 0;
    const cost = asRecord(item.ItemCost);
    const unit = moneyAmount(cost?.UnitPrice);
    const subtotal = moneyAmount(cost?.Subtotal);
    const tax = moneyAmount(cost?.Tax);
    const unitPrice = unit > 0 ? unit : quantity > 0 ? subtotal / quantity : subtotal;
    const sku = asString(item.SellerSKU);
    const asin = asString(item.ASIN);
    const title = asString(item.Title) || sku || asin;
    if (!title && !sku && quantity <= 0) continue;
    items.push({
      title: (title || 'Item').slice(0, 500),
      sku: (sku || asin || 'UNKNOWN').slice(0, 120),
      asin: asin.slice(0, 40),
      imageUrl: asString(item.ImageUrl).slice(0, 500),
      quantity,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      tax: Number.isFinite(tax) ? tax : 0,
    });
  }
  return items;
}

function pickBuyerInfo(body: unknown, orderId: string): Record<string, unknown> | null {
  const root = asRecord(body);
  if (!root) return null;
  const direct = asRecord(root[orderId]);
  if (direct) return direct;
  for (const value of Object.values(root)) {
    const record = asRecord(value);
    if (record?.address || record?.buyerName) return record;
  }
  return null;
}

export function mapScFill(order: ScOrderPayload, buyerBody: unknown | null): HhScFill {
  const buyer = buyerBody ? pickBuyerInfo(buyerBody, order.amazonOrderId) : null;
  const address = asRecord(buyer?.address);
  const city = asString(address?.city);
  const state = asString(address?.stateOrRegion);
  const postalCode = asString(address?.postalCode);
  const street = [asString(address?.line1), asString(address?.line2), asString(address?.line3)].filter(Boolean);
  const customerName =
    asString(address?.name) || asString(buyer?.buyerName) || asString(buyer?.recipientCustomerName);
  const customerPhone = asString(address?.phoneNumber) || asString(buyer?.recipientCustomerPhone);

  return {
    customerName: customerName.slice(0, 200),
    customerEmail: order.buyerProxyEmail.slice(0, 200),
    customerPhone: customerPhone.slice(0, 80),
    addressLine1: asString(address?.line1).slice(0, 200),
    addressLine2: street.slice(1).join(', ').slice(0, 200),
    city: city.slice(0, 80),
    state: state.slice(0, 40),
    postalCode: postalCode.slice(0, 20),
    country: (asString(address?.countryCode) || 'US').slice(0, 8),
    items: mapItems(order.orderItems),
    sellerNotes: order.sellerNotes,
  };
}
