import { useEffect, useRef, useState } from 'react'
import { getHHScSyncStatus } from '../../lib/hhSportswear'
import type { HHScSyncStatus as HHScSyncSnapshot } from '../../lib/hhSportswear'
import { useHHList } from '../../context/HHListContext'

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

function statusLabel(data: HHScSyncSnapshot): string {
  const cart = data.cart
  const filling = data.running
    ? data.currentOrderId
      ? `Filling ${data.currentOrderId}`
      : 'Filling this batch'
    : null
  const drafting = cart?.running
    ? cart.currentOrderId
      ? `Drafting ${cart.currentOrderId}`
      : 'Drafting carts'
    : null
  if (filling && drafting) return `${filling} · ${drafting}`
  if (filling) return filling
  if (drafting) return drafting
  if (data.queuedGroups > 0) return `${data.queuedGroups} batch${data.queuedGroups === 1 ? '' : 'es'} queued`
  if (cart && cart.queued > 0) return `${cart.queued} cart${cart.queued === 1 ? '' : 's'} queued`
  if (data.lastError) return 'Details fill paused'
  if (cart?.lastError) return 'Cart draft paused'
  if (data.pendingUnsynced > 0) return `${data.pendingUnsynced} pending details`
  if (cart && cart.pendingUndrafted > 0) {
    return `${cart.pendingUndrafted} waiting for cart`
  }
  return 'Idle'
}

export function HHScSyncStatus() {
  const { refreshSilent } = useHHList()
  const [data, setData] = useState<HHScSyncSnapshot | null>(null)
  const refreshSilentRef = useRef(refreshSilent)
  refreshSilentRef.current = refreshSilent
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
      getHHScSyncStatus()
        .then((res) => {
          if (cancelled) return
          setData(res.data)
          running = res.data.running || Boolean(res.data.cart?.running)
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
  }, [])

  if (!data) return null

  const cart = data.cart
  const tone =
    (data.lastError || cart?.lastError) && !data.running && !cart?.running
      ? 'error'
      : data.running || cart?.running
        ? 'run'
        : data.pendingUnsynced > 0 ||
            data.queuedGroups > 0 ||
            (cart?.pendingUndrafted ?? 0) > 0 ||
            (cart?.queued ?? 0) > 0
          ? 'wait'
          : 'idle'
  const ago = formatAgo(data.lastSuccessAt || cart?.lastSuccessAt || null)
  const title = [
    data.lastError ? `Details error: ${data.lastError}` : null,
    cart?.lastError ? `Cart error: ${cart.lastError}` : null,
    ago ? `Last success ${ago}` : null,
    'Fills details after upload, then drafts a cart for each synced Order ID',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span
      className={`inline-flex max-w-[min(100%,22rem)] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] leading-none sm:text-xs ${
        tone === 'error'
          ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
          : tone === 'run'
            ? 'bg-[var(--primary-100)] text-[var(--accent-200)] dark:text-[var(--accent-200)]'
            : tone === 'wait'
              ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
              : 'bg-[var(--bg-200)] text-slate-500 dark:text-[var(--text-200)]'
      }`}
      title={title}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          tone === 'error'
            ? 'bg-red-500'
            : tone === 'run'
              ? 'animate-pulse bg-[var(--accent-100)]'
              : tone === 'wait'
                ? 'bg-amber-500'
                : 'bg-slate-400 dark:bg-[var(--bg-300)]'
        }`}
        aria-hidden="true"
      />
      <span className="truncate">{statusLabel(data)}</span>
    </span>
  )
}
