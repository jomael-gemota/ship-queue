/**
 * SpsCommerceTab — workspace-level SPS Commerce invoice lookup.
 *
 * Fetches the workspace's connected SPS sources, then lets the user look up
 * EDI-810 (Invoice) records by PO number against the SPS Fulfillment API.
 *
 * NOTE: The backend endpoint path (`/fulfillment/v1/invoices`) depends on
 * your SPS account provisioning. If calls fail with 404 or 403 the error
 * message from SPS is surfaced verbatim so you can contact SPS support.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { authApi } from '../../lib/api'
import { Spinner } from './docTidyUi'
import { formatDate } from '../../lib/format'
import type { DocTidySpsSource, SpsInvoiceRecord, SpsInvoicesResponse } from '../../types/docTidy'

interface Props {
  workspaceId: string
}

export default function SpsCommerceTab({ workspaceId }: Props) {
  /* ── SPS sources ── */
  const [sources, setSources] = useState<DocTidySpsSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)

  /* ── PO number search ── */
  const [poInput, setPoInput] = useState('')
  const [searchedPo, setSearchedPo] = useState<string | null>(null)

  /* ── Invoice results ── */
  const [records, setRecords] = useState<SpsInvoiceRecord[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  /* ── Raw JSON drawer ── */
  const [rawTarget, setRawTarget] = useState<SpsInvoiceRecord | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

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
      .catch((err) => {
        setSourcesError(err instanceof Error ? err.message : 'Failed to load SPS sources')
      })
      .finally(() => setSourcesLoading(false))
  }, [workspaceId])

  /* Focus input when sources are loaded */
  useEffect(() => {
    if (!sourcesLoading && sources.length > 0) {
      inputRef.current?.focus()
    }
  }, [sourcesLoading, sources.length])

  const fetchInvoices = useCallback(
    async (sourceId: string, poNumber: string, cursor?: string) => {
      setFetchLoading(true)
      setFetchError(null)
      try {
        const params = new URLSearchParams({ limit: '50' })
        if (poNumber.trim()) params.set('poNumber', poNumber.trim())
        if (cursor) params.set('cursor', cursor)

        const res = await authApi.get<SpsInvoicesResponse>(
          `/doc-tidy/workspaces/${workspaceId}/sps-sources/${sourceId}/invoices?${params.toString()}`,
        )
        if (cursor) {
          setRecords((prev) => [...prev, ...res.data])
        } else {
          setRecords(res.data)
        }
        setNextCursor(res.nextCursor ?? null)
        setSearchedPo(poNumber.trim() || null)
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'Failed to fetch SPS invoices')
      } finally {
        setFetchLoading(false)
      }
    },
    [workspaceId],
  )

  const handleSearch = () => {
    if (!selectedSourceId) return
    void fetchInvoices(selectedSourceId, poInput)
  }

  const handleLoadMore = () => {
    if (!selectedSourceId || !nextCursor) return
    void fetchInvoices(selectedSourceId, poInput, nextCursor)
  }

  /* ── Render helpers ── */
  function fmtAmount(amount?: number, currency?: string) {
    if (amount === undefined) return '—'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  /* ── Loading / no-sources states ── */
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
        {/* SPS icon */}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 dark:bg-orange-900/30 shadow-sm">
          <svg className="h-7 w-7 text-orange-500 dark:text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <rect x="2" y="2" width="9" height="9" rx="1.5" stroke="currentColor" fill="none" />
            <rect x="13" y="2" width="9" height="9" rx="1.5" stroke="currentColor" fill="none" />
            <rect x="2" y="13" width="9" height="9" rx="1.5" stroke="currentColor" fill="none" />
            <rect x="13" y="13" width="9" height="9" rx="1.5" stroke="currentColor" fill="none" />
          </svg>
        </div>
        <div>
          <p className="font-semibold text-[var(--text-100)]">No SPS Commerce account connected</p>
          <p className="mt-1 text-sm text-[var(--text-200)]">
            Open the workspace settings and connect an SPS Commerce account to look up invoices.
          </p>
        </div>
      </div>
    )
  }

  const activeSource = sources.find((s) => s._id === selectedSourceId) ?? sources[0]

  return (
    <div className="flex flex-1 flex-col min-h-0 gap-4 p-4">

      {/* ── Source picker (if multiple) + info bar ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-4 py-3 shadow-sm">
        {/* SPS mini icon */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
          <svg className="h-4 w-4 text-orange-500 dark:text-orange-400" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="2" width="9" height="9" rx="1.5" fill="currentColor" />
            <rect x="13" y="2" width="9" height="9" rx="1.5" fill="currentColor" />
            <rect x="2" y="13" width="9" height="9" rx="1.5" fill="currentColor" />
            <rect x="13" y="13" width="9" height="9" rx="1.5" fill="currentColor" />
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
                setNextCursor(null)
                setSearchedPo(null)
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

      {/* ── PO number search ── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-200)]"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Enter PO number to look up invoices…"
            value={poInput}
            onChange={(e) => setPoInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            className="w-full rounded-xl border border-[var(--bg-300)] bg-[var(--bg-000)] pl-9 pr-3 py-2.5 text-sm text-[var(--text-100)] placeholder-[var(--text-200)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]"
          />
        </div>
        <button
          type="button"
          disabled={fetchLoading || !selectedSourceId}
          onClick={handleSearch}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-200)] dark:bg-[var(--accent-100)] text-white px-4 py-2.5 text-sm font-medium shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {fetchLoading && !nextCursor ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
          )}
          Search
        </button>
      </div>

      {/* ── API note ── */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-[11px] text-amber-800 dark:text-amber-300">
        <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          Queries <code className="font-mono">GET /fulfillment/v1/invoices</code> on the SPS Commerce API.
          If you see a 404 or 403 error, your account may use a different endpoint — check your{' '}
          <a
            href="https://developer.spscommerce.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
          >
            SPS Dev Center
          </a>{' '}
          or contact SPS support to confirm the correct path for your provisioning.
        </span>
      </div>

      {/* ── Error ── */}
      {fetchError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="flex-1">{fetchError}</span>
          <button
            type="button"
            onClick={() => setFetchError(null)}
            className="ml-2 shrink-0 rounded p-0.5 opacity-50 hover:opacity-100 cursor-pointer"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Results table ── */}
      {records.length > 0 && (
        <div className="flex flex-col min-h-0 gap-2">
          <p className="text-xs text-[var(--text-200)]">
            {searchedPo
              ? <>Showing {records.length} invoice{records.length !== 1 ? 's' : ''} for PO <span className="font-mono font-medium text-[var(--text-100)]">{searchedPo}</span></>
              : <>Showing {records.length} invoice{records.length !== 1 ? 's' : ''}</>
            }
          </p>

          <div className="overflow-x-auto rounded-xl border border-[var(--bg-300)] shadow-sm">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--bg-100)] dark:bg-[var(--bg-200)] border-b border-[var(--bg-300)]">
                  <th className="px-3 py-2 text-left font-semibold text-[var(--text-200)] whitespace-nowrap">Invoice #</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--text-200)] whitespace-nowrap">PO #</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--text-200)] whitespace-nowrap">Invoice Date</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--text-200)] whitespace-nowrap">Trading Partner</th>
                  <th className="px-3 py-2 text-right font-semibold text-[var(--text-200)] whitespace-nowrap">Total</th>
                  <th className="px-3 py-2 text-center font-semibold text-[var(--text-200)] whitespace-nowrap">Doc Type</th>
                  <th className="px-3 py-2 text-center font-semibold text-[var(--text-200)] whitespace-nowrap">Status</th>
                  <th className="px-3 py-2 text-center font-semibold text-[var(--text-200)] whitespace-nowrap">Raw</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bg-300)]">
                {records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-[var(--bg-100)] dark:hover:bg-[var(--bg-200)] transition-colors">
                    <td className="px-3 py-2 font-mono text-[var(--text-100)] whitespace-nowrap">
                      {rec.invoiceNumber ?? <span className="opacity-30">—</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--text-100)] whitespace-nowrap">
                      {rec.purchaseOrderNumber ?? <span className="opacity-30">—</span>}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-100)] whitespace-nowrap">
                      {rec.invoiceDate ? formatDate(rec.invoiceDate) : <span className="opacity-30">—</span>}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-100)] max-w-[14rem] truncate">
                      {rec.tradingPartner ?? <span className="opacity-30">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[var(--text-100)] whitespace-nowrap tabular-nums">
                      {fmtAmount(rec.totalAmount, rec.currency)}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      {rec.documentType ? (
                        <span className="inline-block rounded-full bg-[var(--bg-200)] dark:bg-[var(--bg-300)] px-2 py-0.5 text-[10px] font-mono font-medium text-[var(--text-200)]">
                          {rec.documentType}
                        </span>
                      ) : (
                        <span className="opacity-30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      {rec.status ? (
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          /sent|complete|delivered/i.test(rec.status)
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                            : /error|fail/i.test(rec.status)
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400'
                              : 'bg-[var(--bg-200)] text-[var(--text-200)]'
                        }`}>
                          {rec.status}
                        </span>
                      ) : (
                        <span className="opacity-30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setRawTarget(rec)}
                        title="View raw API response"
                        className="rounded p-1 text-[var(--text-200)] hover:text-[var(--text-100)] hover:bg-[var(--bg-200)] transition-colors cursor-pointer"
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

          {/* Load more */}
          {nextCursor && (
            <button
              type="button"
              disabled={fetchLoading}
              onClick={handleLoadMore}
              className="self-center inline-flex items-center gap-1.5 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-000)] px-4 py-2 text-xs font-medium text-[var(--text-200)] hover:text-[var(--text-100)] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {fetchLoading ? <Spinner className="h-3.5 w-3.5" /> : null}
              Load more
            </button>
          )}
        </div>
      )}

      {/* ── Empty state after search ── */}
      {!fetchLoading && searchedPo !== null && records.length === 0 && !fetchError && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--bg-300)] py-12 text-center">
          <svg className="h-8 w-8 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium text-[var(--text-200)]">No invoices found</p>
          {searchedPo && (
            <p className="text-xs text-[var(--text-200)]">
              No EDI 810 invoices matched PO <span className="font-mono">{searchedPo}</span>
            </p>
          )}
        </div>
      )}

      {/* ── Raw JSON drawer ── */}
      {rawTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setRawTarget(null) }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => setRawTarget(null)} />

          <div className="relative z-10 flex flex-col w-full max-w-lg max-h-[80vh] rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-000)] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--text-100)]">Raw SPS response</p>
              <button
                type="button"
                onClick={() => setRawTarget(null)}
                className="rounded p-1 text-[var(--text-200)] hover:text-[var(--text-100)] hover:bg-[var(--bg-100)] transition-colors cursor-pointer"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-[11px] font-mono text-[var(--text-100)] whitespace-pre-wrap break-words leading-relaxed">
                {JSON.stringify(rawTarget.rawData ?? rawTarget, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
