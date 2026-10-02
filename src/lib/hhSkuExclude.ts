import type { HHBrandId } from './hhBrand';

/** Applied to Helly Hansen Sports and Work until Configurations saves a list. */
export const DEFAULT_HH_SKU_EXCLUDES = ['DUP_'];

export const HH_SKU_EXCLUDE_NOTE_PREFIX = 'Cart exclusion: ';

const TOKEN_PATTERN = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*[-_]?$/;

export function hhBrandUsesSkuExcludes(brand: HHBrandId): boolean {
  return brand === 'sportswear' || brand === 'workwear';
}

export function effectiveHhSkuExcludes(excludes: string[] | undefined, excludesSet: boolean): string[] {
  if (!excludesSet) return [...DEFAULT_HH_SKU_EXCLUDES];
  return excludes ?? [];
}

export function normalizeHhSkuExcludes(value: unknown): { excludes: string[] } | { error: string } {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { error: 'SKU exclusions must be a list of text values.' };
  }
  if (value.length > 20) return { error: 'Use at most 20 SKU exclusions.' };

  const excludes: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const token = raw.trim().toUpperCase();
    if (!token) continue;
    if (token.length > 40) return { error: `SKU exclusion "${token}" is too long.` };
    if (!TOKEN_PATTERN.test(token)) {
      return { error: `SKU exclusion "${token}" can only use letters, numbers, hyphens, and underscores.` };
    }
    if (seen.has(token)) continue;
    seen.add(token);
    excludes.push(token);
  }
  return { excludes };
}

/** Longest configured token contained in the SKU, if any. */
export function matchingSkuExclude(sku: string, tokens: readonly string[]): string | null {
  const hay = sku.trim().toUpperCase();
  if (!hay) return null;
  const ordered = [...tokens]
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const token of ordered) {
    if (hay.includes(token)) return token;
  }
  return null;
}

export function hhSkuExcludeNote(token: string): string {
  return `${HH_SKU_EXCLUDE_NOTE_PREFIX}${token}`;
}

/** Mark matching lines excluded. Clears a previous rule exclusion that no longer matches. */
export function applyHhSkuExcludes(
  items: Array<{ sku?: string; excluded?: boolean; excludeNote?: string }>,
  tokens: readonly string[]
): boolean {
  let changed = false;
  for (const item of items) {
    const hit = matchingSkuExclude(item.sku ?? '', tokens);
    const note = item.excludeNote ?? '';
    const fromRule = note.startsWith(HH_SKU_EXCLUDE_NOTE_PREFIX);
    if (hit) {
      const nextNote = fromRule || !note.trim() ? hhSkuExcludeNote(hit) : note;
      if (!item.excluded || note !== nextNote) {
        item.excluded = true;
        item.excludeNote = nextNote;
        changed = true;
      }
      continue;
    }
    if (item.excluded && fromRule) {
      item.excluded = false;
      item.excludeNote = '';
      changed = true;
    }
  }
  return changed;
}
