import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useHHList } from '../../context/HHListContext'
import {
  downloadHHImportTemplate,
  importHHSpreadsheet,
  importOutputRowKey,
  previewHHImport,
  type HHImportReview,
} from '../../lib/hhSportswear'
import { HHImportPreviewTable } from './HHImportReview'
import { flashHHGroupRow } from './hhUi'

const ACCEPT = '.xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'

const PASTE_PLACEHOLDER = '225702\t111-5023603-3399458\n225709\t111-5586027-4450636\n226012\t114-7413315-0341811'

type ImportTab = 'file' | 'paste'

function ImportSwitch({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  description: string
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)]">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-[var(--text-200)]">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        } ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-[var(--bg-300)]'}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

function fileLooksValid(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm') && !name.endsWith('.csv')) {
    return 'Upload an .xlsx or .csv file.'
  }
  if (file.size > 5 * 1024 * 1024) {
    return 'File is too large (max 5 MB).'
  }
  return null
}

type ImportPreview =
  | { status: 'idle' }
  | { status: 'ready'; key: string; review: HHImportReview }
  | { status: 'error'; key: string; message: string; review: HHImportReview | null }

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function HHImportButton() {
  const { brand, setGroups, handleClearFilters, setPage } = useHHList()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ImportTab>('paste')
  const [paste, setPaste] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [fetchDetails, setFetchDetails] = useState(true)
  const [draftCart, setDraftCart] = useState(true)
  const [preview, setPreview] = useState<ImportPreview>({ status: 'idle' })
  const [picked, setPicked] = useState<{ key: string; excluded: string[] } | null>(null)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pasteRef = useRef<HTMLTextAreaElement>(null)
  const requestClose = useRef<() => void>(() => {})

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || importBusy) return
      if (event.target instanceof HTMLTextAreaElement) return
      requestClose.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, importBusy])

  useEffect(() => {
    if (!open || tab !== 'paste' || importBusy) return
    pasteRef.current?.focus()
  }, [open, tab, importBusy])

  const sourceKey =
    tab === 'paste'
      ? paste.trim()
        ? `paste:${paste}`
        : ''
      : selectedFile
        ? `file:${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`
        : ''

  useEffect(() => {
    if (!open || !sourceKey) return
    const key = sourceKey
    const usingPaste = tab === 'paste'
    const text = paste
    const file = selectedFile
    let cancelled = false
    const timer = window.setTimeout(() => {
      const request = usingPaste ? previewHHImport(brand, { text }) : previewHHImport(brand, file!)
      request
        .then((result) => {
          if (cancelled) return
          if (result.ok) setPreview({ status: 'ready', key, review: result.review })
          else setPreview({ status: 'error', key, message: result.message, review: result.review })
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setPreview({
            status: 'error',
            key,
            message: error instanceof Error ? error.message : 'Could not check these rows.',
            review: null,
          })
        })
    }, usingPaste ? 400 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, sourceKey, tab, paste, selectedFile, brand])

  const resetFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const resetPicker = () => {
    setSelectedFile(null)
    setPaste('')
    setTab('paste')
    setFetchDetails(true)
    setDraftCart(true)
    setDragging(false)
    dragDepth.current = 0
    resetFileInput()
  }

  const close = () => {
    if (importBusy) return
    const hasPaste = paste.trim().length > 0
    const hasFile = selectedFile != null
    if (hasPaste || hasFile) {
      const message =
        hasPaste && hasFile
          ? 'Discard the pasted orders and the selected file?'
          : hasPaste
            ? 'Discard the pasted orders and close?'
            : 'Discard the selected file and close?'
      if (!window.confirm(message)) return
    }
    setOpen(false)
    resetPicker()
  }
  requestClose.current = close

  const stageFile = (file: File) => {
    const invalid = fileLooksValid(file)
    if (invalid) {
      setImportError(invalid)
      setSelectedFile(null)
      resetFileInput()
      return
    }
    setSelectedFile(file)
    setImportError(null)
  }

  const onDragEnter = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current += 1
    if ([...event.dataTransfer.types].includes('Files')) setDragging(true)
  }

  const onDragLeave = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    if (importBusy) return
    const file = event.dataTransfer.files?.[0]
    if (file) stageFile(file)
  }

  const dropTone = importError
    ? 'border-red-300 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20'
    : dragging
      ? 'border-[var(--accent-200)] bg-[var(--primary-100)] dark:border-[var(--accent-200)] dark:bg-[var(--primary-100)]'
      : selectedFile
        ? 'border-[var(--accent-200)]/50 bg-[var(--primary-100)]/50 dark:border-[var(--accent-200)]/40 dark:bg-[var(--primary-100)]/30'
        : 'border-[var(--bg-300)] bg-[var(--bg-200)]/40 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)]/40'

  const dropTitle = importBusy
    ? 'Importing…'
    : dragging
      ? 'Drop to attach'
      : selectedFile
        ? selectedFile.name
        : 'Drop the Order ID / PO file here'

  const matchedPreview = preview.status !== 'idle' && preview.key === sourceKey ? preview : null
  const checking = Boolean(sourceKey) && !matchedPreview
  const readyReview = matchedPreview?.status === 'ready' ? matchedPreview.review : null
  const previewError = matchedPreview?.status === 'error' ? matchedPreview : null
  const outputRows = readyReview?.rows ?? []
  const excludedKeys = new Set(
    readyReview == null
      ? []
      : picked?.key === sourceKey
        ? picked.excluded
        : outputRows.filter((row) => row.oddOrderId).map(importOutputRowKey),
  )
  const includedCount = outputRows.filter((row) => !excludedKeys.has(importOutputRowKey(row))).length
  const canCreate = !importBusy && includedCount > 0
  const orderLabel = readyReview
    ? `${includedCount} order${includedCount === 1 ? '' : 's'} will be created`
    : null

  const toggleExcluded = (key: string) => {
    const next = new Set(excludedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setPicked({ key: sourceKey, excluded: [...next] })
  }

  const createBatch = () => {
    if (importBusy || !readyReview) return
    const orders = outputRows
      .filter((row) => !excludedKeys.has(importOutputRowKey(row)))
      .map((row) => ({ orderId: row.orderId, po: row.po }))
    if (orders.length === 0) return
    setImportBusy(true)
    setImportError(null)
    importHHSpreadsheet(
      brand,
      {
        orders,
        sourceFileName: tab === 'file' && selectedFile ? selectedFile.name : 'Pasted orders',
      },
      { fetchDetails, draftCart: fetchDetails && draftCart },
    )
      .then((res) => {
        flashHHGroupRow(res.data.id)
        handleClearFilters()
        setPage(1)
        setGroups((current) => [res.data, ...current.filter((group) => group.id !== res.data.id)])
        setOpen(false)
        resetPicker()
      })
      .catch((error: unknown) => {
        setImportError(error instanceof Error ? error.message : 'Failed to import spreadsheet')
      })
      .finally(() => {
        setImportBusy(false)
        resetFileInput()
      })
  }

  const dropHint = importBusy
    ? 'Creating the group and unique orders'
    : !selectedFile
      ? 'or click to browse'
      : checking
        ? 'Checking rows…'
        : orderLabel
          ? `${formatFileSize(selectedFile.size)} · ${orderLabel}`
          : `${formatFileSize(selectedFile.size)} · click to choose a different file`

  const pasteRows = paste.split(/\r?\n/).filter((line) => line.trim()).length

  const tabClass = (id: ImportTab) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
      tab === id
        ? 'bg-[var(--bg-100)] text-slate-900 shadow-sm dark:bg-[var(--bg-100)] dark:text-[var(--text-100)]'
        : 'text-slate-500 hover:text-slate-700 dark:text-[var(--text-200)] dark:hover:text-[var(--text-100)]'
    }`

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setImportError(null)
          resetPicker()
          setOpen(true)
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
          />
        </svg>
        Import
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={close} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="hh-import-title"
            className="relative z-10 max-h-[calc(100vh-2rem)] w-full max-w-2xl space-y-5 overflow-y-auto rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 id="hh-import-title" className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
                Import orders
              </h3>
              <button
                type="button"
                onClick={close}
                disabled={importBusy}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-[var(--bg-200)] hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-[var(--text-100)]"
                aria-label="Close"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-0.5 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)]">
              <button type="button" className={tabClass('paste')} onClick={() => { setTab('paste'); setImportError(null) }} disabled={importBusy}>
                Paste
              </button>
              <button type="button" className={tabClass('file')} onClick={() => { setTab('file'); setImportError(null) }} disabled={importBusy}>
                File
              </button>
            </div>

            <input
              ref={fileInputRef}
              id="hh-import-file"
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={importBusy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) stageFile(file)
              }}
            />

            {tab === 'file' ? (
            <label
              htmlFor="hh-import-file"
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-5 py-7 text-center transition-colors ${dropTone} ${
                importBusy ? 'pointer-events-none opacity-70' : ''
              }`}
            >
              <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-100)] text-[var(--accent-200)] shadow-sm dark:bg-[var(--bg-100)] dark:text-[var(--accent-200)]">
                {importBusy ? (
                  <svg className="h-5 w-5 animate-spin motion-reduce:animate-none" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                ) : selectedFile ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6M7 4h7l5 5v11H7V4z"
                    />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                )}
              </span>

              <span className="max-w-full truncate px-2 text-sm font-semibold text-slate-900 dark:text-[var(--text-100)]">
                {dropTitle}
              </span>
              <span className="mt-1 max-w-[18rem] text-xs text-slate-500 dark:text-[var(--text-200)]">{dropHint}</span>

              {!importBusy && (
                <span className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  {selectedFile ? 'Change file' : 'Browse files'}
                </span>
              )}
              <span className="mt-3 text-[11px] text-slate-400 dark:text-[var(--text-200)]">
                .xlsx or .csv, up to 5 MB
              </span>
            </label>
            ) : (
              <div>
                <label htmlFor="hh-import-paste" className="sr-only">
                  Paste PO and Order ID rows
                </label>
                <textarea
                  ref={pasteRef}
                  id="hh-import-paste"
                  value={paste}
                  disabled={importBusy}
                  rows={readyReview ? 3 : 6}
                  spellCheck={false}
                  placeholder={PASTE_PLACEHOLDER}
                  onChange={(event) => {
                    setPaste(event.target.value)
                    setImportError(null)
                  }}
                  className="w-full resize-none overflow-y-auto rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-200)]/40 px-3.5 py-3 font-mono text-xs leading-5 text-slate-800 outline-none placeholder:text-slate-400 focus:border-[var(--accent-200)] focus:ring-2 focus:ring-[var(--accent-200)] disabled:opacity-60 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)]/40 dark:text-[var(--text-100)] dark:placeholder:text-[var(--text-200)]"
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-[var(--text-200)]">
                  {pasteRows === 0
                    ? 'Paste from Excel or a text list. Tabs, commas, or spaces are fine.'
                    : checking
                      ? 'Checking rows…'
                      : orderLabel ?? `${pasteRows} row${pasteRows === 1 ? '' : 's'} ready`}
                </p>
              </div>
            )}

            {previewError && <p className="text-sm text-red-600 dark:text-red-400">{previewError.message}</p>}
            {importError && <p className="text-sm text-red-600 dark:text-red-400">{importError}</p>}
            {readyReview && (
              <HHImportPreviewTable
                review={readyReview}
                excluded={excludedKeys}
                disabled={importBusy}
                onToggle={toggleExcluded}
                onSetExcluded={(keys) => setPicked({ key: sourceKey, excluded: keys })}
              />
            )}

            {!readyReview && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[var(--text-200)]">
                Columns
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-[var(--text-100)]">
                <li className="flex items-baseline gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-200)]" aria-hidden="true" />
                  <span>
                    <span className="font-medium">Order ID</span>
                    <span className="text-slate-500 dark:text-[var(--text-200)]"> — required</span>
                  </span>
                </li>
                <li className="flex items-baseline gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-200)]" aria-hidden="true" />
                  <span>
                    <span className="font-medium">PO Number</span>
                    <span className="text-slate-500 dark:text-[var(--text-200)]"> — required</span>
                  </span>
                </li>
              </ul>
              <p className="mt-2 text-xs text-slate-500 dark:text-[var(--text-200)]">
                Columns can be in either order. Headers are optional if one column is an Amazon Order ID. Rows are checked before the batch is created.
              </p>
            </div>
            )}

            <div className="space-y-3 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-200)]/40 px-4 py-3 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)]/40">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[var(--text-200)]">
                After import
              </p>
              <ImportSwitch
                checked={fetchDetails}
                disabled={importBusy}
                label="Fetch order details"
                description="Pull Seller Central buyer, address, and items for each Order ID."
                onChange={(next) => {
                  setFetchDetails(next)
                  setDraftCart(next)
                }}
              />
              <ImportSwitch
                checked={fetchDetails && draftCart}
                disabled={importBusy || !fetchDetails}
                label="Draft B2B cart"
                description={
                  fetchDetails
                    ? 'Create a Helly Hansen draft after details sync. The order is not placed.'
                    : 'Turn on Fetch order details first. Carts need synced items.'
                }
                onChange={setDraftCart}
              />
            </div>

            <div className="flex flex-col gap-2">
              {readyReview && includedCount === 0 && (
                <p className="text-center text-xs text-slate-500 dark:text-[var(--text-200)]">
                  Select at least one order.
                </p>
              )}
              <button
                type="button"
                disabled={!canCreate}
                onClick={createBatch}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-200)] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
              >
                {importBusy
                  ? 'Creating batch…'
                  : checking
                    ? 'Checking…'
                    : includedCount > 0
                      ? `Create ${includedCount} ${includedCount === 1 ? 'order' : 'orders'}`
                      : 'Create batch'}
              </button>
              <button
                type="button"
                disabled={importBusy}
                onClick={() => downloadHHImportTemplate(brand)}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--accent-200)] bg-transparent px-3 py-2.5 text-sm font-medium text-[var(--accent-200)] transition-colors hover:bg-[var(--primary-100)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[var(--accent-200)] dark:text-[var(--accent-200)] dark:hover:bg-[var(--primary-100)]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
                  />
                </svg>
                Download template
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
