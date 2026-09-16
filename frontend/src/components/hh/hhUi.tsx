import { Link } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { HHCartStatus, HHChildOrder, HHDetailsStatus, HHOrderGroup } from '../../lib/hhSportswear'
import { HH_CART_STATUS_LABELS, HH_DETAILS_STATUS_LABELS } from '../../lib/hhSportswear'
import { BackIcon, RefreshIcon, Spinner } from '../labels/labelUi'
import type { HHPage } from '../../lib/hhNav'
import { prefersReducedMotion } from '../../lib/hhNav'

export function HHBreadcrumb({
  groupId,
  current,
}: {
  groupId?: string
  current: HHPage
}) {
  const crumbs: { label: string; to?: string }[] = [
    {
      label: 'HH Sportswear',
      to: current === 'list' ? undefined : '/ordering/hh-sportswear',
    },
  ]
  if (current === 'orders' || current === 'items') {
    crumbs.push({
      label: 'Orders',
      to: current === 'items' && groupId ? `/ordering/hh-sportswear/${groupId}` : undefined,
    })
  }
  if (current === 'items') {
    crumbs.push({ label: 'Items' })
  }

  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-slate-500 dark:text-[var(--text-200)]">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <li key={crumb.label} className="inline-flex items-center gap-1.5">
              {index > 0 && (
                <svg className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
              {crumb.to && !isLast ? (
                <Link
                  to={crumb.to}
                  className="hover:text-slate-700 hover:underline dark:hover:text-[var(--text-100)]"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={isLast ? 'font-medium text-slate-800 dark:text-[var(--text-100)]' : undefined}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function HHBackButton({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="inline-flex shrink-0 items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-700 dark:text-[var(--text-200)] dark:hover:text-[var(--text-100)]"
    >
      <BackIcon className="h-4 w-4" />
      Back
    </Link>
  )
}

export function useHHOpenRow() {
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!openId) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.hh-row-actions')) return
      setOpenId(null)
    }

    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [openId])

  return {
    openId,
    close: () => setOpenId(null),
    toggle: (id: string) => setOpenId((current) => (current === id ? null : id)),
  }
}

export function useHHRowExit(onExited: (id: string) => void) {
  const [exitingId, setExitingId] = useState<string | null>(null)
  const onExitedRef = useRef(onExited)
  onExitedRef.current = onExited

  const beginExit = (id: string) => {
    if (prefersReducedMotion()) {
      onExitedRef.current(id)
      return
    }
    setExitingId(id)
  }

  const finishExit = (id: string) => {
    if (exitingId !== id) return
    onExitedRef.current(id)
    setExitingId(null)
  }

  return { exitingId, beginExit, finishExit }
}

const HH_FLASH_MS = 4500
const HH_FLASH_PENDING = '__hhSportswearFlashId'

function pendingFlashId(): string | null {
  return (window as Window & { [HH_FLASH_PENDING]?: string | null })[HH_FLASH_PENDING] ?? null
}

function setPendingFlashId(id: string | null) {
  ;(window as Window & { [HH_FLASH_PENDING]?: string | null })[HH_FLASH_PENDING] = id
}

function rowByGroupId(groupId: string): HTMLTableRowElement | null {
  const row = document.querySelector(`tr[data-hh-group="${CSS.escape(groupId)}"]`)
  return row instanceof HTMLTableRowElement ? row : null
}

export function flashHHGroupRow(groupId: string) {
  if (!groupId) return
  setPendingFlashId(groupId)
  const apply = () => {
    const row = rowByGroupId(groupId)
    if (!row) return false
    row.classList.remove('is-fresh')
    void row.offsetWidth
    row.classList.add('is-fresh')
    return true
  }
  if (!apply()) {
    window.setTimeout(() => {
      if (!apply()) window.setTimeout(apply, 32)
    }, 0)
  }
  window.setTimeout(() => {
    if (pendingFlashId() !== groupId) return
    setPendingFlashId(null)
    rowByGroupId(groupId)?.classList.remove('is-fresh')
  }, HH_FLASH_MS)
}

export function HHActionRow({
  children,
  className = '',
  open = false,
  exiting = false,
  rowId,
  onExitEnd,
}: {
  children: ReactNode
  className?: string
  open?: boolean
  exiting?: boolean
  rowId?: string
  onExitEnd?: () => void
}) {
  const rowRef = useRef<HTMLTableRowElement>(null)
  const finishedRef = useRef(false)
  const onExitEndRef = useRef(onExitEnd)
  onExitEndRef.current = onExitEnd

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    if (rowId) row.classList.toggle('is-fresh', pendingFlashId() === rowId)
    const cells = Array.from(row.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains('hh-row-actions'),
    )
    const n = Math.max(cells.length, 1)
    cells.forEach((cell, i) => {
      const t = n <= 1 ? 1 : i / (n - 1)
      cell.style.setProperty('--hh-t', t.toFixed(4))
      cell.style.zIndex = String(n - i)
    })
  })

  useLayoutEffect(() => {
    finishedRef.current = false
    const row = rowRef.current
    if (!exiting || !row) return

    const cells = Array.from(row.children) as HTMLElement[]
    for (const cell of cells) {
      cell.style.boxSizing = 'border-box'
      cell.style.height = `${Math.ceil(cell.getBoundingClientRect().height)}px`
    }

    const timeout = window.setTimeout(() => {
      row.classList.add('is-collapsing')
    }, 220)
    const fallback = window.setTimeout(() => {
      if (finishedRef.current) return
      finishedRef.current = true
      onExitEndRef.current?.()
    }, 780)

    return () => {
      window.clearTimeout(timeout)
      window.clearTimeout(fallback)
    }
  }, [exiting])

  return (
    <tr
      ref={rowRef}
      data-hh-group={rowId}
      className={`hh-action-row hh-table-row ${open ? 'is-open' : ''} ${exiting ? 'is-deleting' : ''} ${className}`.trim()}
      onTransitionEnd={(event) => {
        if (!exiting || finishedRef.current) return
        if (event.propertyName !== 'height') return
        if (!(event.target instanceof HTMLTableCellElement)) return
        finishedRef.current = true
        onExitEndRef.current?.()
      }}
    >
      {children}
    </tr>
  )
}

export function HHRowActionsHeader() {
  return (
    <th className="hh-row-actions">
      <span className="sr-only">Action</span>
    </th>
  )
}

export function HHRowActions({
  children,
  open,
  onToggle,
  className = '',
}: {
  children: ReactNode
  open: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <td className={`hh-row-actions ${className}`.trim()}>
      <button
        type="button"
        className="hh-row-handle"
        aria-expanded={open}
        aria-label={open ? 'Hide row actions' : 'Show row actions'}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onToggle()
          event.currentTarget.blur()
        }}
      />
      <div className="hh-row-actions-inner">{children}</div>
    </td>
  )
}

export function HHResyncButton({
  busy,
  onClick,
  size = 'sm',
  title = 'Re-sync details',
}: {
  busy?: boolean
  onClick: () => void
  size?: 'sm' | 'md'
  title?: string
}) {
  const sizing = size === 'sm' ? 'p-1.5' : 'p-2'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      disabled={busy}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] text-[var(--accent-100)] hover:bg-[var(--primary-100)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--accent-200)] dark:hover:bg-[var(--primary-100)] cursor-pointer transition-colors ${sizing}`}
    >
      {busy ? <Spinner className={iconSize} /> : <RefreshIcon className={iconSize} />}
    </button>
  )
}

export type HHPendingDelete =
  | { kind: 'group'; group: HHOrderGroup }
  | { kind: 'order'; order: HHChildOrder }

const DETAILS_BADGE_CLASS: Record<HHDetailsStatus, string> = {
  pending: 'bg-[var(--primary-100)] text-slate-700 dark:bg-[var(--bg-300)] dark:text-[var(--text-200)]',
  synced: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

const CART_BADGE_CLASS: Record<Exclude<HHCartStatus, 'none'>, string> = {
  draft: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  ready: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  review: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  placed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
}

export function HHDetailsBadge({ status }: { status: HHDetailsStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${DETAILS_BADGE_CLASS[status]}`}>
      {HH_DETAILS_STATUS_LABELS[status]}
    </span>
  )
}

export function HHCartBadge({ status }: { status: HHCartStatus }) {
  if (status === 'none') {
    return <span className="text-slate-400 dark:text-[var(--text-200)]">—</span>
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CART_BADGE_CLASS[status]}`}>
      {HH_CART_STATUS_LABELS[status]}
    </span>
  )
}

export function HHConfirmDeleteModal({
  pending,
  onConfirm,
  onCancel,
  busy = false,
  error = null,
}: {
  pending: HHPendingDelete
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  error?: string | null
}) {
  const isGroup = pending.kind === 'group'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm space-y-4 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-6 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
          {isGroup ? 'Delete group?' : 'Delete order?'}
        </h3>
        <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
          {isGroup ? (
            <>
              This will remove the group created by{' '}
              <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">
                {pending.group.createdByName}
              </span>{' '}
              and all nested orders.
            </>
          ) : (
            <>
              This will remove order{' '}
              <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">
                {pending.order.orderId}
              </span>
              .
            </>
          )}
        </p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="cursor-pointer rounded-lg bg-[var(--bg-200)] px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-[var(--bg-300)] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[var(--text-200)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="cursor-pointer rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
