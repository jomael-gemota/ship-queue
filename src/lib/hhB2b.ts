/**
 * B2B ASAP / Builder Cart client (Helly Hansen Sports / Scramble).
 *
 * Cart drafts go through HTTP calls that imitate the B2B site — not Puppeteer.
 * Place Order (`do_submit: true`) is a separate path in hhCartPlace, gated by brand config.
 */

import { hhBrandId, type HHBrandId } from './hhBrand';
import {
  HhB2bDraftError,
  hhB2bArriveAndCancel,
  loadHhB2bConfig,
  loadHhB2bCookie,
} from './hhB2bConfig';
import { createHellyHansenSportsDraft } from './hhB2bHellyHansen';

export { HhB2bAuthError, HhB2bDraftError } from './hhB2bConfig';

export interface HhB2bDraftItem {
  sku: string;
  asin: string;
  title: string;
  quantity: number;
  unitPrice: number;
}

export interface HhB2bDraftAddress {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

export interface HhB2bDraftRequest {
  amazonOrderId: string;
  po: string;
  address: HhB2bDraftAddress;
  items: HhB2bDraftItem[];
}

export interface HhB2bDraftResult {
  draftId: string;
  orderNumber: string;
  remote: boolean;
}

export function assertHhB2bDraftRequest(request: HhB2bDraftRequest): void {
  if (!request.amazonOrderId.trim()) {
    throw new HhB2bDraftError('Cannot draft a cart without an Amazon Order ID.');
  }
  if (!request.po.trim()) {
    throw new HhB2bDraftError('Cannot draft a cart without a PO Number.');
  }
  if (request.items.length === 0) {
    throw new HhB2bDraftError('Cannot draft a cart with no line items.');
  }
}

/** Create a B2B cart draft and stop there (no Place Order). */
export async function createHhB2bDraft(
  request: HhB2bDraftRequest,
  brand: HHBrandId | unknown = 'sportswear'
): Promise<HhB2bDraftResult> {
  assertHhB2bDraftRequest(request);
  const brandId = hhBrandId(brand);
  const config = await loadHhB2bConfig(brandId);
  const cookie = await loadHhB2bCookie(brandId);
  const { arriveOn, cancelOn } = hhB2bArriveAndCancel();
  const created = await createHellyHansenSportsDraft(config, cookie, request, arriveOn, cancelOn);
  console.log(
    `[hh-b2b] Drafted ${request.amazonOrderId} PO ${request.po} on ${config.catalog} · Order #${created.orderNumber}`
  );
  return { draftId: created.documentId, orderNumber: created.orderNumber, remote: true };
}
