/**
 * Read-only diagnostic for the SPS Commerce MCP server (Fulfillment Monitor).
 *
 * Uses each connected SPS source's stored OAuth token to run the MCP handshake,
 * list the available tools, and call the read-only transactions summary, so it
 * shows whether the Doc Tidy app's token is accepted by the MCP gateway.
 *
 * Usage: npx ts-node --transpile-only scripts/diagnose-sps-mcp.ts
 */
import '../src/config/env';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db';
import DocTidySpsSource from '../src/models/DocTidySpsSource';
import { ensureAccessToken } from '../src/services/sps.service';

const MCP_URL = 'https://mcp.spscommerce.com/mcp';

let nextId = 1;

async function rpc(
  token: string,
  sessionId: string | null,
  method: string,
  params: unknown,
  notification = false,
): Promise<{ status: number; sessionId: string | null; body: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const payload = notification
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: nextId++, method, params };

  const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
  return {
    status: res.status,
    sessionId: res.headers.get('mcp-session-id') ?? sessionId,
    body: await res.text(),
  };
}

(async () => {
  await connectDB();

  const sources = await DocTidySpsSource.find()
    .select('+spsRefreshToken +spsAccessToken +spsTokenExpiry');

  for (const source of sources) {
    console.log(`\n=== SOURCE ${source._id} (${source.spsAccountEmail ?? 'no email'}) ===`);
    const token = await ensureAccessToken(source);

    const init = await rpc(token, null, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'ship-queue-diagnostic', version: '1.0.0' },
    });
    console.log('\n--- initialize', init.status);
    console.log(init.body.slice(0, 1500));
    if (init.status !== 200) continue;

    await rpc(token, init.sessionId, 'notifications/initialized', {}, true);

    const tools = await rpc(token, init.sessionId, 'tools/list', {});
    console.log('\n--- tools/list', tools.status);
    const names = [...tools.body.matchAll(/"name"\s*:\s*"(sps-[^"]+)"/g)].map((m) => m[1]);
    console.log(names.length ? [...new Set(names)].join('\n') : tools.body.slice(0, 1500));

    const summary = await rpc(token, init.sessionId, 'tools/call', {
      name: 'sps-fulfillment-monitor-transactions-summary',
      arguments: { scope: 'received' },
    });
    console.log('\n--- transactions-summary (received, last 7 days)', summary.status);
    console.log(summary.body.slice(0, 2500));
  }

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
