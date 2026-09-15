import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../lib/api'
import {
  Banner,
  DocTidyTabs,
  DocumentTypeBadge,
  PaginationArrows,
  Spinner,
  Th,
  avatarColour,
} from '../components/docTidy/docTidyUi'
import AttachmentIcons from '../components/docTidy/AttachmentIcons'
import MessageDetailDrawer from '../components/docTidy/MessageDetailDrawer'
import ParseJobPanel from '../components/docTidy/ParseJobPanel'
import { formatDate, formatDateTime } from '../lib/format'
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  PAGE_SIZE_OPTIONS,
  type DocTidyConfig,
  type DocTidyEvent,
  type DocTidyMessage,
  type DocTidyMessagesResponse,
  type DocTidyRule,
  type DocumentType,
  type RunAllResult,
} from '../types/docTidy'

type AttachmentFilter = '' | 'true' | 'false'

export default function DocTidy() {
  const [messages, setMessages] = useState<DocTidyMessage[]>([])
  const [rules, setRules] = useState<DocTidyRule[]>([])
  const [config, setConfig] = useState<DocTidyConfig | null>(null)

  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  // Filters
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [ruleId, setRuleId] = useState('')
  const [documentType, setDocumentType] = useState<DocumentType | ''>('')
  const [hasAttachments, setHasAttachments] = useState<AttachmentFilter>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [pagination, setPagination] = useState({ total: 0, pages: 1 })

  // Live updates
  const [live, setLive] = useState(false)
  const [newCount, setNewCount] = useState(0)

  // The parse job whose reasoning panel is open, if any.
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  // The message whose detail drawer is open, if any.
  const [viewMessage, setViewMessage] = useState<DocTidyMessage | null>(null)

  // Checked rows, held as ids rather than rows so a refetch — a live import, a
  // page change — cannot leave a stale copy of a message in the selection.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const fetchMessages = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setInitialLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
        if (debouncedSearch) params.set('search', debouncedSearch)
        if (ruleId) params.set('ruleId', ruleId)
        if (documentType) params.set('documentType', documentType)
        if (hasAttachments) params.set('hasAttachments', hasAttachments)
        if (dateFrom) params.set('dateFrom', dateFrom)
        if (dateTo) params.set('dateTo', dateTo)

        const res = await authApi.get<DocTidyMessagesResponse>(`/doc-tidy/messages?${params.toString()}`)
        setMessages(res.data)
        setPagination({ total: res.pagination.total, pages: Math.max(1, res.pagination.pages) })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load messages')
      } finally {
        setInitialLoading(false)
        setRefreshing(false)
      }
    },
    [page, pageSize, debouncedSearch, ruleId, documentType, hasAttachments, dateFrom, dateTo]
  )

  // Rules populate the filter dropdown; config drives the "not connected" notice.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      authApi.get<{ data: DocTidyRule[] }>('/doc-tidy/rules').catch(() => ({ data: [] })),
      authApi.get<{ data: DocTidyConfig }>('/doc-tidy/config').catch(() => null),
    ]).then(([rulesRes, configRes]) => {
      if (cancelled) return
      setRules(rulesRes.data)
      if (configRes) setConfig(configRes.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 350)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Any filter change restarts at page 1, and drops the selection with it:
  // rows the user can no longer see should not stay checked.
  useEffect(() => {
    setPage(1)
    setSelectedIds(new Set())
  }, [debouncedSearch, ruleId, documentType, hasAttachments, dateFrom, dateTo, pageSize])

  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      fetchMessages()
      return
    }
    fetchMessages(true)
  }, [fetchMessages])

  // The stream is opened once for the life of the page, so it reads the
  // current fetcher through a ref rather than resubscribing on every filter
  // change — reconnecting the stream each keystroke would defeat the point.
  const fetchRef = useRef(fetchMessages)
  useEffect(() => {
    fetchRef.current = fetchMessages
  }, [fetchMessages])

  // The server pushes a signal, not rows, so the refetch honours whatever
  // filters and page the user is currently on.
  useEffect(() => {
    return authApi.eventStream<DocTidyEvent>(
      '/doc-tidy/stream',
      (event) => {
        if (event.type === 'connected') {
          setLive(true)
          return
        }
        // A parse finishing elsewhere (or in another tab) changes a status chip
        // on a row this table may already be showing, so it refetches without
        // the "new messages" cue that an import deserves.
        if (event.type === 'parse_status') {
          void fetchRef.current(true)
          return
        }
        if (event.type !== 'imported') return

        setNewCount((count) => count + (event.imported ?? 0))
        void fetchRef.current(true)
      },
      () => setLive(false)
    )
  }, [])

  // The "new" badge is an arrival cue, not a persistent state.
  useEffect(() => {
    if (newCount === 0) return
    const timer = setTimeout(() => setNewCount(0), 10_000)
    return () => clearTimeout(timer)
  }, [newCount])

  const handleRunAll = async () => {
    setRunning(true)
    setRunError(null)
    setRunResult(null)
    try {
      const res = await authApi.post<{ data: RunAllResult }>('/doc-tidy/run')
      const results = res.data.results
      const imported = results.reduce((sum, r) => sum + (r.imported ?? 0), 0)
      const matched = results.reduce((sum, r) => sum + (r.matched ?? 0), 0)
      const failed = results.filter((r) => r.error)

      const parts = [`${matched} matched`, `${imported} newly imported`]
      if (failed.length) parts.push(`${failed.length} rule${failed.length === 1 ? '' : 's'} failed`)
      setRunResult(`Extraction complete — ${parts.join(', ')}.`)

      if (failed.length) {
        setRunError(failed.map((f) => `${f.name}: ${f.error}`).join(' · '))
      }
      await fetchMessages(true)
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setRunning(false)
    }
  }

  const clearFilters = () => {
    setSearchInput('')
    setRuleId('')
    setDocumentType('')
    setHasAttachments('')
    setDateFrom('')
    setDateTo('')
  }

  const hasActiveFilters = Boolean(
    searchInput || ruleId || documentType || hasAttachments || dateFrom || dateTo
  )
  const enabledRuleCount = useMemo(() => rules.filter((r) => r.enabled).length, [rules])

  const startItem = pagination.total === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, pagination.total)

  // Select-all covers the current page only, which is what the header checkbox
  // can honestly represent — the selection itself survives paging.
  const allOnPageSelected =
    messages.length > 0 && messages.every((msg) => selectedIds.has(msg._id))
  const someOnPageSelected = messages.some((msg) => selectedIds.has(msg._id))

  // `indeterminate` is a DOM property with no React attribute, so it is set
  // on the node rather than rendered.
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someOnPageSelected && !allOnPageSelected
    }
  }, [someOnPageSelected, allOnPageSelected])

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const msg of messages) {
        if (allOnPageSelected) next.delete(msg._id)
        else next.add(msg._id)
      }
      return next
    })
  }

  const inputClass =
    'text-[11px] border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]'

  // Native `accent-color`, since this project has no forms plugin to restyle
  // checkboxes from scratch.
  const checkboxClass =
    'h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent-200)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-200)]'

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <DocTidyTabs />
            {config?.mailboxConnected && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  live
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-500/10 dark:text-slate-400'
                }`}
                title={
                  live
                    ? 'New mail matching an enabled rule is captured and shown here automatically'
                    : 'Reconnecting to the live update stream…'
                }
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                  }`}
                />
                {live ? 'Live' : 'Offline'}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-[var(--text-200)]">
            {config?.mailboxConnected ? (
              <>
                Mailbox:{' '}
                <span className="font-medium text-gray-700 dark:text-[var(--text-200)]">
                  {config.mailboxEmail}
                </span>
                {config.driveFolderName && (
                  <>
                    {' · Attachments → '}
                    <span className="font-medium text-gray-700 dark:text-[var(--text-200)]">
                      {config.driveFolderName}
                    </span>
                  </>
                )}
              </>
            ) : (
              'No mailbox connected yet.'
            )}
          </p>
        </div>

        <button
          onClick={handleRunAll}
          disabled={running || !config?.mailboxConnected || enabledRuleCount === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--accent-200)] dark:bg-[var(--accent-100)] text-white dark:text-[var(--text-100)] text-[11px] font-medium shadow-[0_14px_24px_-18px_rgba(0,102,140,0.75)] hover:-translate-y-[1px] disabled:bg-sky-300 disabled:text-sky-50 disabled:shadow-none disabled:translate-y-0 transition-all cursor-pointer disabled:cursor-not-allowed"
          title={
            !config?.mailboxConnected
              ? 'Connect the Doc Tidy mailbox in Settings first'
              : enabledRuleCount === 0
                ? 'Enable at least one extraction rule'
                : 'Run every enabled rule'
          }
        >
          {running ? <Spinner className="h-3.5 w-3.5" /> : (
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          )}
          {running ? 'Extracting…' : 'Run all enabled rules'}
        </button>
      </div>

      {!config?.mailboxConnected && (
        <Banner kind="warning">
          The Doc Tidy mailbox is not connected. An admin needs to connect it on the{' '}
          <Link to="/settings" className="underline font-medium">
            Settings
          </Link>{' '}
          page before messages can be extracted.
        </Banner>
      )}

      {runResult && (
        <Banner kind="success" onDismiss={() => setRunResult(null)}>
          {runResult}
        </Banner>
      )}
      {runError && (
        <Banner kind="error" onDismiss={() => setRunError(null)}>
          {runError}
        </Banner>
      )}

      {/* Table card */}
      <div className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-md">

        {/* ── Filter bar ──────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/40">
          {/* Search */}
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--text-200)]">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" />
              </svg>
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search subject, sender, attachment…"
              className={`${inputClass} w-full pl-8 pr-8`}
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-200)] hover:text-[var(--text-100)] cursor-pointer"
                aria-label="Clear search"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Dropdowns */}
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value as DocumentType | '')} className={`${inputClass} cursor-pointer`} aria-label="Filter by document type">
            <option value="">All document types</option>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</option>
            ))}
          </select>

          <select value={ruleId} onChange={(e) => setRuleId(e.target.value)} className={`${inputClass} cursor-pointer`} aria-label="Filter by rule">
            <option value="">All rules</option>
            {rules.map((r) => (
              <option key={r._id} value={r._id}>{r.name}</option>
            ))}
          </select>

          <select value={hasAttachments} onChange={(e) => setHasAttachments(e.target.value as AttachmentFilter)} className={`${inputClass} cursor-pointer`}>
            <option value="">Any attachments</option>
            <option value="true">With attachments</option>
            <option value="false">Without attachments</option>
          </select>

          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-200)]">From</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
            <span className="text-[11px] text-[var(--text-200)]">to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
          </div>

          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer whitespace-nowrap">
              Clear filters
            </button>
          )}

          {/* Status indicators */}
          <span className="ml-auto flex items-center gap-2 text-[11px] text-[var(--text-200)]">
            {refreshing && <Spinner className="h-3 w-3" />}
            {newCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                +{newCount} new
              </span>
            )}
            {pagination.total > 0 && (
              <span className="text-[var(--text-200)]">
                {pagination.total.toLocaleString()} message{pagination.total === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </div>

        {/* ── Top pagination ───────────────────────────────────────── */}
        {!initialLoading && !error && pagination.total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-2 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/60">
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-200)]">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] cursor-pointer"
              >
                {PAGE_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span>{startItem}–{endItem} of {pagination.total.toLocaleString()}</span>
              {selectedIds.size > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[11px] text-[var(--accent-200)]">
                    {selectedIds.size} selected
                  </span>
                  <button onClick={() => setSelectedIds(new Set())} className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer">
                    Clear
                  </button>
                </span>
              )}
            </div>
            <PaginationArrows page={page} pages={pagination.pages} onChange={setPage} />
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────── */}
        <div className="relative overflow-x-auto overflow-y-auto max-h-[calc(100vh-24rem)]">
          {error ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-900/20">
                <svg className="h-5 w-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-100)]">Failed to load messages</p>
                <p className="mt-0.5 text-xs text-[var(--text-200)]">{error}</p>
              </div>
              <button onClick={() => fetchMessages()} className="text-sm text-[var(--accent-200)] hover:underline cursor-pointer">
                Try again
              </button>
            </div>
          ) : (
            <table className="w-full text-[11px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <Th className="w-8">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleAllOnPage}
                      disabled={messages.length === 0}
                      title={allOnPageSelected ? 'Clear this page' : 'Select this page'}
                      aria-label={allOnPageSelected ? 'Clear this page' : 'Select this page'}
                      className={`${checkboxClass} disabled:cursor-not-allowed disabled:opacity-40`}
                    />
                  </Th>
                  <Th label="Received" iconPath="M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z" />
                  <Th label="From" iconPath="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                  <Th label="Subject" iconPath="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  <Th label="Document type" iconPath="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  <Th label="Rule" iconPath="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
                  <Th label="Actions" align="center" />
                </tr>
              </thead>
              <tbody>
                {initialLoading ? (
                  /* Skeleton rows — match the new column layout */
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-[var(--bg-300)]">
                      <td className="px-3 py-1">
                        <div className="h-3.5 w-3.5 animate-pulse rounded bg-[var(--bg-300)]" />
                      </td>
                      <td className="px-3 py-1">
                        <div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-300)]" />
                      </td>
                      <td className="px-3 py-1">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 animate-pulse rounded-full bg-[var(--bg-300)]" />
                          <div className="space-y-1.5">
                            <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-300)]" />
                            <div className="h-2.5 w-32 animate-pulse rounded bg-[var(--bg-300)]" />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-1">
                        <div className="h-3 w-48 animate-pulse rounded bg-[var(--bg-300)]" />
                      </td>
                      <td className="px-3 py-1">
                        <div className="h-5 w-28 animate-pulse rounded-full bg-[var(--bg-300)]" />
                      </td>
                      <td className="px-3 py-1">
                        <div className="h-5 w-20 animate-pulse rounded-full bg-[var(--bg-300)]" />
                      </td>
                      <td className="px-3 py-1">
                        <div className="flex justify-end gap-1.5">
                          <div className="h-7 w-7 animate-pulse rounded-md bg-[var(--bg-300)]" />
                          <div className="h-7 w-7 animate-pulse rounded-md bg-[var(--bg-300)]" />
                        </div>
                      </td>
                    </tr>
                  ))
                ) : messages.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-200)]">
                          <svg className="h-6 w-6 text-[var(--text-200)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-[var(--text-100)]">
                            {hasActiveFilters ? 'No messages match' : 'No messages yet'}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[var(--text-200)]">
                            {hasActiveFilters
                              ? 'Try adjusting or clearing the filters.'
                              : 'Create an extraction rule and run it to pull messages in.'}
                          </p>
                        </div>
                        {hasActiveFilters && (
                          <button onClick={clearFilters} className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer">
                            Clear filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  messages.map((msg) => {
                    const isSelected = selectedIds.has(msg._id)
                    const senderSeed = msg.fromName || msg.from
                    return (
                      <tr
                        key={msg._id}
                        onClick={() => setViewMessage(msg)}
                        className={`group cursor-pointer align-middle transition-all duration-100 hover:relative hover:z-[1] hover:shadow-[0_2px_8px_rgba(0,0,0,0.14),0_-1px_2px_rgba(0,0,0,0.06)] ${
                          isSelected
                            ? 'bg-[var(--primary-100)]/70 hover:bg-[var(--primary-100)]'
                            : 'odd:bg-[var(--bg-100)] even:bg-[var(--bg-200)] hover:bg-[var(--bg-100)]'
                        }`}
                      >
                        {/* Checkbox — stop propagation so clicking it doesn't open the drawer */}
                        <td className="px-3 py-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(msg._id)}
                            aria-label={`Select ${msg.subject || 'message'}`}
                            className={checkboxClass}
                          />
                        </td>

                        {/* Date */}
                        <td className="px-3 py-1 whitespace-nowrap text-[var(--text-200)]" title={formatDateTime(msg.sentAt)}>
                          {formatDate(msg.sentAt)}
                        </td>

                        {/* From — avatar + single-line name/address (Gmail-style compact) */}
                        <td className="px-3 py-1 min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${avatarColour(senderSeed)}`}>
                              {senderSeed.charAt(0).toUpperCase()}
                            </span>
                            <div
                              className="min-w-0 truncate text-[var(--text-100)]"
                              title={msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from}
                            >
                              {msg.fromName || msg.from}
                            </div>
                          </div>
                        </td>

                        {/* Subject */}
                        <td className="px-3 py-1 min-w-0">
                          <div className="truncate text-[var(--text-100)]" title={msg.subject}>
                            {msg.subject || <span className="italic text-[var(--text-200)]">(no subject)</span>}
                          </div>
                        </td>

                        {/* Document type */}
                        <td className="px-3 py-1 whitespace-nowrap">
                          <DocumentTypeBadge value={msg.documentType} />
                        </td>

                        {/* Rule — chip truncates properly with ellipsis */}
                        <td className="px-3 py-1">
                          {msg.ruleName ? (
                            <span
                              title={msg.ruleName}
                              className="inline-flex max-w-[160px] items-center gap-1 rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[11px] text-[var(--accent-200)]"
                            >
                              <svg className="h-2.5 w-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
                              </svg>
                              <span className="truncate">{msg.ruleName}</span>
                            </span>
                          ) : (
                            <span className="text-[11px] italic text-[var(--text-200)]">—</span>
                          )}
                        </td>

                        {/* Actions — stop propagation so parse buttons don't also open the drawer */}
                        <td className="px-3 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                          <AttachmentIcons
                            message={msg}
                            onOpenJob={setOpenJobId}
                            onChanged={() => void fetchMessages(true)}
                          />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Bottom pagination ────────────────────────────────────── */}
        {!initialLoading && !error && pagination.total > 0 && (
          <div className="flex items-center justify-end px-4 py-2.5 border-t border-[var(--bg-300)] bg-[var(--bg-200)]/60">
            <PaginationArrows page={page} pages={pagination.pages} onChange={setPage} />
          </div>
        )}
      </div>

      {openJobId && (
        <ParseJobPanel
          jobId={openJobId}
          onClose={() => setOpenJobId(null)}
          onChanged={() => void fetchMessages(true)}
        />
      )}

      {viewMessage && (
        <MessageDetailDrawer
          message={viewMessage}
          onClose={() => setViewMessage(null)}
          onOpenJob={setOpenJobId}
        />
      )}
    </div>
  )
}
