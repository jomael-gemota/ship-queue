import type { AgentTable } from '../types/docTidy'

/**
 * One entry in a correction diff.
 * - `kind === 'value'`  (default): a field's value changed.
 * - `kind === 'rename'`: a field was renamed; `renamedTo` holds the new name
 *   and `sharedValue` holds the value that moved unchanged into the new key.
 */
export type DiffChange =
  | { kind?: 'value'; field: string; before: string; after: string }
  | {
      kind: 'rename'
      section?: string
      field: string
      renamedTo: string
      sharedValue: string
      before: string
      after: string
    }

/** Header names that mark the first column of a two-column table as a label. */
const LABEL_HEADERS = new Set(['field', 'label', 'key', 'name', 'attribute'])

interface KvEntry {
  label: string
  value: string
}

interface KvSection {
  kind: 'kv'
  title: string
  entries: KvEntry[]
}

interface GridSection {
  kind: 'grid'
  title: string
  columns: string[]
  /** Each row keyed by normalised column name. */
  rows: Record<string, string>[]
}

type Section = KvSection | GridSection

const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

function cellText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

/** The editor re-parses cells as numbers, so `"0.50"` and `0.5` are the same value. */
function sameValue(a: string, b: string): boolean {
  if (a === b) return true
  if (a === '' || b === '') return false
  const na = Number(a)
  const nb = Number(b)
  return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb
}

/** `customerReference` / `customer_reference` → `Customer Reference`. */
function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const isScalar = (v: unknown) => v === null || (typeof v !== 'object' && typeof v !== 'function')

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v)

function tableToSection(table: AgentTable): Section {
  const title = table.title ?? ''
  if (table.columns.length === 2 && LABEL_HEADERS.has(norm(table.columns[0]))) {
    return {
      kind: 'kv',
      title,
      entries: table.rows.map((r) => ({ label: cellText(r[0]), value: cellText(r[1]) })),
    }
  }
  return {
    kind: 'grid',
    title,
    columns: table.columns,
    rows: table.rows.map((r) =>
      Object.fromEntries(table.columns.map((c, i) => [norm(c), cellText(r[i])]))
    ),
  }
}

/**
 * Rebuilds table-shaped sections from the agent's JSON, for corrections saved
 * before `originalTables` was recorded. Top-level scalars form the untitled
 * root section that unmatched key/value tables fall back to.
 */
function jsonToSections(output: Record<string, unknown>): Section[] {
  const root: KvSection = { kind: 'kv', title: '', entries: [] }
  const sections: Section[] = [root]

  for (const [key, value] of Object.entries(output)) {
    if (isScalar(value)) {
      root.entries.push({ label: humanize(key), value: cellText(value) })
    } else if (Array.isArray(value)) {
      const items = value.filter(isPlainObject)
      if (items.length === 0) continue
      const columns = [...new Set(items.flatMap((item) => Object.keys(item)))]
      sections.push({
        kind: 'grid',
        title: key,
        columns,
        rows: items.map((item) =>
          Object.fromEntries(
            Object.entries(item)
              .filter(([, v]) => isScalar(v))
              .map(([k, v]) => [norm(k), cellText(v)])
          )
        ),
      })
    } else if (isPlainObject(value)) {
      sections.push({
        kind: 'kv',
        title: key,
        entries: Object.entries(value)
          .filter(([, v]) => isScalar(v))
          .map(([k, v]) => ({ label: humanize(k), value: cellText(v) })),
      })
    }
  }
  return sections
}

const prefixed = (title: string, rest: string) => (title ? `${title} · ${rest}` : rest)

/**
 * Diffs the key/value tables mapped onto one original section. Rows match by
 * label, so reordering is not a change; an unmatched removed label and an
 * unmatched added label holding the same value are reported as a rename.
 */
function diffKv(original: KvSection, corrected: KvSection[], strict: boolean): DiffChange[] {
  const changes: DiffChange[] = []
  const pool = new Map<string, KvEntry>()
  for (const entry of original.entries) {
    const key = norm(entry.label)
    if (key && !pool.has(key)) pool.set(key, entry)
  }

  const added: Array<KvEntry & { title: string }> = []
  for (const section of corrected) {
    for (const entry of section.entries) {
      const key = norm(entry.label)
      const match = pool.get(key)
      if (!match) {
        added.push({ ...entry, title: section.title })
        continue
      }
      pool.delete(key)
      if (!sameValue(match.value, entry.value)) {
        changes.push({
          field: prefixed(section.title, entry.label),
          before: match.value,
          after: entry.value,
        })
      }
    }
  }

  const removed = [...pool.values()]
  const unpairedAdded: typeof added = []
  for (const entry of added) {
    const candidates =
      entry.value === '' ? [] : removed.filter((r) => sameValue(r.value, entry.value))
    // Only a unique value match is trusted — two removed zeros could be anything.
    if (candidates.length === 1) {
      removed.splice(removed.indexOf(candidates[0]), 1)
      changes.push({
        kind: 'rename',
        section: entry.title || undefined,
        field: candidates[0].label,
        renamedTo: entry.label,
        sharedValue: entry.value,
        before: '',
        after: '',
      })
    } else {
      unpairedAdded.push(entry)
    }
  }

  if (strict) {
    for (const entry of unpairedAdded) {
      changes.push({ field: prefixed(entry.title, entry.label), before: '', after: entry.value })
    }
    const title = corrected[0]?.title ?? ''
    for (const entry of removed) {
      changes.push({ field: prefixed(title, entry.label), before: entry.value, after: '' })
    }
  }
  return changes
}

/** Diffs a grid table row-by-row, cell-by-column-name. */
function diffGrid(original: GridSection, corrected: GridSection, strict: boolean): DiffChange[] {
  const changes: DiffChange[] = []
  const multiRow = original.rows.length > 1 || corrected.rows.length > 1
  const rowCount = Math.max(original.rows.length, corrected.rows.length)
  const summarise = (row: Record<string, string>) =>
    Object.values(row).filter(Boolean).join(' · ')

  for (let ri = 0; ri < rowCount; ri++) {
    const before = original.rows[ri]
    const after = corrected.rows[ri]
    const rowSuffix = multiRow ? ` (row ${ri + 1})` : ''

    if (before && after) {
      for (const column of corrected.columns) {
        const oldVal = before[norm(column)]
        if (oldVal === undefined) continue
        const newVal = after[norm(column)] ?? ''
        if (!sameValue(oldVal, newVal)) {
          changes.push({
            field: prefixed(corrected.title, `${column}${rowSuffix}`),
            before: oldVal,
            after: newVal,
          })
        }
      }
    } else if (strict && after) {
      changes.push({ field: prefixed(corrected.title, `row ${ri + 1}`), before: '', after: summarise(after) })
    } else if (strict && before) {
      changes.push({ field: prefixed(corrected.title, `row ${ri + 1}`), before: summarise(before), after: '' })
    }
  }
  return changes
}

/**
 * Field-level differences for a correction made in the table view.
 *
 * `originalTables` is the exact baseline and yields a full diff. Without it
 * (older corrections) the baseline is rebuilt from `originalOutput`; since the
 * agent's JSON and tables need not carry the same fields, that path reports
 * only value changes and renames, never bare additions or removals.
 */
export function diffTableCorrection({
  originalTables,
  originalOutput,
  correctedTables,
}: {
  originalTables?: AgentTable[] | null
  originalOutput?: Record<string, unknown> | null
  correctedTables: AgentTable[]
}): DiffChange[] {
  const strict = Array.isArray(originalTables) && originalTables.length > 0
  const originals: Section[] = strict
    ? originalTables.map(tableToSection)
    : isPlainObject(originalOutput)
      ? jsonToSections(originalOutput)
      : []
  if (originals.length === 0) return []

  const corrected = correctedTables.map(tableToSection)
  const correctedGrids = corrected.filter((s) => s.kind === 'grid')
  const originalGrids = originals.filter((s) => s.kind === 'grid')
  const root = strict ? undefined : originals.find((s) => s.kind === 'kv' && s.title === '')

  const findOriginal = (section: Section, index: number): Section | undefined => {
    const byTitle = originals.find(
      (o) => o.kind === section.kind && o.title && norm(o.title) === norm(section.title)
    )
    if (byTitle) return byTitle
    if (strict) {
      const sameIndex = originals[index]
      return sameIndex?.kind === section.kind && !sameIndex.title && !section.title
        ? sameIndex
        : undefined
    }
    if (section.kind === 'kv') return root
    return correctedGrids.length === 1 && originalGrids.length === 1 ? originalGrids[0] : undefined
  }

  const changes: DiffChange[] = []
  const kvGroups = new Map<KvSection, KvSection[]>()

  corrected.forEach((section, index) => {
    const original = findOriginal(section, index)
    if (!original) return
    if (section.kind === 'grid' && original.kind === 'grid') {
      changes.push(...diffGrid(original, section, strict))
    } else if (section.kind === 'kv' && original.kind === 'kv') {
      // Several tables can map onto the legacy root section, so a label moved
      // between them is judged against the root as a whole.
      const group = kvGroups.get(original)
      if (group) group.push(section)
      else kvGroups.set(original, [section])
    }
  })

  for (const [original, sections] of kvGroups) {
    changes.push(...diffKv(original, sections, strict))
  }
  return changes
}
