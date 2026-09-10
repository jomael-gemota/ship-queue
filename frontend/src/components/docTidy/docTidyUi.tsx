import { NavLink } from 'react-router-dom'

/** Sub-navigation shared by the Doc Tidy results and rules pages. */
export function DocTidyTabs() {
  const base =
    'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer'
  const className = ({ isActive }: { isActive: boolean }) =>
    `${base} ${
      isActive
        ? 'bg-[var(--primary-100)] text-[var(--accent-200)] shadow-sm'
        : 'text-[var(--text-200)] hover:bg-[var(--primary-100)] hover:text-[var(--text-100)]'
    }`

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-1">
      <NavLink to="/doc-tidy" end className={className}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
        Extracted Messages
      </NavLink>
      <NavLink to="/doc-tidy/rules" className={className}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
        Extraction Rules
      </NavLink>
    </div>
  )
}

/** Sticky, icon-prefixed header cell matching the Orders table. */
export function Th({
  label,
  iconPath,
  align = 'left',
}: {
  label: string
  iconPath?: string
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`sticky top-0 z-20 bg-[var(--bg-200)] dark:bg-[var(--bg-200)] border-b border-[var(--bg-300)] dark:border-[var(--bg-300)] border-r border-[var(--bg-300)] dark:border-r-[var(--bg-300)] last:border-r-0 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-[var(--text-200)] whitespace-nowrap ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <span className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {iconPath && (
          <svg
            className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-[var(--text-200)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
          </svg>
        )}
        {label}
      </span>
    </th>
  )
}

const paginationButtonClass =
  'p-1.5 rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] text-slate-700 dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] hover:text-slate-900 dark:hover:text-[var(--text-100)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors'

/** First / prev / next / last controls with a "Page X of Y" label. */
export function PaginationArrows({
  page,
  pages,
  onChange,
}: {
  page: number
  pages: number
  onChange: (page: number) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(1)}
        disabled={page === 1}
        className={paginationButtonClass}
        aria-label="First page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className={paginationButtonClass}
        aria-label="Previous page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <span className="px-2.5 py-1 text-sm text-gray-700 dark:text-[var(--text-200)] whitespace-nowrap">
        Page {page} of {pages}
      </span>

      <button
        onClick={() => onChange(Math.min(pages, page + 1))}
        disabled={page >= pages}
        className={paginationButtonClass}
        aria-label="Next page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <button
        onClick={() => onChange(pages)}
        disabled={page >= pages}
        className={paginationButtonClass}
        aria-label="Last page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

/** Dismissible status banner using the shared notice-card styles. */
export function Banner({
  kind,
  children,
  onDismiss,
}: {
  kind: 'success' | 'error' | 'warning' | 'info'
  children: React.ReactNode
  onDismiss?: () => void
}) {
  return (
    <div className={`notice-card notice-card--${kind} flex items-start gap-3 text-sm`}>
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="rounded-md px-1 opacity-70 hover:opacity-100 cursor-pointer"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  )
}
