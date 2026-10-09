import type { DropshipBrand } from './dropship'

export const BULK_ORDER_PATH = '/ordering/bulk'
export const BULK_ORDER_LABEL = 'Bulk Order (B2B)'

export const BULK_ORDER_BRANDS: DropshipBrand[] = [
  {
    id: 'thorogood',
    name: 'Thorogood',
    supplier: 'Thorogood',
    catalog: 'Bulk orders',
    path: `${BULK_ORDER_PATH}/thorogood`,
    logo: '/brands/thorogood.jpg',
    logoFit: 'contain',
    logoScale: 1.42,
  },
]

export function bulkOrderBrand(pathname: string): DropshipBrand | undefined {
  return BULK_ORDER_BRANDS.find((brand) => pathname === brand.path || pathname.startsWith(`${brand.path}/`))
}

export type BulkPage = 'orders' | 'shipments' | 'items' | 'config'

function bulkRest(pathname: string): string[] {
  const brand = bulkOrderBrand(pathname)
  if (!brand) return []
  const prefix = brand.path.replace(/\/+$/, '')
  const path = pathname.replace(/\/+$/, '')
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return []
  return path.slice(prefix.length).split('/').filter(Boolean)
}

export function bulkPage(pathname: string): BulkPage {
  const rest = bulkRest(pathname)
  if (rest[0] === 'configurations') return 'config'
  if (rest[1] === 'shipments') return 'items'
  if (rest[0]) return 'shipments'
  return 'orders'
}

export function bulkDepth(pathname: string): number {
  const page = bulkPage(pathname)
  if (page === 'items') return 2
  if (page === 'shipments' || page === 'config') return 1
  return 0
}

export function bulkOrderId(pathname: string): string | null {
  const rest = bulkRest(pathname)
  if (!rest[0] || rest[0] === 'configurations') return null
  return rest[0]
}

export function bulkParentPath(pathname: string): string | null {
  const brand = bulkOrderBrand(pathname)
  if (!brand) return null
  const page = bulkPage(pathname)
  if (page === 'items') {
    const orderId = bulkOrderId(pathname)
    return orderId ? `${brand.path}/${orderId}` : brand.path
  }
  if (page === 'shipments' || page === 'config') return brand.path
  return null
}

export function bulkDirection(from: string, to: string): 'forward' | 'back' | 'none' {
  const a = bulkDepth(from)
  const b = bulkDepth(to)
  if (b > a) return 'forward'
  if (b < a) return 'back'
  return 'none'
}

export function isBulkOrderPath(pathname: string): boolean {
  return pathname === BULK_ORDER_PATH || pathname.startsWith(`${BULK_ORDER_PATH}/`)
}

export function bulkOrderTitle(pathname: string): string | null {
  if (!isBulkOrderPath(pathname)) return null
  if (pathname === BULK_ORDER_PATH || pathname === `${BULK_ORDER_PATH}/`) return BULK_ORDER_LABEL
  return bulkOrderBrand(pathname)?.name ?? BULK_ORDER_LABEL
}

/** Dropship stays active on brand routes, and stays inactive on Bulk Order. */
export function isDropshipPath(pathname: string): boolean {
  if (pathname === '/ordering' || pathname === '/ordering/') return true
  if (!pathname.startsWith('/ordering/')) return false
  return !isBulkOrderPath(pathname)
}
