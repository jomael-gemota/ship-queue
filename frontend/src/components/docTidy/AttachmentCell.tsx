import { useState } from 'react'
import { authApi } from '../../lib/api'
import { formatBytes } from '../../lib/format'
import { ParseStatusChip, Spinner } from './docTidyUi'
import {
  isParseRunning,
  type DocTidyMessage,
  type DocTidyParseJob,
  type ParseJobSummary,
} from '../../types/docTidy'

const PARSEABLE = /\.(pdf)$/i

/**
 * A message's attachments, each with its own parse action.
 *
 * The action is per attachment rather than per row because a captured message
 * can carry several PDFs, and each is a separate document with its own
 * extraction and its own corrections.
 */
export default function AttachmentCell({
  message,
  onOpenJob,
  onChanged,
}: {
  message: DocTidyMessage
  onOpenJob: (jobId: string) => void
  onChanged: () => void
}) {
  const [starting, setStarting] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const jobFor = (index: number): ParseJobSummary | undefined =>
    message.parseJobs?.find((job) => job.attachmentIndex === index)

  const startParse = async (index: number) => {
    setStarting(index)
    setError(null)
    try {
      const res = await authApi.post<{ data: DocTidyParseJob }>(
        `/doc-tidy/messages/${message._id}/attachments/${index}/parse`
      )
      onChanged()
      onOpenJob(res.data._id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setStarting(null)
    }
  }

  if (message.attachments.length === 0) {
    return <span className="text-xs text-slate-400">None</span>
  }

  return (
    <div className="space-y-1">
      <ul className="space-y-0.5">
        {message.attachments.map((att, i) => {
          const job = jobFor(i)
          // Only PDFs go to the agent; the extractor cannot read anything else,
          // so offering the action would just queue a guaranteed failure.
          const parseable = PARSEABLE.test(att.filename) && Boolean(att.driveFileId)

          return (
            <li key={`${message._id}-${i}`} className="flex items-center gap-1.5">
              {att.webViewLink ? (
                <a
                  href={att.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-[200px] truncate text-[var(--accent-200)] hover:underline"
                  title={att.filename}
                >
                  {att.filename}
                </a>
              ) : (
                <span
                  className="max-w-[200px] truncate text-slate-600 dark:text-[var(--text-200)]"
                  title={att.uploadError || att.filename}
                >
                  {att.filename}
                </span>
              )}

              <span className="whitespace-nowrap text-[11px] text-slate-400">
                {formatBytes(att.size)}
              </span>

              {att.uploadError && (
                <span className="text-[11px] text-red-500" title={att.uploadError}>
                  upload failed
                </span>
              )}

              {job ? (
                <button
                  type="button"
                  onClick={() => onOpenJob(job._id)}
                  title={
                    job.error ??
                    (isParseRunning(job.status)
                      ? 'The agent is working on this — open to watch'
                      : 'Open the agent\u2019s reasoning and output')
                  }
                  className="cursor-pointer"
                >
                  <ParseStatusChip status={job.status} />
                </button>
              ) : parseable ? (
                <button
                  type="button"
                  onClick={() => startParse(i)}
                  disabled={starting !== null}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--bg-300)] px-1.5 py-0.5 text-[11px] text-[var(--text-200)] transition-colors hover:bg-[var(--bg-100)] hover:text-[var(--text-100)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="Send this document to the agent"
                >
                  {starting === i ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                  )}
                  Parse
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>

      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  )
}
