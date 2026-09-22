import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const GAP_ABOVE = 12
const GAP_BELOW = 18
const PAD = 8

export function Tooltip({
  content,
  children,
}: {
  content?: string
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
    setCoords((current) => ({ ...current, ready: false }))
  }

  const scheduleOpen = () => {
    window.clearTimeout(delayRef.current)
    delayRef.current = window.setTimeout(() => setOpen(true), 160)
  }

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const tip = tipRef.current
    if (!trigger || !tip) return

    const place = () => {
      const rect = trigger.getBoundingClientRect()
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
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, content])

  if (!content) return children

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex shrink-0"
        onMouseEnter={scheduleOpen}
        onMouseLeave={close}
        onFocus={scheduleOpen}
        onBlur={close}
        onPointerDown={close}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className={`pointer-events-none fixed z-[80] max-w-xs rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium leading-snug text-white shadow-lg dark:bg-[var(--bg-300)] dark:text-[var(--text-100)] ${
              content.includes('\n') ? 'whitespace-pre-line text-left' : 'text-center'
            }`}
            style={{
              top: coords.top,
              left: coords.left,
              visibility: coords.ready ? 'visible' : 'hidden',
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}
