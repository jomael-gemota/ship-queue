/**
 * Global floating toast notification system.
 *
 * Usage:
 *   const { addToast } = useToast()
 *   addToast('Done!', 'success')          // auto-dismisses in 3 s
 *   addToast('Something failed', 'error') // auto-dismisses in 6 s
 *   addToast('Heads up', 'warning')       // stays until dismissed
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: string
  message: string
  kind: ToastKind
  /** Duration in ms. 0 = no auto-dismiss. */
  duration: number
}

interface ToastContextValue {
  addToast: (message: string, kind?: ToastKind, duration?: number) => void
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_DURATIONS: Record<ToastKind, number> = {
  success: 3000,
  info: 4000,
  error: 6000,
  warning: 0, // persistent until dismissed
}

// ─── Per-kind styles ─────────────────────────────────────────────────────────

const ACCENT_CLASS: Record<ToastKind, string> = {
  success: 'bg-emerald-500',
  error: 'bg-rose-500',
  warning: 'bg-amber-500',
  info: 'bg-sky-500',
}

const ICON_COLOR: Record<ToastKind, string> = {
  success: 'text-emerald-500',
  error: 'text-rose-500',
  warning: 'text-amber-500',
  info: 'text-sky-500',
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'success') {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  if (kind === 'error') {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    )
  }
  if (kind === 'warning') {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    )
  }
  // info
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

// ─── Individual toast card ────────────────────────────────────────────────────

function ToastCard({
  item,
  onRemove,
}: {
  item: ToastItem
  onRemove: (id: string) => void
}) {
  const [show, setShow] = useState(false)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Animate in on next tick
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 16)
    return () => clearTimeout(t)
  }, [])

  const dismiss = useCallback(() => {
    setShow(false)
    exitTimerRef.current = setTimeout(() => onRemove(item.id), 320)
  }, [item.id, onRemove])

  // Auto-dismiss timer
  useEffect(() => {
    if (item.duration <= 0) return
    const t = setTimeout(dismiss, item.duration)
    return () => clearTimeout(t)
  }, [item.duration, dismiss])

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    },
    [],
  )

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        transform: show ? 'translateX(0)' : 'translateX(calc(100% + 1.5rem))',
        opacity: show ? 1 : 0,
        transition: 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.32s ease',
        pointerEvents: 'auto',
      }}
      className="relative flex w-[22rem] max-w-[calc(100vw-2.5rem)] items-start gap-3 overflow-hidden rounded-xl border border-[var(--bg-300)] bg-white dark:bg-[var(--bg-100)] px-4 py-3.5 shadow-xl shadow-black/10 dark:shadow-black/40"
    >
      {/* Colored left accent bar */}
      <div className={`absolute inset-y-0 left-0 w-[3px] ${ACCENT_CLASS[item.kind]}`} />

      {/* Icon */}
      <span className={`mt-px shrink-0 ${ICON_COLOR[item.kind]}`}>
        <ToastIcon kind={item.kind} />
      </span>

      {/* Message */}
      <p className="flex-1 text-[13px] leading-snug text-[var(--text-100)]">
        {item.message}
      </p>

      {/* Dismiss button */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 cursor-pointer rounded-md p-0.5 text-[var(--text-200)] opacity-50 transition-opacity hover:opacity-100"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Progress drain bar */}
      {item.duration > 0 && (
        <div
          className={`absolute bottom-0 left-[3px] right-0 h-[2px] origin-left ${ACCENT_CLASS[item.kind]}`}
          style={{
            animation: `toast-drain ${item.duration}ms linear forwards`,
          }}
        />
      )}
    </div>
  )
}

// ─── Container (rendered via portal at document.body) ────────────────────────

function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: ToastItem[]
  onRemove: (id: string) => void
}) {
  return createPortal(
    <div
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2.5 pointer-events-none"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} onRemove={onRemove} />
      ))}
    </div>,
    document.body,
  )
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

// ─── Provider ────────────────────────────────────────────────────────────────

let _counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback(
    (message: string, kind: ToastKind = 'info', duration?: number) => {
      const id = String(++_counter)
      const d = duration ?? DEFAULT_DURATIONS[kind]
      setToasts((prev) => [...prev, { id, message, kind, duration: d }])
    },
    [],
  )

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}
