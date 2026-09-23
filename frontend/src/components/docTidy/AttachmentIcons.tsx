import { useState } from 'react'
import { authApi } from '../../lib/api'
import { ErrorIcon, SuccessIcon } from '../labels/labelUi'
import { LiveReasoningSnippet, Spinner, TableActionButton } from './docTidyUi'
import { PARSEABLE } from './AttachmentCell'
import { isParseRunning, type DocTidyMessage, type DocTidyParseJob } from '../../types/docTidy'

/**
 * Parse-action icons for one message row in the results table.
 *
 * Each parseable attachment gets its own action button in the Actions column:
 * - No job yet → bolt icon, click starts a parse and opens the reasoning panel.
 * - Running    → sky spinner, click opens the panel to watch progress.
 * - Completed  → emerald check, click opens the panel to review output.
 * - Failed     → rose alert, click opens the panel to see the error.
 *
 * The PDF-open link and the View-drawer button are intentionally absent here:
 * PDFs are accessible from the detail drawer, and the row itself is now
 * clickable so the eye button is redundant. This column is parse-actions only.
 *
 * Renders nothing when a message has no parseable attachments, so rows without
 * PDFs have a clean empty cell rather than a placeholder.
 */
export default function AttachmentIcons({
  message,
  onOpenJob,
  onChanged,
}: {
  message: DocTidyMessage
  onOpenJob: (jobId: string) => void
  onChanged: () => void
}) {
  const [startingIndex, setStartingIndex] = useState<number | null>(null)
  const [failedIndex, setFailedIndex] = useState<{ index: number; message: string } | null>(null)

  const startParse = async (index: number) => {
    setStartingIndex(index)
    setFailedIndex(null)
    try {
      await authApi.post<{ data: DocTidyParseJob }>(
        `/doc-tidy/messages/${message._id}/attachments/${index}/parse`
      )
      onChanged()
    } catch (err) {
      setFailedIndex({ index, message: (err as Error).message })
    } finally {
      setStartingIndex(null)
    }
  }

  // Only render buttons for parseable attachments; skip entirely when none exist.
  const parseableItems = message.attachments
    .map((att, i) => ({ att, i }))
    .filter(({ att }) => PARSEABLE.test(att.filename) && Boolean(att.driveFileId) && !att.uploadError)

  if (parseableItems.length === 0) return null

  return (
    <div className="flex items-center justify-center gap-0.5">
      {parseableItems.map(({ i }) => {
        const job = message.parseJobs?.find((j) => j.attachmentIndex === i)
        const failure = failedIndex?.index === i ? failedIndex.message : null

        if (job) {
          const running = isParseRunning(job.status)

          // Running — live reasoning snippet; abort lives inside the reasoning panel
          if (running) {
            return (
              <LiveReasoningSnippet
                key={i}
                jobId={job._id}
                onOpen={() => onOpenJob(job._id)}
              />
            )
          }

          // Finished / failed — open the panel on click.
          // Completed jobs show a "View Tidy Reasoning" text link; failed jobs keep the icon-only button.
          return (
            <span key={i} className="flex items-center gap-0.5">
              {job.status === 'completed' ? (
                <button
                  type="button"
                  title="Open Tidy Agent's reasoning and output"
                  onClick={() => onOpenJob(job._id)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400 transition-all hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                >
                  <SuccessIcon className="h-5 w-5 shrink-0" />
                  View Tidy Reasoning
                </button>
              ) : (
                <TableActionButton
                  label={job.error ?? 'Parse failed — open to see error'}
                  onClick={() => onOpenJob(job._id)}
                >
                  <ErrorIcon className="h-5 w-5 text-rose-500" />
                </TableActionButton>
              )}
            </span>
          )
        }

        // No job yet — plain text at rest, styled on hover, stays compact
        return (
          <button
            key={i}
            type="button"
            title={failure ? `Parse failed — ${failure}` : 'Send this document to Tidy Agent for parsing'}
            onClick={() => void startParse(i)}
            disabled={startingIndex !== null}
            className="group inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-200)] transition-all hover:bg-[var(--primary-100)] hover:text-[var(--accent-200)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {startingIndex === i ? (
              <Spinner className="h-3 w-3" />
            ) : failure ? (
              <svg className="h-3 w-3 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            ) : (
              <svg className="h-3 w-3 opacity-60 group-hover:opacity-100" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
              </svg>
            )}
            {failure ? 'Retry' : 'Send to Tidy Agent'}
          </button>
        )
      })}
    </div>
  )
}
