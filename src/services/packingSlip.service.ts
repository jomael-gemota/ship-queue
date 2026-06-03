import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import type { ShipStationLabelAddress } from './shipstationLabel.service';

export interface PackingSlipSku {
  sku?: string;
  quantity?: number;
}

export interface PackingSlipData {
  poNumber?: string;
  orderNumber?: string;
  customerName?: string;
  shipDate?: string;
  trackingNumber?: string;
  carrierCode?: string;
  serviceCode?: string;
  shipFrom?: ShipStationLabelAddress;
  shipTo?: ShipStationLabelAddress;
  skus?: PackingSlipSku[];
}

const PAGE_WIDTH = 612; // US Letter (8.5in)
const PAGE_HEIGHT = 792; // US Letter (11in)
const MARGIN = 50;
const TEXT_COLOR = rgb(0.1, 0.1, 0.1);
const MUTED_COLOR = rgb(0.4, 0.4, 0.4);
const LINE_COLOR = rgb(0.8, 0.8, 0.8);

function formatAddress(addr?: ShipStationLabelAddress): string[] {
  if (!addr) return ['—'];
  const lines: string[] = [];
  if (addr.name) lines.push(addr.name);
  if (addr.company) lines.push(addr.company);
  if (addr.street1) lines.push(addr.street1);
  if (addr.street2) lines.push(addr.street2);
  if (addr.street3) lines.push(addr.street3);
  const cityLine = [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ');
  if (cityLine) lines.push(cityLine);
  if (addr.country) lines.push(addr.country);
  if (addr.phone) lines.push(addr.phone);
  return lines.length ? lines : ['—'];
}

/** Draws a left-aligned text block and returns the y position after the block. */
function drawLines(
  page: PDFPage,
  lines: string[],
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  lineGap = 4
): number {
  let cursor = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursor, size, font, color: TEXT_COLOR });
    cursor -= size + lineGap;
  }
  return cursor;
}

/**
 * Builds a single-page packing slip PDF from order data and returns it as raw
 * bytes. Used as a fallback when a ShipStation-native slip is unavailable.
 */
async function buildPackingSlipPdf(data: PackingSlipData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const right = PAGE_WIDTH - MARGIN;
  let y = PAGE_HEIGHT - MARGIN;

  page.drawText('PACKING SLIP', { x: MARGIN, y, size: 22, font: bold, color: TEXT_COLOR });
  y -= 30;

  const meta: [string, string][] = [
    ['PO #', data.poNumber || '—'],
    ['Order #', data.orderNumber || '—'],
    ['Ship Date', data.shipDate || '—'],
    ['Tracking #', data.trackingNumber || '—'],
  ];
  for (const [label, value] of meta) {
    page.drawText(label, { x: MARGIN, y, size: 10, font: bold, color: MUTED_COLOR });
    page.drawText(value, { x: MARGIN + 80, y, size: 10, font, color: TEXT_COLOR });
    y -= 16;
  }

  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: LINE_COLOR });
  y -= 24;

  const colTop = y;
  const colRightX = MARGIN + (PAGE_WIDTH - 2 * MARGIN) / 2;

  page.drawText('SHIP FROM', { x: MARGIN, y: colTop, size: 10, font: bold, color: MUTED_COLOR });
  page.drawText('SHIP TO', { x: colRightX, y: colTop, size: 10, font: bold, color: MUTED_COLOR });

  const fromEnd = drawLines(page, formatAddress(data.shipFrom), MARGIN, colTop - 18, font, 10);
  const toEnd = drawLines(page, formatAddress(data.shipTo), colRightX, colTop - 18, font, 10);

  y = Math.min(fromEnd, toEnd) - 16;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: LINE_COLOR });
  y -= 24;

  const qtyColX = right - 60;
  page.drawText('SKU', { x: MARGIN, y, size: 10, font: bold, color: MUTED_COLOR });
  page.drawText('QTY', { x: qtyColX, y, size: 10, font: bold, color: MUTED_COLOR });
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: LINE_COLOR });
  y -= 18;

  const skus = data.skus && data.skus.length ? data.skus : [];
  let totalQty = 0;
  if (skus.length === 0) {
    page.drawText('No line items available.', { x: MARGIN, y, size: 10, font, color: MUTED_COLOR });
    y -= 16;
  } else {
    for (const item of skus) {
      const qty = item.quantity || 0;
      totalQty += qty;
      page.drawText(item.sku || '—', { x: MARGIN, y, size: 10, font, color: TEXT_COLOR });
      page.drawText(String(qty), { x: qtyColX, y, size: 10, font, color: TEXT_COLOR });
      y -= 16;
      if (y < MARGIN + 40) break; // overflow guard for very long orders
    }
  }

  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: LINE_COLOR });
  y -= 18;
  page.drawText('Total Qty', { x: MARGIN, y, size: 10, font: bold, color: TEXT_COLOR });
  page.drawText(String(totalQty), { x: qtyColX, y, size: 10, font: bold, color: TEXT_COLOR });

  return doc.save();
}

/**
 * Appends the packing-slip page(s) from a ShipStation *test label* onto the real
 * shipping-label PDF, returning the combined document as base64.
 *
 * A test label rendered under a "… + Packing Slip" account layout comes back as
 * [sample label page, packing slip page(s)]. We drop the first page (the
 * non-billable sample label) and append the remaining page(s) — the packing
 * slip — after the real label. The slip's barcode is the order-level "Scan to
 * View" reference (verified to be identical across shipments of the same order),
 * so it is correct regardless of which carrier minted the test label.
 *
 * Returns null when the test label has no extra (slip) page, so the caller can
 * fall back to a generated slip.
 */
export async function appendTestLabelSlip(
  realLabelBase64: string,
  testLabelBase64: string
): Promise<string | null> {
  const real = await PDFDocument.load(Buffer.from(realLabelBase64, 'base64'));
  const test = await PDFDocument.load(Buffer.from(testLabelBase64, 'base64'));

  const slipIndices = test.getPageIndices().slice(1); // drop the sample label page
  if (slipIndices.length === 0) return null;

  const slipPages = await real.copyPages(test, slipIndices);
  slipPages.forEach((p) => real.addPage(p));

  const out = await real.save();
  return Buffer.from(out).toString('base64');
}

/**
 * Merges a generated packing slip onto the ShipStation shipping-label PDF and
 * returns the combined document as a base64 string. The label page(s) come
 * first, followed by the generated packing slip. Used as a fallback when the
 * ShipStation-native slip can't be obtained.
 *
 * If the label PDF can't be parsed, the original base64 is returned unchanged so
 * a rendering issue never blocks a (billable) label.
 */
export async function buildLabelWithPackingSlip(
  labelBase64: string,
  data: PackingSlipData
): Promise<string> {
  try {
    const merged = await PDFDocument.load(Buffer.from(labelBase64, 'base64'));
    const slipBytes = await buildPackingSlipPdf(data);
    const slipDoc = await PDFDocument.load(slipBytes);
    const slipPages = await merged.copyPages(slipDoc, slipDoc.getPageIndices());
    slipPages.forEach((p) => merged.addPage(p));
    const out = await merged.save();
    return Buffer.from(out).toString('base64');
  } catch (e) {
    console.error('[PackingSlip] Failed to merge generated packing slip into label PDF:', e);
    return labelBase64;
  }
}
