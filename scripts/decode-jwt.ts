/**
 * Decodes a JWT payload (base64url) and prints the claims — no network call.
 * Usage: npx ts-node --transpile-only scripts/decode-jwt.ts <token>
 */
const token = process.argv[2];
if (!token) { console.error('Usage: npx ts-node --transpile-only scripts/decode-jwt.ts <token>'); process.exit(1); }

const parts = token.split('.');
if (parts.length < 2) { console.error('Not a valid JWT (expected 3 dot-separated parts).'); process.exit(1); }

try {
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  console.log('\n=== JWT Claims ===');
  // Print only the fields relevant to API access
  const fields = ['aud', 'scope', 'azp', 'gty', 'permissions', 'exp', 'iat', 'sub'];
  for (const f of fields) {
    if (payload[f] !== undefined) console.log(`${f.padEnd(12)}: ${JSON.stringify(payload[f])}`);
  }
  console.log('\n=== Full payload (redacted sub) ===');
  delete payload.sub;
  console.log(JSON.stringify(payload, null, 2));
} catch {
  console.error('Could not decode token payload.');
  process.exit(1);
}
