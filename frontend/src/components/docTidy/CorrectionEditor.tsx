import { useEffect, useMemo, useRef, useState } from 'react'
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
                  className="border-b border-r border-[var(--bg-300)] bg-[var(--bg-200)] px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)] last:border-r-0"
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
                      className="border-r border-[var(--bg-300)] px-2 py-1 last:border-r-0 min-w-[120px]"
                    >
                      <input
                        value={row[c]}
                        onChange={(e) => updateCell(r, c, e.target.value)}
                        className="w-full bg-transparent text-sm text-[var(--text-100)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-200)] rounded px-1"
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
    // The server rebuilds the agent-shaped correctedOutput from correctedTables.
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
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? <Spinner className="h-4 w-4" /> : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
        {saving ? 'Saving…' : 'Save correction'}
      </button>
    </div>
  )
}

/* ──────────────── JSON syntax tokeniser (VSCode Dark+ palette) ── */

type JsonTokenType = 'key' | 'string' | 'number' | 'keyword' | 'punctuation' | 'plain'

function tokenizeJson(json: string): Array<{ type: JsonTokenType; value: string }> {
  const out: Array<{ type: JsonTokenType; value: string }> = []
  let i = 0
  while (i < json.length) {
    if (/\s/.test(json[i])) {
      let j = i + 1
      while (j < json.length && /\s/.test(json[j])) j++
      out.push({ type: 'plain', value: json.slice(i, j) })
      i = j; continue
    }
    if (json[i] === '"') {
      let j = i + 1
      while (j < json.length) {
        if (json[j] === '\\') { j += 2; continue }
        if (json[j] === '"') { j++; break }
        j++
      }
      const str = json.slice(i, j)
      const isKey = /^\s*:/.test(json.slice(j))
      out.push({ type: isKey ? 'key' : 'string', value: str })
      i = j; continue
    }
    const numM = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(json.slice(i))
    if (numM) { out.push({ type: 'number', value: numM[0] }); i += numM[0].length; continue }
    const kwM = /^(true|false|null)/.exec(json.slice(i))
    if (kwM) { out.push({ type: 'keyword', value: kwM[0] }); i += kwM[0].length; continue }
    out.push({ type: 'punctuation', value: json[i] }); i++
  }
  return out
}

const TOKEN_COLOR: Record<JsonTokenType, string> = {
  key:         '#9cdcfe',
  string:      '#ce9178',
  number:      '#b5cea8',
  keyword:     '#569cd6',
  punctuation: '#d4d4d4',
  plain:       '#d4d4d4',
}

/**
 * Syntax-highlighted + editable JSON editor using the overlay technique:
 * a transparent <textarea> sits on top of a <pre> that renders the same
 * value with VSCode Dark+ colouring. Scroll positions are kept in sync.
 */
function JsonEditor({
  value,
  onChange,
  rows = 16,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef      = useRef<HTMLPreElement>(null)
  const tokens      = useMemo(() => tokenizeJson(value), [value])

  /** Keep the highlight layer scrolled to the same position as the textarea. */
  const syncScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop  = textareaRef.current.scrollTop
      preRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }

  // Shared layout values — both layers must be pixel-identical.
  const sharedStyle: React.CSSProperties = {
    fontFamily:  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize:    '11px',
    lineHeight:  '20px',
    padding:     '14px',
    margin:      0,
    whiteSpace:  'pre',
    wordWrap:    'normal' as const,
    overflowWrap: 'normal' as const,
    tabSize:     2,
  }

  return (
    <div
      className="relative rounded-lg border border-[var(--bg-300)] focus-within:border-[var(--accent-200)] focus-within:ring-1 focus-within:ring-[var(--accent-200)] transition-colors"
      style={{ background: '#1e1e1e' }}
    >
      {/* ── Highlight layer — pointer-events disabled, no scrollbar ── */}
      <pre
        ref={preRef}
        aria-hidden
        style={{
          ...sharedStyle,
          position:      'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          overflow:      'hidden',
          pointerEvents: 'none',
          userSelect:    'none',
          color:         '#d4d4d4',
          background:    'transparent',
          border:        'none',
          borderRadius:  0,
          zIndex:        0,
        }}
      >
        {tokens.map((tok, idx) => (
          <span key={idx} style={{ color: TOKEN_COLOR[tok.type] }}>{tok.value}</span>
        ))}
      </pre>

      {/* ── Edit layer — transparent text so highlight shows through ── */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        rows={rows}
        style={{
          ...sharedStyle,
          position:   'relative',
          zIndex:     1,
          display:    'block',
          width:      '100%',
          resize:     'none',
          background: 'transparent',
          color:      'transparent',
          caretColor: '#aeafad',
          outline:    'none',
          border:     'none',
          overflow:   'auto',
        }}
      />
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
      {/* ── Single editable JSON editor ── */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold text-[var(--text-100)]">
            Extracted JSON
            <span className="ml-1.5 font-normal text-[var(--text-200)]">
              — edit directly, then save your correction.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(draft)}
            title="Copy JSON to clipboard"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--bg-300)] px-2 py-1 text-[11px] text-[var(--text-200)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
            </svg>
            Copy
          </button>
        </div>
        <JsonEditor value={draft} onChange={setDraft} rows={16} />
        {parsed.error && (
          <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{parsed.error}</p>
        )}
      </div>

      {/* ── Note ── */}
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

      {/* ── Diff ── */}
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
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? <Spinner className="h-4 w-4" /> : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
        {saving ? 'Saving…' : 'Save correction'}
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
  // Default to the Table sub-tab when the agent produced table output.
  const [mode, setMode] = useState<Mode>(() => hasTables ? 'tabular' : 'json')
  // Note is shared so switching mode doesn't discard what the user typed.
  const [note, setNote] = useState('')

  // Reset mode and note when the job changes (e.g. re-run or different file).
  useEffect(() => {
    setNote('')
    setMode(hasTables ? 'tabular' : 'json')
  }, [jobId, hasTables])

  return (
    <div className="space-y-3">
      {/* Mode toggle — only shown when the agent produced table output */}
      {hasTables && (
        <div className="inline-flex rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-0.5">
          {/* Table first, JSON second */}
          {([
            {
              id: 'tabular' as const,
              label: 'Table',
              icon: (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75.125c0-.621.504-1.125 1.125-1.125m0 0h1.5m-1.5 0H3.375m0 0c0-.622.504-1.125 1.125-1.125H18.75M3.375 18.375V7.5m0 10.875H18.75M6 7.5h12M6 7.5V4.875m0 2.625v2.25M6 7.5H3.375M6 10.125H3.375m2.625 0h.008v.008H6v-.008zm0 0H18.75m-12.75 0v2.25m0-2.25H3.375" />
                </svg>
              ),
            },
            {
              id: 'json' as const,
              label: 'JSON',
              icon: (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                </svg>
              ),
            },
          ] as const).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === m.id
                  ? 'bg-[var(--bg-100)] text-[var(--accent-200)] shadow-sm'
                  : 'text-[var(--text-200)] hover:text-[var(--text-100)]'
              }`}
            >
              {m.icon}
              {m.label}
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
