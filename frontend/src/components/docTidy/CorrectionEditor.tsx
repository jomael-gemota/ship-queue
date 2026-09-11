import { useEffect, useMemo, useState } from 'react'
import { authApi } from '../../lib/api'
import { diffOutputs } from '../../lib/correctionDiff'
import { Spinner } from './docTidyUi'
import type { DocTidyCorrection } from '../../types/docTidy'

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

/**
 * Records a correction against one parse job.
 *
 * The editor is raw JSON rather than a generated form because the agent's output
 * shape is document-dependent — a form would have to be rebuilt per vendor, and
 * would quietly drop any field it did not know to render.
 *
 * The note matters as much as the JSON: it is promoted into the agent's system
 * prompt as a hard rule on later documents, so "Qty comes from the Units column"
 * generalises where an edited number alone does not.
 */
export default function CorrectionEditor({
  jobId,
  original,
  onSaved,
}: {
  jobId: string
  original: Record<string, unknown> | null | undefined
  onSaved: () => void
}) {
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    setDraft(JSON.stringify(original ?? {}, null, 2))
    setNote('')
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
            ? 'Saved. The agent will use this on similar documents.'
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
            Written as an instruction, this becomes a rule the agent follows on this
            vendor&apos;s future documents.
          </span>
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
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
        onClick={save}
        disabled={!canSave}
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving && <Spinner />}
        Save correction
      </button>
    </div>
  )
}

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
      {corrections.map((correction) => (
        <li
          key={correction._id}
          className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-3"
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-200)]">
            <span>{new Date(correction.createdAt).toLocaleString()}</span>
            {correction.createdByName && <span>· {correction.createdByName}</span>}
            {correction.vendorName && <span>· {correction.vendorName}</span>}
          </div>
          {correction.note && (
            <p className="mb-1.5 text-sm text-[var(--text-100)]">{correction.note}</p>
          )}
          <CorrectionDiff
            original={correction.originalOutput}
            corrected={correction.correctedOutput}
          />
        </li>
      ))}
    </ul>
  )
}
