/**
 * Verification script: does a ShipStation API *USPS test label* include a
 * packing slip page that we can graft onto the real (Amazon/FedEx) label?
 *
 * Strategy (matches the proposed approach):
 *   - testLabel: true is only supported for USPS on /orders/createlabelfororder.
 *   - So we mint a NON-billable USPS test label for a real order. With the
 *     account's "4x6 + Packing Slip" layout, that document should render as
 *     [USPS label page, packing slip page].
 *   - We only care about the packing slip page; the USPS label page is discarded.
 *
 * Safe: testLabel: true is non-billable and does NOT mark the order shipped.
 *
 * Usage (from project root, with your real .env in place):
 *   npx ts-node --project scripts/tsconfig.json scripts/verify-test-label.ts
 *   # optionally force a specific carrier/service:
 *   npx ts-node --project scripts/tsconfig.json scripts/verify-test-label.ts <carrierCode> <serviceCode>
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

function ptToInches(pt: number): string {
  return `${(pt / 72).toFixed(2)}"`;
}

function isUspsCarrier(name?: string, code?: string): boolean {
  const hay = `${name || ''} ${code || ''}`.toLowerCase();
  return hay.includes('usps') || hay.includes('stamps');
}

/** Picks a domestic ground/first-class style service, else the first one. */
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
  if (argCarrier && argService) {
    return { carrierCode: argCarrier, serviceCode: argService };
  }

  const carriers = await listShipStationCarriers();
  console.log('--- Connected carriers ---');
  carriers.forEach((c) => console.log(`  ${c.code}  (${c.name})`));

  const usps = carriers.find((c) => isUspsCarrier(c.name, c.code));
  if (!usps?.code) {
    throw new Error(
      'No USPS/Stamps.com carrier is connected on this account. ' +
        'USPS is required for test labels. Connect USPS in ShipStation, or pass ' +
        'an explicit <carrierCode> <serviceCode>.'
    );
  }

  const services = await listShipStationCarrierServices(usps.code);
  console.log(`--- Services for ${usps.code} ---`);
  services.forEach((s) => console.log(`  ${s.code}  (${s.name})`));

  const serviceCode = argService || pickDomesticService(services);
  if (!serviceCode) {
    throw new Error(`No services returned for carrier ${usps.code}.`);
  }
  return { carrierCode: usps.code, serviceCode };
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not set.');
  if (!process.env.SHIPSTATION_API_KEY || !process.env.SHIPSTATION_API_SECRET) {
    throw new Error('SHIPSTATION_API_KEY / SHIPSTATION_API_SECRET are not set.');
  }

  await mongoose.connect(mongoUri);

  const argCarrier = process.argv[2];
  const argService = process.argv[3];

  // Reuse a real order (and its resolved orderId) from a created label.
  const label = await Label.findOne({
    status: 'created',
    requestPayload: { $exists: true },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!label || !label.requestPayload) {
    throw new Error(
      'Could not find a created label with a stored requestPayload to reuse. ' +
        'Create at least one real label first.'
    );
  }

  const basePayload = label.requestPayload as unknown as CreateLabelForOrderPayload;
  const { carrierCode, serviceCode } = await resolveUspsCarrierService(argCarrier, argService);

  const testPayload: CreateLabelForOrderPayload = {
    ...basePayload,
    carrierCode,
    serviceCode,
    packageCode: 'package',
    testLabel: true,
  };

  console.log('');
  console.log('--- Test label request ---');
  console.log('PO #:        ', label.poNumber);
  console.log('orderId:     ', basePayload.orderId);
  console.log('carrierCode: ', carrierCode, '(USPS, for test label)');
  console.log('serviceCode: ', serviceCode);
  console.log('testLabel:   ', true);
  console.log('');

  console.log('Requesting USPS TEST label from ShipStation...');
  const res = await createShipStationLabelForOrder(testPayload);

  if (!res.labelData) {
    console.log('No labelData returned. Full response:');
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  const bytes = Buffer.from(res.labelData, 'base64');
  const outPath = path.join(process.cwd(), 'test-label-sample.pdf');
  writeFileSync(outPath, bytes);

  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();

  console.log('');
  console.log('=== RESULT ===');
  console.log(`PDF size:    ${bytes.length} bytes`);
  console.log(`Page count:  ${pages.length}`);
  pages.forEach((p, i) => {
    const { width, height } = p.getSize();
    console.log(
      `  Page ${i + 1}: ${width.toFixed(0)}x${height.toFixed(0)} pt ` +
        `(${ptToInches(width)} x ${ptToInches(height)})`
    );
  });
  console.log('');
  console.log(`Saved sample PDF to: ${outPath}`);
  console.log(
    pages.length > 1
      ? '>>> MULTIPLE pages — page 2+ is likely the packing slip we can graft onto the real label. Open the PDF to confirm (and check for any SAMPLE watermark on the SLIP page).'
      : '>>> Only ONE page — the USPS test label did NOT include a separate packing slip page.'
  );
}

main()
  .catch((err) => {
    console.error('Verification failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void mongoose.disconnect();
  });
