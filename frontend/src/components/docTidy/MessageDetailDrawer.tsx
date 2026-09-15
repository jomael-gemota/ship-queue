import { useEffect, useState } from 'react'
import { authApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { DocumentTypeBadge, avatarColour } from './docTidyUi'
import AttachmentCell from './AttachmentCell'
import type { DocTidyMessage } from '../../types/docTidy'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Tiny section-label typestyle — reused throughout the drawer. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-200)]">
      {children}
    </p>
  )
}

/** Skeleton pulse bar for the loading state. */
function SkeletonLine({ width = 'w-full' }: { width?: string }) {
  return <span className={`block h-3 animate-pulse rounded bg-[var(--bg-300)] ${width}`} />
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Right-side drawer with every detail of one extracted message.
 *
 * Opens instantly from the row's already-loaded data and back-fills bodyText
 * from a background fetch, so the drawer never shows an empty shell. Every
 * field wraps instead of truncating — this is the full-detail view.
 */
export default function MessageDetailDrawer({
  message,
  onClose,
  onOpenJob,
}: {
  message: DocTidyMessage
  onClose: () => void
  onOpenJob: (jobId: string) => void
}) {
  const [detail, setDetail] = useState<DocTidyMessage>(message)
  const [visible, setVisible] = useState(false)
  const [loadingBody, setLoadingBody] = useState(true)

  useEffect(() => {
    setDetail(message)
    setLoadingBody(true)
    let cancelled = false

    authApi
      .get<{ data: DocTidyMessage }>(`/doc-tidy/messages/${message._id}`)
      .then((res) => {
        if (cancelled) return
        // The detail endpoint doesn't join parse jobs — keep the row's copy.
        setDetail((prev) => ({ ...prev, ...res.data, parseJobs: prev.parseJobs }))
        setLoadingBody(false)
      })
      .catch(() => {
        if (!cancelled) setLoadingBody(false)
      })

    return () => {
      cancelled = true
    }
  }, [message])

  // Slide in on the first frame rather than needing a custom keyframe.
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

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

  const initial = (detail.fromName || detail.from).charAt(0).toUpperCase()
  const bgColour = avatarColour(detail.fromName || detail.from)
  const showingPreviewOnly = !detail.bodyText && Boolean(detail.snippet)
  const gmailLink = `https://mail.google.com/mail/u/0/#all/${detail.gmailMessageId}`

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Message details"
        className={`relative z-10 flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl transition-transform duration-200 ease-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Accent gradient line */}
        <div className="h-[3px] w-full shrink-0 bg-gradient-to-r from-[var(--accent-200)] via-[var(--accent-100)] to-[var(--primary-200)]" />

        {/* ── Header ────────────────────────────────────────────────── */}
        <header className="shrink-0 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-5 pb-4 pt-3.5">
          {/* Top row: label + action buttons */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-200)]">
              Message details
            </span>
            <div className="flex items-center gap-1">
              {/* Open in Gmail */}
              <a
                href={gmailLink}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in Gmail"
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] transition-colors hover:bg-[var(--bg-300)]/60 hover:text-[var(--text-100)]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
              {/* Close */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] transition-colors hover:bg-[var(--bg-300)]/60 hover:text-[var(--text-100)]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Subject */}
          <h3 className="break-words text-[13px] font-semibold leading-snug text-[var(--text-100)]">
            {detail.subject || '(no subject)'}
          </h3>

          {/* Metadata row */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="flex items-center gap-1 text-[11px] text-[var(--text-200)]">
              <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z"
                />
              </svg>
              {formatDateTime(detail.sentAt)}
            </span>
            <DocumentTypeBadge value={detail.documentType} />
            {detail.ruleName ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[11px] text-[var(--accent-200)]">
                <svg className="h-2.5 w-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z"
                  />
                </svg>
                {detail.ruleName}
              </span>
            ) : (
              <span className="text-[11px] italic text-[var(--text-200)]">no rule</span>
            )}
          </div>
        </header>

        {/* ── Scrollable body ──────────────────────────────────────── */}
        <div className="min-h-0 flex-1 divide-y divide-[var(--bg-300)] overflow-y-auto">

          {/* FROM */}
          <section className="px-5 py-4">
            <SectionLabel>From</SectionLabel>
            <div className="flex items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${bgColour}`}
              >
                {initial}
              </span>
              <div className="min-w-0">
                {detail.fromName ? (
                  <>
                    <p className="break-words text-[12px] font-medium text-[var(--text-100)]">{detail.fromName}</p>
                    <p className="break-all text-[11px] text-[var(--text-200)]">{detail.from}</p>
                  </>
                ) : (
                  <p className="break-all text-[12px] text-[var(--text-100)]">{detail.from}</p>
                )}
              </div>
            </div>
          </section>

          {/* TO */}
          <section className="px-5 py-4">
            <SectionLabel>To</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {detail.to?.length ? (
                detail.to.map((addr) => (
                  <span
                    key={addr}
                    className="break-all rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] px-2 py-0.5 text-[11px] text-[var(--text-100)]"
                  >
                    {addr}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-[var(--text-200)]">—</span>
              )}
            </div>
          </section>

          {/* ATTACHMENTS */}
          <section className="px-5 py-4">
            <SectionLabel>
              Attachments
              {detail.attachments.length > 0 && (
                <span className="ml-1.5 font-normal normal-case tracking-normal text-[var(--text-200)]">
                  ({detail.attachments.length})
                </span>
              )}
            </SectionLabel>
            <AttachmentCell message={detail} onOpenJob={onOpenJob} />
          </section>

          {/* MESSAGE BODY */}
          <section className="px-5 py-4">
            <div className="mb-2.5 flex items-center justify-between">
              <SectionLabel>Message</SectionLabel>
              {showingPreviewOnly && (
                <span className="mb-2.5 text-[10px] italic text-[var(--text-200)]">
                  Preview only
                </span>
              )}
            </div>

            {loadingBody ? (
              <div className="space-y-2.5">
                <SkeletonLine />
                <SkeletonLine width="w-5/6" />
                <SkeletonLine width="w-4/6" />
                <SkeletonLine width="w-full" />
                <SkeletonLine width="w-3/4" />
              </div>
            ) : detail.bodyText || detail.snippet ? (
              <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--bg-300)] bg-[var(--bg-200)] p-4">
                <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--text-100)]">
                  {detail.bodyText || detail.snippet}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--bg-300)] p-4 text-[12px] italic text-[var(--text-200)]">
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
                No message content available.
              </div>
            )}
          </section>

          {/* Captured date footer */}
          <div className="px-5 py-3.5">
            <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-200)]">
              <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Captured {formatDateTime(detail.extractedAt)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
