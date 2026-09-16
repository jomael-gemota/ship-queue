import { Link } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { HHCartStatus, HHChildOrder, HHDetailsStatus, HHOrderGroup } from '../../lib/hhSportswear'
import { HH_CART_STATUS_LABELS, HH_DETAILS_STATUS_LABELS } from '../../lib/hhSportswear'
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
  const sizing = size === 'sm' ? 'px-2 py-1.5' : 'p-2'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <Tooltip content={title}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onClick()
        }}
        disabled={busy}
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
}: {
  busy?: boolean
  onClick: () => void
  size?: 'sm' | 'md'
  title?: string
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
          onClick()
        }}
        disabled={busy}
        aria-label={title}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] text-[var(--accent-100)] hover:bg-[var(--primary-100)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--accent-200)] dark:hover:bg-[var(--primary-100)] cursor-pointer transition-colors ${sizing}`}
      >
        {busy ? <Spinner className={iconSize} /> : <CartDraftIcon className={iconSize} />}
      </button>
    </Tooltip>
  )
}

export type HHPendingAction =
  | { type: 'delete' | 'resync' | 'redraft'; target: 'group'; group: HHOrderGroup }
  | { type: 'delete' | 'resync' | 'redraft'; target: 'order'; order: HHChildOrder }

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

function confirmCopy(pending: HHPendingAction) {
  const isGroup = pending.target === 'group'
  const orderId = pending.target === 'order' ? pending.order.orderId : null
  const createdBy = pending.target === 'group' ? pending.group.createdByName.trim() : null

  if (pending.type === 'resync') {
    return {
      title: isGroup ? 'Re-sync batch details?' : 'Re-sync order details?',
      body: isGroup ? (
        <>
          This will pull Seller Central details again for every order in the batch created by{' '}
          <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{createdBy}</span>.
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
          This will create new Helly Hansen B2B drafts for every order in this batch. Existing drafts
          will be replaced.
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
}: {
  pending: HHPendingAction
  onConfirm: (options?: HHConfirmOptions) => void
  onCancel: () => void
  busy?: boolean
  error?: string | null
}) {
  const copy = confirmCopy(pending)
  const [draftCart, setDraftCart] = useState(true)
  const isResync = pending.type === 'resync'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onCancel} />
      <div className={`relative z-10 w-full space-y-4 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-6 shadow-xl ${isResync ? 'max-w-md' : 'max-w-sm'}`}>
        <h3 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">{copy.title}</h3>
        <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">{copy.body}</p>
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
