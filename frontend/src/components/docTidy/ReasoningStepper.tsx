import { useEffect, useRef, useState } from 'react'

/**
 * The agent narrates each pipeline stage as a paragraph, so blank lines are the
 * step boundaries. Splitting on them turns a wall of streamed text into
 * something scannable without the worker having to emit structured events.
 */
function parseSteps(content: string): string[] {
  return content
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function shortLabel(step: string): string {
  const firstLine = step.split('\n')[0].replace(/^[\d.)\-\s]+/, '').trim()
  return firstLine.length <= 32 ? firstLine : `${firstLine.slice(0, 32).trimEnd()}…`
}

/**
 * The agent's process for one document: a rail of steps with the selected step's
 * full text below it.
 *
 * The rail auto-scrolls to the newest step while the job runs, and stops as soon
 * as the user picks one — reading step two while the view jumps to step six is
 * worse than missing the animation.
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

  const [selected, setSelected] = useState<number | null>(null)
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (live && selected === null && railRef.current) {
      railRef.current.scrollLeft = railRef.current.scrollWidth
    }
  }, [content, live, selected])

  if (steps.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-[var(--text-200)]">
        {live
          ? 'Waiting for the agent to start…'
          : 'This document was parsed before its reasoning was recorded. Re-run it to capture the transcript.'}
      </p>
    )
  }

  const activeIndex = Math.min(selected ?? lastIndex, lastIndex)

  return (
    <div className="space-y-3">
      <div ref={railRef} className="overflow-x-auto pb-1 pt-3">
        <ol className="flex min-w-max items-start">
          {steps.map((step, i) => {
            const isCurrent = i === lastIndex && live
            const isSelected = i === activeIndex

            return (
              <li key={i} className="flex items-start">
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  className="flex w-[92px] cursor-pointer flex-col items-center gap-1.5 px-1"
                  title={shortLabel(step)}
                >
                  <span
                    className={`relative flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                      isCurrent
                        ? 'bg-[var(--accent-200)] text-white'
                        : 'bg-emerald-500 text-white'
                    } ${isSelected ? 'ring-4 ring-[var(--primary-100)]' : ''}`}
                  >
                    {isCurrent ? (
                      <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-200)]/30" />
                    ) : null}
                    <span className="relative">{isCurrent ? i + 1 : '✓'}</span>
                  </span>
                  <span
                    className={`line-clamp-2 text-center text-[11px] leading-tight ${
                      isSelected
                        ? 'font-medium text-[var(--text-100)]'
                        : 'text-[var(--text-200)]'
                    }`}
                  >
                    {shortLabel(step)}
                  </span>
                </button>
                {i < lastIndex && (
                  <span className="mt-3 h-0.5 w-4 shrink-0 rounded bg-[var(--bg-300)]" />
                )}
              </li>
            )
          })}
        </ol>
      </div>

      <div className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
          Step {activeIndex + 1} of {steps.length}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-100)]">
          {steps[activeIndex]}
        </p>
      </div>
    </div>
  )
}
