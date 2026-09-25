import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const GAP_ABOVE = 12
const GAP_BELOW = 18
const PAD = 8

export function Tooltip({
  content,
  richContent,
  trigger = 'hover',
  children,
}: {
  /** Plain-text tooltip. Supports multi-line via '\n'. */
  content?: string
  /** Rich JSX tooltip — renders inside a styled floating card. */
  richContent?: ReactNode
  /**
   * 'hover' (default) — opens after a short delay on mouse enter, closes on leave.
   * 'click'           — toggles on click, closes on outside click or Escape.
   */
  trigger?: 'hover' | 'click'
  children: ReactNode
}) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const delayRef = useRef<number>(0)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0, ready: false })

  const close = () => {
    window.clearTimeout(delayRef.current)
    setOpen(false)
    setCoords((c) => ({ ...c, ready: false }))
  }

  /* ── Hover helpers ── */
  const scheduleOpen = () => {
    window.clearTimeout(delayRef.current)
    delayRef.current = window.setTimeout(() => setOpen(true), 160)
  }

  /* ── Click-trigger: close on outside click or Escape ── */
  useEffect(() => {
    if (!open || trigger !== 'click') return
    const onDown = (e: MouseEvent) => {
      if (
        !tipRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, trigger])

  /* ── Positioning ── */
  useLayoutEffect(() => {
    if (!open) return
    const triggerEl = triggerRef.current
    const tip = tipRef.current
    if (!triggerEl || !tip) return

    const place = () => {
      const rect = triggerEl.getBoundingClientRect()
      const tipW = tip.offsetWidth
      const tipH = tip.offsetHeight
      const vw = window.innerWidth
      const canPlaceTop = rect.top >= tipH + GAP_ABOVE + PAD
      const top = canPlaceTop ? rect.top - GAP_ABOVE - tipH : rect.bottom + GAP_BELOW
      let left = rect.left + rect.width / 2 - tipW / 2
      left = Math.min(Math.max(left, PAD), Math.max(PAD, vw - tipW - PAD))
      setCoords({ top, left, ready: true })
    }

    place()

    /* Hover mode closes on scroll; click mode stays open (user deliberately opened it). */
    if (trigger === 'hover') {
      window.addEventListener('scroll', close, true)
      window.addEventListener('resize', close)
      return () => {
        window.removeEventListener('scroll', close, true)
        window.removeEventListener('resize', close)
      }
    }
  }, [open, trigger, content, richContent])

  if (!content && !richContent) return <>{children}</>

  /* ── Trigger props ── */
  const hoverProps =
    trigger === 'hover'
      ? {
          onMouseEnter: scheduleOpen,
          onMouseLeave: close,
          onFocus: scheduleOpen,
          onBlur: close,
          onPointerDown: close,
        }
      : {}

  const clickProps =
    trigger === 'click'
      ? {
          onClick: () => (open ? close() : setOpen(true)),
          role: 'button' as const,
          tabIndex: 0,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              open ? close() : setOpen(true)
            }
          },
        }
      : {}

  return (
    <>
      <span
        ref={triggerRef}
        className={`inline-flex shrink-0 ${trigger === 'click' ? 'cursor-pointer' : ''}`}
        {...hoverProps}
        {...clickProps}
      >
        {children}
      </span>

      {open &&
        createPortal(
          richContent ? (
            /* Rich JSX tooltip */
            <div
              ref={tipRef}
              role="tooltip"
              className={[
                'fixed z-[80] overflow-hidden rounded-xl bg-slate-900 shadow-2xl',
                'ring-1 ring-white/10 dark:bg-[var(--bg-300)] dark:ring-white/5',
                /* click-trigger cards are interactive (not pointer-events-none) */
                trigger === 'click' ? '' : 'pointer-events-none',
              ].join(' ')}
              style={{
                top: coords.top,
                left: coords.left,
                visibility: coords.ready ? 'visible' : 'hidden',
                minWidth: 260,
              }}
            >
              {richContent}
            </div>
          ) : (
            /* Plain-text tooltip */
            <div
              ref={tipRef}
              role="tooltip"
              className={`pointer-events-none fixed z-[80] max-w-xs rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium leading-snug text-white shadow-lg dark:bg-[var(--bg-300)] dark:text-[var(--text-100)] ${
                content!.includes('\n') ? 'whitespace-pre-line text-left' : 'text-center'
              }`}
              style={{
                top: coords.top,
                left: coords.left,
                visibility: coords.ready ? 'visible' : 'hidden',
              }}
            >
              {content}
            </div>
          ),
          document.body,
        )}
    </>
  )
}
