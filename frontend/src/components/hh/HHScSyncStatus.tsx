import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getHHScSyncStatus, hhWaitingForCartCount } from '../../lib/hhSportswear'
import type { HHOrderGroup, HHScSyncStatus as HHScSyncSnapshot } from '../../lib/hhSportswear'
import { useHHList } from '../../context/HHListContext'
import { Tooltip } from '../Tooltip'

const POLL_IDLE_MS = 5000
const POLL_RUNNING_MS = 1500

function formatAgo(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 15_000) return 'just now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m ago`
  return `${Math.max(1, Math.round(ms / 3_600_000))}h ago`
}

function firstPersistedCartError(group?: HHOrderGroup): string | null {
  if (!group) return null
  for (const order of group.children) {
    const message = (order.cartError ?? '').trim()
    if (message) return `${order.orderId}: ${message}`
  }
  return null
}

function isWorkerBusy(data: HHScSyncSnapshot): boolean {
  const cart = data.cart
  return Boolean(
    data.running ||
      data.queuedGroups > 0 ||
      cart?.running ||
      cart?.verifying ||
      cart?.placing ||
      (cart?.queued ?? 0) > 0,
  )
}

function statusLabel(data: HHScSyncSnapshot, waitingForCart: number): string {
  const cart = data.cart
  const filling = data.running
    ? data.currentOrderId
      ? `Filling ${data.currentOrderId}`
      : 'Filling this batch'
    : null
  const placing = cart?.placing
    ? cart.placeCurrentOrderId
      ? `Placing ${cart.placeCurrentOrderId}`
      : 'Placing orders'
    : null
  const drafting = cart?.running
    ? cart.currentOrderId
      ? `Drafting ${cart.currentOrderId}`
      : 'Drafting carts'
    : cart?.verifying
      ? 'Checking carts'
      : null
  const parts = [filling, placing, drafting].filter(Boolean)
  if (parts.length > 0) return parts.join(' · ')
  if (data.queuedGroups > 0) return `${data.queuedGroups} batch${data.queuedGroups === 1 ? '' : 'es'} queued`
  if (cart && cart.queued > 0) return `${cart.queued} cart${cart.queued === 1 ? '' : 's'} queued`
  if (waitingForCart > 0) return `${waitingForCart} waiting for cart`
  return 'Idle'
}

export function HHScSyncStatus() {
  const { refreshSilent, brand, level, getGroup } = useHHList()
  const { groupId = '' } = useParams<{ groupId: string }>()
  const group = groupId ? getGroup(groupId) : undefined
  const [data, setData] = useState<HHScSyncSnapshot | null>(null)
  const refreshSilentRef = useRef(refreshSilent)
  useEffect(() => {
    refreshSilentRef.current = refreshSilent
  }, [refreshSilent])
  const wasRunningRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    let running = false

    const stop = () => {
      if (timer != null) {
        window.clearTimeout(timer)
        timer = null
      }
    }

    const load = () => {
      getHHScSyncStatus(brand)
        .then((res) => {
          if (cancelled) return
          setData(res.data)
          running =
            res.data.running ||
            Boolean(res.data.cart?.running) ||
            Boolean(res.data.cart?.verifying) ||
            Boolean(res.data.cart?.placing)
          if (running || wasRunningRef.current) refreshSilentRef.current()
          wasRunningRef.current = running
        })
        .catch(() => {
          if (cancelled) return
        })
        .finally(() => {
          if (cancelled) return
          stop()
          timer = window.setTimeout(load, running ? POLL_RUNNING_MS : POLL_IDLE_MS)
        })
    }

    load()
    return () => {
      cancelled = true
      stop()
    }
  }, [brand])

  if (!data) return null

  const waitingForCart = level === 'orders' && group ? hhWaitingForCartCount(group.children) : 0
  const persistedCartError = level === 'orders' ? firstPersistedCartError(group) : null
  const busy = isWorkerBusy(data)
  const error = !busy && Boolean(persistedCartError)
  const showWaiting = !busy && !error && waitingForCart > 0
  if (!busy && !error && !showWaiting) return null

  const cart = data.cart
  const tone = error ? 'error' : busy ? 'run' : 'wait'
  const ago = formatAgo(data.lastSuccessAt || cart?.lastSuccessAt || null)
  const title = [
    ago ? `Last success ${ago}` : null,
    'Fills details after upload, then drafts a cart and checks it against the live B2B document. Place Order re-checks before submit.',
  ]
    .filter(Boolean)
    .join(' · ')

  const chip = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] leading-snug sm:text-xs ${
        error
          ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
          : tone === 'run'
            ? 'max-w-[min(100%,22rem)] bg-[var(--primary-100)] text-[var(--accent-200)] dark:text-[var(--accent-200)]'
            : 'max-w-[min(100%,22rem)] bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
      }`}
      title={error ? undefined : title}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          tone === 'error'
            ? 'bg-red-500'
            : tone === 'run'
              ? 'animate-pulse bg-[var(--accent-100)]'
              : 'bg-amber-500'
        }`}
        aria-hidden="true"
      />
      {error ? (
        <span className="inline-flex items-center gap-1">
          Failed
          <span
            className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-current text-[9px] font-semibold leading-none"
            aria-hidden="true"
          >
            ?
          </span>
        </span>
      ) : (
        <span className="truncate">{statusLabel(data, waitingForCart)}</span>
      )}
    </span>
  )

  if (error && persistedCartError) {
    return <Tooltip content={persistedCartError}>{chip}</Tooltip>
  }
  return chip
}
