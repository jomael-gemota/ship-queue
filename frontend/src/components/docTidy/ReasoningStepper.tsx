import { useEffect, useRef } from 'react'

function parseSteps(content: string): string[] {
  return content
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

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

  useEffect(() => {
    if (live) {
      lastStepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [steps.length, live])

  /* ── Empty state ── */
  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        {live ? (
          <>
            <div className="relative mb-4 flex h-10 w-10 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-200)]/20" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-200)]" />
            </div>
            <p className="text-sm text-[var(--text-200)]">Agent is starting up…</p>
          </>
        ) : (
          <>
            <svg className="mb-3 h-8 w-8 text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-sm text-[var(--text-200)]">No reasoning recorded — re-run to capture it.</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="relative pl-6">
      {/* Continuous vertical rail */}
      <div className="absolute left-[9px] top-2 bottom-2 w-px bg-[var(--bg-300)]" />

      {steps.map((step, i) => {
        const isLast = i === lastIndex
        const isCurrent = isLast && live

        return (
          <div
            key={i}
            ref={isLast ? lastStepRef : undefined}
            className="relative mb-6 last:mb-2"
          >
            {/* Node on the rail */}
            <div className="absolute -left-6 top-[3px] flex items-center justify-center">
              {isCurrent ? (
                <span className="relative flex h-[18px] w-[18px] items-center justify-center">
                  <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-200)]/30" />
                  <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--accent-200)] shadow-sm shadow-[var(--accent-200)]/50" />
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-emerald-400 dark:bg-emerald-500" />
              )}
            </div>

            {/* Content */}
            <div
              className={`pl-1 ${
                isCurrent
                  ? 'border-l-2 border-[var(--accent-200)]/40 pl-3 -ml-3'
                  : ''
              }`}
            >
              {/* Meta line */}
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-widest ${
                    isCurrent ? 'text-[var(--accent-200)]' : 'text-[var(--text-200)]'
                  }`}
                >
                  Step {i + 1}
                </span>
                {isCurrent && (
                  <span className="flex items-center gap-1 text-[10px] text-[var(--accent-200)]">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-[var(--accent-200)]" />
                    processing
                  </span>
                )}
              </div>

              {/* Reasoning text */}
              <p
                className={`whitespace-pre-wrap text-xs leading-relaxed ${
                  isCurrent ? 'text-[var(--text-100)]' : 'text-[var(--text-200)]'
                }`}
              >
                {step}
              </p>

              {/* Typing indicator on active step */}
              {isCurrent && (
                <span className="mt-2 inline-flex items-end gap-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent-200)]/60 [animation-delay:0ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent-200)]/60 [animation-delay:120ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent-200)]/60 [animation-delay:240ms]" />
                </span>
              )}
            </div>
          </div>
        )
      })}

      {/* Ghost node while more steps may arrive */}
      {live && steps.length > 0 && (
        <div className="relative mb-2">
          <div className="absolute -left-6 top-[3px] flex items-center justify-center">
            <span className="h-2 w-2 rounded-full border border-dashed border-[var(--bg-300)]" />
          </div>
          <p className="pl-1 text-[11px] italic text-[var(--text-200)]">
            More steps may follow…
          </p>
        </div>
      )}
    </div>
  )
}
