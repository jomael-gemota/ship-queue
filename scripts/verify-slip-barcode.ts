/**
 * Double-check: is the packing-slip barcode order-based or shipment-based?
 *
 * It mints TWO non-billable USPS test labels for the SAME order. Each label
 * creation yields a distinct shipmentId. We save each PDF's packing-slip page
 * so we can compare the barcode:
 *   - identical barcode + different shipmentIds  => barcode is ORDER-based (safe)
 *   - different barcode                          => barcode is SHIPMENT-based (NOT safe)
 *
 * Safe: testLabel: true is non-billable and does NOT mark the order shipped.
 *
 * Usage:
 *   npx ts-node --project scripts/tsconfig.json scripts/verify-slip-barcode.ts
 *   npx ts-node --project scripts/tsconfig.json scripts/verify-slip-barcode.ts <carrierCode> <serviceCode>
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { PDFDocument } from 'pdf-lib';
import { writeFileSync } from 'fs';
import path from 'path';
import Label from '../src/models/Label';
import {
  createShipStationLabelForOrder,
  listShipStationCarriers,
  listShipStationCarrierServices,
  CreateLabelForOrderPayload,
} from '../src/services/shipstationLabel.service';

function isUspsCarrier(name?: string, code?: string): boolean {
  const hay = `${name || ''} ${code || ''}`.toLowerCase();
  return hay.includes('usps') || hay.includes('stamps');
}

function pickDomesticService(
  services: { code?: string; name?: string; domestic?: boolean; international?: boolean }[]
): string | undefined {
  const domestic = services.filter((s) => s.domestic !== false && !s.international);
  const preferred = domestic.find((s) =>
    /ground_advantage|first|priority/i.test(`${s.code} ${s.name}`)
  );
  return (preferred || domestic[0] || services[0])?.code;
}

async function resolveUspsCarrierService(
  argCarrier?: string,
  argService?: string
): Promise<{ carrierCode: string; serviceCode: string }> {
  if (argCarrier && argService) return { carrierCode: argCarrier, serviceCode: argService };
  const carriers = await listShipStationCarriers();
  const usps = carriers.find((c) => isUspsCarrier(c.name, c.code));
  if (!usps?.code) throw new Error('No USPS/Stamps.com carrier connected. Pass <carrierCode> <serviceCode>.');
  const services = await listShipStationCarrierServices(usps.code);
  const serviceCode = argService || pickDomesticService(services);
  if (!serviceCode) throw new Error(`No services for ${usps.code}.`);
  return { carrierCode: usps.code, serviceCode };
}

/** Extracts the last page (the packing slip) of a label PDF as its own bytes. */
async function extractLastPage(base64: string): Promise<Uint8Array> {
  const src = await PDFDocument.load(Buffer.from(base64, 'base64'));
  const out = await PDFDocument.create();
  const lastIndex = src.getPageCount() - 1;
  const [page] = await out.copyPages(src, [lastIndex]);
  out.addPage(page);
  return out.save();
}

async function mintTestLabel(
  basePayload: CreateLabelForOrderPayload,
  carrierCode: string,
  serviceCode: string
): Promise<{ shipmentId?: number; labelData?: string }> {
  const res = await createShipStationLabelForOrder({
    ...basePayload,
    carrierCode,
    serviceCode,
    packageCode: 'package',
    testLabel: true,
  });
  return { shipmentId: res.shipmentId, labelData: res.labelData };
}

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');
  if (!process.env.SHIPSTATION_API_KEY || !process.env.SHIPSTATION_API_SECRET) {
    throw new Error('SHIPSTATION_API_KEY / SHIPSTATION_API_SECRET are not set.');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const label = await Label.findOne({ status: 'created', requestPayload: { $exists: true } })
    .sort({ createdAt: -1 })
    .lean();
  if (!label || !label.requestPayload) {
    throw new Error('No created label with a stored requestPayload found.');
  }

  const basePayload = label.requestPayload as unknown as CreateLabelForOrderPayload;
  const { carrierCode, serviceCode } = await resolveUspsCarrierService(process.argv[2], process.argv[3]);

  console.log(`Order: PO ${label.poNumber} / orderId ${basePayload.orderId}`);
  console.log(`USPS carrier/service: ${carrierCode} / ${serviceCode}`);
  console.log('Minting test label #1...');
  const a = await mintTestLabel(basePayload, carrierCode, serviceCode);
  console.log('Minting test label #2...');
  const b = await mintTestLabel(basePayload, carrierCode, serviceCode);

  console.log('');
  console.log(`shipmentId #1: ${a.shipmentId}`);
  console.log(`shipmentId #2: ${b.shipmentId}`);
  console.log(
    a.shipmentId !== b.shipmentId
      ? '>>> shipmentIds DIFFER (good — distinct shipments).'
      : '>>> shipmentIds are the SAME (unexpected; ShipStation may have returned a cached label).'
  );

  if (!a.labelData || !b.labelData) {
    console.log('One of the labels returned no labelData; cannot compare slips.');
    return;
  }

  const slip1 = await extractLastPage(a.labelData);
  const slip2 = await extractLastPage(b.labelData);
  const out1 = path.join(process.cwd(), 'slip-1.pdf');
  const out2 = path.join(process.cwd(), 'slip-2.pdf');
  writeFileSync(out1, slip1);
  writeFileSync(out2, slip2);

  console.log('');
  console.log(`Saved packing-slip pages to:\n  ${out1}\n  ${out2}`);
  console.log(
    'Next: read both PDFs and compare the barcode line near the bottom of each slip.\n' +
      'If the barcode strings match (despite different shipmentIds above), the barcode is ORDER-based and safe to graft.'
  );
}

main()
  .catch((err) => {
    console.error('Double-check failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void mongoose.disconnect();
  });
