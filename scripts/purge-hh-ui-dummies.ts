/**
 * Deletes dummy-ui-seed HH batches (sportswear + workwear).
 *
 *   npx ts-node --project scripts/tsconfig.json scripts/purge-hh-ui-dummies.ts
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import HHOrderGroup from '../src/models/HHOrderGroup'

const SOURCE = 'dummy-ui-seed.csv'

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')

  await mongoose.connect(uri)

  const before = await HHOrderGroup.aggregate<{ _id: string; count: number }>([
    { $match: { sourceFileName: SOURCE } },
    { $group: { _id: '$brand', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])
  console.log('Dummy batches before delete:', before.length ? before : 'none')

  const deleted = await HHOrderGroup.deleteMany({ sourceFileName: SOURCE })
  console.log(`Deleted ${deleted.deletedCount} dummy-ui-seed batch(es)`)

  const remaining = await HHOrderGroup.countDocuments({ sourceFileName: SOURCE })
  console.log(`Remaining dummy-ui-seed batches: ${remaining}`)

  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
