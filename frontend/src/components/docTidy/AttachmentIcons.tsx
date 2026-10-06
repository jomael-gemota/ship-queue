import { useState } from 'react'
import { authApi } from '../../lib/api'
import { ErrorIcon, SuccessIcon } from '../labels/labelUi'
import { ParseProgressBadge, Spinner } from './docTidyUi'
import { PARSEABLE } from './AttachmentCell'
import { isParseRunning, type DocTidyMessage, type DocTidyParseJob } from '../../types/docTidy'

/**
 * Parse-action icons for one message row in the results table.
 *
 * Each parseable attachment gets its own action button in the Actions column:
 * - No job yet → paper-airplane icon (sky), click starts a parse.
 * - Running    → % progress (sky), click opens the panel to watch.
 * - Completed  → emerald check, click opens the reasoning panel.
 * - Failed     → rose alert, click opens the reasoning panel.
 *
 * Renders nothing when a message has no parseable attachments.
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

          // Running — show % progress; click opens the reasoning panel
          if (running) {
            return (
              <ParseProgressBadge
                key={i}
                jobId={job._id}
                onClick={() => onOpenJob(job._id)}
              />
            )
          }

          // Completed — emerald icon button
          if (job.status === 'completed') {
            return (
              <button
                key={i}
                type="button"
                title="Open Tidy Agent's reasoning and output"
                onClick={() => onOpenJob(job._id)}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-emerald-500 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400"
              >
                <SuccessIcon className="h-4.5 w-4.5" />
              </button>
            )
          }

          // Failed — rose icon button
          return (
            <button
              key={i}
              type="button"
              title={job.error ?? 'Parse failed — open to see error'}
              onClick={() => onOpenJob(job._id)}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-rose-500 transition-colors hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600 dark:hover:text-rose-400"
            >
              <ErrorIcon className="h-4.5 w-4.5" />
            </button>
          )
        }

        // No job yet — envelope + arrow send button (sky blue)
        return (
          <button
            key={i}
            type="button"
            title={failure ? `Parse failed — ${failure}` : 'Send this document to Tidy Agent for parsing'}
            onClick={() => void startParse(i)}
            disabled={startingIndex !== null}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sky-500 transition-colors hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:text-sky-600 dark:hover:text-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {startingIndex === i ? (
              <Spinner className="h-4.5 w-4.5" />
            ) : failure ? (
              <svg className="h-4.5 w-4.5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            ) : (
              /* Envelope + arrow — "send to Tidy Agent for processing" */
              <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 10.5v7.5a2.25 2.25 0 0 0 2.25 2.25h12.75a2.25 2.25 0 0 0 2.25-2.25v-7.5M2.25 10.5 12 15l9.75-4.5M2.25 10.5v-.75A2.25 2.25 0 0 1 4.5 7.5h9.75" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 5.25 21 2.25m0 0h-3.75m3.75 0v3.75" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}
