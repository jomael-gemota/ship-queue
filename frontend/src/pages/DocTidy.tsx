import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../lib/api'
import { Banner, DocTidyTabs, PaginationArrows, Spinner, Th } from '../components/docTidy/docTidyUi'
import { formatBytes, formatDateTime } from '../lib/format'
import {
  PAGE_SIZE_OPTIONS,
  type DocTidyConfig,
  type DocTidyMessage,
  type DocTidyMessagesResponse,
  type DocTidyRule,
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
  const [hasAttachments, setHasAttachments] = useState<AttachmentFilter>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [pagination, setPagination] = useState({ total: 0, pages: 1 })

  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const fetchMessages = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setInitialLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
        if (debouncedSearch) params.set('search', debouncedSearch)
        if (ruleId) params.set('ruleId', ruleId)
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
    [page, pageSize, debouncedSearch, ruleId, hasAttachments, dateFrom, dateTo]
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

  // Any filter change restarts at page 1.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, ruleId, hasAttachments, dateFrom, dateTo, pageSize])

  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      fetchMessages()
      return
    }
    fetchMessages(true)
  }, [fetchMessages])

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

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearFilters = () => {
    setSearchInput('')
    setRuleId('')
    setHasAttachments('')
    setDateFrom('')
    setDateTo('')
  }

  const hasActiveFilters = Boolean(searchInput || ruleId || hasAttachments || dateFrom || dateTo)
  const enabledRuleCount = useMemo(() => rules.filter((r) => r.enabled).length, [rules])

  const startItem = pagination.total === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, pagination.total)

  const inputClass =
    'text-sm border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]'

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <DocTidyTabs />
          <p className="text-xs sm:text-sm text-gray-500 dark:text-[var(--text-200)]">
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
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[var(--accent-200)] dark:bg-[var(--accent-100)] text-white dark:text-[var(--text-100)] text-sm font-medium shadow-[0_14px_24px_-18px_rgba(0,102,140,0.75)] hover:-translate-y-[1px] disabled:bg-sky-300 disabled:text-sky-50 disabled:shadow-none disabled:translate-y-0 transition-all cursor-pointer disabled:cursor-not-allowed"
          title={
            !config?.mailboxConnected
              ? 'Connect the Doc Tidy mailbox in Settings first'
              : enabledRuleCount === 0
                ? 'Enable at least one extraction rule'
                : 'Run every enabled rule'
          }
        >
          {running ? <Spinner /> : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      <div className="bg-[var(--bg-100)] rounded-xl border border-[var(--bg-300)] shadow-sm overflow-hidden">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 border-b border-[var(--bg-300)]">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z"
                />
              </svg>
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search subject, sender, attachment…"
              className={`${inputClass} w-full pl-9 pr-9`}
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 cursor-pointer"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <select value={ruleId} onChange={(e) => setRuleId(e.target.value)} className={`${inputClass} cursor-pointer`}>
            <option value="">All rules</option>
            {rules.map((r) => (
              <option key={r._id} value={r._id}>
                {r.name}
              </option>
            ))}
          </select>

          <select
            value={hasAttachments}
            onChange={(e) => setHasAttachments(e.target.value as AttachmentFilter)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="">Any attachments</option>
            <option value="true">With attachments</option>
            <option value="false">Without attachments</option>
          </select>

          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-[var(--text-200)]">
            From
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-[var(--text-200)]">
            To
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
          </label>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-sm text-[var(--accent-200)] hover:underline cursor-pointer"
            >
              Clear filters
            </button>
          )}

          <span className="ml-auto flex items-center gap-2 text-xs sm:text-sm text-gray-500 dark:text-[var(--text-200)]">
            {refreshing && <Spinner className="h-3 w-3" />}
            {pagination.total > 0 &&
              `${pagination.total.toLocaleString()} message${pagination.total === 1 ? '' : 's'}`}
          </span>
        </div>

        {/* Top pagination */}
        {!initialLoading && !error && pagination.total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-2 border-b border-[var(--bg-300)] bg-[var(--bg-200)]">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-[var(--text-200)]">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] cursor-pointer"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="ml-1">
                {startItem}–{endItem} of {pagination.total.toLocaleString()}
              </span>
            </div>
            <PaginationArrows page={page} pages={pagination.pages} onChange={setPage} />
          </div>
        )}

        {/* Table */}
        <div className="relative overflow-x-auto overflow-y-auto max-h-[calc(100vh-24rem)]">
          {error ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-red-500">{error}</p>
              <button
                onClick={() => fetchMessages()}
                className="mt-3 text-sm text-[var(--accent-200)] hover:underline cursor-pointer"
              >
                Try again
              </button>
            </div>
          ) : (
            <table className="w-full text-[13px] border-separate border-spacing-0">
              <thead>
                <tr className="bg-[var(--bg-200)]">
                  <Th label="Received" iconPath="M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z" />
                  <Th label="From" iconPath="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                  <Th label="Subject" iconPath="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  <Th label="Rule" iconPath="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
                  <Th label="Attachments" iconPath="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bg-300)]">
                {initialLoading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-[var(--text-200)]">
                      <span className="inline-flex items-center gap-2">
                        <Spinner /> Loading messages…
                      </span>
                    </td>
                  </tr>
                ) : messages.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-[var(--text-200)]">
                      {hasActiveFilters
                        ? 'No messages match these filters.'
                        : 'No messages extracted yet. Create a rule and run it to pull messages in.'}
                    </td>
                  </tr>
                ) : (
                  messages.map((msg) => {
                    const isOpen = expanded.has(msg._id)
                    return (
                      <tr
                        key={msg._id}
                        className="odd:bg-[var(--bg-100)] even:bg-[var(--bg-200)]/40 hover:bg-[var(--primary-100)]/40 align-top"
                      >
                        <td className="px-3 py-1.5 whitespace-nowrap text-slate-700 dark:text-[var(--text-200)]">
                          {formatDateTime(msg.sentAt)}
                        </td>
                        <td
                          className="px-3 py-1.5 whitespace-nowrap max-w-[200px] truncate font-medium text-slate-900 dark:text-[var(--text-100)]"
                          title={msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from}
                        >
                          {msg.fromName || msg.from}
                        </td>
                        <td className="px-3 py-1.5 max-w-md">
                          <button
                            onClick={() => toggleRow(msg._id)}
                            className="block w-full text-left font-medium text-slate-900 dark:text-[var(--text-100)] hover:text-[var(--accent-200)] cursor-pointer truncate"
                            title={msg.snippet ? 'Show preview' : msg.subject}
                          >
                            {msg.subject}
                          </button>
                          {isOpen && msg.snippet && (
                            <p className="mt-1 text-xs text-slate-500 dark:text-[var(--text-200)]">
                              {msg.snippet}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {msg.ruleName ? (
                            <span className="inline-flex items-center rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-xs font-medium text-[var(--accent-200)]">
                              {msg.ruleName}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {msg.attachments.length === 0 ? (
                            <span className="text-xs text-slate-400">None</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {msg.attachments.map((att, i) => (
                                <li key={`${msg._id}-${i}`} className="flex items-center gap-1.5">
                                  {att.webViewLink ? (
                                    <a
                                      href={att.webViewLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[var(--accent-200)] hover:underline truncate max-w-[220px]"
                                      title={att.filename}
                                    >
                                      {att.filename}
                                    </a>
                                  ) : (
                                    <span
                                      className="truncate max-w-[220px] text-slate-600 dark:text-[var(--text-200)]"
                                      title={att.uploadError || att.filename}
                                    >
                                      {att.filename}
                                    </span>
                                  )}
                                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                                    {formatBytes(att.size)}
                                  </span>
                                  {att.uploadError && (
                                    <span
                                      className="text-[11px] text-red-500"
                                      title={att.uploadError}
                                    >
                                      upload failed
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Bottom pagination */}
        {!initialLoading && !error && pagination.total > 0 && (
          <div className="flex items-center justify-end px-4 py-2 border-t border-[var(--bg-300)] bg-[var(--bg-200)]">
            <PaginationArrows page={page} pages={pagination.pages} onChange={setPage} />
          </div>
        )}
      </div>
    </div>
  )
}
