/**
 * Read-only diagnostic for the SPS Commerce Transaction API v5.
 *
 * For every connected SPS source, prints the raw HTTP status and body that SPS
 * returns for the mailbox root and the common mailbox folders, so the listing
 * shape and the folders the account actually has can be seen directly.
 *
 * Usage: npx ts-node scripts/diagnose-sps.ts
 */
import '../src/config/env';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db';
import DocTidySpsSource from '../src/models/DocTidySpsSource';
import { ensureAccessToken } from '../src/services/sps.service';

const API_BASE = process.env.SPS_API_BASE ?? 'https://api.spscommerce.com';
const PATHS    = ['', 'in/', 'out/', 'out/IN/', 'out/PO/'];

function describeToken(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return JSON.stringify(
      { aud: payload.aud, scope: payload.scope, sub: payload.sub, exp: payload.exp },
      null,
      2,
    );
  } catch {
    return '(not a JWT)';
  }
}

(async () => {
  await connectDB();
  console.log('SPS_API_BASE:', API_BASE);

  const sources = await DocTidySpsSource.find()
    .select('+spsRefreshToken +spsAccessToken +spsTokenExpiry');

  if (sources.length === 0) {
    console.log('No SPS sources connected.');
    await mongoose.disconnect();
    return;
  }

  for (const source of sources) {
    console.log(`\n=== SOURCE ${source._id} (${source.spsAccountEmail ?? 'no email'}) ===`);
    let token: string;
    try {
      token = await ensureAccessToken(source);
    } catch (err) {
      console.log('Token error:', (err as Error).message);
      continue;
    }
    console.log('Token claims:', describeToken(token));

    for (const path of PATHS) {
      const url = `${API_BASE}/transactions/v5/data/${path}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const body = await res.text();
      console.log(`\n--- GET ${url}`);
      console.log('status:', res.status, res.statusText);
      console.log('body  :', body.slice(0, 2000) || '(empty)');
    }
  }

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
