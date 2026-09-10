import { Link } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { HHChildOrder, HHOrderGroup, HHOrderStatus } from '../../lib/hhSportswear'
import { BackIcon } from '../labels/labelUi'
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

export function HHActionRow({
  children,
  className = '',
  open = false,
  exiting = false,
  onExitEnd,
}: {
  children: ReactNode
  className?: string
  open?: boolean
  exiting?: boolean
  onExitEnd?: () => void
}) {
  const rowRef = useRef<HTMLTableRowElement>(null)
  const finishedRef = useRef(false)
  const onExitEndRef = useRef(onExitEnd)
  onExitEndRef.current = onExitEnd

  useLayoutEffect(() => {
    finishedRef.current = false
    const row = rowRef.current
    if (!exiting || !row) return

    const cells = [...row.children] as HTMLElement[]
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
      className={`hh-action-row ${open ? 'is-open' : ''} ${exiting ? 'is-deleting' : ''} ${className}`.trim()}
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

export type HHPendingDelete =
  | { kind: 'group'; group: HHOrderGroup }
  | { kind: 'order'; order: HHChildOrder }

export function HHStatusBadge({ status }: { status: HHOrderStatus }) {
  if (status === 'complete') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        Complete
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--primary-100)] px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-[var(--bg-300)] dark:text-[var(--text-200)]">
      Draft
    </span>
  )
}

export function HHConfirmDeleteModal({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: HHPendingDelete
  onConfirm: () => void
  onCancel: () => void
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
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg bg-[var(--bg-200)] px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-[var(--bg-300)] dark:text-[var(--text-200)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
