/**
 * Inserts dummy HH Sportswear + Workwear batches for UI review.
 * Does not call Seller Central, Helly Hansen B2B, cart draft, verify, or Place Order.
 *
 *   npx ts-node --project scripts/tsconfig.json scripts/seed-hh-ui-dummies.ts
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import HHOrderGroup, {
  rollupHhCartStatus,
  rollupHhDetailsStatus,
  type HHCartStatus,
  type HHDetailsStatus,
} from '../src/models/HHOrderGroup'
import HHB2bConfig from '../src/models/HHB2bConfig'
import { HH_BRANDS, type HHBrandId } from '../src/lib/hhBrand'

const SOURCE = 'dummy-ui-seed.csv'
const GROUPS_PER_BRAND = 50
const DUMMY_DRAFT = 'dummy-ui-not-a-b2b-document'

const CASES = [
  'placed_and_ready',
  'mostly_placed',
  'one_placed',
  'placed_and_draft',
  'mixed_placed',
  'pending',
  'details_failed',
  'synced_waiting',
  'cart_failed',
  'draft',
  'ready_match',
  'review_qty',
  'review_address',
  'placed',
  'place_failed',
  'mixed_details',
  'mixed_cart',
  'excluded',
  'all_excluded',
  'partial_ready',
  'placed_and_ready',
  'mostly_placed',
  'one_placed',
] as const

type CaseId = (typeof CASES)[number]

const BUYERS = [
  { name: 'Avery Cole', city: 'Seattle', state: 'WA', zip: '98101' },
  { name: 'Jordan Hale', city: 'Denver', state: 'CO', zip: '80202' },
  { name: 'Riley Chen', city: 'Austin', state: 'TX', zip: '78701' },
  { name: 'Sam Patel', city: 'Chicago', state: 'IL', zip: '60611' },
  { name: 'Morgan Diaz', city: 'Portland', state: 'OR', zip: '97205' },
  { name: 'Casey Nguyen', city: 'Boston', state: 'MA', zip: '02108' },
]

const SPORT_ITEMS = [
  { title: "Helly Hansen Men's Crew Jacket", sku: '30262_994-M', asin: 'B07DUMMY01' },
  { title: "Helly Hansen Women's Lifa Active Crew", sku: '48320_994-L', asin: 'B07DUMMY02' },
  { title: 'Helly Hansen HP Racing Jacket', sku: '30253_597-XL', asin: 'B07DUMMY03' },
]

const WORK_ITEMS = [
  { title: "Helly Hansen Pier 3.0 Men's Bib Overalls, 980 Ebony / 4.0, Large", sku: '34485_980-L', asin: 'B08DUMMY01' },
  { title: 'Helly Hansen Chelsea Evolution Jacket', sku: '71311_990-M', asin: 'B08DUMMY02' },
  { title: 'Helly Hansen Magni Evolution Shell', sku: '78260_990-XL', asin: 'B08DUMMY03' },
]

function catalog(brand: HHBrandId): string {
  return HH_BRANDS[brand].catalog
}

function itemsFor(brand: HHBrandId, count: number, excludedIndex = -1) {
  const catalogItems = brand === 'workwear' ? WORK_ITEMS : SPORT_ITEMS
  return Array.from({ length: count }, (_, i) => {
    const item = catalogItems[i % catalogItems.length]
    const excluded = i === excludedIndex
    return {
      title: item.title,
      sku: item.sku,
      asin: item.asin,
      imageUrl: '',
      quantity: 1 + (i % 2),
      unitPrice: 89 + i * 10,
      tax: 0,
      excluded,
      excludeNote: excluded ? 'Dummy: exclude from this brand cart' : '',
    }
  })
}

function buyer(index: number) {
  const row = BUYERS[index % BUYERS.length]
  const street = 100 + (index % 80)
  return {
    customerName: row.name,
    customerEmail: `${row.name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    customerPhone: `555-010-${String(1000 + (index % 9000)).slice(-4)}`,
    addressLine1: `${street} Dummy Seed Ave`,
    addressLine2: index % 3 === 0 ? `Suite ${index + 1}` : '',
    city: row.city,
    state: row.state,
    postalCode: row.zip,
    country: 'US',
  }
}

function emptyBuyer() {
  return {
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'US',
  }
}

function compareRows(
  name: string,
  address1: string,
  city: string,
  state: string,
  zip: string,
  po: string,
  sku: string,
  qty: number,
  mismatch?: 'qty' | 'address' | 'name',
) {
  const actualName = mismatch === 'name' ? `${name} (B2B)` : name
  const actualAddress = mismatch === 'address' ? '999 Wrong St' : address1
  const actualQty = mismatch === 'qty' ? String(qty + 1) : String(qty)
  return [
    { field: 'name', label: 'Name', expected: name || '—', actual: actualName || '—', matched: mismatch !== 'name' },
    { field: 'address1', label: 'Address', expected: address1 || '—', actual: actualAddress || '—', matched: mismatch !== 'address' },
    { field: 'address2', label: 'Address 2', expected: '—', actual: '—', matched: true },
    { field: 'city', label: 'City', expected: city || '—', actual: city || '—', matched: true },
    { field: 'state', label: 'State', expected: state || '—', actual: state || '—', matched: true },
    { field: 'zip', label: 'ZIP', expected: zip || '—', actual: zip || '—', matched: true },
    { field: 'country', label: 'Country', expected: 'US', actual: 'US', matched: true },
    { field: 'po', label: 'PO', expected: po, actual: po, matched: true },
    { field: `sku:${sku}`, label: `SKU ${sku}`, expected: String(qty), actual: actualQty, matched: mismatch !== 'qty' },
  ]
}

function issuesFrom(rows: ReturnType<typeof compareRows>) {
  return rows
    .filter((row) => !row.matched)
    .map(({ field, label, expected, actual }) => ({ field, label, expected, actual }))
}

function child(input: {
  orderId: string
  po: string
  brand: HHBrandId
  index: number
  detailsStatus: HHDetailsStatus
  cartStatus: HHCartStatus
  withBuyer?: boolean
  itemCount?: number
  excludedIndex?: number
  cartError?: string
  placeError?: string
  mismatch?: 'qty' | 'address' | 'name'
  notes?: string
}) {
  const filled = input.withBuyer !== false && input.detailsStatus === 'synced'
  const info = filled ? buyer(input.index) : emptyBuyer()
  const lineItems = itemsFor(input.brand, input.itemCount ?? 2, input.excludedIndex ?? -1)
  const first = lineItems[0]
  const hasCart = input.cartStatus !== 'none'
  const checked = input.cartStatus === 'ready' || input.cartStatus === 'review' || input.cartStatus === 'placed'
  const rows = checked
    ? compareRows(
        info.customerName,
        info.addressLine1,
        info.city,
        info.state,
        info.postalCode,
        input.po,
        first.sku,
        first.quantity,
        input.cartStatus === 'review' ? input.mismatch ?? 'qty' : undefined,
      )
    : []
  return {
    orderId: input.orderId,
    po: input.po,
    referenceNumber: hasCart ? `D${10000 + input.index}` : '',
    ...info,
    notes: input.notes ?? '',
    detailsStatus: input.detailsStatus,
    cartStatus: input.cartStatus,
    b2bDraftId: hasCart ? DUMMY_DRAFT : '',
    cartError: input.cartError ?? '',
    placeError: input.placeError ?? '',
    verifyIssues: input.cartStatus === 'review' ? issuesFrom(rows) : [],
    verifyRows: rows,
    verifiedAt: checked ? new Date() : null,
    items: lineItems,
  }
}

function amazonId(brand: HHBrandId, n: number): string {
  const prefix = brand === 'workwear' ? '112' : '111'
  const mid = String(9000000 + n).padStart(7, '0')
  const tail = String(1000000 + n).padStart(7, '0')
  return `${prefix}-${mid}-${tail}`
}

function po(brand: HHBrandId, n: number): string {
  const tag = brand === 'workwear' ? 'WW' : 'SW'
  return `UI-${tag}-${String(n).padStart(4, '0')}`
}

function buildChildren(brand: HHBrandId, groupIndex: number, caseId: CaseId) {
  const base = groupIndex * 10
  const sku = (brand === 'workwear' ? WORK_ITEMS : SPORT_ITEMS)[0]
  const cat = catalog(brand)
  const id = (offset: number) => amazonId(brand, base + offset)
  const p = (offset: number) => po(brand, base + offset)

  switch (caseId) {
    case 'pending':
      return [0, 1, 2].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'pending',
          cartStatus: 'none',
          withBuyer: false,
          notes: offset === 0 ? 'Dummy: details still pending' : '',
        }),
      )
    case 'details_failed':
      return [0, 1].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'failed',
          cartStatus: 'none',
          withBuyer: false,
        }),
      )
    case 'synced_waiting':
      return [0, 1].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'synced',
          cartStatus: 'none',
        }),
      )
    case 'cart_failed':
      return [
        child({
          orderId: id(0),
          po: p(0),
          brand,
          index: base,
          detailsStatus: 'synced',
          cartStatus: 'none',
          cartError: `SKU ${sku.sku} (${sku.title}) was not found in ${cat}`,
        }),
        child({
          orderId: id(1),
          po: p(1),
          brand,
          index: base + 1,
          detailsStatus: 'synced',
          cartStatus: 'none',
        }),
      ]
    case 'draft':
      return [0, 1].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'synced',
          cartStatus: 'draft',
        }),
      )
    case 'ready_match':
      return [0, 1, 2].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'synced',
          cartStatus: 'ready',
        }),
      )
    case 'review_qty':
      return [0, 1].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'synced',
          cartStatus: 'review',
          mismatch: 'qty',
        }),
      )
    case 'review_address':
      return [
        child({
          orderId: id(0),
          po: p(0),
          brand,
          index: base,
          detailsStatus: 'synced',
          cartStatus: 'review',
          mismatch: 'address',
        }),
      ]
    case 'placed':
      return [0, 1].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'synced',
          cartStatus: 'placed',
        }),
      )
    case 'place_failed':
      return [
        child({
          orderId: id(0),
          po: p(0),
          brand,
          index: base,
          detailsStatus: 'synced',
          cartStatus: 'ready',
          placeError: 'Dummy UI: place was not submitted',
        }),
      ]
    case 'mixed_details':
      return [
        child({
          orderId: id(0),
          po: p(0),
          brand,
          index: base,
          detailsStatus: 'pending',
          cartStatus: 'none',
          withBuyer: false,
        }),
        child({
          orderId: id(1),
          po: p(1),
          brand,
          index: base + 1,
          detailsStatus: 'synced',
          cartStatus: 'none',
        }),
        child({
          orderId: id(2),
          po: p(2),
          brand,
          index: base + 2,
          detailsStatus: 'failed',
          cartStatus: 'none',
          withBuyer: false,
        }),
      ]
    case 'mixed_cart':
      return [
        child({
          orderId: id(0),
          po: p(0),
          brand,
          index: base,
          detailsStatus: 'synced',
          cartStatus: 'ready',
        }),
        child({
          orderId: id(1),
          po: p(1),
          brand,
          index: base + 1,
          detailsStatus: 'synced',
          cartStatus: 'review',
          mismatch: 'qty',
        }),
        child({
          orderId: id(2),
          po: p(2),
          brand,
          index: base + 2,
          detailsStatus: 'synced',
          cartStatus: 'draft',
        }),
      ]
    case 'placed_and_ready':
      return [0, 1, 2, 3].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'synced',
          cartStatus: offset < 2 ? 'placed' : 'ready',
        }),
      )
    case 'mostly_placed':
      return [0, 1, 2, 3].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'synced',
          cartStatus: offset < 3 ? 'placed' : 'ready',
        }),
      )
    case 'one_placed':
      return [0, 1, 2, 3].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'synced',
          cartStatus: offset === 0 ? 'placed' : 'ready',
        }),
      )
    case 'placed_and_draft':
      return [0, 1, 2, 3].map((offset) =>
        child({
          orderId: id(offset),
          po: p(offset),
          brand,
          index: base + offset,
          detailsStatus: 'synced',
          cartStatus: offset < 2 ? 'placed' : 'draft',
        }),
      )
    case 'mixed_placed':
      return [
        child({
          orderId: id(0),
          po: p(0),
          brand,
          index: base,
          detailsStatus: 'synced',
          cartStatus: 'placed',
        }),
        child({
          orderId: id(1),
          po: p(1),
          brand,
          index: base + 1,
          detailsStatus: 'synced',
          cartStatus: 'ready',
        }),
        child({
          orderId: id(2),
          po: p(2),
          brand,
          index: base + 2,
          detailsStatus: 'synced',
          cartStatus: 'review',
          mismatch: 'name',
        }),
      ]
    case 'excluded':
      return [
        child({
          orderId: id(0),
          po: p(0),
          brand,
          index: base,
          detailsStatus: 'synced',
          cartStatus: 'draft',
          itemCount: 3,
          excludedIndex: 0,
        }),
        child({
          orderId: id(1),
          po: p(1),
          brand,
          index: base + 1,
          detailsStatus: 'synced',
          cartStatus: 'none',
        }),
      ]
    case 'all_excluded':
      return [
        child({
          orderId: id(0),
          po: p(0),
          brand,
          index: base,
          detailsStatus: 'synced',
          cartStatus: 'none',
          itemCount: 2,
          excludedIndex: 0,
          notes: 'Dummy: one line excluded; sibling still in cart',
        }),
      ].concat([
        child({
          orderId: id(1),
          po: p(1),
          brand,
          index: base + 1,
          detailsStatus: 'synced',
          cartStatus: 'none',
          itemCount: 1,
          excludedIndex: 0,
          notes: 'Dummy: every line excluded',
        }),
      ])
    case 'partial_ready':
      return [
        child({
          orderId: id(0),
          po: p(0),
          brand,
          index: base,
          detailsStatus: 'synced',
          cartStatus: 'ready',
        }),
        child({
          orderId: id(1),
          po: p(1),
          brand,
          index: base + 1,
          detailsStatus: 'synced',
          cartStatus: 'ready',
        }),
        child({
          orderId: id(2),
          po: p(2),
          brand,
          index: base + 2,
          detailsStatus: 'synced',
          cartStatus: 'draft',
        }),
      ]
  }
}

function groupNotes(caseId: CaseId): string {
  const labels: Record<CaseId, string> = {
    pending: 'Dummy UI: details pending',
    details_failed: 'Dummy UI: details failed',
    synced_waiting: 'Dummy UI: synced, waiting for cart',
    cart_failed: 'Dummy UI: cart draft failed (SKU miss)',
    draft: 'Dummy UI: cart drafted, not verified',
    ready_match: 'Dummy UI: cart ready / Match',
    review_qty: 'Dummy UI: Review — quantity mismatch',
    review_address: 'Dummy UI: Review — address mismatch',
    placed: 'Dummy UI: already marked placed (not sent to HH)',
    place_failed: 'Dummy UI: place error chip',
    mixed_details: 'Dummy UI: mixed details statuses',
    mixed_cart: 'Dummy UI: ready + review + draft',
    mixed_placed: 'Dummy UI: 1 placed / 1 ready / 1 review',
    placed_and_ready: 'Dummy UI: 2 placed / 2 ready',
    mostly_placed: 'Dummy UI: 3 placed / 1 ready',
    one_placed: 'Dummy UI: 1 placed / 3 ready',
    placed_and_draft: 'Dummy UI: 2 placed / 2 draft',
    excluded: 'Dummy UI: excluded line item',
    all_excluded: 'Dummy UI: excluded lines',
    partial_ready: 'Dummy UI: 2 ready / 1 draft',
  }
  return labels[caseId]
}

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')

  await mongoose.connect(uri)

  const configs = await HHB2bConfig.find({}).select('key placeOrderEnabled')
  for (const config of configs) {
    console.log(`placeOrderEnabled ${config.key}=${Boolean(config.placeOrderEnabled)}`)
    if (config.placeOrderEnabled) {
      console.warn('Place Order is ON in config — dummy drafts are not live B2B ids, so submit still cannot run.')
    }
  }

  const deleted = await HHOrderGroup.deleteMany({ sourceFileName: SOURCE })
  console.log(`Removed ${deleted.deletedCount} previous dummy-ui-seed batch(es)`)

  const docs = []
  for (const brand of ['sportswear', 'workwear'] as const) {
    for (let i = 0; i < GROUPS_PER_BRAND; i += 1) {
      const caseId = CASES[i % CASES.length]
      const children = buildChildren(brand, i, caseId)
      docs.push({
        brand,
        notes: groupNotes(caseId),
        sourceFileName: SOURCE,
        detailsStatus: rollupHhDetailsStatus(children.map((row) => row.detailsStatus)),
        cartStatus: rollupHhCartStatus(children.map((row) => row.cartStatus)),
        createdByName: 'UI Seed',
        createdByEmail: 'ui-seed@local',
        children,
        createdAt: new Date(Date.now() - (GROUPS_PER_BRAND - i) * 36 * 60 * 1000),
      })
    }
  }

  const inserted = await HHOrderGroup.insertMany(docs)
  const sports = inserted.filter((row) => row.brand === 'sportswear').length
  const work = inserted.filter((row) => row.brand === 'workwear').length
  const orderCount = inserted.reduce((sum, row) => sum + row.children.length, 0)
  console.log(`Inserted ${inserted.length} batches (${sports} sportswear, ${work} workwear), ${orderCount} orders`)
  console.log('No Seller Central / B2B / Place Order calls were made.')
  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
