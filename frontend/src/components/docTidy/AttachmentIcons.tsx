import { useState } from 'react'
import { authApi } from '../../lib/api'
import { ErrorIcon, SuccessIcon } from '../labels/labelUi'
import { BoltIcon, Spinner, TableActionButton } from './docTidyUi'
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
      const res = await authApi.post<{ data: DocTidyParseJob }>(
        `/doc-tidy/messages/${message._id}/attachments/${index}/parse`
      )
      onChanged()
      onOpenJob(res.data._id)
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
      {parseableItems.map(({ att: _att, i }) => {
        const job = message.parseJobs?.find((j) => j.attachmentIndex === i)
        const failure = failedIndex?.index === i ? failedIndex.message : null

        if (job) {
          // A job exists — show its status and let the user open the panel.
          return (
            <TableActionButton
              key={i}
              label={
                job.error ??
                (isParseRunning(job.status)
                  ? 'The agent is working on this — open to watch'
                  : 'Open the agent\u2019s reasoning and output')
              }
              onClick={() => onOpenJob(job._id)}
            >
              {isParseRunning(job.status) ? (
                <Spinner className="h-5 w-5 text-sky-500" />
              ) : job.status === 'failed' ? (
                <ErrorIcon className="h-5 w-5 text-rose-500" />
              ) : (
                <SuccessIcon className="h-5 w-5 text-emerald-500" />
              )}
            </TableActionButton>
          )
        }

        // No job yet — offer to start one; hidden until the row is hovered
        // (the `group` class lives on the <tr> in DocTidy.tsx).
        return (
          <span key={i} className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <TableActionButton
              label={failure ? `Parse failed — ${failure}` : 'Send this document to the agent'}
              onClick={() => startParse(i)}
              disabled={startingIndex !== null}
            >
              {startingIndex === i ? (
                <Spinner className="h-5 w-5" />
              ) : (
                <BoltIcon className={`h-5 w-5 ${failure ? 'text-rose-500' : ''}`} />
              )}
            </TableActionButton>
          </span>
        )
      })}
    </div>
  )
}
