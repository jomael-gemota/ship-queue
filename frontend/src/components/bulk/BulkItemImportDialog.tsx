import { useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { BulkItemTemplateLink } from './BulkItemFileField'
import { checkBulkOrderItem, commitBulkOrderItems, previewBulkOrderItems } from '../../lib/bulkOrders'
import type { BulkImportIssue, BulkImportReadyLine, BulkOrderItems } from '../../lib/bulkOrders'

const ACCEPT = '.xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'
const MAX_BYTES = 5 * 1024 * 1024

const inputClass =
  'w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]'

interface IssueRow extends BulkImportIssue {
  id: string
  draft: string
  checkError: string | null
}

function fileLooksValid(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm') && !name.endsWith('.csv')) {
    return 'Upload an .xlsx or .csv file.'
  }
  if (file.size > MAX_BYTES) return 'File is too large (max 5 MB).'
  return null
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function itemCount(count: number): string {
  return count === 1 ? '1 item' : `${count} items`
}

function joinSellerSku(current: string, next: string): string {
  const add = next.trim()
  if (!add) return current
  if (!current) return add
  const parts = current.split(', ')
  if (parts.some((part) => part.toUpperCase() === add.toUpperCase())) return current
  return `${current}, ${add}`
}

function mergeReady(lines: BulkImportReadyLine[], next: BulkImportReadyLine): BulkImportReadyLine[] {
  const key = next.portalSku.trim().toUpperCase()
  const index = lines.findIndex((line) => line.portalSku.trim().toUpperCase() === key)
  if (index === -1) return [...lines, next]
  const current = lines[index]
  const copy = lines.slice()
  copy[index] = {
    sellerSku: joinSellerSku(current.sellerSku, next.sellerSku),
    portalSku: current.portalSku,
    quantity: current.quantity + next.quantity,
  }
  return copy
}

function issueTitle(issue: IssueRow): string {
  return issue.sellerSku.trim() || issue.portalSku.trim() || 'SKU'
}

function issueDetail(issue: IssueRow): string {
  const seller = issue.sellerSku.trim()
  const portal = issue.portalSku.trim()
  const qty = `Qty ${issue.quantity}`
  if (seller && portal) return `B2B SKU ${portal} · ${qty}`
  return qty
}

function searchedLabel(issue: IssueRow): string {
  const shown = new Set(
    [issue.sellerSku, issue.portalSku].map((value) => value.trim().toUpperCase()).filter(Boolean),
  )
  const extra = issue.tried.filter((code) => !shown.has(code.trim().toUpperCase()))
  if (extra.length === 0) return ''
  return `Searched ${extra.join(', ')}`
}

function reviewNote(ready: number, issues: number): string {
  if (ready === 0) return 'None of these rows are in the catalog. Enter a B2B SKU, or upload a corrected file.'
  if (issues === 0) return 'All rows matched. This replaces the items on this shipment.'
  const left = issues === 1 ? '1 row stays off the shipment.' : `${issues} rows stay off the shipment.`
  return `${left} Import replaces this shipment with the ${ready === 1 ? '1 ready item' : `${ready} ready items`}.`
}

export function BulkItemImportDialog({
  orderId,
  shipmentIndex,
  onClose,
  onImported,
}: {
  orderId: string
  shipmentIndex: number
  onClose: () => void
  onImported: (data: BulkOrderItems) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const requestId = useRef(0)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [checkingFile, setCheckingFile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState<BulkImportReadyLine[]>([])
  const [issues, setIssues] = useState<IssueRow[]>([])
  const [reviewed, setReviewed] = useState(false)
  const [checkingId, setCheckingId] = useState<string | null>(null)

  const close = () => {
    if (busy) return
    onClose()
  }

  const stage = (next: File) => {
    const invalid = fileLooksValid(next)
    const id = requestId.current + 1
    requestId.current = id
    setFile(invalid ? null : next)
    setFileError(invalid)
    setError(null)
    setReady([])
    setIssues([])
    setReviewed(false)
    setCheckingId(null)
    setCheckingFile(false)
    if (invalid) {
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setCheckingFile(true)
    previewBulkOrderItems(orderId, shipmentIndex, next)
      .then((res) => {
        if (requestId.current !== id) return
        setReady(res.data.ready)
        setIssues(
          res.data.issues.map((issue, index) => ({
            ...issue,
            id: `${index}-${issue.sellerSku}-${issue.portalSku}`,
            draft: '',
            checkError: null,
          })),
        )
        setReviewed(true)
      })
      .catch((err: unknown) => {
        if (requestId.current !== id) return
        setError(err instanceof Error ? err.message : 'Could not check the file against Thorogood.')
      })
      .finally(() => {
        if (requestId.current === id) setCheckingFile(false)
      })
  }

  const updateIssue = (id: string, patch: Partial<IssueRow>) => {
    setIssues((current) => current.map((issue) => (issue.id === id ? { ...issue, ...patch } : issue)))
  }

  const checkIssue = (issue: IssueRow) => {
    const portalSku = issue.draft.trim()
    if (!portalSku || checkingId || busy) {
      if (!portalSku) updateIssue(issue.id, { checkError: 'Enter a B2B SKU.' })
      return
    }
    const generation = requestId.current
    setCheckingId(issue.id)
    updateIssue(issue.id, { checkError: null })
    checkBulkOrderItem(orderId, shipmentIndex, portalSku)
      .then((res) => {
        if (requestId.current !== generation) return
        setReady((current) =>
          mergeReady(current, {
            sellerSku: issue.sellerSku,
            portalSku: res.data.portalSku,
            quantity: issue.quantity,
          }),
        )
        setIssues((current) => current.filter((row) => row.id !== issue.id))
      })
      .catch((err: unknown) => {
        if (requestId.current !== generation) return
        updateIssue(issue.id, {
          checkError: err instanceof Error ? err.message : 'Not found in the Thorogood catalog.',
        })
      })
      .finally(() => {
        if (requestId.current !== generation) return
        setCheckingId((current) => (current === issue.id ? null : current))
      })
  }

  const submit = () => {
    if (!reviewed || ready.length === 0 || busy || checkingFile || checkingId) return
    setBusy(true)
    setError(null)
    commitBulkOrderItems(orderId, shipmentIndex, ready)
      .then((res) => onImported(res.data))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not import items.')
      })
      .finally(() => setBusy(false))
  }

  const onDragEnter = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const dropTone = fileError
    ? 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30'
    : dragging
      ? 'border-[var(--accent-200)] bg-[var(--primary-100)]'
      : 'border-[var(--bg-300)] bg-[var(--bg-200)]/40 hover:border-[var(--accent-200)] dark:border-[var(--bg-300)]'

  const importLabel = busy
    ? 'Importing…'
    : checkingFile
      ? 'Checking…'
      : reviewed && ready.length > 0
        ? `Import ${itemCount(ready.length)}`
        : 'Import'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={close} />
      <div className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl">
        <div className="space-y-4 overflow-y-auto p-6">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Import items</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
              Attach a file with SKU, B2B SKU, and Quantity. Each row is checked against Thorogood before the shipment is replaced.
            </p>
            <div className="mt-2">
              <BulkItemTemplateLink />
            </div>
          </div>
          <input
            ref={inputRef}
            id="bulk-item-import-file"
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const next = event.target.files?.[0]
              if (next) stage(next)
            }}
          />
          <label
            htmlFor="bulk-item-import-file"
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              dragDepth.current = 0
              setDragging(false)
              if (busy) return
              const next = event.dataTransfer.files?.[0]
              if (next) stage(next)
            }}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-left transition-colors ${dropTone}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900 dark:text-[var(--text-100)]">
                {file ? file.name : 'Drop a file here'}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-[var(--text-200)]">
                {file
                  ? `${formatFileSize(file.size)} · click to choose a different file`
                  : 'or click to browse · .xlsx or .csv, up to 5 MB'}
              </span>
            </span>
            <span className="shrink-0 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]">
              {file ? 'Change file' : 'Browse files'}
            </span>
          </label>
          {fileError ? <p className="text-sm text-red-600 dark:text-red-400">{fileError}</p> : null}
          {checkingFile ? (
            <p className="text-sm text-slate-500 dark:text-[var(--text-200)]" role="status">
              Checking the catalog…
            </p>
          ) : null}
          {reviewed ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-3 py-2">
                  <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-[var(--text-100)]">{ready.length}</p>
                  <p className="text-xs text-slate-500 dark:text-[var(--text-200)]">ready</p>
                </div>
                <div
                  className={
                    issues.length
                      ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/50 dark:bg-red-950/30'
                      : 'rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-3 py-2'
                  }
                >
                  <p
                    className={
                      issues.length
                        ? 'text-lg font-semibold tabular-nums text-red-700 dark:text-red-300'
                        : 'text-lg font-semibold tabular-nums text-slate-900 dark:text-[var(--text-100)]'
                    }
                  >
                    {issues.length}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-[var(--text-200)]">not found</p>
                </div>
              </div>
              <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">{reviewNote(ready.length, issues.length)}</p>
              {issues.length > 0 ? (
                <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {issues.map((issue) => {
                    const searched = searchedLabel(issue)
                    const checking = checkingId === issue.id
                    return (
                      <li
                        key={issue.id}
                        className="space-y-2 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)]/40 px-3 py-2.5"
                      >
                        <div>
                          <p className="truncate text-sm font-medium text-slate-800 dark:text-[var(--text-100)]" title={issueTitle(issue)}>
                            {issueTitle(issue)}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-[var(--text-200)]">{issueDetail(issue)}</p>
                          {searched ? <p className="mt-1 text-xs text-slate-500 dark:text-[var(--text-200)]">{searched}</p> : null}
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{issue.message}</p>
                        </div>
                        <form
                          className="flex items-start gap-2"
                          onSubmit={(event: FormEvent) => {
                            event.preventDefault()
                            checkIssue(issue)
                          }}
                        >
                          <label className="min-w-0 flex-1">
                            <span className="sr-only">B2B SKU for {issueTitle(issue)}</span>
                            <input
                              value={issue.draft}
                              onChange={(event) => updateIssue(issue.id, { draft: event.target.value, checkError: null })}
                              placeholder="B2B SKU"
                              disabled={busy || checking}
                              className={inputClass}
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={busy || Boolean(checkingId) || !issue.draft.trim()}
                            className="cursor-pointer rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-[var(--bg-200)] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]"
                          >
                            {checking ? 'Checking…' : 'Check'}
                          </button>
                        </form>
                        {issue.checkError ? <p className="text-xs text-red-600 dark:text-red-400">{issue.checkError}</p> : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--bg-300)] px-6 py-4">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="cursor-pointer rounded-lg bg-[var(--bg-200)] px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-[var(--bg-300)] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[var(--text-200)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!reviewed || ready.length === 0 || Boolean(fileError) || busy || checkingFile || Boolean(checkingId)}
            className="cursor-pointer rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
          >
            {importLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
