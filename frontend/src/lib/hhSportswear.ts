export type HHOrderStatus = 'complete' | 'draft'

export const HH_STATUSES: HHOrderStatus[] = ['complete', 'draft']

export const HH_STATUS_LABELS: Record<HHOrderStatus, string> = {
  complete: 'Complete',
  draft: 'Draft',
}

export interface HHLineItem {
  id: string
  title: string
  sku: string
  asin: string
  quantity: number
  unitPrice: number
}

export interface HHChildOrder {
  id: string
  orderId: string
  po: string
  customerName: string
  customerEmail: string
  customerPhone: string
  addressLine1: string
  addressLine2: string
  country: string
  status: HHOrderStatus
  items: HHLineItem[]
}

export interface HHOrderGroup {
  id: string
  createdAt: string
  createdByName: string
  createdByEmail: string
  notes: string
  status: HHOrderStatus
  children: HHChildOrder[]
}

const PEOPLE = [
  { name: 'Alexa Mae Carreon', email: 'acarreon@outdoorequipped.com' },
  { name: 'Jomael Gemota', email: 'jomael@outdoorequipped.com' },
  { name: 'Trixie Lauron', email: 'tlauron@outdoorequipped.com' },
  { name: 'Alex Rivera', email: 'arivera@channelprecision.com' },
  { name: 'Jordan Lee', email: 'jlee@outdoorequipped.com' },
  { name: 'Priya Shah', email: 'pshah@outdoorequipped.com' },
]

const NOTES = [
  'Rush B2B restock for the fall catalog — confirm sizes S–XL on the navy pullover before submitting to HH Sportswear. Warehouse wants this packed with the existing Belleville outbound if possible.',
  'Hold for updated wholesale pricing on hoodies.',
  'Replacement PO after the first file had mixed sizes. Recheck XL count.',
  'Spring sample pack for the buyer walkthrough on Friday.',
  'Do not ship until HH confirms the new SKU mapping.',
  'Add packing slips for the marketplace drop-ship orders.',
  'Priority: trailer leaves Belleville Thursday morning.',
  'Duplicate upload — keep this copy, ignore the earlier draft.',
]

const CUSTOMERS = [
  {
    name: 'Ash and Kerry McArthur',
    email: 'slk73sr4qjm3kbf@marketplace.amazon.com',
    phone: '+1 415-419-8616 ext. 87605',
    addressLine1: '51 LAWRENCE ST',
    addressLine2: 'NORFOLK, MA 02056-1910',
  },
  {
    name: 'Melissa Grant',
    email: 'mgrant@example.com',
    phone: '+1 508-555-0199',
    addressLine1: '18 CEDAR RIDGE RD',
    addressLine2: 'FRANKLIN, MA 02038-1422',
  },
  {
    name: 'Chris Patel',
    email: 'cpatel@example.com',
    phone: '+1 617-555-0142',
    addressLine1: '402 ATLANTIC AVE',
    addressLine2: 'BOSTON, MA 02110-3350',
  },
  {
    name: 'Dana Okonkwo',
    email: 'dokonkwo@example.com',
    phone: '+1 401-555-0174',
    addressLine1: '90 BENEFIT ST',
    addressLine2: 'PROVIDENCE, RI 02903-1804',
  },
  {
    name: 'Riley Chen',
    email: 'rchen@example.com',
    phone: '+1 203-555-0118',
    addressLine1: '12 HARBOR VIEW AVE',
    addressLine2: 'STAMFORD, CT 06902-6731',
  },
]

const PRODUCTS = [
  { title: "HH Sportswear Men's Navy Pullover Hoodie — Size M", sku: 'HH-NVY-HD-M', asin: 'B0C8QK4N2P', unitPrice: 32 },
  { title: 'HH Sportswear Trail Short — Size L', sku: 'HH-TRL-SH-L', asin: 'B0C9W1L8KT', unitPrice: 24.5 },
  { title: "HH Sportswear Women's Fleece Jacket — Size S", sku: 'HH-FLC-JK-S', asin: 'B0D1A7M3QX', unitPrice: 41 },
  { title: 'HH Sportswear Classic Crew Sweatshirt — Size XL', sku: 'HH-CRW-SS-XL', asin: 'B0D2B9P5ZR', unitPrice: 29.75 },
  { title: 'HH Sportswear Performance Tee — Size L', sku: 'HH-PRF-TE-L', asin: 'B0D3C4N6YW', unitPrice: 18 },
  { title: 'HH Sportswear Quarter-Zip — Size M', sku: 'HH-QTZ-M', asin: 'B0D4E8P1KA', unitPrice: 36 },
  { title: 'HH Sportswear Jogger Pant — Size L', sku: 'HH-JGR-L', asin: 'B0D5F2Q7NB', unitPrice: 34 },
]

function padAmazonOrder(n: number): string {
  return `114-${String(4600000 + n).padStart(7, '0')}-${String(8600000 + n).padStart(7, '0')}`
}

function buildItems(groupIndex: number, orderIndex: number): HHLineItem[] {
  const count = 2 + ((groupIndex + orderIndex) % 3)
  return Array.from({ length: count }, (_, i) => {
    const product = PRODUCTS[(groupIndex + orderIndex + i) % PRODUCTS.length]
    return {
      id: `${groupIndex + 1}-${orderIndex}-${i}`,
      title: product.title,
      sku: product.sku,
      asin: product.asin,
      quantity: 2 + ((groupIndex + i) % 8),
      unitPrice: product.unitPrice,
    }
  })
}

function buildOrders(groupIndex: number): HHChildOrder[] {
  const count = 2 + (groupIndex % 3)
  return Array.from({ length: count }, (_, o) => {
    const customer = CUSTOMERS[(groupIndex + o) % CUSTOMERS.length]
    const status: HHOrderStatus = (groupIndex + o) % 3 === 0 ? 'complete' : 'draft'
    return {
      id: `${groupIndex + 1}-${String.fromCharCode(97 + o)}`,
      orderId: padAmazonOrder(groupIndex * 10 + o + 1),
      po: String(210000 + groupIndex * 17 + o),
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      country: 'US',
      status,
      items: buildItems(groupIndex, o),
    }
  })
}

function buildSampleGroups(): HHOrderGroup[] {
  return Array.from({ length: 16 }, (_, i) => {
    const person = PEOPLE[i % PEOPLE.length]
    const created = new Date(Date.UTC(2026, 7, 4 + i, 10 + (i % 8), 12 + i, 24))
    return {
      id: String(i + 1),
      createdAt: created.toISOString(),
      createdByName: person.name,
      createdByEmail: person.email,
      notes: NOTES[i % NOTES.length],
      status: i % 3 === 0 ? 'complete' : 'draft',
      children: buildOrders(i),
    }
  })
}

export const HH_SAMPLE_GROUPS: HHOrderGroup[] = buildSampleGroups()

export function getHHGroupById(id: string): HHOrderGroup | undefined {
  return HH_SAMPLE_GROUPS.find((group) => group.id === id)
}

export function getHHOrder(
  groupId: string,
  orderId: string,
): { group: HHOrderGroup; order: HHChildOrder } | undefined {
  const group = getHHGroupById(groupId)
  if (!group) return undefined
  const order = group.children.find((child) => child.id === orderId || child.orderId === orderId)
  if (!order) return undefined
  return { group, order }
}

export function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function includesQuery(value: string | number | undefined, query: string): boolean {
  return String(value ?? '').toLowerCase().includes(query)
}

export function hhItemMatchesQuery(item: HHLineItem, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true
  return (
    includesQuery(item.title, query) ||
    includesQuery(item.sku, query) ||
    includesQuery(item.asin, query) ||
    includesQuery(item.quantity, query) ||
    includesQuery(item.unitPrice, query)
  )
}

export function hhOrderMatchesQuery(order: HHChildOrder, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true
  if (
    includesQuery(order.orderId, query) ||
    includesQuery(order.po, query) ||
    includesQuery(order.customerName, query) ||
    includesQuery(order.customerEmail, query) ||
    includesQuery(order.customerPhone, query) ||
    includesQuery(order.addressLine1, query) ||
    includesQuery(order.addressLine2, query) ||
    includesQuery(order.country, query) ||
    includesQuery(HH_STATUS_LABELS[order.status], query)
  ) {
    return true
  }
  return order.items.some((item) => hhItemMatchesQuery(item, rawQuery))
}

export function hhGroupMatchesQuery(group: HHOrderGroup, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  if (
    includesQuery(group.createdByName, query) ||
    includesQuery(group.createdByEmail, query) ||
    includesQuery(group.notes, query) ||
    includesQuery(HH_STATUS_LABELS[group.status], query) ||
    includesQuery(formatCreatedAt(group.createdAt), query)
  ) {
    return true
  }

  return group.children.some((order) => hhOrderMatchesQuery(order, rawQuery))
}
