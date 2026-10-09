/**
 * Read-only diagnostic for the SPS Fulfillment Monitor search endpoint.
 *
 * Tests whether the stored Doc Tidy OAuth token is accepted by:
 *   POST https://api.spscommerce.com/fulfillment-monitor/transactions/search
 *
 * Tries progressively specific queries so we can see the exact field names
 * needed for filtering by doc-type and PO number.
 *
 * Usage: npx ts-node --transpile-only scripts/diagnose-sps-fulfillment.ts
 */
import '../src/config/env';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db';
import DocTidySpsSource from '../src/models/DocTidySpsSource';
import { ensureAccessToken } from '../src/services/sps.service';

const BASE = process.env.SPS_API_BASE ?? 'https://api.spscommerce.com';
const SEARCH_URL = `${BASE}/fulfillment-monitor/transactions/search`;

// A real PO number you'd expect to find invoices for — change if you know a better one.
const TEST_PO = '235279';

async function search(token: string, label: string, body: Record<string, unknown>) {
  console.log(`\n--- ${label}`);
  console.log('payload:', JSON.stringify(body));
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log('status:', res.status, res.statusText);
  if (!res.ok) { console.log('body:', text.slice(0, 600)); return null; }

  let data: Record<string, unknown>;
  try { data = JSON.parse(text); } catch { console.log('non-JSON body:', text.slice(0, 600)); return null; }

  const results = Array.isArray(data.results) ? data.results as Record<string, unknown>[] : [];
  console.log(`total_count: ${data.total_count ?? '?'}, results on page: ${results.length}`);

  // Print a condensed view of each hit: id, doc-type, PO#, sender, date
  for (const r of results.slice(0, 5)) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const appKeys = (meta['app-keys'] ?? {}) as Record<string, unknown[]>;
    const poNums  = (appKeys['PurchaseOrderNumber'] ?? appKeys['InvoiceNumber'] ?? []).join(', ');
    const invNums = (appKeys['InvoiceNumber'] ?? []).join(', ');
    console.log({
      id:       r.id,
      docType:  meta['doc-type'],
      po:       poNums || '—',
      invoice:  invNums || '—',
      sender:   meta['sender-name'],
      received: meta['date-received'],
    });
  }
  return data;
}

(async () => {
  await connectDB();
  const sources = await DocTidySpsSource.find()
    .select('+spsRefreshToken +spsAccessToken +spsTokenExpiry');

  for (const source of sources) {
    console.log(`\n=== SOURCE ${source._id} (${source.spsAccountEmail ?? 'no email'}) ===`);
    const token = await ensureAccessToken(source);

    // 1. Broadest possible query — last 7 days, no filter
    await search(token, '1. last 7 days, all doc types', {
      pageNumber: 1, pageSize: 5,
      _q: '', autoResolve: false, sortField: '',
    });

    // 2. Filter to 810 invoices only
    await search(token, '2. doc-type 810 only (last 7 days)', {
      pageNumber: 1, pageSize: 5,
      _q: 'doc-type==810', autoResolve: false, sortField: '',
    });

    // 3. 810 invoices by PO number
    await search(token, `3. 810 invoices for PO ${TEST_PO}`, {
      pageNumber: 1, pageSize: 5,
      _q: `doc-type==810;PurchaseOrderNumber==${TEST_PO}`, autoResolve: false, sortField: '',
    });

    // 4. Try the broader doc-type syntax seen in MCP tool names
    await search(token, '4. received 810s, last 30 days (date filter)', {
      pageNumber: 1, pageSize: 5,
      _q: 'doc-type==810',
      dateRange: { start: new Date(Date.now() - 30 * 864e5).toISOString(), end: new Date().toISOString() },
      autoResolve: false, sortField: '',
    });
  }

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
