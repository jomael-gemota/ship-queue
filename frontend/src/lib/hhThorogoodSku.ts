/** Keep in sync with src/lib/hhThorogoodSku.ts. Used for the Config page preview. */

export const DEFAULT_THOROGOOD_SKU_INITIALS = ['DUP_TG', 'DUP-TG', 'TG-']

export const DEFAULT_THOROGOOD_SKU_SUFFIXES = ['-V2']

export const THOROGOOD_SKU_SAMPLES = [
  'DUP_TG-889-8000_L',
  'DUP_TG-814-4322_10.5-2E',
  'DUP_TG-804-4243_10.5-W',
  'TG-804-3320_7-D',
  'TG-804-3166_12-M-V2',
]

const INITIAL_PATTERN = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*[-_]?$/

export function normalizeThorogoodSkuInitials(value: unknown): { initials: string[] } | { error: string } {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { error: 'SKU initials must be a list of prefixes.' }
  }
  if (value.length > 20) return { error: 'Use at most 20 SKU initials.' }

  const initials: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const token = raw.trim().toUpperCase()
    if (!token) continue
    if (token.length > 40) return { error: `SKU initial "${token}" is too long.` }
    if (!INITIAL_PATTERN.test(token)) {
      return { error: `SKU initial "${token}" can only use letters, numbers, hyphens, and underscores.` }
    }
    if (seen.has(token)) continue
    seen.add(token)
    initials.push(token)
  }
  return { initials }
}

function sizeInTenths(measurement: string): string {
  const match = measurement.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return measurement
  const whole = match[1]
  const fraction = match[2] ?? ''
  if (fraction.length === 0) return `${whole}0`
  if (fraction.length === 1) return `${whole}${fraction}`
  return String(Math.round(Number(`${whole}.${fraction}`) * 10))
}

export function thorogoodPortalSku(raw: string, initials: readonly string[]): string {
  const sku = raw.trim()
  if (!sku) return ''

  const prefixes = [...initials]
    .map((initial) => initial.trim().toUpperCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  let rest = sku
  const upper = sku.toUpperCase()
  for (const prefix of prefixes) {
    if (!upper.startsWith(prefix)) continue
    rest = sku.slice(prefix.length)
    if (rest.startsWith('-') || rest.startsWith('_')) rest = rest.slice(1)
    break
  }

  const splitAt = rest.indexOf('_')
  if (splitAt === -1) return rest.replace(/\s+/g, ' ').trim()

  const style = rest.slice(0, splitAt).trim()
  const tail = rest.slice(splitAt + 1).trim()
  const footwear = tail.match(/^(\d+(?:\.\d+)?)-([A-Za-z0-9]+)$/)
  if (footwear) return `${style} ${footwear[2].toUpperCase()} ${sizeInTenths(footwear[1])}`
  return `${style} ${tail.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()}`.trim()
}

function orderedTokens(tokens: readonly string[]): string[] {
  return [...tokens]
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
}

function stripImportAffixes(raw: string, prefixes: readonly string[], suffixes: readonly string[]): string {
  let sku = raw.trim()
  if (!sku) return ''

  const upperStart = sku.toUpperCase()
  for (const token of orderedTokens(prefixes)) {
    if (!upperStart.startsWith(token) || sku.length <= token.length) continue
    sku = sku.slice(token.length).replace(/^[-_]+/, '')
    break
  }

  const upperEnd = sku.toUpperCase()
  for (const token of orderedTokens(suffixes)) {
    if (!upperEnd.endsWith(token) || sku.length <= token.length) continue
    sku = sku.slice(0, sku.length - token.length).replace(/[-_]+$/, '')
    break
  }

  return sku.trim()
}

function uniquePortalCodes(values: string[]): string[] {
  const seen = new Set<string>()
  const codes: string[] = []
  for (const value of values) {
    const code = value.replace(/\s+/g, ' ').trim()
    const key = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!code || seen.has(key)) continue
    seen.add(key)
    codes.push(code)
  }
  return codes
}

export function thorogoodPortalSkuCandidates(
  raw: string,
  prefixes: readonly string[],
  suffixes: readonly string[],
): string[] {
  const cleaned = stripImportAffixes(raw, prefixes, suffixes)
  if (!cleaned) return []
  if (cleaned.includes(' ') || !cleaned.includes('_')) return uniquePortalCodes([cleaned])

  const splitAt = cleaned.indexOf('_')
  const style = cleaned.slice(0, splitAt).trim()
  const tail = cleaned.slice(splitAt + 1).trim()
  if (!style || !tail) return uniquePortalCodes([cleaned])

  const footwear = tail.match(/^(\d+(?:\.\d+)?)-([A-Za-z0-9]+)$/)
  if (footwear) {
    const width = footwear[2].toUpperCase()
    const tenths = sizeInTenths(footwear[1])
    const padded = /^\d+$/.test(tenths) ? tenths.padStart(3, '0') : tenths
    return uniquePortalCodes([
      `${style} ${width} ${padded}`,
      `${style} ${width} ${tenths}`,
      `${style} ${width}`,
    ])
  }

  const numeric = tail.match(/^(\d+(?:\.\d+)?)$/)
  if (numeric) {
    const tenths = sizeInTenths(numeric[1])
    const padded = /^\d+$/.test(tenths) ? tenths.padStart(3, '0') : tenths
    return uniquePortalCodes([`${style} ${padded}`, `${style} ${tenths}`])
  }

  return uniquePortalCodes([`${style} ${tail.toUpperCase()}`])
}

/** Start and end strings actually removed, including a separator that travels with them. */
export function thorogoodAffixSpan(
  raw: string,
  prefixes: readonly string[],
  suffixes: readonly string[],
): { prefixLen: number; suffixLen: number; prefix: string | null; suffix: string | null } | null {
  const original = raw.trim()
  if (!original) return null

  let prefixLen = 0
  let sku = original
  const upperStart = sku.toUpperCase()
  for (const token of orderedTokens(prefixes)) {
    if (!upperStart.startsWith(token) || sku.length <= token.length) continue
    prefixLen = token.length
    const separators = sku.slice(token.length).match(/^[-_]+/)
    if (separators) prefixLen += separators[0].length
    sku = sku.slice(prefixLen)
    break
  }

  let suffixLen = 0
  const upperEnd = sku.toUpperCase()
  for (const token of orderedTokens(suffixes)) {
    if (!upperEnd.endsWith(token) || sku.length <= token.length) continue
    const head = sku.slice(0, sku.length - token.length)
    const separators = head.match(/[-_]+$/)
    suffixLen = token.length + (separators?.[0].length ?? 0)
    break
  }

  if (prefixLen === 0 && suffixLen === 0) return null
  if (prefixLen + suffixLen >= original.length) return null
  return {
    prefixLen,
    suffixLen,
    prefix: prefixLen ? original.slice(0, prefixLen) : null,
    suffix: suffixLen ? original.slice(original.length - suffixLen) : null,
  }
}
