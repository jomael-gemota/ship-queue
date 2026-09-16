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
  if (data.running) {
    return data.currentOrderId ? `Filling ${data.currentOrderId}` : 'Filling this batch'
  }
  if (data.queuedGroups > 0) return `${data.queuedGroups} batch${data.queuedGroups === 1 ? '' : 'es'} queued`
  if (data.lastError) return 'Details fill paused'
  if (data.pendingUnsynced > 0) return `${data.pendingUnsynced} pending details`
  return 'Details idle'
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
          running = res.data.running
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

  const tone =
    data.lastError && !data.running
      ? 'error'
      : data.running
        ? 'run'
        : data.pendingUnsynced > 0 || data.queuedGroups > 0
          ? 'wait'
          : 'idle'
  const ago = formatAgo(data.lastSuccessAt)
  const title = [
    data.lastError ? `Last error: ${data.lastError}` : null,
    ago ? `Last success ${ago}` : null,
    'Fills right after a batch is uploaded, or when you re-sync details',
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
