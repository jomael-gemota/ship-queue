import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../lib/api'
import {
  Banner,
  DocTidyTabs,
  DocumentTypeBadge,
  IconButton,
  RuleCriteria,
  Spinner,
  ToggleSwitch,
} from '../components/docTidy/docTidyUi'
import RuleEditor from '../components/docTidy/RuleEditor'
import { formatDateTime } from '../lib/format'
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  EMPTY_RULE,
  documentTypeOf,
  type DocTidyConfig,
  type DocTidyRule,
  type DocTidyRuleInput,
  type DocumentType,
  type RunRuleResult,
} from '../types/docTidy'

const ICONS = {
  run: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  delete:
    'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
}

const filterClass =
  'text-sm border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]'

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

export default function DocTidyRules() {
  const [rules, setRules] = useState<DocTidyRule[]>([])
  const [config, setConfig] = useState<DocTidyConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [editing, setEditing] = useState<{ rule: DocTidyRuleInput; id?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DocTidyRule | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<DocumentType | ''>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rulesRes, configRes] = await Promise.all([
        authApi.get<{ data: DocTidyRule[] }>('/doc-tidy/rules'),
        authApi.get<{ data: DocTidyConfig }>('/doc-tidy/config').catch(() => null),
      ])
      setRules(rulesRes.data)
      if (configRes) setConfig(configRes.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async (input: DocTidyRuleInput) => {
    setSaving(true)
    setError(null)
    try {
      if (editing?.id) await authApi.put(`/doc-tidy/rules/${editing.id}`, input)
      else await authApi.post('/doc-tidy/rules', input)

      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save rule')
    } finally {
      setSaving(false)
    }
  }

  const handleRun = async (rule: DocTidyRule) => {
    setRunningId(rule._id)
    setError(null)
    setNotice(null)
    try {
      const res = await authApi.post<{ data: RunRuleResult }>(`/doc-tidy/rules/${rule._id}/run`)
      const r = res.data
      setNotice(
        `"${rule.name}" — ${r.matched} matched, ${r.imported} new, ${r.updated} updated, ` +
          `${r.attachmentsUploaded} attachment${r.attachmentsUploaded === 1 ? '' : 's'} saved to Drive` +
          (r.attachmentErrors ? ` (${r.attachmentErrors} failed)` : '')
      )
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed')
      await load()
    } finally {
      setRunningId(null)
    }
  }

  const handleToggle = async (rule: DocTidyRule) => {
    setTogglingId(rule._id)
    try {
      await authApi.put(`/doc-tidy/rules/${rule._id}`, { ...rule, enabled: !rule.enabled })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update rule')
    } finally {
      setTogglingId(null)
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

  // The full rule list is already loaded, so the toolbar filters in place.
  const visibleRules = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rules.filter((rule) => {
      if (typeFilter && documentTypeOf(rule.documentType) !== typeFilter) return false
      if (statusFilter === 'enabled' && !rule.enabled) return false
      if (statusFilter === 'disabled' && rule.enabled) return false
      if (!term) return true
      return `${rule.name} ${rule.description ?? ''}`.toLowerCase().includes(term)
    })
  }, [rules, search, typeFilter, statusFilter])

  const hasActiveFilters = Boolean(search || typeFilter || statusFilter)

  const clearFilters = () => {
    setSearch('')
    setTypeFilter('')
    setStatusFilter('')
  }

  const openNew = () => setEditing({ rule: { ...EMPTY_RULE } })

  return (
    <div className="space-y-4">
      {/* ── Tab bar + action controls ──────────────────────────────── */}
      <div className="flex items-end justify-between border-b border-[var(--bg-300)]">
        <DocTidyTabs />
        <div className="pb-1.5 pl-4 shrink-0">
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[var(--accent-200)] text-white text-sm font-medium shadow-[0_14px_24px_-18px_rgba(0,102,140,0.75)] hover:-translate-y-[1px] transition-all cursor-pointer"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New rule
          </button>
        </div>
      </div>

      {!config?.mailboxConnected && (
        <Banner kind="warning">
          The Doc Tidy mailbox is not connected. Rules can be written now, but an admin must connect the
          mailbox on the{' '}
          <Link to="/settings" className="underline font-medium">
            Settings
          </Link>{' '}
          page before they can run.
        </Banner>
      )}

      {notice && (
        <Banner kind="success" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--bg-300)] px-4 py-2.5">
          <div className="relative min-w-[200px] flex-1 max-w-sm">
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules…"
              className={`${filterClass} w-full pl-9`}
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as DocumentType | '')}
            className={`${filterClass} cursor-pointer`}
            aria-label="Filter by document type"
          >
            <option value="">All document types</option>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {DOCUMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={`${filterClass} cursor-pointer`}
            aria-label="Filter by status"
          >
            <option value="">Any status</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-sm text-[var(--accent-200)] hover:underline cursor-pointer"
            >
              Clear filters
            </button>
          )}

          <span className="ml-auto text-xs sm:text-sm text-gray-500 dark:text-[var(--text-200)]">
            {hasActiveFilters
              ? `${visibleRules.length} of ${rules.length} rules`
              : `${rules.length} rule${rules.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--text-200)]">
            <span className="inline-flex items-center gap-2">
              <Spinner /> Loading rules…
            </span>
          </div>
        ) : rules.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <svg
              className="mx-auto h-9 w-9 text-[var(--text-200)] opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            <p className="mt-3 text-sm font-medium text-[var(--text-100)]">No extraction rules yet</p>
            <p className="mt-1 text-sm text-[var(--text-200)]">
              A rule describes which messages Doc Tidy should collect and what kind of document they are.
            </p>
            <button
              onClick={openNew}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white cursor-pointer"
            >
              Create the first rule
            </button>
          </div>
        ) : visibleRules.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-[var(--text-200)]">No rules match these filters.</p>
            <button
              onClick={clearFilters}
              className="mt-2 text-sm text-[var(--accent-200)] hover:underline cursor-pointer"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--bg-300)]">
            {visibleRules.map((rule) => (
              <li
                key={rule._id}
                className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-[var(--bg-200)]/60 lg:flex-row lg:items-start lg:justify-between"
              >
                <div className={`min-w-0 flex-1 space-y-2 ${rule.enabled ? '' : 'opacity-60'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text-100)]">{rule.name}</h3>
                    <DocumentTypeBadge value={rule.documentType} />
                    {rule.requireAttachment && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-200)]"
                        title="Only messages carrying an attachment are extracted"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                          />
                        </svg>
                        Attachments only
                      </span>
                    )}
                  </div>

                  {rule.description && (
                    <p className="text-xs text-[var(--text-200)]">{rule.description}</p>
                  )}

                  <RuleCriteria rule={rule} />

                  <p className="text-[11px] text-[var(--text-200)]">
                    {rule.lastRunAt
                      ? `Last run ${formatDateTime(rule.lastRunAt)} · ${rule.lastRunMatchCount ?? 0} matched`
                      : 'Never run'}
                    {rule.createdByName && ` · created by ${rule.createdByName}`}
                  </p>
                  {rule.lastRunError && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400">
                      Last run failed: {rule.lastRunError}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2 lg:pl-4">
                  <ToggleSwitch
                    checked={rule.enabled}
                    disabled={togglingId === rule._id}
                    onChange={() => handleToggle(rule)}
                    label={rule.enabled ? 'Enabled' : 'Disabled'}
                    title={rule.enabled ? 'Disable this rule' : 'Enable this rule'}
                  />

                  <button
                    onClick={() => handleRun(rule)}
                    disabled={runningId === rule._id || !config?.mailboxConnected}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--bg-300)] px-3 text-xs font-medium text-[var(--accent-200)] hover:bg-[var(--primary-100)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title={config?.mailboxConnected ? 'Run this rule now' : 'Connect the mailbox first'}
                  >
                    {runningId === rule._id ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.run} />
                      </svg>
                    )}
                    Run
                  </button>

                  <IconButton
                    label="Edit rule"
                    iconPath={ICONS.edit}
                    onClick={() => setEditing({ id: rule._id, rule: toRuleInput(rule) })}
                  />
                  <IconButton
                    label="Delete rule"
                    iconPath={ICONS.delete}
                    tone="danger"
                    onClick={() => setConfirmDelete(rule)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <RuleEditor
          initial={editing.rule}
          isNew={!editing.id}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
            onClick={() => setConfirmDelete(null)}
          />
          <div className="relative z-10 w-full max-w-sm space-y-4 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-6 shadow-xl">
            <h2 className="text-base font-semibold text-[var(--text-100)]">Delete rule</h2>
            <p className="text-sm text-[var(--text-200)]">
              Delete <span className="font-medium">{confirmDelete.name}</span>? Messages it already
              extracted are kept.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-lg border border-[var(--bg-300)] px-4 py-2 text-sm font-medium text-[var(--text-200)] hover:bg-[var(--bg-200)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
