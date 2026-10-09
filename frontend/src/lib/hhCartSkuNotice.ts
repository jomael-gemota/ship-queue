import { hhCartSku, hhCartSkuAdjustment } from './hhSkuExclude'
import { thorogoodPortalSku } from './hhThorogoodSku'

export type CartSkuStrip = {
  sellerSku: string
  cartSku: string
  note: string
}

function matchingThorogoodInitial(sku: string, initials: readonly string[]): string | null {
  const trimmed = sku.trim()
  const upper = trimmed.toUpperCase()
  const prefixes = [...initials]
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  for (const prefix of prefixes) {
    if (upper.startsWith(prefix) && trimmed.length > prefix.length) return prefix
  }
  return null
}

function removalNote(prefix: string | null, suffix: string | null): string {
  if (prefix && suffix) return `${prefix} removed from the start, ${suffix} from the end`
  if (prefix) return `${prefix} removed from the start`
  return `${suffix ?? ''} removed from the end`
}

/** Lines whose cart SKU drops a configured start or end string. Manual cart SKUs are left out. */
export function cartSkuStrips(
  items: Array<{ sku?: string; cartSku?: string; excluded?: boolean }>,
  options: {
    orderDetails: boolean
    prefixes: readonly string[]
    suffixes: readonly string[]
    initials: readonly string[]
  },
): CartSkuStrip[] {
  const strips: CartSkuStrip[] = []
  for (const item of items) {
    if (item.excluded) continue
    if ((item.cartSku ?? '').trim()) continue
    const sellerSku = (item.sku ?? '').trim()
    if (!sellerSku) continue

    if (options.orderDetails) {
      const initial = matchingThorogoodInitial(sellerSku, options.initials)
      if (!initial) continue
      const cartSku = thorogoodPortalSku(sellerSku, options.initials)
      if (!cartSku || cartSku.toUpperCase() === sellerSku.toUpperCase()) continue
      strips.push({ sellerSku, cartSku, note: `${initial} removed from the start` })
      continue
    }

    const adjustment = hhCartSkuAdjustment(sellerSku, options.prefixes, options.suffixes)
    if (!adjustment.prefix && !adjustment.suffix) continue
    if (!adjustment.cartSku || adjustment.cartSku.toUpperCase() === sellerSku.toUpperCase()) continue
    strips.push({
      sellerSku,
      cartSku: adjustment.cartSku,
      note: removalNote(adjustment.prefix, adjustment.suffix),
    })
  }
  return strips
}

export type SkuRemovalMark = {
  sellerSku: string
  prefixLen: number
  suffixLen: number
  note: string
}

function compactSku(sku: string): string {
  return sku.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function removalSpan(sellerSku: string, options: {
  orderDetails: boolean
  prefixes: readonly string[]
  suffixes: readonly string[]
  initials: readonly string[]
}): { prefixLen: number; suffixLen: number; note: string } | null {
  const raw = sellerSku.trim()
  if (!raw) return null
  if (options.orderDetails) {
    const initial = matchingThorogoodInitial(raw, options.initials)
    if (!initial) return null
    let prefixLen = initial.length
    const rest = raw.slice(prefixLen)
    if (rest.startsWith('-') || rest.startsWith('_')) prefixLen += 1
    return { prefixLen, suffixLen: 0, note: `${raw.slice(0, prefixLen)} removed from the start` }
  }
  const adjustment = hhCartSkuAdjustment(raw, options.prefixes, options.suffixes)
  if (!adjustment.prefix && !adjustment.suffix) return null
  return {
    prefixLen: adjustment.prefix?.length ?? 0,
    suffixLen: adjustment.suffix?.length ?? 0,
    note: removalNote(adjustment.prefix, adjustment.suffix),
  }
}

/** Seller Central SKUs that became this cart SKU by dropping a start or end string. */
export function skuRemovalMarks(
  items: Array<{ sku?: string; cartSku?: string; excluded?: boolean }>,
  cartSku: string,
  options: {
    orderDetails: boolean
    prefixes: readonly string[]
    suffixes: readonly string[]
    initials: readonly string[]
  },
): SkuRemovalMark[] {
  const wanted = compactSku(cartSku)
  if (!wanted) return []
  const marks: SkuRemovalMark[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.excluded) continue
    if ((item.cartSku ?? '').trim()) continue
    const sellerSku = (item.sku ?? '').trim()
    if (!sellerSku || seen.has(sellerSku.toUpperCase())) continue
    const resolved = options.orderDetails
      ? thorogoodPortalSku(sellerSku, options.initials)
      : hhCartSku(sellerSku, options.prefixes, options.suffixes)
    if (compactSku(resolved) !== wanted) continue
    const span = removalSpan(sellerSku, options)
    if (!span || (span.prefixLen === 0 && span.suffixLen === 0)) continue
    if (span.prefixLen + span.suffixLen >= sellerSku.length) continue
    seen.add(sellerSku.toUpperCase())
    marks.push({ sellerSku, ...span })
  }
  return marks
}

export function cartSkuStripTooltip(strips: CartSkuStrip[]): string {
  const shown = strips.slice(0, 6)
  const extra = strips.length - shown.length
  const lines = shown.map((strip) => `${strip.sellerSku} → ${strip.cartSku}\n${strip.note}`)
  if (extra > 0) lines.push(`and ${extra} more`)
  const heading = strips.length === 1 ? 'SKU string removed on this order.' : 'SKU strings removed on this order.'
  return `${heading}\n${lines.join('\n')}`
}
