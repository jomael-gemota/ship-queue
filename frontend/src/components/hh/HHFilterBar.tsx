import {
  HH_CART_STATUSES,
  HH_CART_STATUS_LABELS,
  HH_DETAILS_STATUSES,
  HH_DETAILS_STATUS_LABELS,
} from '../../lib/hhSportswear'
import type { HHCartStatus, HHDetailsStatus } from '../../lib/hhSportswear'
import { useHHList } from '../../context/HHListContext'
import { HHScSyncStatus } from './HHScSyncStatus'

const SEARCH_PLACEHOLDERS = {
  list: 'Search order ID, SKU, PO, reference, customer, notes…',
  orders: 'Search order ID, SKU, PO, reference, customer, notes…',
  items: 'Search title, SKU, ASIN…',
  config: '',
} as const

const COUNT_NOUNS = {
  list: ['group', 'groups'],
  orders: ['order', 'orders'],
  items: ['item', 'items'],
  config: ['setting', 'settings'],
} as const

const selectClass =
  'cursor-pointer rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]'

export function HHFilterBar() {
  const {
    level,
    selectedDetailsStatus,
    selectedCartStatus,
    searchInput,
    total,
    hasActiveFilters,
    handleDetailsStatusChange,
    handleCartStatusChange,
    handleSearchChange,
    handleClearFilters,
  } = useHHList()
  const showStatus = level !== 'items'
  const [singular, plural] = COUNT_NOUNS[level]

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--bg-300)] px-4 py-2.5 dark:border-[var(--bg-300)]">
      {showStatus && (
        <>
          <label className="text-sm font-medium text-gray-700 dark:text-[var(--text-200)]" htmlFor="hh-details-filter">
            Details
          </label>
          <select
            id="hh-details-filter"
            value={selectedDetailsStatus}
            onChange={(event) => handleDetailsStatusChange(event.target.value as HHDetailsStatus | '')}
            className={selectClass}
          >
            <option value="">All details</option>
            {HH_DETAILS_STATUSES.map((status) => (
              <option key={status} value={status}>
                {HH_DETAILS_STATUS_LABELS[status]}
              </option>
            ))}
          </select>

          <label className="text-sm font-medium text-gray-700 dark:text-[var(--text-200)]" htmlFor="hh-cart-filter">
            Cart
          </label>
          <select
            id="hh-cart-filter"
            value={selectedCartStatus}
            onChange={(event) => handleCartStatusChange(event.target.value as HHCartStatus | '')}
            className={selectClass}
          >
            <option value="">All carts</option>
            {HH_CART_STATUSES.map((status) => (
              <option key={status} value={status}>
                {HH_CART_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </>
      )}

      <div className="relative min-w-[220px] max-w-md flex-1">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 dark:text-[var(--text-200)]">
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
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder={SEARCH_PLACEHOLDERS[level]}
          className="w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] py-1.5 pl-9 pr-9 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => handleSearchChange('')}
            className="absolute inset-y-0 right-0 flex cursor-pointer items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-[var(--text-100)]"
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

      <div className="ml-auto flex flex-wrap items-center gap-3">
        <HHScSyncStatus />
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="cursor-pointer text-xs font-medium text-[var(--accent-100)] hover:underline sm:text-sm dark:text-[var(--accent-200)]"
          >
            Clear search and filters
          </button>
        )}
        <span className="text-xs text-gray-500 sm:text-sm dark:text-[var(--text-200)]">
          {total.toLocaleString()} {total === 1 ? singular : plural}
        </span>
      </div>
    </div>
  )
}
