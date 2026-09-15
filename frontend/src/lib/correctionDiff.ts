/** Flattens nested JSON into `a.b[0].c` paths, so two versions can be compared. */
function flatten(value: unknown, prefix = '', out: Record<string, string> = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out)
    }
    return out
  }
  out[prefix] = value === null || value === undefined ? '' : String(value)
  return out
}

export interface FieldChange {
  path: string
  before: string
  after: string
}

/**
 * Field-level differences between the agent's output and a user's edit.
 *
 * Compared as flattened paths rather than as text, so a reformat or a change in
 * key order shows nothing and an actually-changed value shows exactly once.
 */
export function diffOutputs(original: unknown, corrected: unknown): FieldChange[] {
  const before = flatten(original ?? {})
  const after = flatten(corrected ?? {})
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()

  return paths
    .filter((path) => (before[path] ?? '') !== (after[path] ?? ''))
    .map((path) => ({ path, before: before[path] ?? '', after: after[path] ?? '' }))
}
