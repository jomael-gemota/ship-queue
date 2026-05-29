import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../lib/api'
import type {
  ImportRow,
  PreparedRow,
  CreateLabelResult,
  LabelRecord,
  PrepareResponse,
  CreateLabelsResponse,
  LabelsListResponse,
} from '../types/label'

const TOKEN_KEY = 'sq_token'

function formatCurrency(amount?: number | null): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatWeight(w?: { value?: number; units?: string }): string {
  if (!w?.value) return '—'
  return `${w.value} ${w.units || ''}`.trim()
}

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
  const [prepared, setPrepared] = useState<PreparedRow[]>([])
  const [preparing, setPreparing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [testMode, setTestMode] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createResults, setCreateResults] = useState<CreateLabelResult[]>([])

  const [labels, setLabels] = useState<LabelRecord[]>([])
  const [labelsLoading, setLabelsLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadLabels = useCallback(async () => {
    try {
      const res = await authApi.get<LabelsListResponse>('/labels?pageSize=100')
      setLabels(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load labels')
    } finally {
      setLabelsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLabels()
  }, [loadLabels])

  const handleFile = (file: File) => {
    setError(null)
    setPrepared([])
    setCreateResults([])
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

  const handlePrepare = async () => {
    if (importRows.length === 0) return
    setPreparing(true)
    setError(null)
    setCreateResults([])
    try {
      const res = await authApi.post<PrepareResponse>('/labels/prepare', { rows: importRows })
      setPrepared(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to prepare labels')
    } finally {
      setPreparing(false)
    }
  }

  const validRows = prepared.filter((r) => r.found)

  const handleCreate = async () => {
    if (validRows.length === 0) return
    setCreating(true)
    setError(null)
    try {
      const rows: ImportRow[] = validRows.map((r) => ({
        poNumber: r.poNumber,
        orderNumber: r.orderNumber,
      }))
      const res = await authApi.post<CreateLabelsResponse>('/labels/create', {
        rows,
        testLabel: testMode,
      })
      setCreateResults(res.data)
      await loadLabels()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create labels')
    } finally {
      setCreating(false)
    }
  }

  const handleReset = () => {
    setImportRows([])
    setPrepared([])
    setCreateResults([])
    setFileName('')
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDownloadPdf = async (label: LabelRecord) => {
    setDownloadingId(label._id)
    try {
      const token = localStorage.getItem(TOKEN_KEY)
      const res = await fetch(`/api/labels/${label._id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('PDF not available')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${label.poNumber}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to download PDF')
    } finally {
      setDownloadingId(null)
    }
  }

  const createdCount = createResults.filter((r) => r.status === 'created').length
  const failedCount = createResults.filter((r) => r.status === 'failed').length

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

      {/* Step 1 — Import */}
      <section className="rounded-xl border border-slate-300/60 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 p-5">
        <div className="flex items-center gap-2 mb-1">
          <StepBadge n={1} />
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Import &amp; review</h2>
        </div>
        <p className="text-sm text-slate-500 dark:text-gray-400 mb-4">
          Upload a CSV with <span className="font-medium">PO#</span> and <span className="font-medium">Order#</span> columns. The system pulls each order's shipping details for review.
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
              onClick={handlePrepare}
              disabled={preparing}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {preparing && <Spinner />}
              {preparing ? 'Processing…' : 'Process & review'}
            </button>
            <button
              onClick={handleReset}
              className="text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}
      </section>

      {/* Review table */}
      {prepared.length > 0 && (
        <section className="rounded-xl border border-slate-300/60 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-300/60 dark:border-gray-800">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Review labels</h3>
              <p className="text-sm text-slate-500 dark:text-gray-400">
                {validRows.length} ready · {prepared.length - validRows.length} with issues
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-gray-800/60 text-slate-500 dark:text-gray-400">
                <tr className="text-left">
                  <Th>PO#</Th>
                  <Th>Order#</Th>
                  <Th>Customer</Th>
                  <Th>Ship To</Th>
                  <Th>Type</Th>
                  <Th>Service</Th>
                  <Th>Ship Date</Th>
                  <Th>Weight</Th>
                  <Th>Dimensions</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-gray-800">
                {prepared.map((r, i) => (
                  <tr key={`${r.poNumber}-${r.orderNumber}-${i}`} className={r.found ? '' : 'bg-red-50/60 dark:bg-red-900/10'}>
                    <Td className="font-medium text-slate-800 dark:text-gray-100">{r.poNumber || '—'}</Td>
                    <Td>{r.orderNumber || '—'}</Td>
                    <Td>{r.customerName || '—'}</Td>
                    <Td className="max-w-[200px] truncate">{r.shipToSummary || '—'}</Td>
                    <Td>{r.propertyType ? <PropertyBadge type={r.propertyType} /> : '—'}</Td>
                    <Td className="font-mono text-xs">{r.serviceCode || '—'}</Td>
                    <Td>{r.shipDate || '—'}</Td>
                    <Td>{formatWeight(r.weight)}</Td>
                    <Td className="text-xs">
                      {r.dimensions ? `${r.dimensions.length}×${r.dimensions.width}×${r.dimensions.height} ${r.dimensions.units}` : '—'}
                    </Td>
                    <Td>
                      {r.found ? (
                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 text-xs font-medium">
                          <Dot className="bg-green-500" /> Ready
                        </span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400 text-xs" title={r.error}>{r.error || 'Not found'}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Step 2 — Create */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-slate-300/60 dark:border-gray-800">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <StepBadge n={2} />
                <span className="text-sm font-medium text-slate-700 dark:text-gray-200">Create the labels</span>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-gray-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={testMode}
                  onChange={(e) => setTestMode(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                Test mode (no charges)
              </label>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || validRows.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {creating && <Spinner />}
              {creating ? 'Creating labels…' : `Create ${validRows.length} label${validRows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </section>
      )}

      {/* Create results summary */}
      {createResults.length > 0 && (
        <section className="rounded-xl border border-slate-300/60 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 p-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">Result</h3>
          <p className="text-sm text-slate-600 dark:text-gray-300 mb-3">
            <span className="font-medium text-emerald-600 dark:text-emerald-400">{createdCount} created</span>
            {failedCount > 0 && <> · <span className="font-medium text-red-600 dark:text-red-400">{failedCount} failed</span></>}
          </p>
          <ul className="space-y-1.5 text-sm">
            {createResults.map((r) => (
              <li key={r.labelId} className="flex flex-wrap items-center gap-2">
                {r.status === 'created' ? <Dot className="bg-emerald-500" /> : <Dot className="bg-red-500" />}
                <span className="font-medium text-slate-700 dark:text-gray-200">{r.poNumber}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500 dark:text-gray-400">Order {r.orderNumber}</span>
                {r.status === 'created' ? (
                  <>
                    {r.trackingNumber && <span className="text-slate-500 dark:text-gray-400">· {r.trackingNumber}</span>}
                    {r.driveError ? (
                      <span className="text-amber-600 dark:text-amber-400">· Drive: {r.driveError}</span>
                    ) : r.driveFileLink ? (
                      <a href={r.driveFileLink} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">· View in Drive</a>
                    ) : null}
                  </>
                ) : (
                  <span className="text-red-600 dark:text-red-400">· {r.error}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Labels table */}
      <section className="rounded-xl border border-slate-300/60 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-300/60 dark:border-gray-800">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Labels</h3>
          <Link to="/settings" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Drive settings</Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 dark:bg-gray-800/60 text-slate-500 dark:text-gray-400">
              <tr className="text-left">
                <Th>PO#</Th>
                <Th>Order#</Th>
                <Th>Tracking</Th>
                <Th>Shipment ID</Th>
                <Th>Cost</Th>
                <Th>Insurance</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>PDF</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-gray-800">
              {labelsLoading ? (
                <tr><Td className="text-slate-400" colSpan={9}>Loading…</Td></tr>
              ) : labels.length === 0 ? (
                <tr><Td className="text-slate-400" colSpan={9}>No labels created yet.</Td></tr>
              ) : (
                labels.map((l) => (
                  <tr key={l._id}>
                    <Td className="font-medium text-slate-800 dark:text-gray-100">{l.poNumber}</Td>
                    <Td>{l.orderNumber}</Td>
                    <Td className="font-mono text-xs">{l.trackingNumber || '—'}</Td>
                    <Td>{l.shipmentId ?? '—'}</Td>
                    <Td>{formatCurrency(l.shipmentCost)}</Td>
                    <Td>{formatCurrency(l.insuranceCost)}</Td>
                    <Td>
                      {l.status === 'created' ? (
                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 text-xs font-medium"><Dot className="bg-green-500" /> Created{l.testLabel ? ' (test)' : ''}</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400 text-xs" title={l.error}>Failed</span>
                      )}
                    </Td>
                    <Td className="text-slate-500 dark:text-gray-400">{formatDateTime(l.createdAt)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        {l.status === 'created' && (
                          <button
                            onClick={() => handleDownloadPdf(l)}
                            disabled={downloadingId === l._id}
                            className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            {downloadingId === l._id ? '…' : 'Download'}
                          </button>
                        )}
                        {l.driveFileLink && (
                          <a href={l.driveFileLink} target="_blank" rel="noreferrer" className="text-slate-500 dark:text-gray-400 hover:underline">Drive</a>
                        )}
                      </div>
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-medium whitespace-nowrap text-xs uppercase tracking-wide">{children}</th>
}

function Td({ children, className = '', colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={`px-4 py-3 text-slate-600 dark:text-gray-300 ${className}`}>{children}</td>
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{n}</span>
  )
}

function Dot({ className }: { className: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${className}`} />
}

function PropertyBadge({ type }: { type: 'residential' | 'commercial' }) {
  return type === 'residential' ? (
    <span className="rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 px-2 py-0.5 text-xs font-medium">Residential</span>
  ) : (
    <span className="rounded-full bg-slate-200 text-slate-700 dark:bg-gray-700 dark:text-gray-200 px-2 py-0.5 text-xs font-medium">Commercial</span>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}
