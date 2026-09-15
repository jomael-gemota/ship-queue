import { formatBytes } from '../../lib/format'
import { PdfIcon } from '../labels/labelUi'
import { ParseStatusChip } from './docTidyUi'
import { isParseRunning, type DocTidyMessage } from '../../types/docTidy'

/** Attachments the agent can read; anything else can't be sent for parsing. */
export const PARSEABLE = /\.(pdf)$/i

/**
 * A message's attachments — each rendered as a polished card showing the
 * PDF icon, filename (linked when available), file size, and parse status.
 *
 * Starting a parse lives in the results table's Actions column next to each
 * attachment's icon. This view is read-only: it reflects whatever job is
 * running or finished, and clicking the status chip opens the agent's
 * reasoning for it.
 */
export default function AttachmentCell({
  message,
  onOpenJob,
}: {
  message: DocTidyMessage
  onOpenJob: (jobId: string) => void
}) {
  const jobFor = (index: number) => message.parseJobs?.find((job) => job.attachmentIndex === index)

  if (message.attachments.length === 0) {
    return (
      <p className="text-sm italic text-[var(--text-200)]">No attachments.</p>
    )
  }

  return (
    <ul className="space-y-2">
      {message.attachments.map((att, i) => {
        const job = jobFor(i)

        return (
          <li
            key={`${message._id}-${i}`}
            className="flex items-start gap-3 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-200)] p-3"
          >
            {/* PDF icon */}
            <PdfIcon className="mt-0.5 h-9 w-9 shrink-0" />

            {/* File info */}
            <div className="min-w-0 flex-1">
              {/* Filename */}
              {att.webViewLink ? (
                <a
                  href={att.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm font-medium text-[var(--accent-200)] hover:underline"
                  title={att.filename}
                >
                  {att.filename}
                </a>
              ) : (
                <span
                  className="break-all text-sm font-medium text-slate-600 dark:text-[var(--text-200)]"
                  title={att.uploadError || att.filename}
                >
                  {att.filename}
                </span>
              )}

              {/* Meta row: size + parse status */}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-400">{formatBytes(att.size)}</span>

                {job && (
                  <button
                    type="button"
                    onClick={() => onOpenJob(job._id)}
                    title={
                      job.error ??
                      (isParseRunning(job.status)
                        ? 'The agent is working on this — open to watch'
                        : 'Open the agent\u2019s reasoning and output')
                    }
                    className="shrink-0 cursor-pointer"
                  >
                    <ParseStatusChip status={job.status} />
                  </button>
                )}

                {att.uploadError && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
                    <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
                      />
                    </svg>
                    Upload failed
                  </span>
                )}
              </div>

              {/* Full upload error detail */}
              {att.uploadError && (
                <p className="mt-1 break-words text-[11px] text-rose-600 dark:text-rose-400">
                  {att.uploadError}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
