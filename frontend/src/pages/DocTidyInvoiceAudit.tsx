import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authApi } from '../lib/api'
import {
  Banner,
  DocTidyTabs,
  DocumentTypeBadge,
  PaginationArrows,
  Th,
} from '../components/docTidy/docTidyUi'
import ParseJobPanel from '../components/docTidy/ParseJobPanel'
import { formatDate, formatDateTime } from '../lib/format'
import {
  INVOICE_AUDIT_COLUMNS,
  loadAuditColumnVisibility,
  saveAuditColumnVisibility,
  extractJsonField,
  extractJsonArray,
  type InvoiceAuditColumnId,
  type ParseJobListItem,
  type ParseJobsResponse,
} from '../types/docTidy'

/* ──────────────────────────────────── helpers ── */

/** Strip common currency prefixes/symbols for cleaner display. */
function formatTotal(raw: string): string {
  return raw.trim()
}

/* ──────────────────────────────── Column Settings Drawer ── */

function ColumnSettingsDrawer({
  visibility,
  onChange,
  onClose,
}: {
  visibility: Record<InvoiceAuditColumnId, boolean>
  onChange: (next: Record<InvoiceAuditColumnId, boolean>) => void
  onClose: () => void
}) {
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const toggle = (id: InvoiceAuditColumnId) => {
    onChange({ ...visibility, [id]: !visibility[id] })
  }

  const resetDefaults = () => {
    const defaults = Object.fromEntries(
      INVOICE_AUDIT_COLUMNS.map((c) => [c.id, c.defaultVisible])
    ) as Record<InvoiceAuditColumnId, boolean>
    onChange(defaults)
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />

      {/* Drawer — slides in from the right */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Column settings"
        className="relative ml-auto flex h-full w-full max-w-xs flex-col overflow-hidden border-l border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-100)]">Column visibility</h3>
            <p className="mt-0.5 text-xs text-[var(--text-200)]">
              Toggle which fields are shown in the table.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
            Default visible
          </p>
          <ul className="space-y-1">
            {INVOICE_AUDIT_COLUMNS.filter((c) => c.defaultVisible).map((col) => (
              <li key={col.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-[var(--bg-200)]">
                  <input
                    type="checkbox"
                    checked={visibility[col.id]}
                    onChange={() => toggle(col.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-[var(--accent-200)]"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-100)]">{col.label}</p>
                    <p className="text-[11px] text-[var(--text-200)]">{col.description}</p>
                  </div>
                </label>
              </li>
            ))}
          </ul>

          <p className="mb-3 mt-5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
            Hidden by default
          </p>
          <ul className="space-y-1">
            {INVOICE_AUDIT_COLUMNS.filter((c) => !c.defaultVisible).map((col) => (
              <li key={col.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-[var(--bg-200)]">
                  <input
                    type="checkbox"
                    checked={visibility[col.id]}
                    onChange={() => toggle(col.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-[var(--accent-200)]"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-100)]">{col.label}</p>
                    <p className="text-[11px] text-[var(--text-200)]">{col.description}</p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--bg-300)] bg-[var(--bg-200)] px-5 py-3">
          <button
            type="button"
            onClick={resetDefaults}
            className="cursor-pointer text-xs text-[var(--text-200)] hover:text-[var(--accent-200)] hover:underline"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────── Line items expansion ── */

function LineItemsExpansion({ items }: { items: Record<string, unknown>[] }) {
  if (items.length === 0) {
    return <p className="py-2 text-xs italic text-[var(--text-200)]">No line items extracted.</p>
  }

  return (
    <ul className="divide-y divide-[var(--bg-300)]">
      {items.map((item, idx) => {
        const desc =
          extractJsonField(item, 'description', 'name', 'product', 'item', 'sku', 'part_number', 'part_no') ||
          `Item ${idx + 1}`
        const sku = extractJsonField(item, 'sku', 'part_number', 'part_no', 'item_code', 'product_code')
        const qty = extractJsonField(item, 'quantity', 'qty', 'amount')
        const unitPrice = extractJsonField(item, 'unit_price', 'price', 'rate', 'cost', 'unit_cost')
        const total = extractJsonField(item, 'total', 'line_total', 'subtotal', 'amount', 'extended_price')
        const uom = extractJsonField(item, 'uom', 'unit', 'unit_of_measure')

        return (
          <li key={idx} className="flex flex-wrap items-start gap-x-4 gap-y-0.5 py-2 text-[11px]">
            <div className="min-w-0 flex-1">
              <span className="font-medium text-[var(--text-100)]">{desc}</span>
              {sku && sku !== desc && (
                <span className="ml-2 font-mono text-[var(--text-200)]">{sku}</span>
              )}
            </div>
            <div className="flex shrink-0 gap-3 text-[var(--text-200)]">
              {qty && <span>Qty: <span className="font-medium text-[var(--text-100)]">{qty}{uom ? ` ${uom}` : ''}</span></span>}
              {unitPrice && <span>Unit: <span className="font-medium text-[var(--text-100)]">{unitPrice}</span></span>}
              {total && <span>Total: <span className="font-semibold text-[var(--text-100)]">{total}</span></span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ──────────────────────────────────── Page ── */

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500]

export default function DocTidyInvoiceAudit() {
  const [jobs, setJobs] = useState<ParseJobListItem[]>([])
  const [pagination, setPagination] = useState({ total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [vendorSearch, setVendorSearch] = useState('')
  const [debouncedVendor, setDebouncedVendor] = useState('')

  // Expanded line-item rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Column visibility
  const [colVisibility, setColVisibility] = useState<Record<InvoiceAuditColumnId, boolean>>(
    loadAuditColumnVisibility
  )
  const [showColSettings, setShowColSettings] = useState(false)

  // Parse panel
  const [openJobId, setOpenJobId] = useState<string | null>(null)

  // Debounce vendor search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedVendor(vendorSearch.trim()), 350)
    return () => clearTimeout(timer)
  }, [vendorSearch])

  // Reset page on filter change
  useEffect(() => {
    setPage(1)
  }, [debouncedVendor, pageSize])

  const fetchJobs = useCallback(
    async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          status: 'completed',
          page: String(page),
          pageSize: String(pageSize),
        })
        if (debouncedVendor) params.set('vendorName', debouncedVendor)

        const res = await authApi.get<ParseJobsResponse>(`/doc-tidy/parse-jobs?${params.toString()}`)
        setJobs(res.data)
        setPagination({ total: res.pagination.total, pages: Math.max(1, res.pagination.pages) })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invoice audit data')
      } finally {
        setLoading(false)
      }
    },
    [page, pageSize, debouncedVendor]
  )

  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      fetchJobs()
      return
    }
    fetchJobs()
  }, [fetchJobs])

  const handleColVisChange = (next: Record<InvoiceAuditColumnId, boolean>) => {
    setColVisibility(next)
    saveAuditColumnVisibility(next)
  }

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleCols = useMemo(
    () => INVOICE_AUDIT_COLUMNS.filter((c) => colVisibility[c.id]),
    [colVisibility]
  )

  const startItem = pagination.total === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, pagination.total)

  const inputClass =
    'text-[11px] border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]'

  return (
    <div className="space-y-4">
      {/* ── Tab bar ── */}
      <div className="flex items-end justify-between border-b border-[var(--bg-300)]">
        <DocTidyTabs />
      </div>

      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {/* ── Table card ── */}
      <div className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-md">

        {/* ── Filter / toolbar bar ── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/40 px-4 py-2.5">
          {/* Vendor search */}
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--text-200)]">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" />
              </svg>
            </span>
            <input
              type="text"
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              placeholder="Filter by vendor…"
              className={`${inputClass} w-full pl-8 pr-8`}
            />
            {vendorSearch && (
              <button
                onClick={() => setVendorSearch('')}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-200)] hover:text-[var(--text-100)] cursor-pointer"
                aria-label="Clear search"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Summary */}
          <span className="text-[11px] text-[var(--text-200)]">
            {pagination.total > 0 ? `${pagination.total.toLocaleString()} document${pagination.total === 1 ? '' : 's'}` : ''}
          </span>

          {/* Column settings button */}
          <button
            type="button"
            onClick={() => setShowColSettings(true)}
            title="Configure visible columns"
            className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--bg-300)] px-2.5 py-1.5 text-[11px] text-[var(--text-200)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Columns
            <span className="rounded-full bg-[var(--bg-300)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-200)]">
              {visibleCols.length}
            </span>
          </button>
        </div>

        {/* ── Top pagination ── */}
        {!loading && !error && pagination.total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-2 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/60">
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-200)]">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] cursor-pointer"
              >
                {PAGE_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span>{startItem}–{endItem} of {pagination.total.toLocaleString()}</span>
            </div>
            <PaginationArrows page={page} pages={pagination.pages} onChange={setPage} />
          </div>
        )}

        {/* ── Table ── */}
        <div className="relative overflow-x-auto overflow-y-auto max-h-[calc(100vh-22rem)]">
          {error ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-900/20">
                <svg className="h-5 w-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-100)]">Failed to load data</p>
                <p className="mt-0.5 text-xs text-[var(--text-200)]">{error}</p>
              </div>
              <button onClick={() => fetchJobs()} className="text-sm text-[var(--accent-200)] hover:underline cursor-pointer">
                Try again
              </button>
            </div>
          ) : (
            <table className="w-full text-[11px] border-separate border-spacing-0">
              <thead>
                <tr>
                  {visibleCols.map((col) => (
                    <Th
                      key={col.id}
                      label={col.label}
                    />
                  ))}
                  {/* Actions col */}
                  <Th label="Actions" align="center" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {visibleCols.map((col) => (
                        <td key={col.id} className="px-3 py-2">
                          <div className="h-3 w-20 animate-pulse rounded bg-[var(--bg-300)]" />
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <div className="mx-auto h-6 w-6 animate-pulse rounded bg-[var(--bg-300)]" />
                      </td>
                    </tr>
                  ))
                ) : jobs.length === 0 ? (
                  <tr>
                    <td colSpan={visibleCols.length + 1} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-200)]">
                          <svg className="h-6 w-6 text-[var(--text-200)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-[var(--text-100)]">
                            {debouncedVendor ? 'No documents match this vendor filter' : 'No parsed documents yet'}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[var(--text-200)]">
                            {debouncedVendor
                              ? 'Try clearing the filter above.'
                              : 'Parse PDFs from the Email Records tab to see them here.'}
                          </p>
                        </div>
                        {debouncedVendor && (
                          <button onClick={() => setVendorSearch('')} className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer">
                            Clear filter
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  jobs.flatMap((job) => {
                    const json = job.jsonOutput ?? null
                    const isExpanded = expandedRows.has(job._id)

                    const lineItems = extractJsonArray(
                      json,
                      'line_items', 'items', 'products', 'line items', 'lineItems', 'order_items', 'orderItems'
                    )

                    const cellFor = (colId: InvoiceAuditColumnId): React.ReactNode => {
                      switch (colId) {
                        case 'vendorName':
                          return (
                            <span className="font-medium text-[var(--text-100)]">
                              {job.vendorName ||
                                extractJsonField(json, 'vendor_name', 'vendor', 'supplier', 'company', 'from') ||
                                <span className="italic text-[var(--text-200)]">—</span>}
                            </span>
                          )
                        case 'documentType': {
                          const rawType = extractJsonField(json, 'document_type', 'type', 'doc_type')
                          // Try to map to our known types
                          const normalized = rawType.toLowerCase().replace(/[\s_-]+/g, '_')
                          if (normalized.includes('invoice')) {
                            return <DocumentTypeBadge value="invoice" />
                          }
                          if (normalized.includes('order') || normalized.includes('confirmation') || normalized.includes('po')) {
                            return <DocumentTypeBadge value="order_confirmation" />
                          }
                          if (rawType) {
                            return <span className="text-[var(--text-200)]">{rawType}</span>
                          }
                          return <DocumentTypeBadge value={undefined} />
                        }
                        case 'invoiceNumber':
                          return cell(extractJsonField(json, 'invoice_number', 'invoice_no', 'invoice_num', 'inv_number', 'inv_no', 'invoice#', 'invoice'))
                        case 'poNumber':
                          return cell(extractJsonField(json, 'po_number', 'purchase_order_number', 'po_no', 'po', 'purchase_order', 'order_number', 'order_no'))
                        case 'orderDate':
                          return cell(extractJsonField(json, 'order_date', 'date_of_order', 'order date'))
                        case 'invoiceDate':
                          return cell(extractJsonField(json, 'invoice_date', 'date', 'billing_date', 'bill_date', 'invoice date'))
                        case 'terms':
                          return cell(extractJsonField(json, 'payment_terms', 'terms', 'net_terms', 'payment terms'))
                        case 'trackingNumber':
                          return cell(extractJsonField(json, 'tracking_number', 'tracking', 'tracking_no', 'shipment_tracking', 'tracking number'))
                        case 'totalValue':
                          return (
                            <span className="font-semibold tabular-nums text-[var(--text-100)]">
                              {formatTotal(extractJsonField(json, 'total', 'grand_total', 'total_amount', 'total_cost', 'total_value', 'invoice_total', 'amount_due', 'balance_due')) || <span className="font-normal text-[var(--text-200)]">—</span>}
                            </span>
                          )
                        case 'lineItems':
                          if (lineItems.length === 0) {
                            return <span className="italic text-[var(--text-200)]">—</span>
                          }
                          return (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleRow(job._id) }}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-200)] hover:opacity-80"
                            >
                              <svg className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                              {lineItems.length} item{lineItems.length === 1 ? '' : 's'}
                            </button>
                          )
                        case 'filename':
                          return (
                            <span className="font-mono text-[var(--text-200)] truncate max-w-[160px] block" title={job.filename}>
                              {job.filename}
                            </span>
                          )
                        case 'parsedAt':
                          return (
                            <span className="text-[var(--text-200)]" title={job.completedAt ? formatDateTime(job.completedAt) : ''}>
                              {job.completedAt ? formatDate(job.completedAt) : '—'}
                            </span>
                          )
                        case 'requestedBy':
                          return <span className="text-[var(--text-200)]">{job.requestedByName || '—'}</span>
                        default:
                          return null
                      }
                    }

                    const rows: React.ReactNode[] = [
                      <tr
                        key={job._id}
                        className="group align-middle odd:bg-[var(--bg-100)] even:bg-[var(--bg-200)] hover:bg-[var(--primary-100)]/50 transition-colors"
                      >
                        {visibleCols.map((col) => (
                          <td key={col.id} className="px-3 py-1.5 text-[11px]">
                            {cellFor(col.id)}
                          </td>
                        ))}
                        {/* Actions */}
                        <td className="px-3 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => setOpenJobId(job._id)}
                            title="Open parsed document details"
                            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--text-200)] transition-colors hover:bg-[var(--primary-100)] hover:text-[var(--accent-200)]"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                        </td>
                      </tr>,
                    ]

                    // Inline line-item expansion
                    if (isExpanded && lineItems.length > 0) {
                      rows.push(
                        <tr key={`${job._id}-items`}>
                          <td
                            colSpan={visibleCols.length + 1}
                            className="border-t border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-6 pb-3 pt-2"
                          >
                            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
                              Line items — {job.filename}
                            </p>
                            <LineItemsExpansion items={lineItems} />
                          </td>
                        </tr>
                      )
                    }

                    return rows
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Bottom pagination ── */}
        {!loading && !error && pagination.total > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--bg-300)] bg-[var(--bg-200)]/60">
            <span className="text-[11px] text-[var(--text-200)]">
              {startItem}–{endItem} of {pagination.total.toLocaleString()}
            </span>
            <PaginationArrows page={page} pages={pagination.pages} onChange={setPage} />
          </div>
        )}
      </div>

      {/* ── Parse job panel ── */}
      {openJobId && (
        <ParseJobPanel
          jobId={openJobId}
          onClose={() => setOpenJobId(null)}
          onChanged={() => void fetchJobs()}
        />
      )}

      {/* ── Column settings drawer ── */}
      {showColSettings && (
        <ColumnSettingsDrawer
          visibility={colVisibility}
          onChange={handleColVisChange}
          onClose={() => setShowColSettings(false)}
        />
      )}
    </div>
  )
}

/** Render a plain scalar cell, or a dash if empty. */
function cell(value: string): React.ReactNode {
  return value
    ? <span className="text-[var(--text-100)]">{value}</span>
    : <span className="text-[var(--text-200)]">—</span>
}
