import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { newMessageStore } from '../../lib/docTidyStore'
import {
  DOCUMENT_TYPE_ICONS,
  DOCUMENT_TYPE_LABELS,
  PARSE_STATUS_LABELS,
  documentTypeOf,
  isParseRunning,
  type DocTidyRuleInput,
  type DocumentType,
  type ParseJobStatus,
} from '../../types/docTidy'

/**
 * Full-width underline tab bar shared by all three Doc Tidy sections.
 *
 * The component renders a <nav> without an outer border — callers wrap it in a
 * div that provides the horizontal rule so action buttons can sit flush on the
 * same baseline (flex items-end justify-between border-b …).
 *
 * The active tab's border-b-2 uses -mb-px to overlap the parent's border-b,
 * producing the standard "selected tab" look without a double line.
 */
export function DocTidyTabs() {
  // Reactive unread count — survives navigation between sub-pages.
  const [unread, setUnread] = useState(newMessageStore.get)
  useEffect(() => newMessageStore.subscribe(() => setUnread(newMessageStore.get())), [])

  const tab = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 -mb-px cursor-pointer whitespace-nowrap select-none transition-colors ${
      isActive
        ? 'border-[var(--accent-200)] text-[var(--accent-200)]'
        : 'border-transparent text-[var(--text-200)] hover:text-[var(--text-100)] hover:border-[var(--bg-300)]'
    }`

  return (
    <nav className="flex items-end" aria-label="Doc Tidy navigation">
      <NavLink to="/doc-tidy" end className={tab}>
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
        Email Records
        {unread > 0 && (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--accent-200)] px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </NavLink>
      <NavLink to="/doc-tidy/invoice-audit" className={tab}>
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        Invoice Audit
      </NavLink>
      <NavLink to="/doc-tidy/rules" className={tab}>
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
        Filter Rules
      </NavLink>
      <NavLink to="/doc-tidy/vendors" className={tab}>
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </svg>
        Vendors
      </NavLink>
    </nav>
  )
}

/**
 * Sticky, icon-prefixed header cell matching the Orders table. `children`
 * replaces the label outright, for a column headed by a control (a
 * select-all checkbox) rather than a name.
 */
export function Th({
  label,
  iconPath,
  align = 'left',
  className = '',
  children,
}: {
  label?: string
  iconPath?: string
  align?: 'left' | 'center' | 'right'
  className?: string
  children?: React.ReactNode
}) {
  const textAlign =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const flexAlign =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''

  return (
    <th
      className={`sticky top-0 z-20 bg-[var(--bg-200)] dark:bg-[var(--bg-200)] border-b border-[var(--bg-300)] dark:border-[var(--bg-300)] border-r border-[var(--bg-300)] dark:border-r-[var(--bg-300)] last:border-r-0 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-[var(--text-200)] whitespace-nowrap ${textAlign} ${className}`}
    >
      {children ?? (
        <span className={`flex items-center gap-1.5 ${flexAlign}`}>
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
      )}
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

      <span className="px-2 py-1 text-[11px] text-gray-700 dark:text-[var(--text-200)] whitespace-nowrap">
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

/* ------------------------------------------------------- document types */

const DOCUMENT_TYPE_STYLES: Record<DocumentType, string> = {
  order_confirmation:
    'bg-amber-100 text-amber-800 ring-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/20',
  invoice:
    'bg-violet-100 text-violet-800 ring-violet-200/70 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/20',
  other:
    'bg-slate-200 text-slate-700 ring-slate-300/70 dark:bg-[var(--bg-300)] dark:text-[var(--text-200)] dark:ring-white/5',
}

/** Colour-coded document type label used by the rules list and results table. */
export function DocumentTypeBadge({
  value,
  className = '',
}: {
  value?: DocumentType | null
  className?: string
}) {
  const type = documentTypeOf(value)

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap ring-1 ring-inset ${DOCUMENT_TYPE_STYLES[type]} ${className}`}
    >
      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={DOCUMENT_TYPE_ICONS[type]}
        />
      </svg>
      {DOCUMENT_TYPE_LABELS[type]}
    </span>
  )
}

/* --------------------------------------------------------- agent parsing */

const PARSE_STATUS_STYLES: Record<ParseJobStatus, string> = {
  pending:
    'bg-slate-200 text-slate-700 ring-slate-300/70 dark:bg-[var(--bg-300)] dark:text-[var(--text-200)] dark:ring-white/5',
  processing:
    'bg-sky-100 text-sky-800 ring-sky-200/70 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/20',
  completed:
    'bg-emerald-100 text-emerald-800 ring-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20',
  failed:
    'bg-rose-100 text-rose-800 ring-rose-200/70 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/20',
}

/**
 * How far the agent got with one attachment. A running job gets a pulsing dot
 * rather than a spinner: several can be in flight in one table, and four
 * spinners read as the page loading rather than as four documents parsing.
 */
export function ParseStatusChip({
  status,
  title,
}: {
  status: ParseJobStatus
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${PARSE_STATUS_STYLES[status]}`}
    >
      {isParseRunning(status) && (
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
      )}
      {PARSE_STATUS_LABELS[status]}
    </span>
  )
}

/* ------------------------------------------------------------- controls */

/** Accessible on/off switch. Doubles as the status indicator in the rules list. */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  title,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : title}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 rounded-lg text-sm text-[var(--text-100)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-200)]"
    >
      <span
        className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-[var(--accent-200)]' : 'bg-slate-300 dark:bg-[var(--bg-300)]'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-[16px]' : 'translate-x-[2px]'
          }`}
        />
      </span>
      {label && <span className="whitespace-nowrap">{label}</span>}
    </button>
  )
}

/** Square, icon-only action button. Used for a rule's secondary actions. */
export function IconButton({
  label,
  iconPath,
  onClick,
  tone = 'default',
  disabled = false,
}: {
  label: string
  iconPath: string
  onClick: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-rose-600 hover:bg-rose-50 hover:border-rose-200 dark:text-rose-400 dark:hover:bg-rose-900/20 dark:hover:border-rose-900/40'
      : 'text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--bg-300)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${toneClass}`}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
      </svg>
    </button>
  )
}

/**
 * Compact icon-only button for row-level actions in a dense table, where the
 * 32px `IconButton` (with its border) would blow out the row height.
 */
export function TableActionButton({
  label,
  onClick,
  children,
  disabled = false,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-200)] transition-colors hover:bg-[var(--primary-100)] hover:text-[var(--accent-200)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
    >
      {children}
    </button>
  )
}

/** Lightning-bolt glyph for the Parse action — sending a document to the agent. */
export function BoltIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )
}

/* --------------------------------------------------- avatar colour util */

/**
 * Deterministic avatar background colour from the first character of a
 * seed string (a sender name or e-mail address). Used by the table rows and
 * the detail drawer so both show the same colour for the same sender.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function avatarColour(seed: string): string {
  const palette = [
    'bg-blue-500',
    'bg-emerald-500',
    'bg-violet-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-teal-500',
    'bg-indigo-500',
    'bg-sky-500',
  ]
  return palette[seed.charCodeAt(0) % palette.length]
}

/* ------------------------------------------------------ rule conditions */

type Criterion = { label: string; value: string; tone: 'default' | 'exclude' }

/** Turns a rule into the discrete conditions shown as chips. */
function criteriaOf(rule: DocTidyRuleInput): Criterion[] {
  const items: Criterion[] = []
  const add = (label: string, value: string, tone: Criterion['tone'] = 'default') =>
    items.push({ label, value, tone })

  if (rule.fromAddresses.length) add('From', rule.fromAddresses.join(', '))
  if (rule.toAddresses?.length) add('To', rule.toAddresses.join(', '))
  if (rule.subjectKeywords.length) add('Subject', rule.subjectKeywords.join(', '))
  if (rule.bodyKeywords.length) add('Body', rule.bodyKeywords.join(', '))
  if (rule.excludeKeywords.length) add('Not', rule.excludeKeywords.join(', '), 'exclude')

  const hasKeywords = rule.subjectKeywords.length > 0 || rule.bodyKeywords.length > 0
  if (hasKeywords) add('Match', rule.matchMode === 'all' ? 'All keywords' : 'Any keyword')

  if (rule.lookbackDays) add('Window', `Last ${rule.lookbackDays} days`)
  else if (rule.dateFrom || rule.dateTo) {
    const from = rule.dateFrom ? String(rule.dateFrom).slice(0, 10) : 'any'
    const to = rule.dateTo ? String(rule.dateTo).slice(0, 10) : 'today'
    add('Window', `${from} → ${to}`)
  }

  if (rule.attachmentExtensions.length) {
    add('Files', rule.attachmentExtensions.map((ext) => `.${ext}`).join(' '))
  } else if (rule.requireAttachment) {
    add('Files', 'Any file type')
  }

  return items
}

/**
 * A rule's conditions as labelled chips. Shared by the rules list and the
 * editor's preview, so what is previewed is exactly what the list will show.
 */
export function RuleCriteria({ rule }: { rule: DocTidyRuleInput }) {
  const items = criteriaOf(rule)

  if (!items.length) {
    return (
      <p className="text-xs italic text-[var(--text-200)]">
        No conditions — matches every message in the mailbox.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item) => (
        <span
          key={`${item.label}-${item.value}`}
          title={`${item.label}: ${item.value}`}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
            item.tone === 'exclude'
              ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/15 dark:text-rose-300'
              : 'border-[var(--bg-300)] bg-[var(--bg-200)] text-[var(--text-100)]'
          }`}
        >
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide ${
              item.tone === 'exclude' ? 'text-rose-500 dark:text-rose-400' : 'text-[var(--text-200)]'
            }`}
          >
            {item.label}
          </span>
          <span className="truncate">{item.value}</span>
        </span>
      ))}
    </div>
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
