import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../lib/api'
import type {
  ImportRow,
  PreparedRow,
  CreateLabelResult,
  LabelRecord,
  LabelAddress,
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
              <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                <ReviewTableIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Review labels</span>
              </h3>
              <p className="text-sm text-slate-500 dark:text-gray-400">
                {validRows.length} ready · {prepared.length - validRows.length} with issues
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-gray-800/60 text-slate-500 dark:text-gray-400">
                <tr className="text-left">
                  <Th><HeaderLabel icon={<TagIcon className="h-3.5 w-3.5" />} text="PO#" /></Th>
                  <Th><HeaderLabel icon={<ClipboardIcon className="h-3.5 w-3.5" />} text="Order#" /></Th>
                  <Th><HeaderLabel icon={<UserIcon className="h-3.5 w-3.5" />} text="Customer" /></Th>
                  <Th><HeaderLabel icon={<StoreIcon className="h-3.5 w-3.5" />} text="Ship From" /></Th>
                  <Th><HeaderLabel icon={<PinIcon className="h-3.5 w-3.5" />} text="Ship To" /></Th>
                  <Th><HeaderLabel icon={<HomeIcon className="h-3.5 w-3.5" />} text="Property Type" /></Th>
                  <Th><HeaderLabel icon={<BoxIcon className="h-3.5 w-3.5" />} text="Package" /></Th>
                  <Th><HeaderLabel icon={<TruckIcon className="h-3.5 w-3.5" />} text="Service" /></Th>
                  <Th><HeaderLabel icon={<CalendarIcon className="h-3.5 w-3.5" />} text="Ship Date" /></Th>
                  <Th><HeaderLabel icon={<QtyIcon className="h-3.5 w-3.5" />} text="Qty" /></Th>
                  <Th><HeaderLabel icon={<ScaleIcon className="h-3.5 w-3.5" />} text="Weight" /></Th>
                  <Th><HeaderLabel icon={<RulerIcon className="h-3.5 w-3.5" />} text="Dimensions" /></Th>
                  <Th><HeaderLabel icon={<ShieldIcon className="h-3.5 w-3.5" />} text="Insurance" /></Th>
                  <Th><HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Status" /></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-gray-800">
                {prepared.map((r, i) => (
                  <tr key={`${r.poNumber}-${r.orderNumber}-${i}`} className={r.found ? '' : 'bg-red-50/60 dark:bg-red-900/10'}>
                    <Td className="font-medium text-slate-800 dark:text-gray-100">
                      <span className="inline-flex items-center gap-1.5">
                        <RowItemIcon className="h-3.5 w-3.5 text-slate-400 dark:text-gray-500" />
                        <span>{r.poNumber || '—'}</span>
                      </span>
                    </Td>
                    <Td>{r.orderNumber || '—'}</Td>
                    <Td>{r.customerName || '—'}</Td>
                    <Td className="min-w-[180px]"><AddressCell addr={r.shipFrom} /></Td>
                    <Td className="min-w-[180px]"><AddressCell addr={r.shipTo} /></Td>
                    <Td>{r.propertyType ? <PropertyBadge type={r.propertyType} /> : '—'}</Td>
                    <Td className="font-mono text-xs">{r.packageCode || '—'}</Td>
                    <Td className="font-mono text-xs">{r.serviceCode || '—'}</Td>
                    <Td>{r.shipDate || '—'}</Td>
                    <Td>{r.qty != null ? r.qty : '—'}</Td>
                    <Td>{formatWeight(r.weight)}</Td>
                    <Td className="text-xs">
                      {r.dimensions ? `${r.dimensions.length}×${r.dimensions.width}×${r.dimensions.height} ${r.dimensions.units}` : '—'}
                    </Td>
                    <Td className="text-xs capitalize">{r.insuranceProvider || '—'}</Td>
                    <Td>
                      {r.found ? (
                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 text-xs font-medium">
                          <SuccessIcon className="h-3.5 w-3.5" /> Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-xs" title={r.error}>
                          <ErrorIcon className="h-3.5 w-3.5" />
                          <span>{r.error || 'Not found'}</span>
                        </span>
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
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <LabelsTableIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>Labels</span>
          </h3>
          <Link to="/settings" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Drive settings</Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 dark:bg-gray-800/60 text-slate-500 dark:text-gray-400">
              <tr className="text-left">
                <Th><HeaderLabel icon={<TagIcon className="h-3.5 w-3.5" />} text="PO#" /></Th>
                <Th><HeaderLabel icon={<ClipboardIcon className="h-3.5 w-3.5" />} text="Order#" /></Th>
                <Th><HeaderLabel icon={<TrackingIcon className="h-3.5 w-3.5" />} text="Tracking" /></Th>
                <Th><HeaderLabel icon={<IdIcon className="h-3.5 w-3.5" />} text="Shipment ID" /></Th>
                <Th><HeaderLabel icon={<DollarIcon className="h-3.5 w-3.5" />} text="Cost" /></Th>
                <Th><HeaderLabel icon={<ShieldIcon className="h-3.5 w-3.5" />} text="Insurance" /></Th>
                <Th><HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Status" /></Th>
                <Th><HeaderLabel icon={<ClockIcon className="h-3.5 w-3.5" />} text="Created" /></Th>
                <Th><HeaderLabel icon={<DocumentIcon className="h-3.5 w-3.5" />} text="PDF" /></Th>
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
                    <Td className="font-medium text-slate-800 dark:text-gray-100">
                      <span className="inline-flex items-center gap-1.5">
                        <RowItemIcon className="h-3.5 w-3.5 text-slate-400 dark:text-gray-500" />
                        <span>{l.poNumber}</span>
                      </span>
                    </Td>
                    <Td>{l.orderNumber}</Td>
                    <Td className="font-mono text-xs">{l.trackingNumber || '—'}</Td>
                    <Td>{l.shipmentId ?? '—'}</Td>
                    <Td>{formatCurrency(l.shipmentCost)}</Td>
                    <Td>{formatCurrency(l.insuranceCost)}</Td>
                    <Td>
                      {l.status === 'created' ? (
                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 text-xs font-medium">
                          <SuccessIcon className="h-3.5 w-3.5" /> Created{l.testLabel ? ' (test)' : ''}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-xs" title={l.error}>
                          <ErrorIcon className="h-3.5 w-3.5" />
                          <span>Failed</span>
                        </span>
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

function HeaderLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-slate-400 dark:text-gray-500">{icon}</span>
      <span>{text}</span>
    </span>
  )
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
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
      <HomeIcon className="h-3 w-3" />
      <span>Residential</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400">
      <CommercialIcon className="h-3 w-3" />
      <span>Commercial</span>
    </span>
  )
}

function AddressCell({ addr }: { addr?: LabelAddress }) {
  if (!addr) return <span className="text-slate-400">—</span>
  const lines = [
    addr.name,
    addr.company,
    addr.street1,
    addr.street2,
    addr.street3,
    [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', '),
    addr.country,
    addr.phone,
  ].filter(Boolean) as string[]
  if (lines.length === 0) return <span className="text-slate-400">—</span>
  return (
    <div className="text-xs leading-snug space-y-0.5 text-slate-600 dark:text-gray-300">
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  )
}

function ReviewTableIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-7 9h8m-8 4h5" />
    </svg>
  )
}

function LabelsTableIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h10m-10 5h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  )
}

function RowItemIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V7a2 2 0 00-2-2h-3m-6 0H6a2 2 0 00-2 2v6m16 0v4a2 2 0 01-2 2h-3m-6 0H6a2 2 0 01-2-2v-4m16 0h-3m-10 0H4m13-8V4m0 4h-2m-6 12v-2m0 2H7m3-2h2" />
    </svg>
  )
}

function SuccessIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function ErrorIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function HomeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10l9-7 9 7v10a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V10z" />
    </svg>
  )
}

function CommercialIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M5 21V7a1 1 0 011-1h5a1 1 0 011 1v14m0 0h7V4a1 1 0 00-1-1h-5a1 1 0 00-1 1m-4 4h2m-2 4h2m6-6h2m-2 4h2" />
    </svg>
  )
}

function TagIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M3 11l8.59 8.59a2 2 0 002.82 0L21 13.01a2 2 0 000-2.83L12.41 1.6A2 2 0 0011 1H5a2 2 0 00-2 2v8a2 2 0 00.59 1.41z" />
    </svg>
  )
}

function ClipboardIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
    </svg>
  )
}

function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function StoreIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9l1.5-4.5A2 2 0 016.4 3h11.2a2 2 0 011.9 1.5L21 9m-1 0v10a2 2 0 01-2 2h-2V11H8v10H6a2 2 0 01-2-2V9m0 0h16" />
    </svg>
  )
}

function PinIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function BoxIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8 4-8-4m16 0l-8-4-8 4m16 0v10l-8 4m-8-14v10l8 4m0-10v10" />
    </svg>
  )
}

function TruckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17H6a2 2 0 01-2-2V7a2 2 0 012-2h8a2 2 0 012 2v2h2.5L21 12v3a2 2 0 01-2 2h-1m-9 0a2 2 0 104 0m-4 0a2 2 0 114 0m5 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
    </svg>
  )
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

function QtyIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h10M7 16h10M5 8h.01M5 12h.01M5 16h.01" />
    </svg>
  )
}

function ScaleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v3m0 0l6 10a3 3 0 11-6 0m0-10L6 16a3 3 0 11-6 0m12 5v-2m0 2h7m-7 0H5" />
    </svg>
  )
}

function RulerIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7l13 13m-10-3l-2 2m5-5l-2 2m5-5l-2 2m5-5l-2 2M15 4l5 5a2 2 0 010 2.828l-8.172 8.172a2 2 0 01-2.828 0l-5-5a2 2 0 010-2.828L12.172 4A2 2 0 0115 4z" />
    </svg>
  )
}

function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
    </svg>
  )
}

function StatusIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function TrackingIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 01.553-.894L9 2m0 18l6-3m-6 3V2m6 15l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 2" />
    </svg>
  )
}

function IdIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8M8 12h8M8 17h5M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  )
}

function DollarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m4-13a4 4 0 00-4-2 4 4 0 00-4 2c0 1.5 1 2.5 4 3s4 1.5 4 3a4 4 0 01-4 2 4 4 0 01-4-2" />
    </svg>
  )
}

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function DocumentIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6M8 3h7l5 5v13a1 1 0 01-1 1H8a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
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
