import { useEffect, useMemo, useState } from 'react'
import { authApi } from '../../lib/api'
import { diffOutputs } from '../../lib/correctionDiff'
import { Spinner } from './docTidyUi'
import type { AgentTable, DocTidyCorrection, TableOutput } from '../../types/docTidy'

/* ─────────────────────────────────────────── JSON diff (shared) ── */

export function CorrectionDiff({
  original,
  corrected,
}: {
  original: unknown
  corrected: unknown
}) {
  const changes = useMemo(() => diffOutputs(original, corrected), [original, corrected])

  if (changes.length === 0) {
    return <p className="text-xs italic text-[var(--text-200)]">No field-level changes.</p>
  }

  return (
    <ul className="space-y-1">
      {changes.map((change) => (
        <li key={change.path} className="text-xs">
          <span className="font-mono text-[var(--text-200)]">{change.path}</span>
          <span className="mx-1.5 text-[var(--text-200)]">·</span>
          <span className="rounded bg-rose-50 px-1 py-0.5 text-rose-700 line-through dark:bg-rose-900/20 dark:text-rose-300">
            {change.before || '(empty)'}
          </span>
          <span className="mx-1 text-[var(--text-200)]">→</span>
          <span className="rounded bg-emerald-50 px-1 py-0.5 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
            {change.after || '(empty)'}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ─────────────────────────────────── Tabular editor internals ── */

type CellValue = string | number | boolean | null

/** A table whose cells are held as plain strings for easy editing. */
interface EditableTable {
  title?: string
  columns: string[]
  /** Each row has one string slot per column. */
  rows: string[][]
}

/** Deep-copy an AgentTable[] into EditableTable[], stringifying every cell. */
function initEditable(tables: AgentTable[]): EditableTable[] {
  return tables.map((t) => ({
    title: t.title,
    columns: [...t.columns],
    rows: t.rows.map((r) =>
      t.columns.map((_, i) => {
        const v = r[i]
        return v === null || v === undefined ? '' : String(v)
      })
    ),
  }))
}

/** Re-parse a cell string, restoring numbers where appropriate. */
function parseCell(val: string): CellValue {
  const trimmed = val.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return !isNaN(n) ? n : trimmed
}

/** Convert an EditableTable back to AgentTable for submission. */
function toAgentTable(t: EditableTable): AgentTable {
  return {
    title: t.title,
    columns: t.columns,
    rows: t.rows.map((r) => r.map(parseCell)),
  }
}

/** Counts cells changed, rows added, and rows removed across all tables. */
function tableDiffStats(
  original: AgentTable[],
  edited: EditableTable[]
): { rowsAdded: number; rowsRemoved: number; cellsChanged: number; hasChanges: boolean } {
  let rowsAdded = 0
  let rowsRemoved = 0
  let cellsChanged = 0

  for (let i = 0; i < Math.max(original.length, edited.length); i++) {
    const orig = original[i]
    const mod = edited[i]
    if (!orig || !mod) continue

    const maxLen = Math.max(orig.rows.length, mod.rows.length)
    for (let r = 0; r < maxLen; r++) {
      if (r >= orig.rows.length) { rowsAdded++; continue }
      if (r >= mod.rows.length) { rowsRemoved++; continue }
      for (let c = 0; c < orig.columns.length; c++) {
        const origVal = String(orig.rows[r][c] ?? '')
        const modVal = mod.rows[r][c] ?? ''
        if (origVal !== modVal) cellsChanged++
      }
    }
  }

  return {
    rowsAdded,
    rowsRemoved,
    cellsChanged,
    hasChanges: rowsAdded + rowsRemoved + cellsChanged > 0,
  }
}

/* ─────────────────────────────── Editable table grid component ── */

function EditableTableGrid({
  table,
  onChange,
}: {
  table: EditableTable
  onChange: (updated: EditableTable) => void
}) {
  const updateCell = (r: number, c: number, val: string) => {
    onChange({
      ...table,
      rows: table.rows.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? val : cell)) : row
      ),
    })
  }

  const addRow = () => {
    onChange({ ...table, rows: [...table.rows, table.columns.map(() => '')] })
  }

  const removeRow = (r: number) => {
    onChange({ ...table, rows: table.rows.filter((_, ri) => ri !== r) })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--bg-300)]">
      {table.title && (
        <div className="border-b border-[var(--bg-300)] bg-[var(--bg-200)] px-3 py-1.5">
          <span className="text-sm font-semibold text-[var(--text-100)]">{table.title}</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {table.columns.map((col, i) => (
                <th
                  key={i}
                  className="border-b border-r border-[var(--bg-300)] bg-[var(--bg-200)] px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-200)] last:border-r-0"
                >
                  {col}
                </th>
              ))}
              {/* Spacer for the delete-row button column */}
              <th className="w-8 border-b border-[var(--bg-300)] bg-[var(--bg-200)]" />
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={table.columns.length + 1}
                  className="px-3 py-3 text-center text-xs italic text-[var(--text-200)]"
                >
                  No rows — click <strong>+ Add row</strong> below.
                </td>
              </tr>
            ) : (
              table.rows.map((row, r) => (
                <tr key={r} className="group odd:bg-[var(--bg-100)] even:bg-[var(--bg-200)]">
                  {table.columns.map((_, c) => (
                    <td
                      key={c}
                      className="border-r border-[var(--bg-300)] px-2 py-1 last:border-r-0"
                    >
                      <input
                        value={row[c]}
                        onChange={(e) => updateCell(r, c, e.target.value)}
                        className="w-full min-w-[60px] bg-transparent text-sm text-[var(--text-100)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-200)] rounded px-1"
                      />
                    </td>
                  ))}
                  <td className="px-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(r)}
                      title="Remove this row"
                      className="cursor-pointer rounded px-1 py-0.5 text-xs text-[var(--text-300)] opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[var(--bg-300)] px-3 py-1.5">
        <button
          type="button"
          onClick={addRow}
          className="cursor-pointer text-xs text-[var(--accent-200)] hover:underline"
        >
          + Add row
        </button>
      </div>
    </div>
  )
}

/* ──────────────────────────────────── Tabular correction editor ── */

function TabularCorrectionEditor({
  jobId,
  originalTables,
  note,
  onNoteChange,
  onSaved,
}: {
  jobId: string
  originalTables: AgentTable[]
  note: string
  onNoteChange: (n: string) => void
  onSaved: () => void
}) {
  const [tables, setTables] = useState<EditableTable[]>(() => initEditable(originalTables))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  // Reset when the underlying job/tables change (e.g. after a re-run).
  useEffect(() => {
    setTables(initEditable(originalTables))
    setError(null)
    setResult(null)
  }, [originalTables])

  const updateTable = (i: number, updated: EditableTable) => {
    setTables((prev) => prev.map((t, ti) => (ti === i ? updated : t)))
  }

  const diff = useMemo(() => tableDiffStats(originalTables, tables), [originalTables, tables])

  const diffSummary = useMemo(() => {
    const parts: string[] = []
    if (diff.cellsChanged > 0)
      parts.push(`${diff.cellsChanged} cell${diff.cellsChanged !== 1 ? 's' : ''} changed`)
    if (diff.rowsAdded > 0)
      parts.push(`${diff.rowsAdded} row${diff.rowsAdded !== 1 ? 's' : ''} added`)
    if (diff.rowsRemoved > 0)
      parts.push(`${diff.rowsRemoved} row${diff.rowsRemoved !== 1 ? 's' : ''} removed`)
    return parts.join(' · ')
  }, [diff])

  const save = async () => {
    if (!diff.hasChanges) return
    setSaving(true)
    setError(null)
    setResult(null)

    const correctedTables = tables.map(toAgentTable)
    // Use the corrected tables as the JSON object for retrieval + duplicate detection.
    const correctedOutput: Record<string, unknown> = { tables: correctedTables }

    try {
      const res = await authApi.post<{
        data: { duplicate: boolean; embedded?: boolean }
      }>(`/doc-tidy/parse-jobs/${jobId}/corrections`, {
        correctedOutput,
        correctedTables,
        note: note.trim() || undefined,
        mode: 'tabular',
      })

      setResult(
        res.data.duplicate
          ? 'That correction was already recorded.'
          : res.data.embedded
            ? 'Saved. Tidy Agent will use this on similar documents.'
            : 'Saved, but not indexed for reuse — set OPENAI_API_KEY to enable retrieval.'
      )
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Editable table grids */}
      <div className="space-y-3">
        {tables.map((table, i) => (
          <EditableTableGrid
            key={i}
            table={table}
            onChange={(updated) => updateTable(i, updated)}
          />
        ))}
      </div>

      {/* Changes summary bar */}
      <div className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
          {diff.hasChanges ? diffSummary : 'No changes yet — edit cells, add or remove rows above'}
        </span>
      </div>

      {/* Shared note input */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-[var(--text-100)]">
          What was wrong?
          <span className="ml-1.5 font-normal text-[var(--text-200)]">
            Written as an instruction, this becomes a rule Tidy Agent follows on this
            vendor&apos;s future documents.
          </span>
        </label>
        <input
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="e.g. Qty comes from the Units column, not the case pack"
          className="w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-[var(--text-100)] focus:border-[var(--accent-200)] focus:outline-none"
        />
      </div>

      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {result && <p className="text-xs text-emerald-700 dark:text-emerald-400">{result}</p>}

      <button
        type="button"
        onClick={() => void save()}
        disabled={!diff.hasChanges || saving}
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving && <Spinner />}
        Save correction
      </button>
    </div>
  )
}

/* ──────────────────────────────────────── JSON correction editor ── */

function JsonCorrectionEditor({
  jobId,
  original,
  note,
  onNoteChange,
  onSaved,
}: {
  jobId: string
  original: Record<string, unknown> | null | undefined
  note: string
  onNoteChange: (n: string) => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    setDraft(JSON.stringify(original ?? {}, null, 2))
    setError(null)
    setResult(null)
  }, [jobId, original])

  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(draft) as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { value: null, error: 'The corrected output must be a JSON object.' }
      }
      return { value: value as Record<string, unknown>, error: null }
    } catch (err) {
      return { value: null, error: (err as Error).message }
    }
  }, [draft])

  const changes = useMemo(
    () => (parsed.value ? diffOutputs(original, parsed.value) : []),
    [original, parsed.value]
  )

  const save = async () => {
    if (!parsed.value) return
    setSaving(true)
    setError(null)
    setResult(null)

    try {
      const res = await authApi.post<{
        data: { duplicate: boolean; embedded?: boolean }
      }>(`/doc-tidy/parse-jobs/${jobId}/corrections`, {
        correctedOutput: parsed.value,
        note: note.trim() || undefined,
        mode: 'json',
      })

      setResult(
        res.data.duplicate
          ? 'That correction was already recorded.'
          : res.data.embedded
            ? 'Saved. Tidy Agent will use this on similar documents.'
            : 'Saved, but not indexed for reuse — set OPENAI_API_KEY to enable retrieval.'
      )
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const canSave = !saving && parsed.value !== null && changes.length > 0

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold text-[var(--text-100)]">
          Corrected output
        </label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          rows={14}
          className="w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-3 font-mono text-xs leading-relaxed text-[var(--text-100)] focus:border-[var(--accent-200)] focus:outline-none"
        />
        {parsed.error && (
          <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{parsed.error}</p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-[var(--text-100)]">
          What was wrong?
          <span className="ml-1.5 font-normal text-[var(--text-200)]">
            Written as an instruction, this becomes a rule Tidy Agent follows on this
            vendor&apos;s future documents.
          </span>
        </label>
        <input
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="e.g. Qty comes from the Units column, not the case pack"
          className="w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-[var(--text-100)] focus:border-[var(--accent-200)] focus:outline-none"
        />
      </div>

      {parsed.value && (
        <div className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
            {changes.length === 0 ? 'Changes' : `${changes.length} change(s)`}
          </div>
          <CorrectionDiff original={original} corrected={parsed.value} />
        </div>
      )}

      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {result && <p className="text-xs text-emerald-700 dark:text-emerald-400">{result}</p>}

      <button
        type="button"
        onClick={() => void save()}
        disabled={!canSave}
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving && <Spinner />}
        Save correction
      </button>
    </div>
  )
}

/* ─────────────────────────────────────── Main CorrectionEditor ── */

/**
 * Records a correction against one parse job.
 *
 * Two modes are available when the agent produced table output:
 * - **JSON** — raw textarea over the agent's jsonOutput (existing behaviour).
 * - **Table** — editable grid over the agent's tableOutput; cells, row additions,
 *   and row deletions are all tracked and submitted as `correctedTables`.
 *
 * The note field persists across mode switches so typing once is enough.
 */
export default function CorrectionEditor({
  jobId,
  original,
  tableOutput,
  onSaved,
}: {
  jobId: string
  original: Record<string, unknown> | null | undefined
  tableOutput?: TableOutput | null
  onSaved: () => void
}) {
  const tables = tableOutput?.tables ?? []
  const hasTables = tables.length > 0

  type Mode = 'json' | 'tabular'
  const [mode, setMode] = useState<Mode>('json')
  // Note is shared so switching mode doesn't discard what the user typed.
  const [note, setNote] = useState('')

  // Reset shared note when the job changes.
  useEffect(() => {
    setNote('')
  }, [jobId])

  return (
    <div className="space-y-3">
      {/* Mode toggle — only shown when the agent produced table output */}
      {hasTables && (
        <div className="flex gap-1">
          {(['json', 'tabular'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-[var(--primary-100)] text-[var(--accent-200)]'
                  : 'text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]'
              }`}
            >
              {m === 'json' ? 'JSON' : 'Table'}
            </button>
          ))}
        </div>
      )}

      {mode === 'json' && (
        <JsonCorrectionEditor
          jobId={jobId}
          original={original}
          note={note}
          onNoteChange={setNote}
          onSaved={onSaved}
        />
      )}

      {mode === 'tabular' && (
        <TabularCorrectionEditor
          jobId={jobId}
          originalTables={tables}
          note={note}
          onNoteChange={setNote}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

/* ──────────────────────── Read-only table view (for history) ── */

function TabularCorrectionView({ tables }: { tables: AgentTable[] }) {
  if (tables.length === 0) {
    return <p className="text-xs italic text-[var(--text-200)]">No table data recorded.</p>
  }

  return (
    <div className="space-y-2">
      {tables.map((table, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-[var(--bg-300)]">
          {table.title && (
            <div className="border-b border-[var(--bg-300)] bg-[var(--bg-200)] px-3 py-1">
              <span className="text-xs font-semibold text-[var(--text-100)]">{table.title}</span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {table.columns.map((col, c) => (
                    <th
                      key={c}
                      className="border-b border-r border-[var(--bg-300)] bg-[var(--bg-200)] px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)] last:border-r-0"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r} className="odd:bg-[var(--bg-100)] even:bg-[var(--bg-200)]">
                    {table.columns.map((_, c) => (
                      <td
                        key={c}
                        className="border-r border-[var(--bg-300)] px-2 py-1 text-xs text-[var(--text-100)] last:border-r-0"
                      >
                        {row[c] === null || row[c] === undefined ? '' : String(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─────────────────────────────────── Correction history list ── */

/** The corrections already recorded for a job, newest first. */
export function CorrectionHistory({ corrections }: { corrections: DocTidyCorrection[] }) {
  if (corrections.length === 0) {
    return (
      <p className="text-xs italic text-[var(--text-200)]">
        Nothing corrected yet for this document.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {corrections.map((correction) => {
        const isTabular =
          correction.mode === 'tabular' &&
          Array.isArray(correction.correctedTables) &&
          (correction.correctedTables as AgentTable[]).length > 0

        return (
          <li
            key={correction._id}
            className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-3"
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-200)]">
              <span>{new Date(correction.createdAt).toLocaleString()}</span>
              {correction.createdByName && <span>· {correction.createdByName}</span>}
              {correction.vendorName && <span>· {correction.vendorName}</span>}
              {isTabular && (
                <span className="rounded-full bg-[var(--bg-300)] px-1.5 py-0.5 text-[10px] font-medium">
                  Table
                </span>
              )}
            </div>
            {correction.note && (
              <p className="mb-1.5 text-sm text-[var(--text-100)]">{correction.note}</p>
            )}
            {isTabular ? (
              <TabularCorrectionView
                tables={correction.correctedTables as AgentTable[]}
              />
            ) : (
              <CorrectionDiff
                original={correction.originalOutput}
                corrected={correction.correctedOutput}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
