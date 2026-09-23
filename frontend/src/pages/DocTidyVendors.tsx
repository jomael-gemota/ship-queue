import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authApi } from '../lib/api'
import {
  Banner,
  IconButton,
  PaginationArrows,
  Spinner,
  avatarColour,
} from '../components/docTidy/docTidyUi'
import { diffOutputs } from '../lib/correctionDiff'
import {
  normalizeVendorName,
  vendorSamples,
  type AgentTable,
  type DocTidyCorrection,
  type DocTidyVendor,
} from '../types/docTidy'

/* ─────────────────────────────────────────────────────────── VendorEditor ── */

/**
 * Create / edit modal for a vendor. Handles both modes:
 * - `vendor === null` → creating a new vendor (name editable, no corrections row)
 * - `vendor !== null` → editing an existing vendor (name read-only, corrections read-only)
 *
 * SKU samples are batched locally and applied on Save so that Cancel is honest:
 * nothing is sent to the server until the user confirms.
 */
function VendorEditor({
  vendor,
  workspaceId,
  onClose,
  onSaved,
}: {
  vendor: DocTidyVendor | null
  workspaceId: string
  onClose: () => void
  onSaved: (notice: string) => void
}) {
  const isNew = vendor === null

  const [name, setName] = useState(vendor?.name ?? '')
  const [draft, setDraft] = useState('')
  const [pendingAdds, setPendingAdds] = useState<string[]>([])
  const [pendingRemoves, setPendingRemoves] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(onClose)
  useEffect(() => {
    cancelRef.current = onClose
  }, [onClose])

  // Focus the first field and block page scroll behind the overlay.
  useEffect(() => {
    nameRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelRef.current()
    }
    document.addEventListener('keydown', onKeyDown)

    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prev
    }
  }, [])

  // The chips shown for an existing vendor minus the ones the user has removed.
  const existingSamples = vendor ? vendorSamples(vendor).filter((s) => !pendingRemoves.includes(s)) : []

  const hasChanges = isNew ? name.trim().length > 0 : pendingAdds.length > 0 || pendingRemoves.length > 0

  /** Commit the draft input as one or more new samples. */
  const commitDraft = () => {
    const parts = draft
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (!parts.length) return

    const taken = new Set([
      ...pendingAdds.map((v) => v.toLowerCase()),
      ...existingSamples.map((v) => v.toLowerCase()),
    ])
    const fresh = parts.filter((p) => !taken.has(p.toLowerCase()))
    setPendingAdds((prev) => [...prev, ...fresh])
    setDraft('')
  }

  const save = async () => {
    if (!name.trim()) {
      setError('Vendor name is required.')
      nameRef.current?.focus()
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (isNew) {
        // Create: upsert once per sample (the first call also creates the vendor).
        if (pendingAdds.length === 0) {
          await authApi.post('/doc-tidy/vendors', { name: name.trim(), workspaceId })
        } else {
          for (const sample of pendingAdds) {
            await authApi.post('/doc-tidy/vendors', { name: name.trim(), skuSample: sample, workspaceId })
          }
        }
        onSaved('Vendor saved.')
      } else {
        // Edit: apply removes then adds.
        for (const sample of pendingRemoves) {
          await authApi.post(
            `/doc-tidy/vendors/${encodeURIComponent(vendor!.name)}/samples/remove`,
            { skuSample: sample, workspaceId }
          )
        }
        for (const sample of pendingAdds) {
          await authApi.post('/doc-tidy/vendors', { name: vendor!.name, skuSample: sample, workspaceId })
        }
        onSaved('Vendor updated.')
      }
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
      return
    }

    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-[var(--bg-300)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-100)]">
              {isNew ? 'New vendor' : 'Edit vendor'}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-200)]">
              {isNew
                ? 'Register a supplier so Tidy Agent scopes its corrections correctly.'
                : 'Add or remove SKU format samples. Corrections are managed by the parsing process.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Vendor name */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-100)]">
              Vendor name {isNew && <span className="text-rose-500">*</span>}
            </label>

            {isNew ? (
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save()
                }}
                placeholder="e.g. Acme Supplies"
                className="w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-[var(--text-100)] placeholder:text-[var(--text-200)]/60 focus:border-[var(--accent-200)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]/20 transition-shadow dark:bg-[var(--bg-200)]"
              />
            ) : (
              /* Read-only display for edit mode */
              <div className="flex items-center gap-2.5 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] px-3 py-2">
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold text-white ${avatarColour(vendor!.name)}`}
                >
                  {vendor!.name.charAt(0).toUpperCase()}
                </div>
                <span className="flex-1 text-sm text-[var(--text-100)]">{vendor!.name}</span>
                <span className="text-[11px] text-[var(--text-200)]">Name cannot be changed</span>
              </div>
            )}

            {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          </div>

          {/* SKU samples */}
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium text-[var(--text-100)]">SKU format samples</p>
              <p className="text-xs text-[var(--text-200)]">
                Real SKU codes anchor Tidy Agent to this vendor's format from the very first document.
              </p>
            </div>

            {/* Existing samples (edit mode) */}
            {existingSamples.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {existingSamples.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--bg-300)] bg-[var(--bg-200)] px-2 py-1 font-mono text-[11px] text-[var(--text-100)]"
                  >
                    {s}
                    <button
                      type="button"
                      onClick={() => setPendingRemoves((prev) => [...prev, s])}
                      aria-label={`Remove ${s}`}
                      className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full opacity-50 transition-all hover:bg-rose-100 hover:opacity-100 hover:text-rose-600 dark:hover:bg-rose-900/30"
                    >
                      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Pending new samples */}
            {pendingAdds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pendingAdds.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--accent-200)]/30 bg-[var(--primary-100)] px-2 py-1 font-mono text-[11px] text-[var(--accent-200)]"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">
                      new
                    </span>
                    {s}
                    <button
                      type="button"
                      onClick={() => setPendingAdds((prev) => prev.filter((a) => a !== s))}
                      aria-label={`Remove ${s}`}
                      className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full opacity-50 transition-opacity hover:opacity-100"
                    >
                      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Draft input */}
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  commitDraft()
                }
                if (e.key === 'Backspace' && !draft && pendingAdds.length) {
                  setPendingAdds((prev) => prev.slice(0, -1))
                }
              }}
              onBlur={commitDraft}
              placeholder="Type a SKU and press Enter to add…"
              className="w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 font-mono text-sm text-[var(--text-100)] placeholder:font-sans placeholder:text-[var(--text-200)]/60 focus:border-[var(--accent-200)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]/20 transition-shadow dark:bg-[var(--bg-200)]"
            />
          </div>

          {/* Agent corrections — read-only, edit mode only */}
          {!isNew && (
            <div className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-[var(--text-100)]">Tidy Agent corrections</p>
                  <p className="text-xs text-[var(--text-200)]">
                    Learned automatically during the PDF parsing process.
                  </p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    vendor!.correctionCount > 0
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20'
                      : 'bg-[var(--bg-200)] text-[var(--text-200)] ring-1 ring-[var(--bg-300)]'
                  }`}
                >
                  <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                  {vendor!.correctionCount === 0
                    ? 'None yet'
                    : `${vendor!.correctionCount} correction${vendor!.correctionCount === 1 ? '' : 's'}`}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-200)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-[var(--bg-300)] px-4 py-2 text-sm font-medium text-[var(--text-200)] hover:bg-[var(--bg-300)]/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || (!isNew && !hasChanges)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Spinner />}
            {isNew ? 'Save vendor' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────── CorrectionList ── */

/** How many changed fields a correction shows before collapsing the remainder. */
const CHANGE_PREVIEW_LIMIT = 5

/* ── Shared change-entry type ── */

/**
 * One entry in a correction diff.
 * - `kind === 'value'`  (default): a field's value changed.
 * - `kind === 'rename'`: a field was renamed; `renamedTo` holds the new name
 *   and `sharedValue` holds the value that moved unchanged into the new key.
 */
type DiffChange =
  | { kind?: 'value'; field: string; before: string; after: string }
  | { kind: 'rename'; field: string; renamedTo: string; sharedValue: string; before: string; after: string }

/**
 * Post-processes a raw `diffOutputs` result to merge rename pairs.
 *
 * A rename is detected when a path appears as deleted (before=value, after='')
 * AND a *different* path appears as added (before='', after=same_value).
 * Those two entries are replaced with a single `{ kind:'rename' }` entry placed
 * where the deleted entry was, and the added entry is suppressed.
 */
function mergeRenames(raw: Array<{ field: string; before: string; after: string }>): DiffChange[] {
  // Build a map from value → the field name that added it.
  const addedByValue = new Map<string, string>()
  for (const c of raw) {
    if (c.before === '' && c.after !== '') {
      addedByValue.set(c.after, c.field)
    }
  }

  const suppressedFields = new Set<string>()
  const result: DiffChange[] = []

  for (const c of raw) {
    if (suppressedFields.has(c.field)) continue

    if (c.before !== '' && c.after === '') {
      // Potential "deleted" half of a rename — check whether the value was re-added elsewhere.
      const newFieldName = addedByValue.get(c.before)
      if (newFieldName && newFieldName !== c.field) {
        suppressedFields.add(newFieldName) // suppress the matching "added" entry
        result.push({
          kind: 'rename',
          field: c.field,
          renamedTo: newFieldName,
          sharedValue: c.before,
          before: '',
          after: '',
        })
        continue
      }
    }

    result.push({ ...c })
  }

  return result
}

/** Normalise a string for fuzzy column↔field matching. */
const _TNORM = (s: string) => String(s).toLowerCase().replace(/[_\-\s]+/g, '')

/**
 * Find the value of a JSON field whose normalised key matches `colName`.
 * Returns `null` when no matching key exists (not the same as empty string).
 */
function lookupColValue(item: Record<string, unknown>, colName: string): string | null {
  const target = _TNORM(colName)
  for (const [k, v] of Object.entries(item)) {
    if (_TNORM(k) !== target) continue
    if (v === null || v === undefined) return ''
    if (!Array.isArray(v) && typeof v !== 'object') return String(v)
  }
  return null   // no matching key found
}

/**
 * Produce a flat before→after diff for a tabular correction by comparing
 * `correctedTables` row-by-row against the original line items (or top-level
 * fields) from `originalOutput`.
 *
 * Rules:
 * - If a column name can't be matched to any field in the original JSON,
 *   skip it (we have no "before" to compare against).
 * - Document-level columns (those found on `originalOutput` directly, not in
 *   any line-item row) are deduplicated so they appear once, not per-row.
 * - Only changed cells are returned.
 */
function diffTabularCorrection(
  originalOutput: Record<string, unknown> | null | undefined,
  correctedTables: AgentTable[]
): Array<{ field: string; before: string; after: string }> {
  if (!originalOutput || !correctedTables.length) return []

  // Try to find the line-items array in the original JSON.
  const ARRAY_KEYS = ['line_items', 'items', 'products', 'lineItems', 'order_items', 'orderItems']
  let lineItems: Record<string, unknown>[] = []
  for (const key of ARRAY_KEYS) {
    const val = originalOutput[key]
    if (Array.isArray(val) && val.length > 0) {
      lineItems = val as Record<string, unknown>[]
      break
    }
  }

  const changes: Array<{ field: string; before: string; after: string }> = []
  const multiRow = correctedTables.some((t) => t.rows.length > 1)

  for (const table of correctedTables) {
    const tablePrefix = correctedTables.length > 1 && table.title ? `${table.title} · ` : ''
    const docLevelSeen = new Set<number>() // column indices already emitted as document-level

    for (let ci = 0; ci < table.columns.length; ci++) {
      const colName = table.columns[ci]

      // Determine whether this is a document-level or line-item-level field.
      const isDocLevel =
        lookupColValue(originalOutput, colName) !== null &&
        (lineItems.length === 0 || lineItems.every((r) => lookupColValue(r, colName) === null))

      if (isDocLevel) {
        // Document-level — compare once against originalOutput.
        const oldVal = lookupColValue(originalOutput, colName)!
        // Use the first row's corrected value (should be the same across all rows).
        const newVal = String(table.rows[0]?.[ci] ?? '').trim()
        if (oldVal !== newVal && !docLevelSeen.has(ci)) {
          docLevelSeen.add(ci)
          changes.push({ field: `${tablePrefix}${colName}`, before: oldVal, after: newVal })
        }
        continue
      }

      // Line-item level — compare each row.
      for (let ri = 0; ri < table.rows.length; ri++) {
        const origRow = lineItems[ri] ?? {}
        const newVal = String(table.rows[ri]?.[ci] ?? '').trim()
        const oldVal = lookupColValue(origRow, colName)
        if (oldVal === null) continue   // column not found in original row — skip
        if (oldVal === newVal) continue // no change
        const rowSuffix = multiRow ? ` (row ${ri + 1})` : ''
        changes.push({ field: `${tablePrefix}${colName}${rowSuffix}`, before: oldVal, after: newVal })
      }
    }
  }

  return changes
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * One learned correction: what the user changed, and the instruction they left.
 *
 * The note matters more than the diff — the worker promotes it into the system
 * prompt as a hard rule — so it is given the emphasis, not buried under paths.
 */
function CorrectionItem({
  correction,
  onDelete,
}: {
  correction: DocTidyCorrection
  onDelete: () => void
}) {
  const [showAll, setShowAll] = useState(false)

  // Tabular corrections store the full corrected table in correctedTables.
  // Their correctedOutput is { tables: [...] } which has a completely different
  // schema from originalOutput (the agent's JSON), so running diffOutputs on them
  // produces nothing useful — ALL paths appear changed (schema mismatch).
  // Detect tabular and take a different display path.
  const isTabular =
    correction.mode === 'tabular' &&
    Array.isArray(correction.correctedTables) &&
    correction.correctedTables.length > 0

  // For JSON corrections: a valid baseline must be a non-empty object (not {} or null).
  const hasBaseline =
    !isTabular &&
    Boolean(
      correction.originalOutput &&
        typeof correction.originalOutput === 'object' &&
        Object.keys(correction.originalOutput).length > 0
    )

  const changes = useMemo<DiffChange[]>(
    () => {
      if (isTabular) {
        return diffTabularCorrection(
          correction.originalOutput,
          correction.correctedTables as AgentTable[]
        )
      }
      if (!hasBaseline) return []
      const raw = diffOutputs(correction.originalOutput, correction.correctedOutput)
        .map(({ path, before, after }) => ({ field: path, before, after }))
      return mergeRenames(raw)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isTabular, hasBaseline, correction.originalOutput, correction.correctedOutput, correction.correctedTables]
  )

  const shown = showAll ? changes : changes.slice(0, CHANGE_PREVIEW_LIMIT)
  const hidden = changes.length - shown.length

  return (
    <li className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3.5 py-3">
      {/* Provenance */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-[var(--text-100)]">
            {correction.filename}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-200)]">
            {formatWhen(correction.createdAt)}
            {correction.createdByName && ` · by ${correction.createdByName}`}
            {correction.mode && ` · from the ${correction.mode === 'json' ? 'JSON' : 'table'} view`}
          </p>
        </div>
        <IconButton label="Delete correction" tone="danger" onClick={onDelete} iconPath={ICON_DELETE} />
      </div>

      {/* The user's instruction — applied as a hard rule on every later parse */}
      {correction.note && (
        <p className="mt-2 rounded-md border-l-2 border-[var(--accent-200)] bg-[var(--primary-100)]/60 px-2.5 py-1.5 text-xs text-[var(--text-100)]">
          {correction.note}
        </p>
      )}

      {/* Field-level changes — same flat before→after format for both JSON and tabular corrections */}
      {changes.length > 0 ? (
        <>
          <ul className="mt-2 space-y-1">
            {shown.map((change, i) => (
              <li key={`${change.field}-${i}`} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 text-[11px]">
                {change.kind === 'rename' ? (
                  <>
                    <span className="font-mono text-rose-600 line-through decoration-rose-400/60 dark:text-rose-400">{change.field}</span>
                    <span className="text-[var(--text-200)]">→</span>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400">{change.renamedTo}</span>
                    <span className="text-[var(--text-200)] italic">(field renamed · value: {change.sharedValue})</span>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-[var(--text-100)]">{change.field}</span>
                    <span className="text-[var(--text-200)]">·</span>
                    <span className="font-mono text-rose-600 line-through decoration-rose-400/60 dark:text-rose-400">
                      {change.before || '—'}
                    </span>
                    <span className="text-[var(--text-200)]">→</span>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400">
                      {change.after || '—'}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>

          {(hidden > 0 || showAll) && (
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              className="mt-1.5 cursor-pointer text-[11px] font-medium text-[var(--accent-200)] hover:underline"
            >
              {showAll ? 'Show fewer' : `+${hidden} more change${hidden === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      ) : (
        <p className="mt-2 text-[11px] italic text-[var(--text-200)]">
          {isTabular
            ? 'No cell differences detected between the original and corrected values.'
            : hasBaseline
              ? 'No field differences — saved for the instruction above.'
              : "The agent's original output was not recorded, so there is nothing to compare."}
        </p>
      )}
    </li>
  )
}

/* ──────────────────────────────────────────────────────────── Page ── */

const ICON_DELETE =
  'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'

const ICON_EDIT =
  'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'

const filterClass =
  'text-[11px] border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

type CorrectionFilter = '' | 'has' | 'none'

export default function WorkspaceVendorsView({ workspaceId }: { workspaceId: string }) {
  const [vendors, setVendors] = useState<DocTidyVendor[]>([])
  const [corrections, setCorrections] = useState<DocTidyCorrection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** `null` = new vendor  |  `DocTidyVendor` = editing existing  |  `undefined` = modal closed */
  const [editing, setEditing] = useState<DocTidyVendor | null | undefined>(undefined)
  const [pendingDelete, setPendingDelete] = useState<DocTidyVendor | null>(null)
  const [pendingCorrectionDelete, setPendingCorrectionDelete] = useState<DocTidyCorrection | null>(
    null
  )

  /** Vendor ids whose learned corrections are expanded. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showUnassigned, setShowUnassigned] = useState(false)

  const [search, setSearch] = useState('')
  const [correctionFilter, setCorrectionFilter] = useState<CorrectionFilter>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [vendorRes, correctionRes] = await Promise.all([
        authApi.get<{ data: DocTidyVendor[] }>(`/doc-tidy/vendors?workspaceId=${workspaceId}`),
        authApi.get<{ data: DocTidyCorrection[] }>(`/doc-tidy/corrections?workspaceId=${workspaceId}`),
      ])
      setVendors(vendorRes.data)
      setCorrections(correctionRes.data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  // Reset page whenever filters change.
  useEffect(() => {
    setPage(1)
  }, [search, correctionFilter])

  const openNew = () => setEditing(null)
  const openEdit = (vendor: DocTidyVendor) => setEditing(vendor)
  const closeEditor = () => setEditing(undefined)

  const handleSaved = async (msg: string) => {
    setNotice(msg)
    closeEditor()
    await load()
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      const res = await authApi.delete<{ data: { correctionsDeleted: number } }>(
        `/doc-tidy/vendors/${encodeURIComponent(pendingDelete.name)}?workspaceId=${workspaceId}`
      )
      setNotice(
        res.data.correctionsDeleted > 0
          ? `Deleted ${pendingDelete.name} and ${res.data.correctionsDeleted} correction(s) it had taught Tidy Agent.`
          : `Deleted ${pendingDelete.name}.`
      )
      setPendingDelete(null)
      await load()
    } catch (err) {
      setError((err as Error).message)
      setPendingDelete(null)
    }
  }

  const confirmCorrectionDelete = async () => {
    if (!pendingCorrectionDelete) return
    try {
      await authApi.delete(`/doc-tidy/corrections/${pendingCorrectionDelete._id}`)
      setNotice('Correction deleted — Tidy Agent stops using it on the next parse.')
      setPendingCorrectionDelete(null)
      await load()
    } catch (err) {
      setError((err as Error).message)
      setPendingCorrectionDelete(null)
    }
  }

  const toggleExpanded = (vendorId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(vendorId)) next.delete(vendorId)
      else next.add(vendorId)
      return next
    })
  }

  /**
   * Corrections keyed by the vendor they taught, plus the ones that reached no
   * vendor at all.
   *
   * An unmatched `vendorName` is not cosmetic: with `CORRECTION_VENDOR_STRICT`
   * on the worker, such a correction is never retrieved for any vendor, so it
   * teaches the agent nothing. Collecting them makes that visible.
   */
  const { byVendor, unassigned } = useMemo(() => {
    const registered = new Set(vendors.map((v) => v.normalizedName))
    const grouped = new Map<string, DocTidyCorrection[]>()
    const orphans: DocTidyCorrection[] = []

    for (const correction of corrections) {
      const key = correction.vendorName ? normalizeVendorName(correction.vendorName) : ''
      if (key && registered.has(key)) {
        const list = grouped.get(key)
        if (list) list.push(correction)
        else grouped.set(key, [correction])
      } else {
        orphans.push(correction)
      }
    }

    return { byVendor: grouped, unassigned: orphans }
  }, [vendors, corrections])

  /** All vendors passing the active filters — not yet paginated. */
  const filteredVendors = useMemo(() => {
    const term = search.trim().toLowerCase()
    return vendors.filter((v) => {
      if (correctionFilter === 'has' && v.correctionCount === 0) return false
      if (correctionFilter === 'none' && v.correctionCount > 0) return false
      if (!term) return true
      return v.name.toLowerCase().includes(term)
    })
  }, [vendors, search, correctionFilter])

  const totalPages = Math.max(1, Math.ceil(filteredVendors.length / pageSize))

  const pagedVendors = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredVendors.slice(start, start + pageSize)
  }, [filteredVendors, page, pageSize])

  const totalCorrections = vendors.reduce((sum, v) => sum + v.correctionCount, 0)
  const hasActiveFilters = Boolean(search || correctionFilter)

  const clearFilters = () => {
    setSearch('')
    setCorrectionFilter('')
    setPage(1)
  }

  /* ─────────────────────────────────────────────────────────── render ── */
  return (
    <div className="space-y-5">
      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {notice && (
        <Banner kind="success" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      {/* ── Vendor list ───────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-sm">

        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--bg-300)] px-4 py-2">
          {/* Search */}
          <div className="relative min-w-[180px] flex-1 max-w-xs">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-gray-400">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z"
                />
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendors…"
              className={`${filterClass} w-full pl-8`}
            />
          </div>

          {/* Corrections filter */}
          <select
            value={correctionFilter}
            onChange={(e) => setCorrectionFilter(e.target.value as CorrectionFilter)}
            className={`${filterClass} cursor-pointer`}
            aria-label="Filter by corrections"
          >
            <option value="">All corrections</option>
            <option value="has">Has corrections</option>
            <option value="none">No corrections</option>
          </select>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer"
            >
              Clear
            </button>
          )}

          {/* Summary stats + New vendor */}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[11px] text-gray-500 dark:text-[var(--text-200)]">
              {hasActiveFilters
                ? `${filteredVendors.length} of ${vendors.length} vendors`
                : `${vendors.length} vendor${vendors.length !== 1 ? 's' : ''}`}
            </span>
            {!loading && vendors.length > 0 && (
              <span
                className={`text-[11px] font-medium ${
                  totalCorrections > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-[var(--text-200)]'
                }`}
              >
                {totalCorrections} correction{totalCorrections !== 1 ? 's' : ''} learned
              </span>
            )}
            <button onClick={openNew}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 cursor-pointer">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New vendor
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--text-200)]">
            <span className="inline-flex items-center gap-2">
              <Spinner /> Loading vendors…
            </span>
          </div>
        ) : vendors.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--bg-200)] text-[var(--text-200)]">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <p className="mt-3 text-sm font-medium text-[var(--text-100)]">No vendors yet</p>
            <p className="mt-1 text-sm text-[var(--text-200)]">
              The first vendor is registered automatically when you set one up from a parsed
              document, or you can add one with the button above.
            </p>
            <button
              onClick={openNew}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-3.5 py-2 text-sm font-medium text-white cursor-pointer"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New vendor
            </button>
          </div>
        ) : filteredVendors.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-[var(--text-200)]">No vendors match these filters.</p>
            <button
              onClick={clearFilters}
              className="mt-2 text-sm text-[var(--accent-200)] hover:underline cursor-pointer"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-[var(--bg-300)]">
              {pagedVendors.map((vendor) => {
                const samples = vendorSamples(vendor)
                const initial = vendor.name.charAt(0).toUpperCase()
                const learned = byVendor.get(vendor.normalizedName) ?? []
                const isOpen = expanded.has(vendor._id)

                return (
                  <li
                    key={vendor._id}
                    className={`border-l-2 ${
                      vendor.correctionCount > 0
                        ? 'border-l-[var(--accent-200)]'
                        : 'border-l-[var(--bg-300)]'
                    }`}
                  >
                    <div
                      onClick={() => toggleExpanded(vendor._id)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleExpanded(vendor._id)
                        }
                      }}
                      className="group flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--bg-200)]/50"
                    >
                      {/* Avatar */}
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white ${avatarColour(vendor.name)}`}
                      >
                        {initial}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {/* Name + attribution */}
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold text-[var(--text-100)]">
                            {vendor.name}
                          </span>
                          {vendor.createdByName && (
                            <span className="text-[11px] text-[var(--text-200)]">
                              Added by {vendor.createdByName}
                            </span>
                          )}
                        </div>

                        {/* Corrections pill + SKU samples inline */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                              vendor.correctionCount > 0
                                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20'
                                : 'bg-[var(--bg-200)] text-[var(--text-200)] ring-1 ring-[var(--bg-300)]'
                            }`}
                          >
                            <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                              />
                            </svg>
                            {vendor.correctionCount === 0
                              ? 'No corrections yet'
                              : `${vendor.correctionCount} correction${vendor.correctionCount === 1 ? '' : 's'} taught to Tidy Agent`}
                          </span>

                          {/* SKU samples — compact, read-only chips */}
                          {samples.length > 0 && (
                            <>
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
                                SKUs
                              </span>
                              {samples.map((s) => (
                                <span
                                  key={s}
                                  className="inline-flex items-center rounded-md border border-[var(--bg-300)] bg-[var(--bg-200)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-100)]"
                                >
                                  {s}
                                </span>
                              ))}
                            </>
                          )}

                          {samples.length === 0 && (
                            <span className="text-[11px] italic text-[var(--text-200)]">
                              No sample SKU
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right side: disclosure chevron + edit + delete */}
                      <div className="flex shrink-0 items-center gap-2">
                        <svg
                          className={`h-4 w-4 shrink-0 text-[var(--text-200)] transition-transform ${
                            isOpen ? 'rotate-90 opacity-70' : 'opacity-40 group-hover:opacity-70'
                          }`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>

                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <IconButton
                            label="Edit vendor"
                            onClick={() => openEdit(vendor)}
                            iconPath={ICON_EDIT}
                          />
                          <IconButton
                            label="Delete vendor"
                            tone="danger"
                            onClick={() => setPendingDelete(vendor)}
                            iconPath={ICON_DELETE}
                          />
                        </div>
                      </div>
                    </div>

                    {/* ── Learned corrections ── */}
                    {isOpen && (
                      <div className="border-t border-[var(--bg-300)] bg-[var(--bg-200)]/40 px-5 py-4">
                        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
                          What {vendor.name} has taught Tidy Agent
                        </p>

                        {learned.length === 0 ? (
                          <p className="text-xs text-[var(--text-200)]">
                            Nothing yet. Correct a parsed document for this vendor and the fix
                            appears here, and steers every later parse of their paperwork.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {learned.map((correction) => (
                              <CorrectionItem
                                key={correction._id}
                                correction={correction}
                                onDelete={() => setPendingCorrectionDelete(correction)}
                              />
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>

            {/* ── Pagination footer ── */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--bg-300)] px-4 py-2.5">
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-200)]">
                <span>Rows per page</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                  className="cursor-pointer rounded border border-[var(--bg-300)] bg-[var(--bg-100)] px-1.5 py-0.5 text-[11px] text-[var(--text-100)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-200)] dark:bg-[var(--bg-200)]"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="tabular-nums">
                  {filteredVendors.length === 0
                    ? '0'
                    : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredVendors.length)}`}{' '}
                  of {filteredVendors.length}
                </span>
              </div>

              {totalPages > 1 && (
                <PaginationArrows page={page} pages={totalPages} onChange={setPage} />
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Corrections that reached no vendor ────────────────────── */}
      {!loading && unassigned.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-amber-300/60 bg-[var(--bg-100)] shadow-sm dark:border-amber-500/30">
          <button
            type="button"
            onClick={() => setShowUnassigned((prev) => !prev)}
            aria-expanded={showUnassigned}
            className="flex w-full cursor-pointer items-center gap-3 bg-amber-50/70 px-4 py-3 text-left transition-colors hover:bg-amber-50 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
          >
            <svg
              className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--text-100)]">
                {unassigned.length} correction{unassigned.length === 1 ? '' : 's'} not reaching any
                vendor
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-200)]">
                These have no vendor name, or a name that matches no registered vendor. Tidy Agent
                never retrieves them, so they are teaching it nothing.
              </p>
            </div>

            <svg
              className={`h-4 w-4 shrink-0 text-[var(--text-200)] transition-transform ${showUnassigned ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {showUnassigned && (
            <div className="border-t border-[var(--bg-300)] px-4 py-4">
              <p className="mb-2.5 text-xs text-[var(--text-200)]">
                Register a vendor under exactly the name shown on a correction and it starts
                steering that vendor's parses.
              </p>
              <ul className="space-y-2">
                {unassigned.map((correction) => (
                  <li key={correction._id}>
                    <p className="mb-1 text-[11px] text-[var(--text-200)]">
                      Vendor name on this correction:{' '}
                      {correction.vendorName ? (
                        <span className="font-mono text-amber-700 dark:text-amber-400">
                          {correction.vendorName}
                        </span>
                      ) : (
                        <span className="italic">none recorded</span>
                      )}
                    </p>
                    <ul>
                      <CorrectionItem
                        correction={correction}
                        onDelete={() => setPendingCorrectionDelete(correction)}
                      />
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Vendor editor modal ───────────────────────────────────── */}
      {editing !== undefined && (
        <VendorEditor
          vendor={editing}
          workspaceId={workspaceId}
          onClose={closeEditor}
          onSaved={(msg) => void handleSaved(msg)}
        />
      )}

      {/* ── Delete confirmation modal ──────────────────────────────── */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
            onClick={() => setPendingDelete(null)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-sm overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl"
          >
            <div className="flex items-center gap-3 border-b border-[var(--bg-300)] px-5 py-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICON_DELETE} />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-[var(--text-100)]">
                Delete {pendingDelete.name}?
              </h3>
            </div>

            <div className="px-5 py-4">
              <p className="text-sm text-[var(--text-200)]">
                {pendingDelete.correctionCount > 0
                  ? `This also deletes the ${pendingDelete.correctionCount} correction${pendingDelete.correctionCount === 1 ? '' : 's'} this vendor taught Tidy Agent — it will go back to guessing their format.`
                  : 'This vendor has taught Tidy Agent nothing yet, so only the profile is removed.'}
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-5 py-3">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="cursor-pointer rounded-lg border border-[var(--bg-300)] px-3 py-1.5 text-sm text-[var(--text-200)] transition-colors hover:bg-[var(--bg-200)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                className="cursor-pointer rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Delete vendor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Correction delete confirmation modal ───────────────────── */}
      {pendingCorrectionDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
            onClick={() => setPendingCorrectionDelete(null)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-sm overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl"
          >
            <div className="flex items-center gap-3 border-b border-[var(--bg-300)] px-5 py-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICON_DELETE} />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-[var(--text-100)]">Delete correction?</h3>
            </div>

            <div className="px-5 py-4">
              <p className="text-sm text-[var(--text-200)]">
                Tidy Agent stops applying this to{' '}
                {pendingCorrectionDelete.vendorName ?? 'this vendor'}'s documents from the next
                parse onward. Anything it already learned from other corrections is unaffected.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-5 py-3">
              <button
                type="button"
                onClick={() => setPendingCorrectionDelete(null)}
                className="cursor-pointer rounded-lg border border-[var(--bg-300)] px-3 py-1.5 text-sm text-[var(--text-200)] transition-colors hover:bg-[var(--bg-200)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmCorrectionDelete()}
                className="cursor-pointer rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Delete correction
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
