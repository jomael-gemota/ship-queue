/**
 * Read-only: reports DC COGS state per workspace and shows what the Channel
 * Precision bt_costs API returns for a sample of SKUs that ended up as 'n/a'.
 *
 *   npx ts-node --transpile-only --project scripts/tsconfig.json scripts/diagnose-dc-cogs.ts [samplesPerWorkspace]
 */
import 'dotenv/config'
import axios from 'axios'
import mongoose from 'mongoose'
import DocTidyOrderImport from '../src/models/DocTidyOrderImport'
import DocTidyWorkspace from '../src/models/DocTidyWorkspace'

const SAMPLES = Number(process.argv[2] ?? 3)

async function probe(sku: string) {
  try {
    const res = await axios.get(`https://api.dc.app.channelprecision.com/v1/bt_costs`, {
      params: { limit: 50, page: 1, s: sku.trim() },
      headers: {
        accept: 'application/json, text/plain, */*',
        authorization: process.env.CHANNEL_PRECISION_API_KEY ?? '',
        'x-ps-client-id': process.env.CHANNEL_PRECISION_CLIENT_ID ?? '',
        Referer: 'https://dc.channelprecision.com/',
      },
      timeout: 10_000,
      validateStatus: () => true,
    })
    const items: { sku?: string; cost?: unknown }[] = Array.isArray(res.data?.items) ? res.data.items : []
    return {
      status: res.status,
      total: res.data?.total,
      returnedSkus: items.slice(0, 8).map((i) => `${i.sku}=${i.cost}`),
      body: res.status >= 400 ? JSON.stringify(res.data).slice(0, 200) : undefined,
    }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  await mongoose.connect(uri)

  const workspaces = await DocTidyWorkspace.find().select('_id name').lean()
  for (const ws of workspaces) {
    const states = await DocTidyOrderImport.aggregate<{ _id: string; count: number }>([
      { $match: { workspaceId: ws._id } },
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $eq: ['$dcCogs', null] }, then: 'pending' },
                { case: { $eq: ['$dcCogs', 'n/a'] }, then: 'n/a' },
              ],
              default: 'has cost',
            },
          },
          count: { $sum: 1 },
        },
      },
    ])
    if (!states.length) continue
    console.log(`\n=== ${ws.name} (${ws._id}) ===`, Object.fromEntries(states.map((s) => [s._id, s.count])))

    const naSkus = await DocTidyOrderImport.distinct('orderSku', { workspaceId: ws._id, dcCogs: 'n/a' })
    for (const sku of naSkus.slice(0, SAMPLES)) {
      console.log(`  sku ${JSON.stringify(sku)} ->`, await probe(String(sku)))
    }
  }

  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
