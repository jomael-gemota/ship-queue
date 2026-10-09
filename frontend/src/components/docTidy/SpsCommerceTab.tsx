/**
 * SpsCommerceTab — SPS Transaction API v5 browser.
 *
 * Two modes:
 *   "Transactions" (default) — downloads + parses each EDI file server-side and
 *     shows the results as a rich record table (doc type, PO #, invoice #,
 *     sender, date). Same data as SPS Fulfillment Monitor, sourced from the files.
 *   "Files" — raw directory listing of the mailbox folder (original behaviour).
 *
 * The SPS Transaction API v5 is a file-queue system, not a queryable database.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { authApi } from '../../lib/api'
import { Spinner } from './docTidyUi'
import { formatDate } from '../../lib/format'
import type {
  DocTidySpsSource,
  SpsDocumentRecord,
  SpsDocumentsResponse,
  SpsTransaction,
  SpsTransactionsResponse,
} from '../../types/docTidy'

interface Props {
  workspaceId: string
}

type DocTypeOption = { label: string; value: string }
const TOP_LEVEL = '__top__'
const FOLDER_ROOT = '__root__'
const DOC_TYPE_OPTIONS: DocTypeOption[] = [
  { label: '(top level) — list mailbox folders',    value: TOP_LEVEL   },
  { label: '(folder root) — list document types',   value: FOLDER_ROOT },
  { label: 'PO — Purchase Orders',           value: 'PO'  },
  { label: '850 — Purchase Orders (EDI)',     value: '850' },
  { label: 'IN — Invoices',                  value: 'IN'  },
  { label: '810 — Invoices (EDI)',            value: '810' },
  { label: 'SN / 856 — Ship Notices (ASN)',  value: 'SN'  },
  { label: '856 — Ship Notices (EDI)',        value: '856' },
  { label: 'Other (type manually)…',         value: ''    },
]

const DEFAULT_FOLDER = '__default__'
const FOLDER_OPTIONS: DocTypeOption[] = [
  { label: 'Server default (SPS_DATA_DIR)',                           value: DEFAULT_FOLDER },
  // ── Production ───────────────────────────────────────────────────
  { label: 'in — production inbound (POs, orders from retailers)',    value: 'in'      },
  { label: 'out — production outbound (invoices, ASNs to retailers)', value: 'out'     },
  // ── Sandbox ──────────────────────────────────────────────────────
  { label: 'testin — sandbox inbound (incoming docs, testing)',       value: 'testin'  },
  { label: 'testout — sandbox outbound (outgoing docs, testing)',     value: 'testout' },
  // ── Custom ───────────────────────────────────────────────────────
  { label: 'Other (type manually)…',                                  value: ''        },
]

type ViewMode = 'transactions' | 'files'

export default function SpsCommerceTab({ workspaceId }: Props) {
  /* ── SPS sources ── */
  const [sources, setSources]         = useState<DocTidySpsSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError]     = useState<string | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)

  /* ── View mode ── */
  const [viewMode, setViewMode] = useState<ViewMode>('transactions')

  /* ── Filters ── */
  const [folder, setFolder]       = useState(DEFAULT_FOLDER)
  const [customFolder, setCustomFolder] = useState('')
  const [docType, setDocType]     = useState('PO')
  const [customDocType, setCustomDocType] = useState('')
  const [poFilter, setPoFilter]   = useState('')

  /* ── Transactions view ── */
  const [transactions, setTransactions] = useState<SpsTransaction[]>([])
  const [txNextCursor, setTxNextCursor] = useState<string | null>(null)
  const [txLoading, setTxLoading]       = useState(false)
  const [txError, setTxError]           = useState<string | null>(null)
  const [txFetched, setTxFetched]       = useState(false)

  /* ── Files view (original) ── */
  const [records, setRecords]     = useState<SpsDocumentRecord[]>([])
  const [listedDir, setListedDir] = useState<string | null>(null)
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchError, setFetchError]     = useState<string | null>(null)
  const [hasFetched, setHasFetched]     = useState(false)

  /* ── XML viewer ── */
  const [xmlTarget, setXmlTarget]   = useState<SpsDocumentRecord | null>(null)
  const [xmlContent, setXmlContent] = useState<string | null>(null)
  const [xmlLoading, setXmlLoading] = useState(false)
  const [xmlError, setXmlError]     = useState<string | null>(null)

  const poInputRef    = useRef<HTMLInputElement>(null)
  /** Holds the AbortController for the most-recent in-flight request. */
  const fetchAbortRef = useRef<AbortController | null>(null)

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
  const effectiveFolder  = folder === '' ? customFolder.trim() : folder
  const isTopLevel  = docType === TOP_LEVEL
  const isFolderRoot = docType === FOLDER_ROOT
  const isDirListing = isTopLevel || isFolderRoot

  /** Path shown in hints, e.g. "testout/PO/". Falls back to the last listed folder for the server default. */
  const folderLabel = folder === DEFAULT_FOLDER ? (listedDir ?? 'out') : effectiveFolder
  const listedPath  = isTopLevel ? '/' : `${folderLabel}/${isFolderRoot ? '' : effectiveDocType + '/'}`

  const resetResults = () => {
    setRecords([])
    setHasFetched(false)
    setFetchError(null)
    setTransactions([])
    setTxFetched(false)
    setTxError(null)
    setTxNextCursor(null)
  }

  /* ── Transactions fetch ── */
  const fetchTransactions = useCallback(async (
    sourceId: string,
    opts?: { folderOverride?: string; docTypeOverride?: string },
  ) => {
    const resolvedFolder  = opts?.folderOverride  ?? effectiveFolder
    const resolvedDocType = opts?.docTypeOverride ?? effectiveDocType
    if (!resolvedDocType || !resolvedFolder) return

    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    setTxLoading(true)
    setTxError(null)
    try {
      const params = new URLSearchParams()
      if (resolvedFolder !== DEFAULT_FOLDER) params.set('dir', resolvedFolder)
      params.set('docType', resolvedDocType)
      params.set('limit', '50')

      const res = await authApi.getAbortable<SpsTransactionsResponse>(
        `/doc-tidy/workspaces/${workspaceId}/sps-sources/${sourceId}/transactions?${params.toString()}`,
        controller.signal,
      )
      setTransactions(res.data)
      setTxNextCursor(res.nextCursor ?? null)
      if (res.dataDir) setListedDir(res.dataDir)
      setTxFetched(true)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setTxError(err instanceof Error ? err.message : 'Failed to fetch transactions')
    } finally {
      if (fetchAbortRef.current === controller) setTxLoading(false)
    }
  }, [workspaceId, effectiveDocType, effectiveFolder])

  const fetchDocuments = useCallback(async (
    sourceId: string,
    opts?: {
      /** Override the resolved folder (e.g. 'testout') without waiting for state to settle. */
      folderOverride?: string
      /** Override the resolved doc-type (e.g. TOP_LEVEL) without waiting for state to settle. */
      docTypeOverride?: string
      /** When true, request a top-level mailbox listing regardless of current docType state. */
      topLevelOverride?: boolean
    },
  ) => {
    const resolvedFolder   = opts?.folderOverride  ?? effectiveFolder
    const resolvedDocType  = opts?.docTypeOverride ?? effectiveDocType
    const resolvedTopLevel = opts?.topLevelOverride ?? isTopLevel
    const resolvedIsFolderRoot = resolvedDocType === FOLDER_ROOT

    if (!resolvedDocType || !resolvedFolder) return

    // Cancel any in-flight request before starting a new one.
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    setFetchLoading(true)
    setFetchError(null)
    try {
      const params = new URLSearchParams()
      if (resolvedTopLevel) {
        params.set('topLevel', '1')
      } else {
        if (resolvedFolder !== DEFAULT_FOLDER) params.set('dir', resolvedFolder)
        if (!resolvedIsFolderRoot) params.set('docType', resolvedDocType)
      }
      if (poFilter.trim()) params.set('poNumber', poFilter.trim())

      const res = await authApi.getAbortable<SpsDocumentsResponse>(
        `/doc-tidy/workspaces/${workspaceId}/sps-sources/${sourceId}/documents?${params.toString()}`,
        controller.signal,
      )
      setRecords(res.data)
      if (res.dataDir) setListedDir(res.dataDir)
      setHasFetched(true)
    } catch (err) {
      // An AbortError means a newer request superseded this one — discard silently.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch SPS documents')
    } finally {
      // Only clear the loading flag if this controller is still the active one.
      if (fetchAbortRef.current === controller) setFetchLoading(false)
    }
  }, [workspaceId, effectiveDocType, effectiveFolder, isTopLevel, isFolderRoot, poFilter])

  const handleSearch = () => {
    if (!selectedSourceId) return
    if (viewMode === 'transactions' && !isDirListing) {
      void fetchTransactions(selectedSourceId)
    } else {
      void fetchDocuments(selectedSourceId)
    }
  }

  /**
   * One-click recovery: switch to the testin folder (sandbox inbound) and immediately re-fetch.
   * Use this when looking for incoming POs / orders from trading partners.
   */
  const handleTryTestin = () => {
    if (!selectedSourceId) return
    setFolder('testin')
    setFetchError(null)
    resetResults()
    void fetchDocuments(selectedSourceId, { folderOverride: 'testin' })
  }

  /**
   * One-click recovery: switch to the testout folder (sandbox outbound) and immediately re-fetch.
   * Use this when looking for outgoing invoices / ASNs you send to trading partners.
   */
  const handleTryTestout = () => {
    if (!selectedSourceId) return
    setFolder('testout')
    setFetchError(null)
    resetResults()
    void fetchDocuments(selectedSourceId, { folderOverride: 'testout' })
  }

  /**
   * One-click recovery: run a top-level listing to discover which mailbox
   * folders this account actually has (in, out, testout, testin, …).
   */
  const handleDiscoverFolders = () => {
    if (!selectedSourceId) return
    setDocType(TOP_LEVEL)
    setFetchError(null)
    resetResults()
    void fetchDocuments(selectedSourceId, { topLevelOverride: true })
  }

  /** Drill into a directory row: a mailbox folder from the top level, or a doc type from a folder root. */
  const handleOpenDir = (rec: SpsDocumentRecord) => {
    if (isTopLevel) {
      const known = FOLDER_OPTIONS.some((o) => o.value === rec.filename)
      setFolder(known ? rec.filename : '')
      setCustomFolder(known ? '' : rec.filename)
      setDocType(FOLDER_ROOT)
    } else {
      const type  = rec.filename.toUpperCase()
      const known = DOC_TYPE_OPTIONS.some((o) => o.value === type)
      setDocType(known ? type : '')
      setCustomDocType(known ? '' : type)
    }
    resetResults()
  }

  const handleViewXml = async (rec: SpsDocumentRecord) => {
    setXmlTarget(rec)
    setXmlContent(null)
    setXmlError(null)
    setXmlLoading(true)
    try {
      const dirQuery = effectiveFolder !== DEFAULT_FOLDER ? `?dir=${encodeURIComponent(effectiveFolder)}` : ''
      const res = await authApi.get<{ data: string }>(
        `/doc-tidy/workspaces/${workspaceId}/sps-sources/${selectedSourceId}/documents/${rec.docType}/${encodeURIComponent(rec.filename)}${dirQuery}`,
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

  const TX_BADGE: Record<string, string> = {
    '810': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    '820': 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    '850': 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    '855': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    '856': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    '860': 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    '997': 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  }
  function txBadge(set: string) {
    return TX_BADGE[set] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
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
                resetResults()
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

      {/* ── View mode toggle ── */}
      <div className="flex items-center gap-1 self-start rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-0.5">
        {(['transactions', 'files'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => { setViewMode(mode); resetResults() }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              viewMode === mode
                ? 'bg-[var(--bg-000)] shadow-sm text-[var(--text-100)]'
                : 'text-[var(--text-200)] hover:text-[var(--text-100)]'
            }`}
          >
            {mode === 'transactions' ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Transactions
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                Files
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Filters row ── */}
      <div className="flex flex-wrap items-end gap-2">
        {/* Mailbox folder */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[var(--text-200)]">Mailbox folder</label>
          <select
            value={folder}
            disabled={isTopLevel}
            onChange={(e) => {
              setFolder(e.target.value)
              resetResults()
            }}
            className="rounded-xl border border-[var(--bg-300)] bg-[var(--bg-000)] px-3 py-2 text-sm text-[var(--text-100)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] disabled:opacity-50"
          >
            {FOLDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {folder === '' && !isTopLevel && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-[var(--text-200)]">Custom folder</label>
            <input
              type="text"
              placeholder="e.g. testout"
              value={customFolder}
              onChange={(e) => setCustomFolder(e.target.value)}
              className="w-28 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-000)] px-3 py-2 text-sm font-mono text-[var(--text-100)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]"
            />
          </div>
        )}

        {/* Document type */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[var(--text-200)]">Document type</label>
          <select
            value={docType}
            onChange={(e) => {
              setDocType(e.target.value)
              resetResults()
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
          disabled={(txLoading || fetchLoading) || !selectedSourceId || !effectiveDocType || !effectiveFolder}
          onClick={handleSearch}
          className="inline-flex items-center gap-1.5 self-end rounded-xl bg-[var(--accent-200)] dark:bg-[var(--accent-100)] text-white px-4 py-2 text-sm font-medium shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {(txLoading || fetchLoading) ? <Spinner className="h-4 w-4" /> : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {viewMode === 'transactions' && !isDirListing ? 'Fetch transactions' : 'Fetch documents'}
        </button>
      </div>


      {/* ── Transactions table (parsed EDI records) ── */}
      {viewMode === 'transactions' && !isDirListing && (
        <>
          {txError && (() => {
            const isNotFound = /not found|directory/i.test(txError)
            return (
              <div className="rounded-xl border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="flex-1">{txError}</span>
                  <button type="button" onClick={() => setTxError(null)}
                    className="ml-2 shrink-0 rounded p-0.5 opacity-50 hover:opacity-100 cursor-pointer">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {isNotFound && (
                  <div className="mt-2.5 border-t border-rose-200 dark:border-rose-700/40 pt-2.5 flex flex-wrap gap-2">
                    <button type="button" disabled={txLoading} onClick={handleTryTestin}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50 cursor-pointer">
                      Try testin (inbound POs)
                    </button>
                    <button type="button" disabled={txLoading} onClick={handleTryTestout}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50 cursor-pointer">
                      Try testout (outbound invoices)
                    </button>
                    <button type="button" disabled={txLoading} onClick={handleDiscoverFolders}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 disabled:opacity-50 cursor-pointer">
                      Discover my folders
                    </button>
                  </div>
                )}
              </div>
            )
          })()}

          {transactions.length > 0 && (
            <div className="flex flex-col min-h-0 gap-2">
              <p className="text-xs text-[var(--text-200)]">
                {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} parsed from{' '}
                <code className="font-mono">{listedPath}</code>
                {txNextCursor && <span className="ml-1 text-[var(--accent-200)]">· more available</span>}
              </p>
              <div className="overflow-x-auto rounded-xl border border-[var(--bg-300)] shadow-sm">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg-100)] dark:bg-[var(--bg-200)] border-b border-[var(--bg-300)]">
                      <th className="px-3 py-2 text-left font-semibold text-[var(--text-200)] whitespace-nowrap">Document Type</th>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--text-200)] whitespace-nowrap">Doc #</th>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--text-200)] whitespace-nowrap">PO #</th>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--text-200)] whitespace-nowrap">Sender / Partner</th>
                      <th className="px-3 py-2 text-center font-semibold text-[var(--text-200)] whitespace-nowrap">Date</th>
                      <th className="px-3 py-2 text-right font-semibold text-[var(--text-200)] whitespace-nowrap">Size</th>
                      <th className="px-3 py-2 text-center font-semibold text-[var(--text-200)] whitespace-nowrap">File</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--bg-300)]">
                    {transactions.map((tx) => (
                      <tr key={tx.filename} className="hover:bg-[var(--bg-100)] dark:hover:bg-[var(--bg-200)] transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${txBadge(tx.transactionSet)}`}>
                            {tx.transactionLabel || <span className="opacity-40">—</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--text-100)] whitespace-nowrap max-w-[10rem] truncate" title={tx.documentNumber}>
                          {tx.documentNumber || <span className="opacity-30">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--text-100)] whitespace-nowrap">
                          {tx.poNumber || <span className="opacity-30">—</span>}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-100)] max-w-[12rem] truncate" title={tx.senderName}>
                          {tx.senderName || <span className="opacity-30 text-[var(--text-200)]">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-[var(--text-200)] whitespace-nowrap tabular-nums">
                          {tx.documentDate || (tx.createdAt ? formatDate(tx.createdAt) : <span className="opacity-30">—</span>)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text-200)] whitespace-nowrap tabular-nums">
                          {fmtBytes(tx.size)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <a
                            href={tx.downloadUrl}
                            download={tx.filename}
                            title={`Download ${tx.filename}`}
                            className="rounded p-1 text-[var(--text-200)] hover:text-[var(--accent-200)] hover:bg-[var(--bg-200)] transition-colors inline-flex"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!txLoading && txFetched && transactions.length === 0 && !txError && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--bg-300)] py-12 text-center">
              <svg className="h-8 w-8 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm font-medium text-[var(--text-200)]">No transactions found</p>
              <p className="text-xs text-[var(--text-200)]">The <code className="font-mono">{listedPath}</code> directory is empty.</p>
            </div>
          )}

          {!txFetched && !txLoading && !txError && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--bg-300)] py-12 text-center">
              <svg className="h-8 w-8 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              <p className="text-sm font-medium text-[var(--text-200)]">Select a folder + document type and click Fetch</p>
              <p className="text-xs text-[var(--text-200)]">The EDI files will be downloaded and parsed into structured records.</p>
            </div>
          )}
        </>
      )}

      {/* ── Files table (raw directory listing) ── */}
      {(viewMode === 'files' || isDirListing) && (
        <>
          {fetchError && (() => {
            const isNotFound = /not found|directory/i.test(fetchError)
            return (
              <div className="rounded-xl border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
                <div className="flex items-center gap-2">
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
                {isNotFound && (
                  <div className="mt-2.5 border-t border-rose-200 dark:border-rose-700/40 pt-2.5">
                    <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400 mb-1.5">
                      This folder doesn't exist. Sandbox accounts use{' '}
                      <code className="font-mono">testin</code> / <code className="font-mono">testout</code>.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={fetchLoading} onClick={handleTryTestin}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50 cursor-pointer">
                        Try testin
                      </button>
                      <button type="button" disabled={fetchLoading} onClick={handleTryTestout}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50 cursor-pointer">
                        Try testout
                      </button>
                      <button type="button" disabled={fetchLoading} onClick={handleDiscoverFolders}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 disabled:opacity-50 cursor-pointer">
                        Discover my folders
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {records.length > 0 && (
            <div className="flex flex-col min-h-0 gap-2">
              <p className="text-xs text-[var(--text-200)]">
                {records.length} {isDirListing ? 'director' : 'document'}{records.length !== 1 ? (isDirListing ? 'ies' : 's') : (isDirListing ? 'y' : '')} in{' '}
                <code className="font-mono">{listedPath}</code>
              </p>
              <div className="overflow-x-auto rounded-xl border border-[var(--bg-300)] shadow-sm">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg-100)] dark:bg-[var(--bg-200)] border-b border-[var(--bg-300)]">
                      <th className="px-3 py-2 text-left font-semibold text-[var(--text-200)] whitespace-nowrap">Filename</th>
                      <th className="px-3 py-2 text-center font-semibold text-[var(--text-200)] whitespace-nowrap">Date</th>
                      <th className="px-3 py-2 text-right font-semibold text-[var(--text-200)] whitespace-nowrap">Size</th>
                      <th className="px-3 py-2 text-center font-semibold text-[var(--text-200)] whitespace-nowrap">{isDirListing ? 'Open' : 'View XML'}</th>
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
                          {isDirListing ? (
                            <button type="button" onClick={() => handleOpenDir(rec)}
                              className="rounded px-2 py-0.5 text-[11px] font-medium text-[var(--accent-200)] hover:bg-[var(--bg-200)] transition-colors cursor-pointer">
                              Open
                            </button>
                          ) : (
                            <button type="button" onClick={() => void handleViewXml(rec)}
                              className="rounded p-1 text-[var(--text-200)] hover:text-[var(--accent-200)] hover:bg-[var(--bg-200)] transition-colors cursor-pointer">
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!fetchLoading && hasFetched && records.length === 0 && !fetchError && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--bg-300)] py-12 text-center">
              <svg className="h-8 w-8 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm font-medium text-[var(--text-200)]">No documents found</p>
              <p className="text-xs text-[var(--text-200)]">
                The <code className="font-mono">{listedPath}</code> directory is empty.
              </p>
            </div>
          )}
        </>
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
