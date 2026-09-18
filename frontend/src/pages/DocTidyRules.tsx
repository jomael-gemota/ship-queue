import { useCallback, useEffect, useMemo, useState } from 'react'
import { authApi } from '../lib/api'
import {
  Banner,
  DocumentTypeBadge,
  IconButton,
  PaginationArrows,
  Spinner,
} from '../components/docTidy/docTidyUi'
import RuleEditor from '../components/docTidy/RuleEditor'
import { formatDateTime } from '../lib/format'
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  EMPTY_RULE,
  documentTypeOf,
  type DocTidyRule,
  type DocTidyRuleInput,
  type DocumentType,
} from '../types/docTidy'

const ICON_DELETE =
  'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'

const filterClass =
  'text-[11px] border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]'

type StatusFilter = '' | 'enabled' | 'disabled'

/** Strips the server-only fields so an existing rule can seed the editor. */
function toRuleInput(rule: DocTidyRule): DocTidyRuleInput {
  return {
    name: rule.name,
    description: rule.description ?? '',
    enabled: rule.enabled,
    documentType: documentTypeOf(rule.documentType),
    fromAddresses: rule.fromAddresses,
    toAddresses: rule.toAddresses ?? [],
    subjectKeywords: rule.subjectKeywords,
    bodyKeywords: rule.bodyKeywords,
    excludeKeywords: rule.excludeKeywords,
    matchMode: rule.matchMode,
    dateFrom: rule.dateFrom ?? null,
    dateTo: rule.dateTo ?? null,
    lookbackDays: rule.lookbackDays ?? null,
    requireAttachment: rule.requireAttachment,
    attachmentExtensions: rule.attachmentExtensions,
  }
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

/**
 * Rule list + editor scoped to one workspace.
 *
 * Renders without any page chrome (no tab bar, no outer card) so it can be
 * dropped directly into a workspace detail tab panel.
 */
export default function WorkspaceRulesView({ workspaceId }: { workspaceId: string }) {
  const [rules, setRules] = useState<DocTidyRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<{ rule: DocTidyRuleInput; id?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<DocTidyRule | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<DocumentType | ''>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authApi.get<{ data: DocTidyRule[] }>(`/doc-tidy/rules?workspaceId=${workspaceId}`)
      setRules(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rules')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async (input: DocTidyRuleInput) => {
    setSaving(true)
    setError(null)
    try {
      if (editing?.id) {
        await authApi.put(`/doc-tidy/rules/${editing.id}`, { ...input, workspaceId })
      } else {
        await authApi.post('/doc-tidy/rules', { ...input, workspaceId })
      }
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save rule')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (rule: DocTidyRule) => {
    try {
      await authApi.delete(`/doc-tidy/rules/${rule._id}`)
      setConfirmDelete(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete rule')
    }
  }

  /** All rules that pass the active filters — not yet paginated. */
  const filteredRules = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rules.filter((rule) => {
      if (typeFilter && documentTypeOf(rule.documentType) !== typeFilter) return false
      if (statusFilter === 'enabled' && !rule.enabled) return false
      if (statusFilter === 'disabled' && rule.enabled) return false
      if (!term) return true
      return `${rule.name} ${rule.description ?? ''}`.toLowerCase().includes(term)
    })
  }, [rules, search, typeFilter, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRules.length / pageSize))

  const pagedRules = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredRules.slice(start, start + pageSize)
  }, [filteredRules, page, pageSize])

  useEffect(() => { setPage(1) }, [search, typeFilter, statusFilter])

  const hasActiveFilters = Boolean(search || typeFilter || statusFilter)

  const clearFilters = () => {
    setSearch('')
    setTypeFilter('')
    setStatusFilter('')
    setPage(1)
  }

  const openNew = () => setEditing({ rule: { ...EMPTY_RULE } })
  const openEdit = (rule: DocTidyRule) => setEditing({ id: rule._id, rule: toRuleInput(rule) })

  /* ─────────────────────────────────────────────────────────── render ── */
  return (
    <div className="space-y-4">
      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-sm">
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--bg-300)] px-4 py-2">
          {/* Search */}
          <div className="relative min-w-[180px] flex-1 max-w-xs">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-gray-400">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" />
              </svg>
            </span>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules…" className={`${filterClass} w-full pl-8`} />
          </div>

          {/* Type filter */}
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as DocumentType | '')}
            className={`${filterClass} cursor-pointer`} aria-label="Filter by document type">
            <option value="">All document types</option>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</option>
            ))}
          </select>

          {/* Status filter */}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={`${filterClass} cursor-pointer`} aria-label="Filter by status">
            <option value="">Any status</option>
            <option value="enabled">Active</option>
            <option value="disabled">Disabled</option>
          </select>

          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer">
              Clear
            </button>
          )}

          {/* Rule count + New rule */}
          <span className="ml-auto text-[11px] text-gray-500 dark:text-[var(--text-200)]">
            {hasActiveFilters
              ? `${filteredRules.length} of ${rules.length} rules`
              : `${rules.length} rule${rules.length === 1 ? '' : 's'}`}
          </span>
          <button onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-200)] px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 cursor-pointer">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New rule
          </button>
        </div>

        {/* ── Body ── */}
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--text-200)]">
            <span className="inline-flex items-center gap-2"><Spinner /> Loading rules…</span>
          </div>
        ) : rules.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <svg className="mx-auto h-9 w-9 text-[var(--text-200)] opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <p className="mt-3 text-sm font-medium text-[var(--text-100)]">No rules in this workspace yet</p>
            <p className="mt-1 text-sm text-[var(--text-200)]">
              Rules define which emails Doc Tidy captures and what kind of document they contain.
            </p>
            <button onClick={openNew}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white cursor-pointer">
              Create the first rule
            </button>
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-[var(--text-200)]">No rules match these filters.</p>
            <button onClick={clearFilters} className="mt-2 text-sm text-[var(--accent-200)] hover:underline cursor-pointer">
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-[var(--bg-300)]">
              {pagedRules.map((rule) => (
                <li key={rule._id} onClick={() => openEdit(rule)}
                  className={`group cursor-pointer flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-[var(--bg-200)]/50 lg:flex-row lg:items-center lg:justify-between border-l-2 ${
                    rule.enabled ? 'border-l-[var(--accent-200)]' : 'border-l-[var(--bg-300)]'
                  }`}
                >
                  {/* ── Main content ── */}
                  <div className={`min-w-0 flex-1 space-y-1.5 ${rule.enabled ? '' : 'opacity-60'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--text-100)]">{rule.name}</h3>
                      <DocumentTypeBadge value={rule.documentType} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-200)]">
                        <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {rule.lastRunAt
                          ? `Last run ${formatDateTime(rule.lastRunAt)} · ${rule.lastRunMatchCount ?? 0} matched`
                          : 'Never run'}
                      </span>
                      {rule.createdByName && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-200)]">
                          <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          {rule.createdByName}
                        </span>
                      )}
                      {rule.lastRunError && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
                          <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          Last run failed: {rule.lastRunError}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Right side: status badge + actions ── */}
                  <div className="flex shrink-0 items-center gap-2.5 lg:pl-4">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                      rule.enabled
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20'
                        : 'bg-[var(--bg-200)] text-[var(--text-200)] ring-[var(--bg-300)]'
                    }`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        rule.enabled ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-[var(--text-200)]/50'
                      }`} />
                      {rule.enabled ? 'Active' : 'Disabled'}
                    </span>

                    <svg className="h-4 w-4 shrink-0 text-[var(--text-200)] opacity-0 transition-opacity group-hover:opacity-60"
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>

                    <div onClick={(e) => e.stopPropagation()}>
                      <IconButton label="Delete rule" iconPath={ICON_DELETE} tone="danger"
                        onClick={() => setConfirmDelete(rule)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* ── Pagination footer ── */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--bg-300)] px-4 py-2.5">
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-200)]">
                <span>Rows per page</span>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                  className="cursor-pointer rounded border border-[var(--bg-300)] bg-[var(--bg-100)] px-1.5 py-0.5 text-[11px] text-[var(--text-100)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-200)] dark:bg-[var(--bg-200)]">
                  {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="tabular-nums">
                  {filteredRules.length === 0
                    ? '0'
                    : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredRules.length)}`}{' '}
                  of {filteredRules.length}
                </span>
              </div>
              {totalPages > 1 && (
                <PaginationArrows page={page} pages={totalPages} onChange={setPage} />
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Rule editor modal ── */}
      {editing && (
        <RuleEditor
          initial={editing.rule}
          isNew={!editing.id}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {/* ── Delete confirmation modal ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={() => setConfirmDelete(null)} />
          <div role="dialog" aria-modal="true"
            className="relative z-10 w-full max-w-sm overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl">
            <div className="flex items-center gap-3 border-b border-[var(--bg-300)] px-5 py-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICON_DELETE} />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-[var(--text-100)]">Delete rule</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-[var(--text-200)]">
                Delete <span className="font-medium text-[var(--text-100)]">{confirmDelete.name}</span>?
                Messages it already extracted are kept.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-5 py-3">
              <button onClick={() => setConfirmDelete(null)}
                className="cursor-pointer rounded-lg border border-[var(--bg-300)] px-3 py-1.5 text-sm font-medium text-[var(--text-200)] transition-colors hover:bg-[var(--bg-200)]">
                Cancel
              </button>
              <button onClick={() => void handleDelete(confirmDelete)}
                className="cursor-pointer rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90">
                Delete rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
