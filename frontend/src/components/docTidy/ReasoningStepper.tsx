import { useEffect, useRef, useState } from 'react'

/**
 * Split the agent's streamed narration into discrete steps on blank-line
 * boundaries. Each paragraph becomes one step in the vertical timeline.
 */
function parseSteps(content: string): string[] {
  return content
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** First sentence of a step, capped at 72 chars, used as the collapsed label. */
function shortLabel(step: string): string {
  const firstLine = step.split('\n')[0].replace(/^[\d.)\-\s]+/, '').trim()
  return firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 72).trimEnd()}…`
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function ChevronUp({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  )
}

/**
 * Vertical timeline of the agent's reasoning steps.
 *
 * Each blank-line-separated paragraph from the stream becomes one step.
 * Completed steps are collapsed by default (clickable to expand).
 * The current live step is always expanded and shows a "Processing" badge.
 * Auto-scrolls to the latest step while the job is running, unless the user
 * has manually selected a different step.
 */
export default function ReasoningStepper({
  content,
  live,
}: {
  content: string
  live: boolean
}) {
  const steps = parseSteps(content)
  const lastIndex = steps.length - 1

  // null = auto (last step); number = user clicked a specific step
  const [selected, setSelected] = useState<number | null>(null)
  const lastStepRef = useRef<HTMLDivElement>(null)
  const prevStepCountRef = useRef(steps.length)

  // Reset selection when a new run clears the transcript
  useEffect(() => {
    if (steps.length === 0 && prevStepCountRef.current > 0) {
      setSelected(null)
    }
    prevStepCountRef.current = steps.length
  }, [steps.length])

  // Auto-scroll the newest step into view while live
  useEffect(() => {
    if (live && selected === null) {
      lastStepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [steps.length, live, selected])

  /* ── Empty state ── */
  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        {live ? (
          <>
            <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary-100)]">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-200)]/20" />
              <span className="h-3.5 w-3.5 animate-pulse rounded-full bg-[var(--accent-200)]" />
            </div>
            <p className="text-sm font-medium text-[var(--text-100)]">Agent is starting up…</p>
            <p className="mt-1 text-xs text-[var(--text-200)]">Reasoning steps will appear here as they are produced.</p>
          </>
        ) : (
          <>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-200)]">
              <svg className="h-6 w-6 text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--text-100)]">No reasoning recorded</p>
            <p className="mt-1 text-xs text-[var(--text-200)]">
              This document was parsed before reasoning capture was introduced.
              Re-run it to record the agent's thought process.
            </p>
          </>
        )}
      </div>
    )
  }

  const expandedIndex = selected ?? lastIndex

  const toggle = (i: number) => {
    // Clicking the auto-expanded last step when not live collapses it;
    // clicking the user-selected step deselects; clicking any other expands it.
    setSelected((prev) => (prev === i ? null : i))
  }

  return (
    <div className="py-2">
      {steps.map((step, i) => {
        const isLast = i === lastIndex
        const isCurrent = isLast && live
        const isExpanded = i === expandedIndex

        return (
          <div key={i} ref={isLast ? lastStepRef : undefined} className="flex gap-0">
            {/* ── Left: vertical timeline ── */}
            <div className="mr-4 flex w-7 shrink-0 flex-col items-center">
              {/* Step node */}
              <div
                className={`
                  relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                  transition-all duration-200
                  ${isCurrent
                    ? 'bg-[var(--accent-200)] text-white shadow-md shadow-[var(--accent-200)]/25'
                    : isExpanded
                      ? 'bg-emerald-500 text-white ring-[3px] ring-emerald-100 dark:ring-emerald-900/40'
                      : 'bg-emerald-500 text-white'
                  }
                `}
              >
                {isCurrent && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-200)]/35" />
                )}
                <span className="relative">
                  {isCurrent
                    ? <span className="text-[10px] font-bold leading-none">{i + 1}</span>
                    : <CheckIcon className="h-3.5 w-3.5" />
                  }
                </span>
              </div>
              {/* Connector line to next step */}
              {!isLast && (
                <div className="my-1 w-px flex-1 rounded-full bg-[var(--bg-300)] min-h-[16px]" />
              )}
            </div>

            {/* ── Right: step content ── */}
            <div className={`min-w-0 flex-1 ${isLast ? 'pb-2' : 'pb-3'}`}>
              <button
                type="button"
                onClick={() => toggle(i)}
                className="group w-full cursor-pointer text-left focus:outline-none"
              >
                <div className="flex items-start gap-2 pt-0.5">
                  <div className="min-w-0 flex-1">
                    {/* Step label */}
                    <span
                      className={`block text-[10px] font-semibold uppercase tracking-widest leading-none mb-0.5 ${
                        isCurrent ? 'text-[var(--accent-200)]' : 'text-[var(--text-200)]'
                      }`}
                    >
                      Step {i + 1}
                    </span>
                    <p
                      className={`text-sm leading-snug transition-colors ${
                        isExpanded
                          ? 'font-semibold text-[var(--text-100)]'
                          : 'text-[var(--text-100)] group-hover:text-[var(--accent-200)]'
                      }`}
                    >
                      {shortLabel(step)}
                    </p>
                  </div>

                  {/* Status badges / chevron */}
                  <div className="mt-0.5 shrink-0 flex items-center gap-1.5">
                    {isCurrent && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-200)]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-200)]" />
                        Processing
                      </span>
                    )}
                    {!isCurrent && isExpanded && (
                      <ChevronUp className="h-3.5 w-3.5 text-[var(--accent-200)]" />
                    )}
                    {!isCurrent && !isExpanded && (
                      <ChevronDown className="h-3.5 w-3.5 text-[var(--text-200)] transition-colors group-hover:text-[var(--accent-200)]" />
                    )}
                  </div>
                </div>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="mt-2.5 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-200)] px-4 py-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-100)]">
                    {step}
                  </p>
                  {isCurrent && (
                    <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--bg-300)] pt-2.5 text-[11px] text-[var(--accent-200)]">
                      <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[var(--accent-200)]" />
                      Agent is still working on this step…
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Trailing "still thinking" node when live and at least one step exists */}
      {live && steps.length > 0 && (
        <div className="flex gap-0">
          <div className="mr-4 flex w-7 shrink-0 flex-col items-center">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-[var(--bg-300)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text-200)]" />
            </div>
          </div>
          <div className="flex-1 pb-2 pt-1.5">
            <p className="text-[11px] italic text-[var(--text-200)]">More steps may follow…</p>
          </div>
        </div>
      )}
    </div>
  )
}
