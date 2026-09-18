import { Link } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { HHCartStatus, HHChildOrder, HHDetailsStatus, HHOrderGroup, HHVerifyIssue } from '../../lib/hhSportswear'
import {
  HH_CART_COUNT_ORDER,
  HH_CART_STATUS_LABELS,
  HH_DETAILS_COUNT_ORDER,
  HH_DETAILS_STATUS_LABELS,
  hhCartCounts,
  hhDetailsCounts,
  hhPlacePlan,
} from '../../lib/hhSportswear'
import { BackIcon, Spinner } from '../labels/labelUi'
import { Tooltip } from '../Tooltip'
import type { HHPage } from '../../lib/hhNav'
import { prefersReducedMotion } from '../../lib/hhNav'
import { DROPSHIP_PATH, HH_SPORTSWEAR_PATH } from '../../lib/dropship'

export function HHBreadcrumb({
  groupId,
  current,
}: {
  groupId?: string
  current: HHPage
}) {
  const crumbs: { label: string; to?: string }[] = [
    { label: 'Dropship (B2B)', to: DROPSHIP_PATH },
    {
      label: 'HH Sportswear',
      to: current === 'list' ? undefined : HH_SPORTSWEAR_PATH,
    },
  ]
  if (current === 'orders' || current === 'items') {
    crumbs.push({
      label: 'Orders',
      to: current === 'items' && groupId ? `${HH_SPORTSWEAR_PATH}/${groupId}` : undefined,
    })
  }
  if (current === 'items') {
    crumbs.push({ label: 'Items' })
  }
  if (current === 'config') {
    crumbs.push({ label: 'Configurations' })
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
      <div className="hh-row-actions-tray">
        <div className="hh-row-actions-inner">{children}</div>
      </div>
    </td>
  )
}

function CopyIdIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 8H6a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-2M8 8V6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2M8 8h8"
      />
    </svg>
  )
}

function CopiedIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const field = document.createElement('textarea')
      field.value = value
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.left = '-9999px'
      document.body.appendChild(field)
      field.select()
      const ok = document.execCommand('copy')
      field.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function HHCopyIdButton({
  value,
  size = 'sm',
  title = 'Copy batch ID',
}: {
  value: string
  size?: 'sm' | 'md'
  title?: string
}) {
  const [copied, setCopied] = useState(false)
  const sizing = size === 'sm' ? 'px-1.5 py-1' : 'p-2'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const label = copied ? 'Copied' : title

  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void copyText(value).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
        }}
        aria-label={label}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] text-slate-500 hover:bg-[var(--primary-100)] hover:text-[var(--accent-200)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-200)] dark:hover:bg-[var(--primary-100)] dark:hover:text-[var(--accent-200)] cursor-pointer transition-colors ${sizing}`}
      >
        {copied ? <CopiedIcon className={iconSize} /> : <CopyIdIcon className={iconSize} />}
      </button>
    </Tooltip>
  )
}

function MoreIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM11.5 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM17 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
    </svg>
  )
}

function MenuTrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  )
}

export function HHBatchHeaderMenu({
  groupId,
  allPlaced,
  hasPlaced,
  resyncBusy = false,
  redraftBusy = false,
  onResync,
  onRedraft,
  onDelete,
}: {
  groupId: string
  allPlaced: boolean
  hasPlaced: boolean
  resyncBusy?: boolean
  redraftBusy?: boolean
  onResync: () => void
  onRedraft: () => void
  onDelete: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [coords, setCoords] = useState({ top: 0, right: 0 })

  const close = () => setOpen(false)

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setCoords({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }, [open])

  useEffect(() => {
    if (!open) {
      setCopied(false)
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const run = (action: () => void) => {
    close()
    action()
  }

  const copyId = () => {
    void copyText(groupId).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  const itemClass = (danger?: boolean, disabled?: boolean) =>
    `flex w-full items-center gap-2.5 border-0 bg-transparent px-3 py-2 text-left text-sm transition-colors ${
      disabled
        ? 'cursor-not-allowed text-slate-500 opacity-50 dark:text-[var(--text-200)]'
        : danger
          ? 'cursor-pointer text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
          : 'cursor-pointer text-slate-700 hover:bg-[var(--primary-100)] dark:text-[var(--text-100)]'
    }`

  return (
    <div className="relative">
      <Tooltip content={open ? undefined : 'More actions'}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More actions"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setOpen((current) => !current)
          }}
          className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] p-2 text-slate-500 hover:bg-[var(--primary-100)] hover:text-[var(--accent-200)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-200)] dark:hover:bg-[var(--primary-100)] dark:hover:text-[var(--accent-200)] transition-colors"
        >
          <MoreIcon className="h-4 w-4" />
        </button>
      </Tooltip>

      {open
        ? createPortal(
            <>
              <div className="fixed inset-0 z-40" onClick={close} />
              <div
                role="menu"
                aria-label="Batch actions"
                className="fixed z-[60] min-w-[13.75rem] overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] py-1 shadow-xl dark:border-[var(--bg-300)] dark:bg-[var(--bg-100)]"
                style={{ top: coords.top, right: coords.right }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className={itemClass()}
                  onClick={copyId}
                >
                  {copied ? <CopiedIcon className="h-4 w-4" /> : <CopyIdIcon className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy batch ID'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={allPlaced || resyncBusy}
                  className={itemClass(false, allPlaced || resyncBusy)}
                  onClick={() => {
                    if (allPlaced || resyncBusy) return
                    run(onResync)
                  }}
                >
                  {resyncBusy ? <Spinner className="h-4 w-4" /> : <DetailsResyncIcon className="h-4 w-4" />}
                  {allPlaced ? 'Re-sync unavailable' : 'Re-sync details'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={allPlaced || redraftBusy}
                  className={itemClass(false, allPlaced || redraftBusy)}
                  onClick={() => {
                    if (allPlaced || redraftBusy) return
                    run(onRedraft)
                  }}
                >
                  {redraftBusy ? <Spinner className="h-4 w-4" /> : <CartDraftIcon className="h-4 w-4" />}
                  {allPlaced ? 'Regenerate unavailable' : 'Regenerate B2B draft'}
                </button>
                <div className="my-1 border-t border-[var(--bg-300)]" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={hasPlaced}
                  className={itemClass(true, hasPlaced)}
                  onClick={() => {
                    if (hasPlaced) return
                    run(onDelete)
                  }}
                >
                  <MenuTrashIcon className="h-4 w-4" />
                  {hasPlaced ? 'Delete unavailable' : 'Delete batch'}
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  )
}

export function HHResyncButton({
  busy,
  onClick,
  size = 'sm',
  title = 'Re-sync details',
  disabled = false,
}: {
  busy?: boolean
  onClick: () => void
  size?: 'sm' | 'md'
  title?: string
  disabled?: boolean
}) {
  const sizing = size === 'sm' ? 'px-2 py-1.5' : 'p-2'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <Tooltip content={title}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (disabled || busy) return
          onClick()
        }}
        disabled={busy || disabled}
        aria-label={title}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] text-[var(--accent-100)] hover:bg-[var(--primary-100)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--accent-200)] dark:hover:bg-[var(--primary-100)] cursor-pointer transition-colors ${sizing}`}
      >
        {busy ? <Spinner className={iconSize} /> : <DetailsResyncIcon className={iconSize} />}
      </button>
    </Tooltip>
  )
}

function DetailsResyncIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h7"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 5a2 2 0 012-2h2a2 2 0 012 2v0a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11h5M8 15h3" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20.2 14.2a3.6 3.6 0 10-1 2.5"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.2 11.5V15h-3.4" />
    </svg>
  )
}

function CartDraftIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 3h2l.6 3M6.2 9h12.2l-1.5 6.2a1 1 0 01-1 .8H8.1a1 1 0 01-1-.8L5.4 6H3"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 20a1.25 1.25 0 11-2.5 0A1.25 1.25 0 019 20zM18 20a1.25 1.25 0 11-2.5 0A1.25 1.25 0 0118 20z"
      />
    </svg>
  )
}

export function HHRedraftButton({
  busy,
  onClick,
  size = 'sm',
  title = 'Regenerate B2B draft',
  disabled = false,
}: {
  busy?: boolean
  onClick: () => void
  size?: 'sm' | 'md'
  title?: string
  disabled?: boolean
}) {
  const sizing = size === 'sm' ? 'px-2 py-1.5' : 'p-2'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <Tooltip content={title}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (disabled || busy) return
          onClick()
        }}
        disabled={busy || disabled}
        aria-label={title}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] text-[var(--accent-100)] hover:bg-[var(--primary-100)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--accent-200)] dark:hover:bg-[var(--primary-100)] cursor-pointer transition-colors ${sizing}`}
      >
        {busy ? <Spinner className={iconSize} /> : <CartDraftIcon className={iconSize} />}
      </button>
    </Tooltip>
  )
}

export function HHPlaceButton({
  busy,
  onClick,
  size = 'sm',
  title = 'Place Order',
  disabled = false,
}: {
  busy?: boolean
  onClick: () => void
  size?: 'sm' | 'md'
  title?: string
  disabled?: boolean
}) {
  const sizing = size === 'sm' ? 'px-2 py-1.5' : 'p-2'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <Tooltip content={title}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (disabled || busy) return
          onClick()
        }}
        disabled={busy || disabled}
        aria-label={title}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-emerald-300 dark:hover:bg-emerald-950/40 cursor-pointer transition-colors ${sizing}`}
      >
        {busy ? <Spinner className={iconSize} /> : <PlaceOrderIcon className={iconSize} />}
      </button>
    </Tooltip>
  )
}

function PlaceOrderIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6M7 4h7l5 5v11H7V4z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l1.5 1.5L14 10" />
    </svg>
  )
}

export type HHPendingAction =
  | { type: 'delete' | 'resync' | 'redraft' | 'place'; target: 'group'; group: HHOrderGroup }
  | { type: 'delete' | 'resync' | 'redraft' | 'place'; target: 'order'; order: HHChildOrder }

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

export function HHCartBadge({
  status,
  issues,
}: {
  status: HHCartStatus
  issues?: HHVerifyIssue[]
}) {
  if (status === 'none') {
    return <span className="text-slate-400 dark:text-[var(--text-200)]">—</span>
  }
  const badge = (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CART_BADGE_CLASS[status]}`}>
      {HH_CART_STATUS_LABELS[status]}
    </span>
  )
  const content =
    status === 'review' && issues && issues.length > 0
      ? issues.map((issue) => `${issue.label}: ${issue.expected} → ${issue.actual}`).join('\n')
      : status === 'ready'
        ? 'Matched the live B2B draft'
        : undefined
  if (!content) return badge
  return <Tooltip content={content}>{badge}</Tooltip>
}

function HHSummaryDash() {
  return <span className="text-slate-400 dark:text-[var(--text-200)]">—</span>
}

function HHSummaryChips({
  tooltip,
  children,
}: {
  tooltip: string
  children: ReactNode
}) {
  return (
    <Tooltip content={tooltip}>
      <span className="inline-flex flex-wrap items-center gap-1">{children}</span>
    </Tooltip>
  )
}

export function HHDetailsSummary({
  orders,
}: {
  orders: Array<Pick<HHChildOrder, 'detailsStatus'>>
}) {
  const total = orders.length
  if (total === 0) return <HHSummaryDash />
  const counts = hhDetailsCounts(orders)
  const present = HH_DETAILS_COUNT_ORDER.filter((status) => counts[status] > 0)
  if (present.length === 0) return <HHSummaryDash />
  const unanimous = present.length === 1
  const tooltip = present.map((status) => `${counts[status]} ${HH_DETAILS_STATUS_LABELS[status]}`).join(' · ')
  return (
    <HHSummaryChips tooltip={tooltip}>
      {present.map((status) => (
        <span
          key={status}
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${DETAILS_BADGE_CLASS[status]}`}
        >
          {unanimous ? HH_DETAILS_STATUS_LABELS[status] : `${counts[status]} ${HH_DETAILS_STATUS_LABELS[status]}`}
        </span>
      ))}
    </HHSummaryChips>
  )
}

export function HHCartSummary({
  orders,
}: {
  orders: Array<Pick<HHChildOrder, 'cartStatus'>>
}) {
  const total = orders.length
  if (total === 0) return <HHSummaryDash />
  const counts = hhCartCounts(orders)
  const present = HH_CART_COUNT_ORDER.filter(
    (status): status is Exclude<HHCartStatus, 'none'> => status !== 'none' && counts[status] > 0,
  )
  if (present.length === 0) return <HHSummaryDash />
  const none = counts.none
  const unanimous = present.length === 1 && none === 0
  const tooltip = [
    ...present.map((status) => `${counts[status]} ${HH_CART_STATUS_LABELS[status]}`),
    none > 0 ? `${none} none` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <HHSummaryChips tooltip={tooltip}>
      {present.map((status) => (
        <span
          key={status}
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CART_BADGE_CLASS[status]}`}
        >
          {unanimous ? HH_CART_STATUS_LABELS[status] : `${counts[status]} ${HH_CART_STATUS_LABELS[status]}`}
        </span>
      ))}
    </HHSummaryChips>
  )
}

function PlaceOrderIdList({ ids }: { ids: string[] }) {
  const shown = ids.slice(0, 8)
  const extra = ids.length - shown.length
  return (
    <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto font-mono text-[13px] text-slate-700 dark:text-[var(--text-100)]">
      {shown.map((id) => (
        <li key={id}>{id}</li>
      ))}
      {extra > 0 ? <li className="text-xs text-slate-500 dark:text-[var(--text-200)]">+{extra} more</li> : null}
    </ul>
  )
}

function PlaceOrderPlan({
  placingIds,
  skipGroups,
}: {
  placingIds: string[]
  skipGroups: ReturnType<typeof hhPlacePlan>['skipGroups']
}) {
  const skippedCount = skipGroups.reduce((sum, group) => sum + group.ids.length, 0)
  return (
    <div className="mt-3 space-y-3">
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
          Will place · {placingIds.length}
        </p>
        <PlaceOrderIdList ids={placingIds} />
      </section>
      {skippedCount > 0 ? (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-[var(--text-200)]">
            Will skip · {skippedCount}
          </p>
          <div className="mt-1.5 space-y-2">
            {skipGroups.map((group) => (
              <div key={group.reason}>
                <p className="text-xs text-slate-500 dark:text-[var(--text-200)]">
                  {group.ids.length} {group.label}
                </p>
                <PlaceOrderIdList ids={group.ids} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function confirmCopy(pending: HHPendingAction, placeOrderEnabled: boolean) {
  const isGroup = pending.target === 'group'
  const orderId = pending.target === 'order' ? pending.order.orderId : null
  const createdBy = pending.target === 'group' ? pending.group.createdByName.trim() : null

  if (pending.type === 'place') {
    const plan =
      pending.target === 'group' ? hhPlacePlan(pending.group.children) : hhPlacePlan([pending.order])
    const placingCount = plan.placingIds.length
    const title = isGroup
      ? plan.skipped.length > 0
        ? `Place ${placingCount} of ${plan.total} orders?`
        : `Place ${placingCount} verified order${placingCount === 1 ? '' : 's'}?`
      : 'Place this order?'
    return {
      title,
      body: (
        <>
          {placeOrderEnabled ? (
            isGroup ? (
              <span>
                Only verified orders are placed. Helly Hansen is checked again first; a cart that no
                longer matches is skipped.
              </span>
            ) : (
              <span>
                This will re-check the live Helly Hansen cart, then place order{' '}
                <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{orderId}</span>.
              </span>
            )
          ) : (
            <span>
              Place Order is off in Configurations. This re-checks the live Helly Hansen cart
              {isGroup ? (
                ' for the verified orders below.'
              ) : (
                <>
                  {' '}
                  for <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{orderId}</span>.
                </>
              )}
            </span>
          )}
          {isGroup ? <PlaceOrderPlan placingIds={plan.placingIds} skipGroups={plan.skipGroups} /> : null}
          {placeOrderEnabled ? null : (
            <span className="mt-3 block">Helly Hansen will not receive Place Order.</span>
          )}
        </>
      ),
      confirm: isGroup && placingCount > 1 ? `Place ${placingCount}` : 'Place Order',
      busy: 'Placing…',
      danger: false,
    }
  }

  if (pending.type === 'resync') {
    return {
      title: isGroup ? 'Re-sync batch details?' : 'Re-sync order details?',
      body: isGroup ? (
        <>
          This will pull Seller Central details again for every order in the batch created by{' '}
          <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{createdBy}</span>
          . Placed orders are not changed.
        </>
      ) : (
        <>
          This will pull Seller Central details again for order{' '}
          <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{orderId}</span>.
        </>
      ),
      confirm: 'Re-sync',
      busy: 'Re-syncing…',
      danger: false,
    }
  }

  if (pending.type === 'redraft') {
    return {
      title: isGroup ? 'Regenerate B2B drafts?' : 'Regenerate B2B draft?',
      body: isGroup ? (
        <>
          This will create new Helly Hansen B2B drafts for orders in this batch that are not placed.
          Existing drafts will be replaced.
        </>
      ) : (
        <>
          This will create a new Helly Hansen B2B draft for order{' '}
          <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{orderId}</span>.
          {' '}The existing draft will be replaced.
        </>
      ),
      confirm: 'Regenerate',
      busy: 'Regenerating…',
      danger: false,
    }
  }

  return {
    title: isGroup ? 'Delete group?' : 'Delete order?',
    body: isGroup ? (
      <>
        This will remove the group created by{' '}
        <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{createdBy}</span>{' '}
        and all nested orders.
      </>
    ) : (
      <>
        This will remove order{' '}
        <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{orderId}</span>.
      </>
    ),
    confirm: 'Delete',
    busy: 'Deleting…',
    danger: true,
  }
}

export type HHConfirmOptions = { draftCart?: boolean }

function HHConfirmSwitch({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  description: string
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-200)]/40 px-3.5 py-3 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)]/40">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)]">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-[var(--text-200)]">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        } ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-[var(--bg-300)]'}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

export function HHConfirmModal({
  pending,
  onConfirm,
  onCancel,
  busy = false,
  error = null,
  placeOrderEnabled = false,
}: {
  pending: HHPendingAction
  onConfirm: (options?: HHConfirmOptions) => void
  onCancel: () => void
  busy?: boolean
  error?: string | null
  placeOrderEnabled?: boolean
}) {
  const copy = confirmCopy(pending, placeOrderEnabled)
  const [draftCart, setDraftCart] = useState(true)
  const isResync = pending.type === 'resync'
  const isPlace = pending.type === 'place'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onCancel} />
      <div className={`relative z-10 w-full space-y-4 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-6 shadow-xl ${isResync || isPlace ? 'max-w-lg' : 'max-w-sm'}`}>
        <h3 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">{copy.title}</h3>
        <div className="text-sm text-slate-500 dark:text-[var(--text-200)]">{copy.body}</div>
        {isResync && (
          <HHConfirmSwitch
            checked={draftCart}
            disabled={busy}
            label="Also regenerate B2B cart"
            description={
              draftCart
                ? 'Creates a new Helly Hansen draft after details sync. Existing drafts are replaced. The order is not placed.'
                : 'Existing drafts and reference numbers stay. You can regenerate later from the cart action.'
            }
            onChange={setDraftCart}
          />
        )}
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
            onClick={() => onConfirm(isResync ? { draftCart } : undefined)}
            disabled={busy}
            className={
              copy.danger
                ? 'cursor-pointer rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
                : 'cursor-pointer rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[var(--accent-100)]'
            }
          >
            {busy ? copy.busy : copy.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}

export const HHConfirmDeleteModal = HHConfirmModal
