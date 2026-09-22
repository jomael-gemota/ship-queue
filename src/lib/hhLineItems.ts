export function hhItemIsExcluded(item: { excluded?: boolean }): boolean {
  return Boolean(item.excluded);
}

export function hhCartItems<T extends { excluded?: boolean }>(items: T[] | undefined | null): T[] {
  return (items ?? []).filter((item) => !hhItemIsExcluded(item));
}

export function hhExclusionKey(item: { sku?: string; asin?: string }): string {
  return (item.sku ?? '').trim().toUpperCase() || (item.asin ?? '').trim().toUpperCase();
}

export function mergeHhItemExclusions<T extends { sku: string; asin?: string }>(
  existing: Array<{ sku?: string; asin?: string; excluded?: boolean; excludeNote?: string }>,
  incoming: T[]
): Array<T & { excluded: boolean; excludeNote: string }> {
  const prior = new Map<string, { excluded: boolean; excludeNote: string }>();
  for (const item of existing) {
    const key = hhExclusionKey(item);
    if (!key) continue;
    if (item.excluded || (item.excludeNote ?? '').trim()) {
      prior.set(key, {
        excluded: Boolean(item.excluded),
        excludeNote: (item.excludeNote ?? '').trim(),
      });
    }
  }
  return incoming.map((item) => {
    const saved = prior.get(hhExclusionKey(item));
    return {
      ...item,
      excluded: saved?.excluded ?? false,
      excludeNote: saved?.excludeNote ?? '',
    };
  });
}
