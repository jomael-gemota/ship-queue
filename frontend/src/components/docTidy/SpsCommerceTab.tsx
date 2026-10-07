/**
 * SpsCommerceTab — SPS Transaction API v5 document browser.
 *
 * Lists EDI documents available in the SPS out-directory
 * (`GET /transactions/v5/data/out/{docType}/`) and lets the user filter
 * by PO number (substring match in filename).  Clicking a row downloads
 * and shows the raw EDI XML in a slide-over panel.
 *
 * The SPS Transaction API v5 is a file-queue system, not a queryable database.
 * PO numbers live in filenames (e.g. "PO584615-1-v7.7-BulkImport.xml") so
 * filtering is done client-side after fetching the directory listing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { authApi } from '../../lib/api'
import { Spinner } from './docTidyUi'
import { formatDate } from '../../lib/format'
import type { DocTidySpsSource, SpsDocumentRecord, SpsDocumentsResponse } from '../../types/docTidy'

interface Props {
  workspaceId: string
}

type DocTypeOption = { label: string; value: string }
const DOC_TYPE_OPTIONS: DocTypeOption[] = [
  { label: '(root) — discover available directories', value: '__root__' },
  { label: 'PO — Purchase Orders',           value: 'PO'  },
  { label: '850 — Purchase Orders (EDI)',     value: '850' },
  { label: 'IN — Invoices',                  value: 'IN'  },
  { label: '810 — Invoices (EDI)',            value: '810' },
  { label: 'SN / 856 — Ship Notices (ASN)',  value: 'SN'  },
  { label: '856 — Ship Notices (EDI)',        value: '856' },
  { label: 'Other (type manually)…',         value: ''    },
]

export default function SpsCommerceTab({ workspaceId }: Props) {
  /* ── SPS sources ── */
  const [sources, setSources]         = useState<DocTidySpsSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError]     = useState<string | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)

  /* ── Filters ── */
  const [docType, setDocType]     = useState('PO')
  const [customDocType, setCustomDocType] = useState('')
  const [poFilter, setPoFilter]   = useState('')

  /* ── Document list ── */
  const [records, setRecords]     = useState<SpsDocumentRecord[]>([])
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchError, setFetchError]     = useState<string | null>(null)
  const [hasFetched, setHasFetched]     = useState(false)

  /* ── XML viewer ── */
  const [xmlTarget, setXmlTarget]   = useState<SpsDocumentRecord | null>(null)
  const [xmlContent, setXmlContent] = useState<string | null>(null)
  const [xmlLoading, setXmlLoading] = useState(false)
  const [xmlError, setXmlError]     = useState<string | null>(null)

  const poInputRef = useRef<HTMLInputElement>(null)

  /* Load SPS sources on mount */
  useEffect(() => {
    setSourcesLoading(true)
    setSourcesError(null)
    authApi
      .get<{ data: DocTidySpsSource[] }>(`/doc-tidy/workspaces/${workspaceId}/sps-sources`)
      .then((res) => {
        setSources(res.data)
        if (res.data.length > 0) setSelectedSourceId(res.data[0]._id)
      })
      .catch((err) => setSourcesError(err instanceof Error ? err.message : 'Failed to load SPS sources'))
      .finally(() => setSourcesLoading(false))
  }, [workspaceId])

  useEffect(() => {
    if (!sourcesLoading && sources.length > 0) poInputRef.current?.focus()
  }, [sourcesLoading, sources.length])

  const effectiveDocType = docType === '' ? customDocType.trim().toUpperCase() : docType

  const fetchDocuments = useCallback(async (sourceId: string) => {
    if (docType !== '__root__' && !effectiveDocType) return
    setFetchLoading(true)
    setFetchError(null)
    try {
      const params = new URLSearchParams()
      if (docType !== '__root__') params.set('docType', effectiveDocType)
      if (poFilter.trim()) params.set('poNumber', poFilter.trim())

      const res = await authApi.get<SpsDocumentsResponse>(
        `/doc-tidy/workspaces/${workspaceId}/sps-sources/${sourceId}/documents?${params.toString()}`,
      )
      setRecords(res.data)
      setHasFetched(true)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch SPS documents')
    } finally {
      setFetchLoading(false)
    }
  }, [workspaceId, effectiveDocType, poFilter])

  const handleSearch = () => {
    if (!selectedSourceId) return
    void fetchDocuments(selectedSourceId)
  }

  const handleViewXml = async (rec: SpsDocumentRecord) => {
    setXmlTarget(rec)
    setXmlContent(null)
    setXmlError(null)
    setXmlLoading(true)
    try {
      const res = await authApi.get<{ data: string }>(
        `/doc-tidy/workspaces/${workspaceId}/sps-sources/${selectedSourceId}/documents/${rec.docType}/${encodeURIComponent(rec.filename)}`,
      )
      setXmlContent(res.data)
    } catch (err) {
      setXmlError(err instanceof Error ? err.message : 'Failed to download document')
    } finally {
      setXmlLoading(false)
    }
  }

  /* ── Render helpers ── */
  function fmtBytes(n?: number) {
    if (n === undefined) return '—'
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }

  /* ── States ── */
  if (sourcesLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (sourcesError) {
    return (
      <div className="m-4 rounded-xl border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
        {sourcesError}
      </div>
    )
  }

  if (sources.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 dark:bg-orange-900/30 shadow-sm">
          <svg className="h-7 w-7 text-orange-500 dark:text-orange-400" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="2" width="9" height="9" rx="1.5" fill="currentColor"/>
            <rect x="13" y="2" width="9" height="9" rx="1.5" fill="currentColor"/>
            <rect x="2" y="13" width="9" height="9" rx="1.5" fill="currentColor"/>
            <rect x="13" y="13" width="9" height="9" rx="1.5" fill="currentColor"/>
          </svg>
        </div>
        <div>
          <p className="font-semibold text-[var(--text-100)]">No SPS Commerce account connected</p>
          <p className="mt-1 text-sm text-[var(--text-200)]">
            Open the workspace settings and connect an SPS Commerce account to browse EDI documents.
          </p>
        </div>
      </div>
    )
  }

  const activeSource = sources.find((s) => s._id === selectedSourceId) ?? sources[0]

  return (
    <div className="flex flex-1 flex-col min-h-0 gap-4 p-4">

      {/* ── Connected account info ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-4 py-3 shadow-sm">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
          <svg className="h-4 w-4 text-orange-500 dark:text-orange-400" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="2" width="9" height="9" rx="1.5" fill="currentColor"/>
            <rect x="13" y="2" width="9" height="9" rx="1.5" fill="currentColor"/>
            <rect x="2" y="13" width="9" height="9" rx="1.5" fill="currentColor"/>
            <rect x="13" y="13" width="9" height="9" rx="1.5" fill="currentColor"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          {sources.length === 1 ? (
            <p className="text-sm font-medium text-[var(--text-100)] truncate">
              {activeSource.spsAccountEmail ?? activeSource.spsAccountId ?? 'SPS Commerce account'}
            </p>
          ) : (
            <select
              value={selectedSourceId ?? ''}
              onChange={(e) => {
                setSelectedSourceId(e.target.value)
                setRecords([])
                setHasFetched(false)
                setFetchError(null)
              }}
              className="w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-000)] px-2 py-1 text-sm text-[var(--text-100)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]"
            >
              {sources.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.spsAccountEmail ?? s.spsAccountId ?? s._id}
                </option>
              ))}
            </select>
          )}
          {activeSource.spsConnectedAt && (
            <p className="text-xs text-[var(--text-200)] mt-0.5">
              Connected {formatDate(activeSource.spsConnectedAt)}
              {activeSource.spsConnectedByName ? ` by ${activeSource.spsConnectedByName}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* ── How-it-works note ── */}
      <div className="flex items-start gap-2 rounded-lg border border-sky-200 dark:border-sky-700/40 bg-sky-50 dark:bg-sky-900/20 px-3 py-2.5 text-[11px] text-sky-800 dark:text-sky-300">
        <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          Browses the SPS Transaction API v5 document queue
          (<code className="font-mono">/transactions/v5/data/out/{'{docType}'}/</code>).
          PO numbers are matched client-side by searching filenames.
          Click a row to view the raw EDI XML.
        </span>
      </div>

      {/* ── Filters row ── */}
      <div className="flex flex-wrap items-end gap-2">
        {/* Document type */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[var(--text-200)]">Document type</label>
          <select
            value={docType}
            onChange={(e) => {
              setDocType(e.target.value)
              setRecords([])
              setHasFetched(false)
            }}
            className="rounded-xl border border-[var(--bg-300)] bg-[var(--bg-000)] px-3 py-2 text-sm text-[var(--text-100)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]"
          >
            {DOC_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {docType === '' && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-[var(--text-200)]">Custom type</label>
            <input
              type="text"
              placeholder="e.g. ASN"
              value={customDocType}
              onChange={(e) => setCustomDocType(e.target.value.toUpperCase())}
              className="w-28 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-000)] px-3 py-2 text-sm font-mono text-[var(--text-100)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]"
            />
          </div>
        )}

        {/* PO number filter */}
        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <label className="text-[11px] font-medium text-[var(--text-200)]">Filter by PO number in filename</label>
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-200)]"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              ref={poInputRef}
              type="text"
              placeholder="e.g. 584615"
              value={poFilter}
              onChange={(e) => setPoFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
              className="w-full rounded-xl border border-[var(--bg-300)] bg-[var(--bg-000)] pl-9 pr-3 py-2 text-sm text-[var(--text-100)] placeholder-[var(--text-200)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]"
            />
          </div>
        </div>

        {/* Search button */}
        <button
          type="button"
          disabled={fetchLoading || !selectedSourceId || !effectiveDocType}
          onClick={handleSearch}
          className="inline-flex items-center gap-1.5 self-end rounded-xl bg-[var(--accent-200)] dark:bg-[var(--accent-100)] text-white px-4 py-2 text-sm font-medium shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {fetchLoading ? <Spinner className="h-4 w-4" /> : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Fetch documents
        </button>
      </div>

      {/* ── Error ── */}
      {fetchError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="flex-1">{fetchError}</span>
          <button type="button" onClick={() => setFetchError(null)}
            className="ml-2 shrink-0 rounded p-0.5 opacity-50 hover:opacity-100 cursor-pointer">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Document table ── */}
      {records.length > 0 && (
        <div className="flex flex-col min-h-0 gap-2">
          <p className="text-xs text-[var(--text-200)]">
            {records.length} {docType === '__root__' ? 'director' : 'document'}{records.length !== 1 ? (docType === '__root__' ? 'ies' : 's') : (docType === '__root__' ? 'y' : '')} in{' '}
            <code className="font-mono">out/{docType === '__root__' ? '' : effectiveDocType + '/'}</code>
            {poFilter.trim() && (
              <> · filtered by <span className="font-mono font-medium text-[var(--text-100)]">{poFilter.trim()}</span></>
            )}
          </p>
          <div className="overflow-x-auto rounded-xl border border-[var(--bg-300)] shadow-sm">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--bg-100)] dark:bg-[var(--bg-200)] border-b border-[var(--bg-300)]">
                  <th className="px-3 py-2 text-left font-semibold text-[var(--text-200)] whitespace-nowrap">Filename</th>
                  <th className="px-3 py-2 text-center font-semibold text-[var(--text-200)] whitespace-nowrap">Date</th>
                  <th className="px-3 py-2 text-right font-semibold text-[var(--text-200)] whitespace-nowrap">Size</th>
                  <th className="px-3 py-2 text-center font-semibold text-[var(--text-200)] whitespace-nowrap">View XML</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bg-300)]">
                {records.map((rec) => (
                  <tr key={rec.filename} className="hover:bg-[var(--bg-100)] dark:hover:bg-[var(--bg-200)] transition-colors">
                    <td className="px-3 py-2 font-mono text-[var(--text-100)] max-w-sm truncate" title={rec.filename}>
                      {rec.filename}
                    </td>
                    <td className="px-3 py-2 text-center text-[var(--text-200)] whitespace-nowrap">
                      {rec.createdAt ? formatDate(rec.createdAt) : <span className="opacity-30">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[var(--text-200)] whitespace-nowrap tabular-nums">
                      {fmtBytes(rec.size)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => void handleViewXml(rec)}
                        title="View EDI XML"
                        className="rounded p-1 text-[var(--text-200)] hover:text-[var(--accent-200)] hover:bg-[var(--bg-200)] transition-colors cursor-pointer"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Empty state after fetch ── */}
      {!fetchLoading && hasFetched && records.length === 0 && !fetchError && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--bg-300)] py-12 text-center">
          <svg className="h-8 w-8 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium text-[var(--text-200)]">No documents found</p>
          <p className="text-xs text-[var(--text-200)]">
            The <code className="font-mono">out/{docType === '__root__' ? '' : effectiveDocType + '/'}</code> directory is empty
            {poFilter.trim() && <>, or no filename contains "{poFilter.trim()}"</>}.
          </p>
        </div>
      )}

      {/* ── XML viewer drawer ── */}
      {xmlTarget && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => setXmlTarget(null)} />
          <div className="relative z-10 flex flex-col w-full max-w-2xl h-full border-l border-[var(--bg-300)] bg-[var(--bg-000)] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-4 py-3 shrink-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-100)] truncate">{xmlTarget.filename}</p>
                <p className="text-[11px] text-[var(--text-200)]">Raw EDI XML</p>
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                <a
                  href={xmlTarget.downloadUrl}
                  download={xmlTarget.filename}
                  title="Download file"
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--bg-300)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-200)] hover:text-[var(--text-100)] hover:bg-[var(--bg-100)] transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </a>
                <button type="button" onClick={() => setXmlTarget(null)}
                  className="rounded p-1 text-[var(--text-200)] hover:text-[var(--text-100)] hover:bg-[var(--bg-100)] transition-colors cursor-pointer">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-auto p-4">
              {xmlLoading && (
                <div className="flex items-center justify-center py-16">
                  <Spinner className="h-6 w-6" />
                </div>
              )}
              {xmlError && (
                <p className="text-sm text-rose-500">{xmlError}</p>
              )}
              {xmlContent && !xmlLoading && (
                <pre className="text-[11px] font-mono text-[var(--text-100)] whitespace-pre-wrap break-words leading-relaxed">
                  {xmlContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
