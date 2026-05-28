import { Fragment, useState, useEffect, useCallback, useRef } from 'react'
import { authApi } from '../lib/api'
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../types/order'
import type {
  Order,
  OrderStatus,
  OrdersResponse,
  SyncResponse,
  SyncStatusResponse,
  SyncState,
} from '../types/order'

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500]
const POLL_INTERVAL_MS = 3000

const STATUS_COLORS: Record<OrderStatus, string> = {
  awaiting_payment:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  awaiting_shipment:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  pending_fulfillment:
    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  shipped:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  on_hold:
    'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  cancelled:
    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  rejected_fulfillment:
    'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return 'Never'
  return new Date(dateStr).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCurrency(amount?: number | null): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function getFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function getFirstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function formatWeightDetails(record: Record<string, unknown>): string {
  const weightObject = asRecord(record.weight)
  const nestedValue = getFirstNumber(weightObject, [
    'value',
    'amount',
    'weight',
    'oz',
    'ounces',
    'lb',
    'lbs',
    'pounds',
  ])
  const nestedUnit = getFirstString(weightObject, ['units', 'unit', 'uom', 'code'])

  if (nestedValue != null) {
    return nestedUnit ? `${nestedValue.toLocaleString()} ${nestedUnit}` : nestedValue.toLocaleString()
  }

  const topLevelValue = getFirstNumber(record, [
    'weight',
    'weightValue',
    'weightOz',
    'weightOunces',
    'weightLb',
    'weightPounds',
  ])
  const topLevelUnit = getFirstString(record, ['weightUnits', 'weightUnit'])

  if (topLevelValue != null) {
    return topLevelUnit
      ? `${topLevelValue.toLocaleString()} ${topLevelUnit}`
      : topLevelValue.toLocaleString()
  }

  if (typeof record.weight === 'string' && record.weight.trim() !== '') {
    return record.weight
  }

  return '—'
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${STATUS_COLORS[status]}`}
    >
      {ORDER_STATUS_LABELS[status]}
    </span>
  )
}

function HeaderLabel({
  label,
  iconPath,
  align = 'left',
}: {
  label: string
  iconPath: string
  align?: 'left' | 'right'
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${
        align === 'right' ? 'justify-end w-full' : ''
      }`}
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
      </svg>
      <span>{label}</span>
    </span>
  )
}

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="flex gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800"
        >
          <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-20" />
          <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-24" />
          <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-36 flex-1" />
          <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-28" />
          <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-24" />
          <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-14" />
          <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-16" />
        </div>
      ))}
    </div>
  )
}

function SyncProgressBar({ state }: { state: SyncState }) {
  const { progress } = state
  const pct =
    progress.total > 0 ? Math.round((progress.synced / progress.total) * 100) : 0

  return (
    <div className="mb-4 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-800 dark:text-blue-300">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Syncing orders from ShipStation…
        </div>
        <span className="text-sm text-blue-600 dark:text-blue-400">
          {progress.synced.toLocaleString()} / {progress.total > 0 ? progress.total.toLocaleString() : '?'}
        </span>
      </div>
      <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-1.5">
        <div
          className="bg-blue-600 dark:bg-blue-400 h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress.totalPages > 0 && (
        <p className="mt-1.5 text-xs text-blue-600 dark:text-blue-400">
          Page {progress.page} of {progress.totalPages} — table updates live as data arrives
        </p>
      )}
    </div>
  )
}

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set())
  const [initialLoading, setInitialLoading] = useState(true)
  const [tableRefreshing, setTableRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [syncState, setSyncState] = useState<SyncState | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncDone, setSyncDone] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)

  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | ''>('')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [pagination, setPagination] = useState({ total: 0, pages: 0 })

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSyncing = syncState?.running === true

  const fetchOrders = useCallback(
    async (silent = false) => {
      if (!silent) setInitialLoading(true)
      else setTableRefreshing(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        })
        if (selectedStatus) params.set('status', selectedStatus)
        if (debouncedSearch) params.set('search', debouncedSearch)

        const res = await authApi.get<OrdersResponse>(`/orders?${params.toString()}`)
        setOrders(res.data)
        setPagination({ total: res.pagination.total, pages: res.pagination.pages })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load orders')
      } finally {
        setInitialLoading(false)
        setTableRefreshing(false)
      }
    },
    [page, pageSize, selectedStatus, debouncedSearch]
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim())
    }, 350)

    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  const fetchSyncStatus = useCallback(async (): Promise<SyncState & { lastSyncedAt: string | null }> => {
    const res = await authApi.get<SyncStatusResponse>('/orders/sync-status')
    return res.data
  }, [])

  // Initial load: get orders + sync status together
  useEffect(() => {
    let cancelled = false

    const init = async () => {
      setInitialLoading(true)
      try {
        const [, status] = await Promise.all([fetchOrders(true), fetchSyncStatus()])
        if (!cancelled) {
          setSyncState(status)
          setLastSyncedAt(status.lastSyncedAt)
          if (status.running) startPolling()
        }
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    }

    init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-fetch orders when filters / page change (but not on initial mount — handled above)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    fetchOrders(true)
  }, [fetchOrders])

  function startPolling() {
    if (pollTimerRef.current) return

    pollTimerRef.current = setInterval(async () => {
      try {
        const [status] = await Promise.all([fetchSyncStatus(), fetchOrders(true)])

        setSyncState(status)
        setLastSyncedAt(status.lastSyncedAt)

        if (!status.running) {
          stopPolling()

          if (status.error) {
            setSyncError(status.error)
          } else if (status.result) {
            const { inserted, updated, fetched, isIncremental } = status.result
            const label = isIncremental ? 'Incremental sync' : 'Full sync'

            if (fetched === 0) {
              setSyncDone(`${label} complete — already up to date, no orders found in this window`)
            } else if (inserted === 0 && updated === 0) {
              setSyncDone(`${label} complete — ${fetched.toLocaleString()} orders checked, nothing changed`)
            } else {
              const parts: string[] = []
              if (inserted > 0) parts.push(`${inserted.toLocaleString()} new`)
              if (updated > 0) parts.push(`${updated.toLocaleString()} updated`)
              setSyncDone(`${label} complete — ${parts.join(', ')} (${fetched.toLocaleString()} checked)`)
            }
          }
        }
      } catch {
        // network hiccup — keep polling
      }
    }, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  useEffect(() => () => stopPolling(), [])

  const handleSync = async () => {
    setSyncError(null)
    setSyncDone(null)
    try {
      const res = await authApi.post<SyncResponse>('/orders/sync')
      setSyncState(res.data)
      startPolling()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to start sync')
    }
  }

  const handleStatusChange = (status: OrderStatus | '') => {
    setSelectedStatus(status)
    setPage(1)
  }

  const handleSearchChange = (value: string) => {
    setSearchInput(value)
  }

  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
    setPage(1)
  }

  const toggleOrderItems = (orderId: string) => {
    setExpandedOrderIds((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  const startItem = (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, pagination.total)
  const paginationButtonClass =
    'p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors'

  const renderPaginationArrows = () => (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setPage(1)}
        disabled={page === 1}
        className={paginationButtonClass}
        aria-label="First page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 19l-7-7 7-7M19 19l-7-7 7-7"
          />
        </svg>
      </button>
      <button
        onClick={() => setPage((p) => Math.max(1, p - 1))}
        disabled={page === 1}
        className={paginationButtonClass}
        aria-label="Previous page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>

      <span className="px-2.5 py-1 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
        Page {page} of {pagination.pages}
      </span>

      <button
        onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
        disabled={page === pagination.pages}
        className={paginationButtonClass}
        aria-label="Next page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>
      <button
        onClick={() => setPage(pagination.pages)}
        disabled={page === pagination.pages}
        className={paginationButtonClass}
        aria-label="Last page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 5l7 7-7 7M5 5l7 7-7 7"
          />
        </svg>
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">List of Orders</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Last synced:{' '}
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {formatDateTime(lastSyncedAt)}
            </span>
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed shadow-sm"
        >
          {isSyncing ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Syncing…
            </>
          ) : (
            <>
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Sync Orders
            </>
          )}
        </button>
      </div>

      {/* Sync progress bar */}
      {isSyncing && syncState && <SyncProgressBar state={syncState} />}

      {/* Sync success banner */}
      {syncDone && !isSyncing && (
        <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300">
          <svg
            className="h-4 w-4 mt-0.5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          {syncDone}
          <button
            onClick={() => setSyncDone(null)}
            className="ml-auto text-green-600 dark:text-green-400 hover:opacity-70 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Sync error banner */}
      {syncError && (
        <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
          <svg
            className="h-4 w-4 mt-0.5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {syncError}
          <button
            onClick={() => setSyncError(null)}
            className="ml-auto text-red-600 dark:text-red-400 hover:opacity-70 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Table card */}
      <div className="bg-slate-50 dark:bg-gray-900 rounded-xl border border-slate-300/70 dark:border-gray-800 shadow-sm">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Status
          </label>
          <select
            value={selectedStatus}
            onChange={(e) => handleStatusChange(e.target.value as OrderStatus | '')}
            className="text-sm border border-slate-300 dark:border-gray-700 bg-slate-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="">All Statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          <div className="relative min-w-[220px] flex-1 max-w-md">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 dark:text-gray-500">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z"
                />
              </svg>
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search order #, customer, ship-to"
              className="w-full text-sm border border-slate-300 dark:border-gray-700 bg-slate-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg pl-9 pr-9 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchInput && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
                aria-label="Clear search"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>

          <span className="ml-auto flex items-center gap-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            {tableRefreshing && (
              <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {pagination.total > 0 &&
              `${pagination.total.toLocaleString()} order${pagination.total !== 1 ? 's' : ''}`}
          </span>
        </div>

        {/* Top pagination */}
        {!initialLoading && !error && pagination.total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-2 border-b border-slate-200 dark:border-gray-800 bg-slate-100/70 dark:bg-gray-800/20">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="border border-slate-300 dark:border-gray-700 bg-slate-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="ml-1">
                {startItem}–{endItem} of {pagination.total.toLocaleString()}
              </span>
            </div>
            {renderPaginationArrows()}
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-22rem)]">
          {error ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
              <button
                onClick={() => fetchOrders()}
                className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Try again
              </button>
            </div>
          ) : (
            <table className="w-full text-[13px] border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-200/90 dark:bg-gray-800">
                  <th className="sticky top-0 z-20 bg-slate-200/90 dark:bg-gray-800 border-b border-slate-300 dark:border-gray-700 border-r border-slate-300/80 dark:border-r-gray-700/80 last:border-r-0 text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-gray-300 whitespace-nowrap">
                    <HeaderLabel
                      label="Order #"
                      iconPath="M9 12h6m-6 4h6m1-10H8m8 0V5a2 2 0 00-2-2H8a2 2 0 00-2 2v1m10 0a2 2 0 012 2v10a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2"
                    />
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-200/90 dark:bg-gray-800 border-b border-slate-300 dark:border-gray-700 border-r border-slate-300/80 dark:border-r-gray-700/80 last:border-r-0 text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-gray-300 whitespace-nowrap">
                    <HeaderLabel
                      label="Order Date"
                      iconPath="M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z"
                    />
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-200/90 dark:bg-gray-800 border-b border-slate-300 dark:border-gray-700 border-r border-slate-300/80 dark:border-r-gray-700/80 last:border-r-0 text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-gray-300 whitespace-nowrap">
                    <HeaderLabel
                      label="Customer"
                      iconPath="M16 14a4 4 0 10-8 0m8 0a4 4 0 018 0m-8 0H8m8 0v1a3 3 0 01-3 3H11a3 3 0 01-3-3v-1m6-6a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-200/90 dark:bg-gray-800 border-b border-slate-300 dark:border-gray-700 border-r border-slate-300/80 dark:border-r-gray-700/80 last:border-r-0 text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-gray-300 whitespace-nowrap">
                    <HeaderLabel
                      label="Ship To"
                      iconPath="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-200/90 dark:bg-gray-800 border-b border-slate-300 dark:border-gray-700 border-r border-slate-300/80 dark:border-r-gray-700/80 last:border-r-0 text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-gray-300 whitespace-nowrap">
                    <HeaderLabel
                      label="Property Type"
                      iconPath="M3 10l9-7 9 7v10a2 2 0 01-2 2h-4v-6H9v6H5a2 2 0 01-2-2V10z"
                    />
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-200/90 dark:bg-gray-800 border-b border-slate-300 dark:border-gray-700 border-r border-slate-300/80 dark:border-r-gray-700/80 last:border-r-0 text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-gray-300 whitespace-nowrap">
                    <HeaderLabel
                      label="Status"
                      iconPath="M9 12l2 2 4-4m5 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-200/90 dark:bg-gray-800 border-b border-slate-300 dark:border-gray-700 border-r border-slate-300/80 dark:border-r-gray-700/80 last:border-r-0 text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-gray-300 whitespace-nowrap">
                    <HeaderLabel
                      label="Items"
                      iconPath="M20 13V7a2 2 0 00-2-2h-3V3H9v2H6a2 2 0 00-2 2v6m16 0l-2 7H6l-2-7m16 0H4"
                      align="right"
                    />
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-200/90 dark:bg-gray-800 border-b border-slate-300 dark:border-gray-700 border-r border-slate-300/80 dark:border-r-gray-700/80 last:border-r-0 text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-gray-300 whitespace-nowrap">
                    <HeaderLabel
                      label="Order Total"
                      iconPath="M12 8c-1.657 0-3 .672-3 1.5S10.343 11 12 11s3 .672 3 1.5S13.657 14 12 14m0-8v2m0 6v2m9-4a9 9 0 11-18 0 9 9 0 0118 0z"
                      align="right"
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300 dark:divide-gray-800">
                {initialLoading ? (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <TableSkeleton />
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-14 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <svg
                          className="h-10 w-10 text-gray-300 dark:text-gray-700"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        <p className="text-gray-500 dark:text-gray-400">
                          {selectedStatus && debouncedSearch
                            ? `No orders match "${debouncedSearch}" with status "${ORDER_STATUS_LABELS[selectedStatus as OrderStatus]}".`
                            : selectedStatus
                            ? `No orders with status "${ORDER_STATUS_LABELS[selectedStatus as OrderStatus]}"`
                            : debouncedSearch
                            ? `No orders match "${debouncedSearch}".`
                            : isSyncing
                            ? 'Syncing orders — they will appear here shortly…'
                            : 'No orders found. Click "Sync Orders" to import from ShipStation.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  orders.map((order, rowIndex) => {
                    const itemCount = order.items?.length ?? 0
                    const isExpanded = expandedOrderIds.has(order._id)
                    const isEvenRow = rowIndex % 2 === 0
                    const rowStripedClass = isEvenRow
                      ? 'bg-slate-100/85 dark:bg-gray-900/40'
                      : 'bg-slate-200/65 dark:bg-gray-800/30'
                    const rowHighlightClass = isExpanded
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : rowStripedClass
                    const rowHoverClass = isExpanded
                      ? 'hover:bg-blue-100 dark:hover:bg-blue-900/30'
                      : 'hover:bg-slate-300/75 dark:hover:bg-gray-800/50'
                    const orderNumberText = order.orderNumber ? String(order.orderNumber) : '—'
                    const orderDateText = formatDate(order.orderDate)
                    const customerName = order.shipTo?.name || '—'
                    const shipToText = order.shipTo
                      ? [
                          order.shipTo.street1,
                          order.shipTo.street2 || null,
                          order.shipTo.city,
                          order.shipTo.state,
                          order.shipTo.country,
                        ]
                          .filter(Boolean)
                          .join(', ') || '—'
                      : '—'
                    const propertyTypeText =
                      order.shipTo?.residential == null
                        ? '—'
                        : order.shipTo.residential
                        ? 'Residential'
                        : 'Commercial'
                    const statusText = ORDER_STATUS_LABELS[order.orderStatus]
                    const itemCountText = itemCount.toLocaleString()
                    const orderTotalText = formatCurrency(order.orderTotal)

                    return (
                      <Fragment key={order._id}>
                        <tr className={`${rowHighlightClass} ${rowHoverClass} transition-colors`}>
                          <td
                            className="px-3 py-2.5 font-medium text-gray-900 dark:text-white whitespace-nowrap border-r border-slate-300/80 dark:border-gray-800 last:border-r-0"
                            title={orderNumberText}
                          >
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleOrderItems(order._id)}
                                className="inline-flex items-center justify-center text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                                aria-expanded={isExpanded}
                                aria-controls={`order-items-${order._id}`}
                                aria-label={`${isExpanded ? 'Hide' : 'Show'} items for order ${order.orderNumber}`}
                              >
                                <svg
                                  className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5l7 7-7 7"
                                  />
                                </svg>
                              </button>
                              <span>{orderNumberText}</span>
                            </div>
                          </td>
                          <td
                            className="px-3 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap border-r border-slate-300/80 dark:border-gray-800 last:border-r-0"
                            title={orderDateText}
                          >
                            {orderDateText}
                          </td>
                          <td
                            className="px-3 py-2.5 text-gray-600 dark:text-gray-400 max-w-[170px] truncate border-r border-slate-300/80 dark:border-gray-800 last:border-r-0"
                            title={customerName}
                          >
                            {customerName}
                          </td>
                          <td
                            className="px-3 py-2.5 text-gray-600 dark:text-gray-400 max-w-[240px] truncate border-r border-slate-300/80 dark:border-gray-800 last:border-r-0"
                            title={shipToText}
                          >
                            {shipToText}
                          </td>
                          <td
                            className="px-3 py-2.5 whitespace-nowrap border-r border-slate-300/80 dark:border-gray-800 last:border-r-0"
                            title={propertyTypeText}
                          >
                            {order.shipTo?.residential == null ? (
                              <span className="text-gray-400 dark:text-gray-600">—</span>
                            ) : order.shipTo.residential ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M3 10l9-7 9 7v10a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V10z"
                                  />
                                </svg>
                                <span>Residential</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400">
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M3 21h18M5 21V7a1 1 0 011-1h5a1 1 0 011 1v14m0 0h7V4a1 1 0 00-1-1h-5a1 1 0 00-1 1m-4 4h2m-2 4h2m6-6h2m-2 4h2"
                                  />
                                </svg>
                                <span>Commercial</span>
                              </span>
                            )}
                          </td>
                          <td
                            className="px-3 py-2.5 whitespace-nowrap border-r border-slate-300/80 dark:border-gray-800 last:border-r-0"
                            title={statusText}
                          >
                            <StatusBadge status={order.orderStatus} />
                          </td>
                          <td
                            className="px-3 py-2.5 text-right whitespace-nowrap text-gray-600 dark:text-gray-400 border-r border-slate-300/80 dark:border-gray-800 last:border-r-0"
                            title={itemCountText}
                          >
                            {itemCount}
                          </td>
                          <td
                            className="px-3 py-2.5 text-right font-medium text-gray-900 dark:text-white whitespace-nowrap border-r border-slate-300/80 dark:border-gray-800 last:border-r-0"
                            title={orderTotalText}
                          >
                            {orderTotalText}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr
                            id={`order-items-${order._id}`}
                            className="bg-blue-50/60 dark:bg-blue-900/10 border-t border-blue-100 dark:border-blue-800/40"
                          >
                            <td colSpan={8} className="px-4 py-3">
                              {itemCount > 0 ? (
                                <div className="max-h-56 overflow-y-auto overflow-x-auto rounded-md border border-slate-300/70 dark:border-gray-700 bg-slate-50/85 dark:bg-gray-900/60">
                                  <table className="w-full text-[10px] leading-tight whitespace-nowrap">
                                    <thead className="bg-slate-200/80 dark:bg-gray-800/80">
                                      <tr>
                                        <th className="text-left px-1.5 py-1 font-semibold text-gray-600 dark:text-gray-300">
                                          <HeaderLabel
                                            label="Img"
                                            iconPath="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-8-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                          />
                                        </th>
                                        <th className="text-left px-1.5 py-1 font-semibold text-gray-600 dark:text-gray-300">
                                          <HeaderLabel
                                            label="Title"
                                            iconPath="M4 6h16M4 10h16M4 14h10"
                                          />
                                        </th>
                                        <th className="text-left px-1.5 pl-20 py-1 font-semibold text-gray-600 dark:text-gray-300">
                                          <HeaderLabel
                                            label="SKU"
                                            iconPath="M20 7l-8 4-8-4m16 0l-8-4-8 4m16 0v10l-8 4m-8-4V7m8 4v10"
                                          />
                                        </th>
                                        <th className="text-left px-1.5 py-1 font-semibold text-gray-600 dark:text-gray-300">
                                          <HeaderLabel
                                            label="UPC"
                                            iconPath="M4 5v14M8 5v14M12 5v14M16 5v14M20 5v14"
                                          />
                                        </th>
                                        <th className="text-right pl-1.5 pr-20 py-1 font-semibold text-gray-600 dark:text-gray-300">
                                          <HeaderLabel
                                            label="Qty"
                                            iconPath="M7 8h10M7 12h10M7 16h10"
                                            align="right"
                                          />
                                        </th>
                                        <th className="text-left px-1.5 py-1 font-semibold text-gray-600 dark:text-gray-300">
                                          <HeaderLabel
                                            label="Weight"
                                            iconPath="M7 4h10l3 6v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8l3-6zm5 3v3"
                                          />
                                        </th>
                                        <th className="text-right px-1.5 py-1 font-semibold text-gray-600 dark:text-gray-300">
                                          <HeaderLabel
                                            label="Unit"
                                            iconPath="M12 8c-1.657 0-3 .448-3 1s1.343 1 3 1 3 .448 3 1-1.343 1-3 1-3 .448-3 1 1.343 1 3 1m0-8V6m0 9v1m8-4a8 8 0 11-16 0 8 8 0 0116 0z"
                                            align="right"
                                          />
                                        </th>
                                        <th className="text-right px-1.5 py-1 font-semibold text-gray-600 dark:text-gray-300">
                                          <HeaderLabel
                                            label="Tax"
                                            iconPath="M9 14l2 2 4-4m1-8H8a2 2 0 00-2 2v12l4-2 4 2 4-2 4 2V6a2 2 0 00-2-2h-4"
                                            align="right"
                                          />
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {order.items?.map((item, index) => {
                                        const itemRecord = asRecord(item)
                                        const sku =
                                          item.sku ??
                                          getFirstString(itemRecord, ['sku', 'SKU']) ??
                                          '—'
                                        const upc =
                                          getFirstString(itemRecord, [
                                            'upc',
                                            'upcCode',
                                            'upc_code',
                                            'UPC',
                                          ]) ?? '—'
                                        const quantity =
                                          item.quantity ??
                                          getFirstNumber(itemRecord, ['quantity', 'qty']) ??
                                          null
                                        const unitPrice =
                                          item.unitPrice ??
                                          getFirstNumber(itemRecord, [
                                            'unitPrice',
                                            'unit_price',
                                            'price',
                                          ]) ??
                                          null
                                        const taxAmount =
                                          getFirstNumber(itemRecord, [
                                            'taxAmount',
                                            'tax_amount',
                                            'tax',
                                          ]) ?? null
                                        const title =
                                          getFirstString(itemRecord, ['title', 'name', 'productName']) ??
                                          '—'
                                        const imageUrl =
                                          getFirstString(itemRecord, [
                                            'imageUrl',
                                            'imageURL',
                                            'image',
                                            'thumbnailUrl',
                                          ]) ?? null
                                        const weightDetails = formatWeightDetails(itemRecord)

                                        return (
                                          <tr
                                            key={
                                              item.orderItemId ??
                                              item.lineItemKey ??
                                              `${item.sku}-${item.name}-${index}`
                                            }
                                            className="border-t border-slate-300/70 dark:border-gray-800 first:border-t-0"
                                          >
                                            <td className="px-1.5 py-1 align-top">
                                              <div className="w-8 h-8 rounded border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 overflow-hidden">
                                                {imageUrl ? (
                                                  <img
                                                    src={imageUrl}
                                                    alt={title}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                  />
                                                ) : (
                                                  <div className="w-full h-full flex items-center justify-center text-[8px] text-gray-400 dark:text-gray-500">
                                                    —
                                                  </div>
                                                )}
                                              </div>
                                            </td>
                                            <td
                                              className="px-1.5 py-1 align-top text-gray-900 dark:text-gray-100 max-w-[12rem] truncate"
                                              title={title}
                                            >
                                              {title}
                                            </td>
                                            <td className="px-1.5 pl-20 py-1 align-top text-gray-700 dark:text-gray-300">
                                              {sku}
                                            </td>
                                            <td className="px-1.5 py-1 align-top text-gray-700 dark:text-gray-300">
                                              {upc}
                                            </td>
                                            <td className="pl-1.5 pr-20 py-1 align-top text-right text-gray-700 dark:text-gray-300">
                                              {quantity != null ? quantity.toLocaleString() : '—'}
                                            </td>
                                            <td className="px-1.5 py-1 align-top text-gray-700 dark:text-gray-300">
                                              {weightDetails}
                                            </td>
                                            <td className="px-1.5 py-1 align-top text-right text-gray-700 dark:text-gray-300">
                                              {formatCurrency(unitPrice)}
                                            </td>
                                            <td className="px-1.5 py-1 align-top text-right text-gray-700 dark:text-gray-300">
                                              {formatCurrency(taxAmount)}
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                  No items found for this order.
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!initialLoading && !error && pagination.total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-2.5 border-t border-slate-200 dark:border-gray-800">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="border border-slate-300 dark:border-gray-700 bg-slate-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="ml-1">
                {startItem}–{endItem} of {pagination.total.toLocaleString()}
              </span>
            </div>

            {renderPaginationArrows()}
          </div>
        )}
      </div>
    </div>
  )
}
