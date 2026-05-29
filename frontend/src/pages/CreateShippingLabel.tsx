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
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [drafting, setDrafting] = useState(false)
  const [testMode, setTestMode] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [batches, setBatches] = useState<LabelBatch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [creatingBatchId, setCreatingBatchId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadBatches = useCallback(async () => {
    try {
      const res = await authApi.get<BatchesListResponse>('/labels/batches?pageSize=100')
      setBatches(res.data)
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

      {/* Step 1 — Import & draft */}
      <section className="rounded-xl border border-slate-300/60 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 p-5">
        <div className="flex items-center gap-2 mb-1">
          <StepBadge n={1} />
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Import &amp; draft</h2>
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
      </section>

      {/* Batches table */}
      <section className="rounded-xl border border-slate-300/60 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-300/60 dark:border-gray-800">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <LabelsTableIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>Label batches</span>
          </h3>
          <Link to="/settings" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Drive settings</Link>
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
            <tbody className="divide-y divide-slate-200 dark:divide-gray-800">
              {batchesLoading ? (
                <tr><Td className="text-slate-400" colSpan={6}>Loading…</Td></tr>
              ) : batches.length === 0 ? (
                <tr><Td className="text-slate-400" colSpan={6}>No batches yet. Upload a file and draft it for review.</Td></tr>
              ) : (
                batches.map((b) => (
                  <tr key={b._id}>
                    <Td className="font-medium text-slate-800 dark:text-gray-100">
                      <span className="inline-flex items-center gap-1.5">
                        <RowItemIcon className="h-3.5 w-3.5 text-slate-400 dark:text-gray-500" />
                        <span className="font-mono">{shortBatchId(b._id)}</span>
                        {b.fileName && (
                          <span className="text-xs text-slate-400 dark:text-gray-500">· {b.fileName}</span>
                        )}
                      </span>
                    </Td>
                    <Td className="text-slate-500 dark:text-gray-400 whitespace-nowrap">{formatDateTime(b.createdAt)}</Td>
                    <Td className="text-slate-600 dark:text-gray-300">{b.createdBy || '—'}</Td>
                    <Td><BatchStatusBadge status={b.status} testLabel={b.testLabel} /></Td>
                    <Td>
                      <Link
                        to={`/create-label/batches/${b._id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                      >
                        <EyeIcon className="h-3.5 w-3.5" />
                        View items ({b.itemCount})
                      </Link>
                    </Td>
                    <Td>
                      <CreatePrintButton
                        busy={creatingBatchId === b._id}
                        done={b.status === 'created'}
                        onClick={() => handleCreateAndPrint(b)}
                      />
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
