/** Seller Central prefixes removed before a Thorogood portal search. */
export const DEFAULT_THOROGOOD_SKU_INITIALS = ['DUP_TG', 'DUP-TG', 'TG-'];

export const THOROGOOD_SKU_SAMPLES = [
  'DUP_TG-889-8000_L',
  'DUP_TG-814-4322_10.5-2E',
  'DUP_TG-804-4243_10.5-W',
];

const INITIAL_PATTERN = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*[-_]?$/;

export function effectiveThorogoodSkuInitials(initials: string[] | undefined, initialsSet: boolean): string[] {
  if (!initialsSet) return [...DEFAULT_THOROGOOD_SKU_INITIALS];
  return initials ?? [];
}

export function normalizeThorogoodSkuInitials(value: unknown): { initials: string[] } | { error: string } {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { error: 'SKU initials must be a list of prefixes.' };
  }
  if (value.length > 20) return { error: 'Use at most 20 SKU initials.' };

  const initials: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const token = raw.trim().toUpperCase();
    if (!token) continue;
    if (token.length > 40) return { error: `SKU initial "${token}" is too long.` };
    if (!INITIAL_PATTERN.test(token)) {
      return { error: `SKU initial "${token}" can only use letters, numbers, hyphens, and underscores.` };
    }
    if (seen.has(token)) continue;
    seen.add(token);
    initials.push(token);
  }
  return { initials };
}

/** 10.5 → 105, 10 → 100, 9 → 90. */
function sizeInTenths(measurement: string): string {
  const match = measurement.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return measurement;
  const whole = match[1];
  const fraction = match[2] ?? '';
  if (fraction.length === 0) return `${whole}0`;
  if (fraction.length === 1) return `${whole}${fraction}`;
  return String(Math.round(Number(`${whole}.${fraction}`) * 10));
}

/**
 * Seller Central SKU → Thorogood portal code.
 * `DUP_TG-889-8000_L` → `889-8000 L`
 * `DUP_TG-814-4322_10.5-2E` → `814-4322 2E 105`
 * `DUP_TG-804-4243_10.5-W` → `804-4243 W 105`
 */
export function thorogoodPortalSku(raw: string, initials: readonly string[]): string {
  const sku = raw.trim();
  if (!sku) return '';

  const prefixes = [...initials]
    .map((initial) => initial.trim().toUpperCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let rest = sku;
  const upper = sku.toUpperCase();
  for (const prefix of prefixes) {
    if (!upper.startsWith(prefix)) continue;
    rest = sku.slice(prefix.length);
    if (rest.startsWith('-') || rest.startsWith('_')) rest = rest.slice(1);
    break;
  }

  const splitAt = rest.indexOf('_');
  if (splitAt === -1) return rest.replace(/\s+/g, ' ').trim();

  const style = rest.slice(0, splitAt).trim();
  const tail = rest.slice(splitAt + 1).trim();
  const footwear = tail.match(/^(\d+(?:\.\d+)?)-([A-Za-z0-9]+)$/);
  if (footwear) return `${style} ${footwear[2].toUpperCase()} ${sizeInTenths(footwear[1])}`;
  return `${style} ${tail.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()}`.trim();
}
