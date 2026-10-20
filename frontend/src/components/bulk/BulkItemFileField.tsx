import { useRef, useState } from 'react'
import type { DragEvent } from 'react'

const ACCEPT = '.xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'
const MAX_BYTES = 5 * 1024 * 1024

const labelClass = 'block text-sm font-medium text-slate-700 dark:text-[var(--text-100)]'
const hintClass = 'block text-xs text-slate-500 dark:text-[var(--text-200)]'

export function BulkItemTemplateLink() {
  return (
    <a
      href="/templates/bulk-items-template.xlsx"
      download="bulk-items-template.xlsx"
      className="shrink-0 text-xs font-medium text-[var(--accent-100)] hover:underline dark:text-[var(--accent-200)]"
    >
      Download template
    </a>
  )
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
  if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function BulkItemFileField({
  inputId,
  file,
  error,
  onFile,
}: {
  inputId: string
  file: File | null
  error: string | null
  onFile: (file: File | null, error: string | null) => void
}) {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const stage = (next: File) => {
    const invalid = fileLooksValid(next)
    onFile(invalid ? null : next, invalid)
    if (invalid && inputRef.current) inputRef.current.value = ''
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

  const dropTone = error
    ? 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30'
    : dragging
      ? 'border-[var(--accent-200)] bg-[var(--primary-100)]'
      : 'border-[var(--bg-300)] bg-[var(--bg-200)]/40 hover:border-[var(--accent-200)] dark:border-[var(--bg-300)]'

  return (
    <div className="space-y-1.5 border-t border-[var(--accent-200)] pt-4 dark:border-[var(--accent-100)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <label className={labelClass} htmlFor={inputId}>
            Items
          </label>
          <p className={hintClass}>Optional. SKU, B2B SKU, and Quantity. Fill in at least one SKU column.</p>
        </div>
        <BulkItemTemplateLink />
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const next = event.target.files?.[0]
          if (next) stage(next)
        }}
      />
      <label
        htmlFor={inputId}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          const next = event.dataTransfer.files?.[0]
          if (next) stage(next)
        }}
        className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-2.5 text-left transition-colors ${dropTone}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900 dark:text-[var(--text-100)]">
            {file ? file.name : 'Drop a file here'}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-[var(--text-200)]">
            {file ? `${formatFileSize(file.size)} · click to choose a different file` : 'or click to browse · .xlsx or .csv, up to 5 MB'}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center rounded-lg bg-[var(--accent-200)] px-3 py-1.5 text-sm font-medium text-white dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]">
          {file ? 'Change file' : 'Browse files'}
        </span>
      </label>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  )
}
