import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../lib/api'
import type {
  ImportRow,
  LabelRecord,
  LabelBatch,
  DraftBatchResponse,
  BatchesListResponse,
  BatchItemsResponse,
  CreateBatchLabelsResponse,
} from '../types/label'
import {
  formatDateTime,
  shortBatchId,
  printLabelPdf,
  BatchStatusBadge,
  CreatePrintButton,
  ExportCsvButton,
  DeleteBatchButton,
  exportBatchItemsCsv,
  Spinner,
  StepBadge,
  Th,
  HeaderLabel,
  Td,
  LabelsTableIcon,
  EyeIcon,
  IdIcon,
  ClockIcon,
  UserIcon,
  StatusIcon,
  RowItemIcon,
} from '../components/labels/labelUi'
import { useAuth } from '../context/AuthContext'

/** Parses a single CSV row, respecting double-quoted fields. */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const PO_HEADERS = new Set(['po', 'ponumber', 'purchaseorder', 'purchaseordernumber'])
const ORDER_HEADERS = new Set(['order', 'ordernumber', 'orderno', 'ordernum'])

interface ParseResult {
  rows: ImportRow[]
  error?: string
}

function parseCsv(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length === 0) return { rows: [], error: 'The file is empty.' }

  const firstCells = parseCsvLine(lines[0]).map((c) => c.trim())
  const normalized = firstCells.map(normalizeHeader)

  let poIdx = normalized.findIndex((h) => PO_HEADERS.has(h))
  let orderIdx = normalized.findIndex((h) => ORDER_HEADERS.has(h))

  let dataLines = lines
  if (poIdx !== -1 || orderIdx !== -1) {
    // Header row detected — skip it.
    dataLines = lines.slice(1)
    if (poIdx === -1) poIdx = orderIdx === 0 ? 1 : 0
    if (orderIdx === -1) orderIdx = poIdx === 0 ? 1 : 0
  } else {
    // No recognizable header — assume column 0 = PO#, column 1 = Order#.
    poIdx = 0
    orderIdx = 1
  }

  const rows: ImportRow[] = []
  for (const line of dataLines) {
    const cells = parseCsvLine(line).map((c) => c.trim())
    const poNumber = cells[poIdx] || ''
    const orderNumber = cells[orderIdx] || ''
    if (!poNumber && !orderNumber) continue
    rows.push({ poNumber, orderNumber })
  }

  if (rows.length === 0) return { rows: [], error: 'No PO#/Order# rows found in the file.' }
  return { rows }
}

function downloadTemplate() {
  const csv = 'PO#,Order#\nPO-1001,123456\nPO-1002,123457\n'
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'shipping-label-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function CreateShippingLabel() {
  const { user } = useAuth()

  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [drafting, setDrafting] = useState(false)
  const [testMode, setTestMode] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [batches, setBatches] = useState<LabelBatch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [creatingBatchId, setCreatingBatchId] = useState<string | null>(null)
  const [exportingBatchId, setExportingBatchId] = useState<string | null>(null)
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [batchPage, setBatchPage] = useState(0)
  const [batchPageSize, setBatchPageSize] = useState(10)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadBatches = useCallback(async () => {
    try {
      const res = await authApi.get<BatchesListResponse>('/labels/batches?pageSize=100')
      setBatches(res.data)
      setBatchPage(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load batches')
    } finally {
      setBatchesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBatches()
  }, [loadBatches])

  const fetchBatchItems = useCallback(async (batchId: string): Promise<LabelRecord[]> => {
    const res = await authApi.get<BatchItemsResponse>(`/labels/batches/${batchId}/items`)
    return res.data.items
  }, [])

  const handleFile = (file: File) => {
    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      const { rows, error: parseError } = parseCsv(text)
      if (parseError) {
        setError(parseError)
        setImportRows([])
        return
      }
      setFileName(file.name)
      setImportRows(rows)
    }
    reader.onerror = () => setError('Failed to read the file.')
    reader.readAsText(file)
  }

  const handleReset = () => {
    setImportRows([])
    setFileName('')
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDraft = async () => {
    if (importRows.length === 0) return
    setDrafting(true)
    setError(null)
    try {
      await authApi.post<DraftBatchResponse>('/labels/batches', {
        rows: importRows,
        fileName,
        testLabel: testMode,
      })
      handleReset()
      await loadBatches()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to draft batch')
    } finally {
      setDrafting(false)
    }
  }

  const handleExportCsv = async (batch: LabelBatch) => {
    setExportingBatchId(batch._id)
    setError(null)
    try {
      const items = await fetchBatchItems(batch._id)
      exportBatchItemsCsv(items, `${shortBatchId(batch._id)}-items.csv`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export CSV')
    } finally {
      setExportingBatchId(null)
    }
  }

  const handleCreateAndPrint = async (batch: LabelBatch) => {
    setCreatingBatchId(batch._id)
    setError(null)
    try {
      await authApi.post<CreateBatchLabelsResponse>(`/labels/batches/${batch._id}/create`)

      // Refresh the table and print every created label in the batch.
      await loadBatches()
      const items = await fetchBatchItems(batch._id)
      for (const item of items) {
        if (item.status === 'created') {
          await printLabelPdf(item._id)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create labels')
    } finally {
      setCreatingBatchId(null)
    }
  }

  const handleDeleteBatch = async (batch: LabelBatch) => {
    if (confirmDeleteId !== batch._id) {
      setConfirmDeleteId(batch._id)
      return
    }
    setDeletingBatchId(batch._id)
    setError(null)
    try {
      await authApi.delete(`/labels/batches/${batch._id}`)
      setConfirmDeleteId(null)
      await loadBatches()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete batch')
      setConfirmDeleteId(null)
    } finally {
      setDeletingBatchId(null)
    }
  }

  const canCreate = !!user?.canCreateLabels

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 cursor-pointer">×</button>
        </div>
      )}

      {!canCreate && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/15 px-4 py-3.5 text-sm text-amber-800 dark:text-amber-300">
          <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span>
            You have <span className="font-medium">view-only</span> access. Contact an admin to get label creation permission.
          </span>
        </div>
      )}

      {/* Step 1 — Import & draft (only shown to users with label creation permission) */}
      {canCreate && <section className="rounded-xl border border-slate-300/60 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 p-5">
        <div className="flex items-center gap-2 mb-1">
          <StepBadge n={1} />
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Import &amp; Draft</h2>
        </div>
        <p className="text-sm text-slate-500 dark:text-gray-400 mb-4">
          Upload a CSV with <span className="font-medium">PO#</span> and <span className="font-medium">Order#</span> columns, then draft the batch for review. Labels are only created when you choose to create &amp; print.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
            className="block text-sm text-slate-600 dark:text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700 file:cursor-pointer cursor-pointer"
          />
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-gray-700 bg-slate-100 dark:bg-gray-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-gray-200 hover:bg-slate-200/80 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
            Download template
          </button>

          {importRows.length > 0 && (
            <span className="text-sm text-slate-500 dark:text-gray-400">
              <span className="font-medium text-slate-700 dark:text-gray-200">{fileName}</span> — {importRows.length} row{importRows.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {importRows.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={handleDraft}
              disabled={drafting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {drafting && <Spinner />}
              {drafting ? 'Drafting…' : 'Draft for Review'}
            </button>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              Test mode (no charges)
            </label>
            <button
              onClick={handleReset}
              className="text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}
      </section>}

      {/* Batches table */}
      <section className="rounded-xl border border-slate-300/60 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-300/60 dark:border-gray-800">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <LabelsTableIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>Label Batches</span>
          </h3>
          <Link to="/settings" className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
              <path d="M43.65 25L29.9 0c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9 9 0 000 53h27.5z" fill="#00ac47"/>
              <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.9 10.9z" fill="#ea4335"/>
              <path d="M43.65 25L57.4 0H29.9z" fill="#00832d"/>
              <path d="M59.8 53H87.3L73.55 29.5H45.9l13.9 23.5z" fill="#2684fc"/>
              <path d="M45.9 29.5H73.55L57.4 0H43.65z" fill="#ffba00"/>
            </svg>
            Drive settings
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 dark:bg-gray-800/60 text-slate-500 dark:text-gray-400">
              <tr className="text-left">
                <Th><HeaderLabel icon={<IdIcon className="h-3.5 w-3.5" />} text="Batch ID" /></Th>
                <Th><HeaderLabel icon={<ClockIcon className="h-3.5 w-3.5" />} text="Created" /></Th>
                <Th><HeaderLabel icon={<UserIcon className="h-3.5 w-3.5" />} text="Uploaded by" /></Th>
                <Th><HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Status" /></Th>
                <Th><HeaderLabel icon={<EyeIcon className="h-3.5 w-3.5" />} text="Items" /></Th>
                <Th><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-gray-800 text-[13px]">
              {batchesLoading ? (
                <tr><Td className="text-slate-400" colSpan={6}>Loading…</Td></tr>
              ) : batches.length === 0 ? (
                <tr><Td className="text-slate-400" colSpan={6}>No batches yet. Upload a file and draft it for review.</Td></tr>
              ) : (
                batches.slice(batchPage * batchPageSize, (batchPage + 1) * batchPageSize).map((b) => (
                  <tr key={b._id}>
                    <Td compact className="font-medium text-slate-800 dark:text-gray-100">
                      <span className="inline-flex items-center gap-1.5">
                        <RowItemIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-gray-500" />
                        <span className="font-mono whitespace-nowrap">{shortBatchId(b._id)}</span>
                        {b.fileName && (
                          <span className="text-xs text-slate-400 dark:text-gray-500">· {b.fileName}</span>
                        )}
                      </span>
                    </Td>
                    <Td compact className="text-slate-500 dark:text-gray-400 whitespace-nowrap">{formatDateTime(b.createdAt)}</Td>
                    <Td compact className="text-slate-600 dark:text-gray-300">{b.createdBy || '—'}</Td>
                    <Td compact><BatchStatusBadge status={b.status} testLabel={b.testLabel} /></Td>
                    <Td compact>
                      <Link
                        to={`/create-label/batches/${b._id}`}
                        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                      >
                        <EyeIcon className="h-3.5 w-3.5" />
                        View items ({b.itemCount})
                      </Link>
                    </Td>
                    <Td compact>
                      <div className="flex items-center justify-end gap-2">
                        {canCreate && (
                          <CreatePrintButton
                            size="sm"
                            busy={creatingBatchId === b._id}
                            done={b.status === 'created'}
                            onClick={() => handleCreateAndPrint(b)}
                          />
                        )}
                        <ExportCsvButton
                          size="sm"
                          busy={exportingBatchId === b._id}
                          onClick={() => handleExportCsv(b)}
                        />
                        {user && b.createdBy === user.email && (
                          confirmDeleteId === b._id ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">Delete?</span>
                              <button
                                onClick={() => handleDeleteBatch(b)}
                                disabled={deletingBatchId === b._id}
                                className="rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60 transition-colors cursor-pointer"
                              >
                                {deletingBatchId === b._id ? '…' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <DeleteBatchButton
                              size="sm"
                              onClick={() => handleDeleteBatch(b)}
                            />
                          )
                        )}
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {!batchesLoading && batches.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-gray-800 px-5 py-3">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
              <span>Rows per page:</span>
              <select
                value={batchPageSize}
                onChange={(e) => { setBatchPageSize(Number(e.target.value)); setBatchPage(0) }}
                className="rounded border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-gray-400">
              <span>
                {batchPage * batchPageSize + 1}–{Math.min((batchPage + 1) * batchPageSize, batches.length)} of {batches.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setBatchPage((p) => Math.max(0, p - 1))}
                  disabled={batchPage === 0}
                  className="inline-flex items-center justify-center rounded border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  aria-label="Previous page"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button
                  onClick={() => setBatchPage((p) => p + 1)}
                  disabled={(batchPage + 1) * batchPageSize >= batches.length}
                  className="inline-flex items-center justify-center rounded border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  aria-label="Next page"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
