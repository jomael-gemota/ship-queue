import { useCallback, useEffect, useState } from 'react'
import { authApi } from '../../lib/api'
import { useParseJobStream } from '../../hooks/useParseJobStream'
import { ParseStatusChip, Spinner } from './docTidyUi'
import ReasoningStepper from './ReasoningStepper'
import CorrectionEditor, { CorrectionHistory } from './CorrectionEditor'
import VendorSetup from './VendorSetup'
import {
  isParseRunning,
  type DocTidyCorrection,
  type DocTidyParseJob,
} from '../../types/docTidy'

type Tab = 'reasoning' | 'corrections'

const TABS: { id: Tab; label: string }[] = [
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'corrections', label: 'Corrections' },
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
  workspaceId,
  onClose,
  onChanged,
}: {
  jobId: string
  workspaceId?: string
  onClose: () => void
  onChanged: () => void
}) {
  const [tab, setTab] = useState<Tab>('reasoning')
  const [job, setJob] = useState<DocTidyParseJob | null>(null)
  const [corrections, setCorrections] = useState<DocTidyCorrection[]>([])
  const [rerunning, setRerunning] = useState(false)
  const [aborting, setAborting] = useState(false)
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
  // timestamps), so refresh once the run ends.
  const finished = stream.status === 'completed' || stream.status === 'failed'
  useEffect(() => {
    if (!finished) return
    void loadJob()
    onChanged()
  }, [finished, loadJob, onChanged])

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
      await authApi.post(`/doc-tidy/parse-jobs/${jobId}/rerun`)
      await loadJob()
      onChanged()
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
      await loadJob()
      onChanged()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setAborting(false)
    }
  }

  const status = stream.status === 'idle' ? (job?.status ?? 'pending') : stream.status
  const json = stream.json ?? job?.jsonOutput ?? null
  const table = stream.table ?? job?.tableOutput ?? null
  const errorMessage = stream.error ?? job?.error ?? null

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
              {job?.completedAt
                ? `Parsed ${new Date(job.completedAt).toLocaleString()}`
                : isParseRunning(status)
                  ? 'Tidy Agent is working on this now'
                  : 'Not parsed yet'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Abort — only relevant while a job is in flight */}
            {isParseRunning(status) && (
              <button
                type="button"
                onClick={() => void abort()}
                disabled={aborting}
                title="Stop this parse immediately and mark it as failed"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-1.5 text-sm text-rose-600 transition-colors hover:bg-rose-50 hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-900/40 dark:text-rose-400 dark:hover:bg-rose-900/15"
              >
                {aborting ? <Spinner /> : (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                Abort
              </button>
            )}
            <button
              type="button"
              onClick={rerun}
              disabled={rerunning || isParseRunning(status)}
              title={isParseRunning(status) ? 'Agent is already running' : 'Send this document to Tidy Agent again'}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-400 bg-transparent px-3 py-1.5 text-sm font-medium text-amber-500 transition-colors hover:bg-amber-50 hover:border-amber-500 dark:text-amber-400 dark:border-amber-500/60 dark:hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {rerunning ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                </svg>
              )}
              Re-run
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer rounded-lg px-2 py-1.5 text-[var(--text-200)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]"
            >
              ✕
            </button>
          </div>
        </header>

        <nav className="flex gap-1 border-b border-[var(--bg-300)] px-5 py-2">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === item.id
                  ? 'bg-[var(--primary-100)] text-[var(--accent-200)]'
                  : 'text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]'
              }`}
            >
              {item.label}
              {item.id === 'corrections' && corrections.length > 0 && (
                <span className="ml-1.5 text-[11px] text-[var(--text-200)]">
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
          {status === 'failed' && errorMessage && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/15 dark:text-rose-300">
              {errorMessage}
            </div>
          )}

          {job?.vendorNeedsSetup && (
            <VendorSetup
              jobId={jobId}
              workspaceId={workspaceId ?? ''}
              suggestedName={job.vendorName}
              onRegistered={() => {
                void loadJob()
                onChanged()
              }}
            />
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
