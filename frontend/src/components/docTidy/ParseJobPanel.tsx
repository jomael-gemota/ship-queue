import React, { useCallback, useEffect, useState } from 'react'
import { authApi } from '../../lib/api'
import { useParseJobStream } from '../../hooks/useParseJobStream'
import { ParseStatusChip, Spinner } from './docTidyUi'
import ReasoningStepper from './ReasoningStepper'
import CorrectionEditor, { CorrectionHistory } from './CorrectionEditor'
import {
  isParseRunning,
  type DocTidyCorrection,
  type DocTidyParseJob,
} from '../../types/docTidy'

type Tab = 'reasoning' | 'corrections'

/** Must match the error the server stores when a parse is aborted
 *  (`abortParseJob` in `src/controllers/docTidyParse.controller.ts`). */
const PARSE_STOPPED_MESSAGE = 'Parsing was stopped by the user.'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'reasoning',
    label: 'Reasoning',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
      </svg>
    ),
  },
  {
    id: 'corrections',
    label: 'Corrections',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      </svg>
    ),
  },
]

/**
 * Everything the agent did with one file, and the place to correct it.
 *
 * The live stream is the source of truth while a job runs and the stored job is
 * the source of truth once it has finished, so both are held and the fresher one
 * wins per field: reasoning always comes from the stream (which replays what was
 * stored before going live), while output falls back to the stored job for a run
 * that completed before this panel was opened.
 */
export default function ParseJobPanel({
  jobId,
  onClose,
  onChanged,
}: {
  jobId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [tab, setTab] = useState<Tab>('reasoning')
  const [job, setJob] = useState<DocTidyParseJob | null>(null)
  const [corrections, setCorrections] = useState<DocTidyCorrection[]>([])
  const [rerunning, setRerunning] = useState(false)
  const [aborting, setAborting] = useState(false)
  // Set once Stop succeeds, so the panel reflects it without waiting on the
  // stream, which may be stalled inside a long model call.
  const [stopped, setStopped] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)

  const stream = useParseJobStream(jobId, epoch)

  const loadJob = useCallback(async () => {
    const res = await authApi.get<{ data: DocTidyParseJob }>(`/doc-tidy/parse-jobs/${jobId}`)
    setJob(res.data)
  }, [jobId])

  const loadCorrections = useCallback(async () => {
    const res = await authApi.get<{ data: DocTidyCorrection[] }>(
      `/doc-tidy/parse-jobs/${jobId}/corrections`
    )
    setCorrections(res.data)
  }, [jobId])

  useEffect(() => {
    void loadJob()
    void loadCorrections()
  }, [loadJob, loadCorrections])

  // The stream carries the tokens but not the persisted job fields (vendor,
  // timestamps), so refresh once the run ends. Also reload corrections so the
  // history reflects any that the new run's completion may have affected.
  const finished = stream.status === 'completed' || stream.status === 'failed'
  useEffect(() => {
    if (!finished) return
    void loadJob()
    void loadCorrections()
    onChanged()
  }, [finished, loadJob, loadCorrections, onChanged])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const rerun = async () => {
    setRerunning(true)
    setActionError(null)
    try {
      // Email jobs: re-download fresh bytes from Drive, exactly like the table's
      // per-attachment button does. This ensures the modal's Re-run and the
      // table's Re-run are identical code paths, so corrections are applied the
      // same way in both.
      // PDF-import jobs: use the dedicated /rerun endpoint (no Drive source to
      // re-download from; GridFS is the authoritative copy).
      if (job?.source === 'email') {
        await authApi.post(
          `/doc-tidy/messages/${job.messageId}/attachments/${job.attachmentIndex}/parse`
        )
      } else {
        await authApi.post(`/doc-tidy/parse-jobs/${jobId}/rerun`)
      }
      await loadJob()
      onChanged()
      setStopped(false)
      // The job id is unchanged, so bumping the epoch is what reconnects the
      // stream to the new run rather than leaving it on the closed one.
      setEpoch((n) => n + 1)
      setTab('reasoning')
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setRerunning(false)
    }
  }

  const abort = async () => {
    setAborting(true)
    setActionError(null)
    try {
      await authApi.post(`/doc-tidy/parse-jobs/${jobId}/abort`)
      setStopped(true)
      await loadJob()
      onChanged()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setAborting(false)
    }
  }

  const status = stopped
    ? 'failed'
    : stream.status === 'idle'
      ? (job?.status ?? 'pending')
      : stream.status
  const json = stream.json ?? job?.jsonOutput ?? null
  const table = stream.table ?? job?.tableOutput ?? null
  const errorMessage = stream.error ?? job?.error ?? null
  const stoppedByUser = stopped || errorMessage === PARSE_STOPPED_MESSAGE

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Agent parsing details"
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--bg-300)] px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-[var(--text-100)]">
                {job?.filename ?? 'Document'}
              </h3>
              <ParseStatusChip status={status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--text-200)]">
              {job?.vendorName ? `${job.vendorName} · ` : ''}
              {status === 'failed' && stoppedByUser
                ? `Stopped${job?.completedAt ? ` ${new Date(job.completedAt).toLocaleString()}` : ''}`
                : job?.completedAt
                ? `Parsed ${new Date(job.completedAt).toLocaleString()}`
                : isParseRunning(status)
                  ? 'Tidy Agent is working on this now'
                  : 'Not parsed yet'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Abort — only visible while a job is running */}
            {isParseRunning(status) && (
              <button
                type="button"
                onClick={() => void abort()}
                disabled={aborting}
                title="Stop this parse immediately and mark it as failed"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {aborting ? <Spinner className="h-3.5 w-3.5" /> : (
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <rect x="5" y="5" width="14" height="14" rx="2" />
                  </svg>
                )}
                {aborting ? 'Stopping…' : 'Stop'}
              </button>
            )}

            {/* Re-run Agent */}
            <button
              type="button"
              onClick={rerun}
              disabled={rerunning || isParseRunning(status)}
              title={isParseRunning(status) ? 'Agent is already running' : 'Send this document to Tidy Agent again'}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {rerunning ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                </svg>
              )}
              {rerunning ? 'Running…' : 'Re-run Agent'}
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
              className="cursor-pointer inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-200)] transition-colors hover:bg-[var(--bg-300)] hover:text-[var(--text-100)]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        <nav className="flex gap-1 border-b border-[var(--bg-300)] px-5 py-2">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === item.id
                  ? 'bg-[var(--primary-100)] text-[var(--accent-200)]'
                  : 'text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]'
              }`}
            >
              {item.icon}
              {item.label}
              {item.id === 'corrections' && corrections.length > 0 && (
                <span className="ml-0.5 min-w-[18px] rounded-full bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-white">
                  {corrections.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {actionError && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{actionError}</p>
          )}
          {status === 'failed' && stoppedByUser && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-300">
              You stopped this parse. Tidy Agent discarded its work on this document —
              click <span className="font-semibold">Re-run Agent</span> to start it again.
            </div>
          )}
          {status === 'failed' && !stoppedByUser && errorMessage && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/15 dark:text-rose-300">
              {errorMessage}
            </div>
          )}

          {tab === 'reasoning' && (
            <ReasoningStepper
              content={stream.thinking || job?.thinking || ''}
              live={stream.live && isParseRunning(status)}
            />
          )}

          {tab === 'corrections' && (
            <div className="space-y-5">
              {json ? (
                <CorrectionEditor
                  jobId={jobId}
                  original={json}
                  tableOutput={table}
                  onSaved={() => {
                    void loadCorrections()
                    onChanged()
                  }}
                />
              ) : (
                <p className="text-sm text-[var(--text-200)]">
                  There is nothing to correct until Tidy Agent produces output.
                </p>
              )}

              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-200)]">
                  History
                </h4>
                <CorrectionHistory corrections={corrections} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
