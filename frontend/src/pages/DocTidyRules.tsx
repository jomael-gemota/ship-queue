import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../lib/api'
import { Banner, DocTidyTabs, Spinner } from '../components/docTidy/docTidyUi'
import { formatDateTime } from '../lib/format'
import type {
  DocTidyConfig,
  DocTidyRule,
  DocTidyRuleInput,
  MatchMode,
  RunRuleResult,
} from '../types/docTidy'

const EMPTY_RULE: DocTidyRuleInput = {
  name: '',
  description: '',
  enabled: true,
  fromAddresses: [],
  toAddresses: [],
  subjectKeywords: [],
  bodyKeywords: [],
  excludeKeywords: [],
  matchMode: 'any',
  dateFrom: null,
  dateTo: null,
  lookbackDays: 30,
  requireAttachment: true,
  attachmentExtensions: [],
}

const inputClass =
  'w-full text-sm border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]'

/** Repeatable free-text entry rendered as removable chips. */
function ChipInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  const [draft, setDraft] = useState('')

  const commit = () => {
    const parts = draft
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (!parts.length) return
    // Case-insensitive de-dupe so the same term isn't added twice.
    const existing = new Set(values.map((v) => v.toLowerCase()))
    onChange([...values, ...parts.filter((p) => !existing.has(p.toLowerCase()))])
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-[var(--text-100)]">
        {label}
        {hint && <span className="ml-1.5 text-xs font-normal text-[var(--text-200)]">{hint}</span>}
      </label>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value, i) => (
            <span
              key={`${value}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--primary-100)] px-2.5 py-1 text-xs font-medium text-[var(--accent-200)]"
            >
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                className="opacity-60 hover:opacity-100 cursor-pointer"
                aria-label={`Remove ${value}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          }
        }}
        // Commit on blur too, so a typed term isn't silently lost on save.
        onBlur={commit}
        placeholder={placeholder}
        className={inputClass}
      />
    </div>
  )
}

function RuleEditor({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: DocTidyRuleInput
  saving: boolean
  onCancel: () => void
  onSave: (rule: DocTidyRuleInput) => void
}) {
  const [rule, setRule] = useState<DocTidyRuleInput>(initial)
  const [useLookback, setUseLookback] = useState(Boolean(initial.lookbackDays))

  const set = <K extends keyof DocTidyRuleInput>(key: K, value: DocTidyRuleInput[K]) =>
    setRule((prev) => ({ ...prev, [key]: value }))

  const submit = () => {
    // The date mode toggle decides which of the two ranges is persisted.
    onSave({
      ...rule,
      lookbackDays: useLookback ? rule.lookbackDays || 30 : null,
      dateFrom: useLookback ? null : rule.dateFrom,
      dateTo: useLookback ? null : rule.dateTo,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl">
        <div className="sticky top-0 border-b border-[var(--bg-300)] bg-[var(--bg-100)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--text-100)]">
            {initial.name ? 'Edit rule' : 'New extraction rule'}
          </h2>
          <p className="text-xs text-[var(--text-200)] mt-0.5">
            Messages must match this entry to be extracted along with their attachments.
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-100)]">Name</label>
              <input
                type="text"
                value={rule.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Acme supplier invoices"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-100)]">
                Description <span className="text-xs font-normal text-[var(--text-200)]">optional</span>
              </label>
              <input
                type="text"
                value={rule.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
                placeholder="What this entry collects"
                className={inputClass}
              />
            </div>
          </div>

          <ChipInput
            label="Sender emails"
            hint="address or domain"
            values={rule.fromAddresses}
            onChange={(v) => set('fromAddresses', v)}
            placeholder="billing@acme.com — press Enter to add"
          />

          <ChipInput
            label="Delivered to"
            hint="group or recipient address the mail arrived under"
            values={rule.toAddresses}
            onChange={(v) => set('toAddresses', v)}
            placeholder="invoice@outdoorequipped.com — press Enter to add"
          />

          <ChipInput
            label="Subject keywords"
            values={rule.subjectKeywords}
            onChange={(v) => set('subjectKeywords', v)}
            placeholder="invoice, statement — press Enter to add"
          />

          <ChipInput
            label="Body keywords"
            values={rule.bodyKeywords}
            onChange={(v) => set('bodyKeywords', v)}
            placeholder="purchase order — press Enter to add"
          />

          <ChipInput
            label="Exclude keywords"
            hint="messages containing these are skipped"
            values={rule.excludeKeywords}
            onChange={(v) => set('excludeKeywords', v)}
            placeholder="reminder, draft — press Enter to add"
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-100)]">Keyword matching</label>
            <select
              value={rule.matchMode}
              onChange={(e) => set('matchMode', e.target.value as MatchMode)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="any">Match any keyword</option>
              <option value="all">Match all keywords</option>
            </select>
          </div>

          {/* Date range */}
          <div className="space-y-2 rounded-lg border border-[var(--bg-300)] p-4">
            <p className="text-sm font-medium text-[var(--text-100)]">Date range</p>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={useLookback}
                  onChange={() => setUseLookback(true)}
                  className="cursor-pointer"
                />
                Rolling window
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={!useLookback}
                  onChange={() => setUseLookback(false)}
                  className="cursor-pointer"
                />
                Fixed dates
              </label>
            </div>

            {useLookback ? (
              <label className="flex items-center gap-2 text-sm text-[var(--text-200)]">
                Look back
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={rule.lookbackDays ?? 30}
                  onChange={(e) => set('lookbackDays', Number(e.target.value))}
                  className={`${inputClass} w-24`}
                />
                days from the run date
              </label>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-[var(--text-200)] space-y-1">
                  <span className="block">From</span>
                  <input
                    type="date"
                    value={rule.dateFrom ? String(rule.dateFrom).slice(0, 10) : ''}
                    onChange={(e) => set('dateFrom', e.target.value || null)}
                    className={inputClass}
                  />
                </label>
                <label className="text-sm text-[var(--text-200)] space-y-1">
                  <span className="block">To</span>
                  <input
                    type="date"
                    value={rule.dateTo ? String(rule.dateTo).slice(0, 10) : ''}
                    onChange={(e) => set('dateTo', e.target.value || null)}
                    className={inputClass}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Attachments */}
          <div className="space-y-3 rounded-lg border border-[var(--bg-300)] p-4">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-100)] cursor-pointer">
              <input
                type="checkbox"
                checked={rule.requireAttachment}
                onChange={(e) => set('requireAttachment', e.target.checked)}
                className="cursor-pointer"
              />
              Only extract messages that have attachments
            </label>

            <ChipInput
              label="Attachment file types"
              hint="leave empty to accept all"
              values={rule.attachmentExtensions}
              onChange={(v) => set('attachmentExtensions', v)}
              placeholder="pdf, xlsx — press Enter to add"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-100)] cursor-pointer">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
              className="cursor-pointer"
            />
            Enabled
          </label>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-100)] px-6 py-4">
          <button
            onClick={onCancel}
            className="rounded-lg border border-[var(--bg-300)] px-4 py-2 text-sm font-medium text-[var(--text-200)] hover:bg-[var(--bg-200)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !rule.name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-200)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving && <Spinner />}
            Save rule
          </button>
        </div>
      </div>
    </div>
  )
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
  const [confirmDelete, setConfirmDelete] = useState<DocTidyRule | null>(null)

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
    try {
      await authApi.put(`/doc-tidy/rules/${rule._id}`, { ...rule, enabled: !rule.enabled })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update rule')
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

  const summarise = (rule: DocTidyRule): string => {
    const parts: string[] = []
    if (rule.fromAddresses.length) parts.push(`from ${rule.fromAddresses.join(', ')}`)
    if (rule.toAddresses?.length) parts.push(`to ${rule.toAddresses.join(', ')}`)
    if (rule.subjectKeywords.length) parts.push(`subject: ${rule.subjectKeywords.join(', ')}`)
    if (rule.bodyKeywords.length) parts.push(`body: ${rule.bodyKeywords.join(', ')}`)
    if (rule.excludeKeywords.length) parts.push(`excluding: ${rule.excludeKeywords.join(', ')}`)
    if (rule.lookbackDays) parts.push(`last ${rule.lookbackDays} days`)
    if (rule.attachmentExtensions.length) parts.push(`${rule.attachmentExtensions.join('/')} files`)
    return parts.length ? parts.join(' · ') : 'Matches every message in the mailbox'
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <DocTidyTabs />
        <button
          onClick={() => setEditing({ rule: { ...EMPTY_RULE } })}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[var(--accent-200)] text-white text-sm font-medium shadow-[0_14px_24px_-18px_rgba(0,102,140,0.75)] hover:-translate-y-[1px] transition-all cursor-pointer"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New rule
        </button>
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

      <div className="rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-sm">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--text-200)]">
            <span className="inline-flex items-center gap-2">
              <Spinner /> Loading rules…
            </span>
          </div>
        ) : rules.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-[var(--text-200)]">
              No extraction rules yet. Create one to describe which messages Doc Tidy should collect.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--bg-300)]">
            {rules.map((rule) => (
              <li key={rule._id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text-100)]">{rule.name}</h3>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        rule.enabled
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-slate-200 text-slate-600 dark:bg-[var(--bg-300)] dark:text-[var(--text-200)]'
                      }`}
                    >
                      {rule.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    {rule.requireAttachment && (
                      <span className="inline-flex items-center rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-200)]">
                        Attachments only
                      </span>
                    )}
                    <span className="text-[11px] uppercase tracking-wide text-[var(--text-200)]">
                      match {rule.matchMode}
                    </span>
                  </div>

                  {rule.description && (
                    <p className="mt-0.5 text-xs text-[var(--text-200)]">{rule.description}</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--text-200)]">{summarise(rule)}</p>

                  <p className="mt-1.5 text-[11px] text-[var(--text-200)]">
                    {rule.lastRunAt
                      ? `Last run ${formatDateTime(rule.lastRunAt)} · ${rule.lastRunMatchCount ?? 0} matched`
                      : 'Never run'}
                    {rule.createdByName && ` · created by ${rule.createdByName}`}
                  </p>
                  {rule.lastRunError && (
                    <p className="mt-1 text-[11px] text-red-500">Last run failed: {rule.lastRunError}</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => handleRun(rule)}
                    disabled={runningId === rule._id || !config?.mailboxConnected}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--bg-300)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent-200)] hover:bg-[var(--primary-100)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title={config?.mailboxConnected ? 'Run this rule now' : 'Connect the mailbox first'}
                  >
                    {runningId === rule._id ? <Spinner className="h-3 w-3" /> : 'Run'}
                  </button>
                  <button
                    onClick={() => handleToggle(rule)}
                    className="rounded-lg border border-[var(--bg-300)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-200)] hover:bg-[var(--bg-200)] cursor-pointer"
                  >
                    {rule.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() =>
                      setEditing({
                        id: rule._id,
                        rule: {
                          name: rule.name,
                          description: rule.description ?? '',
                          enabled: rule.enabled,
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
                        },
                      })
                    }
                    className="rounded-lg border border-[var(--bg-300)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-200)] hover:bg-[var(--bg-200)] cursor-pointer"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDelete(rule)}
                    className="rounded-lg border border-[var(--bg-300)] px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <RuleEditor
          initial={editing.rule}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={() => setConfirmDelete(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl p-6 space-y-4">
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
