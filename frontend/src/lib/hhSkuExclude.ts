export const DEFAULT_HH_SKU_EXCLUDES = ['DUP_']

export const HH_SKU_EXCLUDE_NOTE_PREFIX = 'Cart exclusion: '

const TOKEN_PATTERN = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*[-_]?$/

export function normalizeHhSkuExcludes(value: unknown): { excludes: string[] } | { error: string } {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { error: 'SKU exclusions must be a list of text values.' }
  }
  if (value.length > 20) return { error: 'Use at most 20 SKU exclusions.' }

  const excludes: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const token = raw.trim().toUpperCase()
    if (!token) continue
    if (token.length > 40) return { error: `SKU exclusion "${token}" is too long.` }
    if (!TOKEN_PATTERN.test(token)) {
      return { error: `SKU exclusion "${token}" can only use letters, numbers, hyphens, and underscores.` }
    }
    if (seen.has(token)) continue
    seen.add(token)
    excludes.push(token)
  }
  return { excludes }
}

export function hhSkuExcludedByRule(note: string | undefined): boolean {
  return (note ?? '').startsWith(HH_SKU_EXCLUDE_NOTE_PREFIX)
}
