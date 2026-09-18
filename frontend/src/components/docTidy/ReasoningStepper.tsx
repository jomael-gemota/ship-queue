import { useEffect, useRef, useState } from 'react'

/**
 * Split the streamed narration into discrete steps on blank-line boundaries.
 * Each paragraph becomes one timeline entry.
 */
function parseSteps(content: string): string[] {
  return content
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  )
}

/**
 * Vertical timeline of the agent's full reasoning.
 *
 * Each blank-line-separated paragraph is shown in full — no truncation, no
 * collapsing. The current live step is highlighted and shows a "Processing"
 * pulse badge. The timeline auto-scrolls to the newest entry while the job
 * is running, unless the user has scrolled away.
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
  const lastStepRef = useRef<HTMLDivElement>(null)
  const prevStepCountRef = useRef(steps.length)

  // Auto-scroll the latest step into view while the job is live
  useEffect(() => {
    if (live) {
      lastStepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [steps.length, live])

  // Track step count for reset logic
  useEffect(() => {
    prevStepCountRef.current = steps.length
  }, [steps.length])

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
            <p className="mt-1 text-xs text-[var(--text-200)]">
              Reasoning steps will appear here as they are produced.
            </p>
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
              Re-run the agent to capture its thought process.
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="py-1">
      {steps.map((step, i) => {
        const isLast = i === lastIndex
        const isCurrent = isLast && live

        return (
          <div
            key={i}
            ref={isLast ? lastStepRef : undefined}
            className="flex gap-0"
          >
            {/* ── Left: timeline rail ── */}
            <div className="mr-4 flex w-7 shrink-0 flex-col items-center">
              {/* Node */}
              <div
                className={`
                  relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                  transition-all duration-200
                  ${isCurrent
                    ? 'bg-[var(--accent-200)] text-white shadow-md shadow-[var(--accent-200)]/30'
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
              {/* Connector line */}
              {!isLast && (
                <div className="my-1 w-px flex-1 rounded-full bg-[var(--bg-300)] min-h-[16px]" />
              )}
            </div>

            {/* ── Right: full step content ── */}
            <div
              className={`
                min-w-0 flex-1 rounded-xl px-4 py-3 mb-3
                ${isCurrent
                  ? 'border border-[var(--accent-200)]/25 bg-[var(--primary-100)]/60'
                  : 'border border-[var(--bg-300)] bg-[var(--bg-200)]'
                }
              `}
            >
              {/* Step header */}
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest ${
                    isCurrent ? 'text-[var(--accent-200)]' : 'text-[var(--text-200)]'
                  }`}
                >
                  Step {i + 1}
                </span>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-200)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-200)] border border-[var(--accent-200)]/20">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-200)]" />
                    Processing
                  </span>
                )}
                {!isCurrent && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckIcon className="h-2.5 w-2.5" />
                    Done
                  </span>
                )}
              </div>

              {/* Full agent reasoning text */}
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-100)]">
                {step}
              </p>

              {/* Streaming cursor indicator */}
              {isCurrent && (
                <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--accent-200)]/15 pt-2.5">
                  <span className="flex gap-0.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent-200)]/70 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent-200)]/70 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent-200)]/70 [animation-delay:300ms]" />
                  </span>
                  <span className="text-[11px] text-[var(--accent-200)]">
                    AI agent is still thinking…
                  </span>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Trailing "more steps" indicator while live */}
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
