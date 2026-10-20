import { useEffect, useId, useState } from 'react'
import type { HHBrandId } from '../../lib/hhBrand'
import { Td, Th } from '../labels/labelUi'
import { previewDsOmWrite, writeDsOmReferences } from '../../lib/hhSportswear'
import type { DsOmPreview, DsOmSkipped, DsOmTarget } from '../../lib/hhSportswear'

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function skipLabel(reason: DsOmSkipped['reason']): string {
  return reason === 'not-placed' ? 'Not placed' : 'No reference number'
}

function writeLabel(fill: number, other: number, overwrite: boolean): string {
  if (overwrite && other > 0 && fill > 0) {
    return `Fill ${countLabel(fill, 'empty cell', 'empty cells')} and overwrite ${other}`
  }
  if (overwrite && other > 0) return `Overwrite ${countLabel(other, 'cell', 'cells')}`
  return `Fill ${countLabel(fill, 'empty cell', 'empty cells')}`
}

function resultLabel(written: number, overwritten: number): string {
  if (written === 0 && overwritten === 0) return 'Nothing was written. The sheet already matched this batch.'
  const parts: string[] = []
  if (written > 0) parts.push(`Filled ${countLabel(written, 'empty cell', 'empty cells')}`)
  if (overwritten > 0) parts.push(`overwrote ${countLabel(overwritten, 'cell', 'cells')}`)
  const sentence = parts.join(' and ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

type RecheckStatus = 'fill' | 'same' | 'other' | 'missing' | 'skip'

interface RecheckRow {
  key: string
  childId: string
  sheetRow: number | null
  orderId: string
  po: string
  referenceNumber: string
  current: string
  status: RecheckStatus
  skipReason?: DsOmSkipped['reason']
}

function selectionKey(childId: string, row: number): string {
  return `${childId}:${row}`
}

const STATUS_LABEL: Record<RecheckStatus, string> = {
  fill: 'Will fill',
  same: 'Already set',
  other: 'Other text',
  missing: 'Not found',
  skip: 'Skipped',
}

const STATUS_CLASS: Record<RecheckStatus, string> = {
  fill: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  same: 'bg-slate-100 text-slate-600 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]',
  other: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  missing: 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  skip: 'bg-slate-100 text-slate-500 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]',
}

function recheckRows(preview: DsOmPreview): RecheckRow[] {
  const fromTarget = (row: DsOmTarget, status: RecheckStatus): RecheckRow => ({
    key: `${status}-${row.childId}-${row.row}`,
    childId: row.childId,
    sheetRow: row.row,
    orderId: row.orderId,
    po: row.po,
    referenceNumber: row.referenceNumber,
    current: row.current,
    status,
  })
  const rows: RecheckRow[] = [
    ...preview.willFill.map((row) => fromTarget(row, 'fill')),
    ...preview.hasOtherText.map((row) => fromTarget(row, 'other')),
    ...preview.alreadySet.map((row) => fromTarget(row, 'same')),
    ...preview.notFound.map((row) => ({
      key: `missing-${row.childId}`,
      childId: row.childId,
      sheetRow: null,
      orderId: row.orderId,
      po: row.po,
      referenceNumber: row.referenceNumber,
      current: '',
      status: 'missing' as const,
    })),
    ...preview.skipped.map((row) => ({
      key: `skip-${row.childId}`,
      childId: row.childId,
      sheetRow: null,
      orderId: row.orderId,
      po: row.po,
      referenceNumber: '',
      current: '',
      status: 'skip' as const,
      skipReason: row.reason,
    })),
  ]
  return rows.sort((left, right) => {
    if (left.sheetRow == null && right.sheetRow == null) return 0
    if (left.sheetRow == null) return 1
    if (right.sheetRow == null) return -1
    return left.sheetRow - right.sheetRow
  })
}

function statusText(row: RecheckRow): string {
  if (row.status === 'skip') return skipLabel(row.skipReason ?? 'not-placed')
  return STATUS_LABEL[row.status]
}

function ReferenceCell({ row }: { row: RecheckRow }) {
  if (row.status === 'skip') return <span className="text-slate-400">—</span>
  if (row.status === 'other' && row.current) {
    return (
      <span className="font-mono">
        <span className="text-slate-400 line-through">{row.current}</span>
        <span className="px-1.5 text-slate-400">→</span>
        <span className="text-slate-800 dark:text-[var(--text-100)]">{row.referenceNumber}</span>
      </span>
    )
  }
  return <span className="font-mono text-slate-800 dark:text-[var(--text-100)]">{row.referenceNumber || '—'}</span>
}

function rowCanWrite(row: RecheckRow, overwrite: boolean): boolean {
  return row.status === 'fill' || (row.status === 'other' && overwrite)
}

function IncludeBox({
  checked,
  indeterminate = false,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  indeterminate?: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      className="cursor-pointer accent-[var(--accent-200)] disabled:cursor-not-allowed"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      ref={(element) => {
        if (element) element.indeterminate = indeterminate
      }}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

function RecheckTable({
  rows,
  selected,
  overwrite,
  busy,
  onToggle,
  onToggleValid,
}: {
  rows: RecheckRow[]
  selected: Set<string>
  overwrite: boolean
  busy: boolean
  onToggle: (key: string, checked: boolean) => void
  onToggleValid: (checked: boolean) => void
}) {
  const valid = rows.filter((row) => rowCanWrite(row, overwrite) && row.sheetRow != null)
  const selectedValid = valid.filter((row) => selected.has(selectionKey(row.childId, row.sheetRow as number)))
  const allValid = valid.length > 0 && selectedValid.length === valid.length
  return (
    <div className="hh-table-scroll rounded-lg border border-[var(--bg-300)]" style={{ maxHeight: '20rem' }}>
      <table className="w-full text-left text-[13px]">
        <thead className="text-slate-500 dark:text-[var(--text-200)]">
          <tr>
            <Th className="w-12">
              <IncludeBox
                checked={allValid}
                indeterminate={selectedValid.length > 0 && !allValid}
                disabled={busy || valid.length === 0}
                label={allValid ? 'Leave out every row that can be written' : 'Include every row that can be written'}
                onChange={onToggleValid}
              />
            </Th>
            <Th>Sheet row</Th>
            <Th>Order ID</Th>
            <Th>PO</Th>
            <Th>Reference</Th>
            <Th>Result</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-[var(--bg-300)]">
          {rows.map((row) => {
            const canWrite = rowCanWrite(row, overwrite) && row.sheetRow != null
            const key = canWrite ? selectionKey(row.childId, row.sheetRow as number) : ''
            const checked = canWrite && selected.has(key)
            return (
            <tr key={row.key} className={canWrite && !checked ? 'opacity-60' : undefined}>
              <Td compact>
                <IncludeBox
                  checked={checked}
                  disabled={!canWrite || busy}
                  label={
                    canWrite
                      ? `${checked ? 'Leave out' : 'Include'} sheet row ${row.sheetRow}`
                      : 'This row will not be written'
                  }
                  onChange={(next) => onToggle(key, next)}
                />
              </Td>
              <Td compact className="font-mono tabular-nums">
                {row.sheetRow ?? '—'}
              </Td>
              <Td compact className="font-mono">
                {row.orderId || '—'}
              </Td>
              <Td compact className="font-mono">
                {row.po || '—'}
              </Td>
              <Td compact>
                <ReferenceCell row={row} />
              </Td>
              <Td compact>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}>
                  {statusText(row)}
                </span>
              </Td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function HHDsOmModal({
  brand,
  groupId,
  onClose,
}: {
  brand: HHBrandId
  groupId: string
  onClose: () => void
}) {
  const titleId = useId()
  const [preview, setPreview] = useState<DsOmPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    previewDsOmWrite(brand, groupId)
      .then((res) => {
        if (cancelled) return
        setPreview(res.data)
        setSelected(new Set(res.data.ok ? res.data.willFill.map((row) => selectionKey(row.childId, row.row)) : []))
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not read the DS OM sheet')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [brand, groupId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const chosenFill = preview?.ok ? preview.willFill.filter((row) => selected.has(selectionKey(row.childId, row.row))) : []
  const chosenOther = preview?.ok && overwrite
    ? preview.hasOtherText.filter((row) => selected.has(selectionKey(row.childId, row.row)))
    : []
  const fillCount = chosenFill.length
  const otherCount = chosenOther.length
  const writeCount = fillCount + otherCount
  const canWrite = Boolean(preview?.ok) && writeCount > 0 && !busy

  const toggleRow = (key: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const toggleValid = (checked: boolean) => {
    if (!preview?.ok) return
    const valid = overwrite ? [...preview.willFill, ...preview.hasOtherText] : preview.willFill
    setSelected((current) => {
      const next = new Set(current)
      for (const row of valid) {
        const key = selectionKey(row.childId, row.row)
        if (checked) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  const confirm = () => {
    if (!canWrite || !preview?.ok) return
    const rows = [...chosenFill, ...chosenOther].map((row) => ({ childId: row.childId, row: row.row }))
    setBusy(true)
    setWriteError(null)
    writeDsOmReferences(brand, groupId, { overwrite: chosenOther.length > 0, rows })
      .then((res) => {
        setPreview(res.data)
        if (!res.data.ok) {
          setWriteError(res.data.message || 'Could not update the DS OM sheet')
          return
        }
        setOverwrite(false)
        setSelected((current) => {
          const next = new Set<string>()
          for (const row of res.data.willFill) {
            const key = selectionKey(row.childId, row.row)
            if (current.has(key)) next.add(key)
          }
          return next
        })
        setResult(resultLabel(res.data.written ?? 0, res.data.overwritten ?? 0))
      })
      .catch((error: unknown) => {
        setWriteError(error instanceof Error ? error.message : 'Could not update the DS OM sheet')
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={() => { if (!busy) onClose() }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(44rem,calc(100vh-2rem))] w-full max-w-4xl flex-col rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl"
      >
        <div className="space-y-2 border-b border-[var(--bg-300)] px-6 py-5">
          <h3 id={titleId} className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
            Update DS OM
          </h3>
          <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
            {loading
              ? 'Reading the sheet…'
              : preview?.ok
                ? `${preview.spreadsheetTitle || 'DS OM'} · ${preview.sheetName || 'sheet'}${preview.accountEmail ? ` · ${preview.accountEmail}` : ''}`
                : 'Nothing will be written until you confirm.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {loadError ? <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p> : null}
          {preview && !preview.ok ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              {preview.message}
              {preview.accountEmail ? ` (${preview.accountEmail})` : ''}
            </p>
          ) : null}
          {result ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{result}</p> : null}
          {preview?.ok ? (
            preview.willFill.length === 0 &&
            preview.alreadySet.length === 0 &&
            preview.hasOtherText.length === 0 &&
            preview.notFound.length === 0 &&
            preview.skipped.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">This batch has no orders.</p>
            ) : (
              <>
                <RecheckTable
                  rows={recheckRows(preview)}
                  selected={selected}
                  overwrite={overwrite}
                  busy={busy}
                  onToggle={toggleRow}
                  onToggleValid={toggleValid}
                />
                {preview.hasOtherText.length > 0 ? (
                  <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-[var(--text-100)]">
                    <input
                      type="checkbox"
                      className="mt-0.5 cursor-pointer accent-[var(--accent-200)] disabled:cursor-not-allowed"
                      checked={overwrite}
                      disabled={busy}
                      onChange={(event) => {
                        const next = event.target.checked
                        setOverwrite(next)
                        if (!next) return
                        setSelected((current) => {
                          const merged = new Set(current)
                          for (const row of preview.hasOtherText) merged.add(selectionKey(row.childId, row.row))
                          return merged
                        })
                      }}
                    />
                    <span>Also overwrite cells that already have a different value.</span>
                  </label>
                ) : null}
              </>
            )
          ) : null}
          {writeError ? <p className="text-sm text-red-600 dark:text-red-400">{writeError}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--bg-300)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded-lg bg-[var(--bg-200)] px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-[var(--bg-300)] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[var(--text-200)]"
          >
            {result && writeCount === 0 ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!canWrite}
            className="cursor-pointer rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)]"
          >
            {busy ? 'Updating…' : writeCount === 0 ? 'Nothing to write' : writeLabel(fillCount, otherCount, overwrite)}
          </button>
        </div>
      </div>
    </div>
  )
}
