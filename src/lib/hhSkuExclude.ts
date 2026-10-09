import type { HHBrandId } from './hhBrand';

/** Removed from the start of a Helly Hansen Seller Central SKU. */
export const DEFAULT_HH_SKU_PREFIXES = ['DUP_', 'DUP-'];

/** Removed from the end of a Helly Hansen Seller Central SKU. */
export const DEFAULT_HH_SKU_SUFFIXES = ['_FBA', '-FBA'];

/** Left on lines when an older build kept the whole SKU off the cart. */
export const HH_SKU_EXCLUDE_NOTE_PREFIX = 'Cart exclusion: ';

const TOKEN_PATTERN = /^[-_]?[A-Z0-9]+(?:[-_][A-Z0-9]+)*[-_]?$/;

export function hhBrandUsesSkuAffixes(brand: HHBrandId): boolean {
  return brand === 'sportswear' || brand === 'workwear';
}

export function effectiveHhSkuPrefixes(prefixes: string[] | undefined, prefixesSet: boolean): string[] {
  if (!prefixesSet) return [...DEFAULT_HH_SKU_PREFIXES];
  return prefixes ?? [];
}

export function effectiveHhSkuSuffixes(suffixes: string[] | undefined, suffixesSet: boolean): string[] {
  if (!suffixesSet) return [...DEFAULT_HH_SKU_SUFFIXES];
  return suffixes ?? [];
}

export function normalizeHhSkuTokens(
  value: unknown,
  label: string
): { tokens: string[] } | { error: string } {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { error: `${label} must be a list of text values.` };
  }
  if (value.length > 20) return { error: `Use at most 20 ${label.toLowerCase()}.` };

  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const token = raw.trim().toUpperCase();
    if (!token) continue;
    if (token.length > 40) return { error: `${label} "${token}" is too long.` };
    if (!TOKEN_PATTERN.test(token)) {
      return { error: `${label} "${token}" can only use letters, numbers, hyphens, and underscores.` };
    }
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return { tokens };
}

function orderedTokens(tokens: readonly string[]): string[] {
  return [...tokens]
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

export function hhCartSkuAdjustment(
  raw: string,
  prefixes: readonly string[],
  suffixes: readonly string[]
): { cartSku: string; prefix: string | null; suffix: string | null } {
  let sku = raw.trim();
  if (!sku) return { cartSku: '', prefix: null, suffix: null };

  let prefix: string | null = null;
  const upperStart = sku.toUpperCase();
  for (const token of orderedTokens(prefixes)) {
    if (!upperStart.startsWith(token) || sku.length <= token.length) continue;
    prefix = token;
    sku = sku.slice(token.length);
    break;
  }

  let suffix: string | null = null;
  const upperEnd = sku.toUpperCase();
  for (const token of orderedTokens(suffixes)) {
    if (!upperEnd.endsWith(token) || sku.length <= token.length) continue;
    suffix = token;
    sku = sku.slice(0, sku.length - token.length);
    break;
  }

  return { cartSku: sku, prefix, suffix };
}

/**
 * Seller Central SKU → Helly Hansen cart SKU.
 * Prefixes are removed from the start and suffixes from the end, once each.
 * `DUP_70429_482-M` → `70429_482-M`
 * `70429_482-M_fba` → `70429_482-M`
 * `DUP_70429_482-M-fba` → `70429_482-M`
 */
export function hhCartSku(raw: string, prefixes: readonly string[], suffixes: readonly string[]): string {
  return hhCartSkuAdjustment(raw, prefixes, suffixes).cartSku;
}

/** Explicit cart SKU wins. Otherwise the start and end strings are removed. */
export function hhLineCartSku(
  item: { sku?: string; cartSku?: string },
  prefixes: readonly string[],
  suffixes: readonly string[]
): string {
  const chosen = (item.cartSku ?? '').trim();
  if (chosen) return chosen;
  return hhCartSku(item.sku ?? '', prefixes, suffixes);
}

/** Clear a previous "leave this line off the cart" flag. The SKU is cleaned later, not dropped. */
export function releaseHhSkuRuleExclusions(
  items: Array<{ excluded?: boolean; excludeNote?: string }>
): boolean {
  let changed = false;
  for (const item of items) {
    const note = item.excludeNote ?? '';
    if (!item.excluded || !note.startsWith(HH_SKU_EXCLUDE_NOTE_PREFIX)) continue;
    item.excluded = false;
    item.excludeNote = '';
    changed = true;
  }
  return changed;
}
