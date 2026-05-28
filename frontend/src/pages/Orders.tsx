import { useState, useEffect, useCallback, useRef } from 'react'
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

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${STATUS_COLORS[status]}`}
    >
      {ORDER_STATUS_LABELS[status]}
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

  const startItem = (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, pagination.total)

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
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Status
          </label>
          <select
            value={selectedStatus}
            onChange={(e) => handleStatusChange(e.target.value as OrderStatus | '')}
            className="text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
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
              type="search"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search order #, customer, ship-to"
              className="w-full text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg pl-9 pr-9 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
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

        {/* Table */}
        <div className="overflow-x-auto">
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
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    Order #
                  </th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    Order Date
                  </th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    Customer
                  </th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    Ship To
                  </th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    Property Type
                  </th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    Status
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    Items
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    Order Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
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
                  orders.map((order) => (
                    <tr
                      key={order._id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                        {order.orderNumber}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(order.orderDate)}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 max-w-[170px] truncate">
                        {order.shipTo?.name || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 max-w-[240px] truncate">
                        {order.shipTo
                          ? [
                              order.shipTo.street1,
                              order.shipTo.street2 || null,
                              order.shipTo.city,
                              order.shipTo.state,
                              order.shipTo.country,
                            ]
                              .filter(Boolean)
                              .join(', ') || '—'
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {order.shipTo?.residential == null ? (
                          <span className="text-gray-400 dark:text-gray-600">—</span>
                        ) : order.shipTo.residential ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                            Residential
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400">
                            Commercial
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <StatusBadge status={order.orderStatus} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {order.items?.length ?? 0}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-gray-900 dark:text-white whitespace-nowrap">
                        {formatCurrency(order.orderTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!initialLoading && !error && pagination.total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-2.5 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
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

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
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
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
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

              <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">
                Page {page} of {pagination.pages}
              </span>

              <button
                onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                disabled={page === pagination.pages}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
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
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
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
          </div>
        )}
      </div>
    </div>
  )
}
