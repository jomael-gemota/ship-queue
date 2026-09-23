import { useCallback, useEffect, useState } from 'react'
import { authApi } from '../lib/api'
import { HH_BRANDS } from '../lib/hhBrand'
import type { CookieJar, CookieJarListResponse, CookieJarResponse } from '../types/label'

function hhJarHelp(key: string): string | null {
  const brand = Object.values(HH_BRANDS).find((item) => item.cookieJarKey === key)
  if (!brand) return null
  return `Manual session for ${brand.supplier} B2B (${brand.catalog}). Prefer Dropship (B2B) → ${brand.name} → Configurations. Not refreshed by Sphere.`
}

interface Draft {
  name: string
  enabled: boolean
  cron: string
}

function toDraft(jar: CookieJar): Draft {
  return { name: jar.name, enabled: jar.enabled, cron: jar.cron }
}

function isDirty(jar: CookieJar, draft: Draft): boolean {
  return draft.name !== jar.name || draft.enabled !== jar.enabled || draft.cron !== jar.cron
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const DEFAULT_JAR_KEY = 'seller-central-outdoor-equipped-us'

function orderedJars(jars: CookieJar[]): CookieJar[] {
  return [...jars].sort((a, b) => {
    if (a.key === DEFAULT_JAR_KEY) return -1
    if (b.key === DEFAULT_JAR_KEY) return 1
    return 0
  })
}

export default function CookieJarSection({
  isAdmin,
  onError,
  onSuccess,
}: {
  isAdmin: boolean
  onError: (message: string | null) => void
  onSuccess: (message: string | null) => void
}) {
  const [jars, setJars] = useState<CookieJar[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [selectedKey, setSelectedKey] = useState(DEFAULT_JAR_KEY)
  const [loaded, setLoaded] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [runningKey, setRunningKey] = useState<string | null>(null)

  const applyJars = useCallback((next: CookieJar[]) => {
    setJars(next)
    setDrafts(Object.fromEntries(next.map((jar) => [jar.key, toDraft(jar)])))
  }, [])

  useEffect(() => {
    authApi
      .get<CookieJarListResponse>('/settings/cookie-jars')
      .then((res) => applyJars(res.data))
      .catch(() => onError('Failed to load cookie jar settings'))
      .finally(() => setLoaded(true))
  }, [applyJars, onError])

  const updateDraft = (key: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  const saveJar = async (jar: CookieJar) => {
    const draft = drafts[jar.key]
    if (!draft) return
    const name = draft.name.trim()
    if (!name) {
      onSuccess(null)
      onError('Name is required.')
      return
    }
    const cron = draft.cron.trim()
    if (cron.split(/\s+/).length !== 5) {
      onSuccess(null)
      onError('Cron must have 5 fields, e.g. 0 0,6,12,18 * * *.')
      return
    }

    setSavingKey(jar.key)
    onError(null)
    onSuccess(null)
    try {
      const res = await authApi.patch<CookieJarResponse>(`/settings/cookie-jars/${encodeURIComponent(jar.key)}`, {
        name,
        enabled: draft.enabled,
        cron,
      })
      setJars((prev) => prev.map((row) => (row.key === jar.key ? res.data : row)))
      setDrafts((prev) => ({ ...prev, [jar.key]: toDraft(res.data) }))
      onSuccess(
        res.data.enabled
          ? `${res.data.name} saved — worker will pick up the schedule within about 30 seconds.`
          : `${res.data.name} disabled.`
      )
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save cookie jar')
    } finally {
      setSavingKey(null)
    }
  }

  const runJarNow = async (jar: CookieJar) => {
    setRunningKey(jar.key)
    onError(null)
    onSuccess(null)
    try {
      const res = await authApi.post<CookieJarResponse>(
        `/settings/cookie-jars/${encodeURIComponent(jar.key)}/run`
      )
      setJars((prev) => prev.map((row) => (row.key === jar.key ? res.data : row)))
      setDrafts((prev) => ({ ...prev, [jar.key]: toDraft(res.data) }))
      if (res.skipped) {
        onError(res.message || 'A run is already in progress.')
      } else if (res.data.lastError) {
        onError(`${res.data.name} failed: ${res.data.lastError}`)
      } else {
        onSuccess(`${res.data.name} ran successfully.`)
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to run cookie jar')
    } finally {
      setRunningKey(null)
    }
  }

  return (
    <section className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)]">
          <CookieJarMark className="h-6 w-6 text-amber-700 dark:text-amber-400" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Cookie Jar</h2>
            {!isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-[var(--bg-300)] px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-[var(--text-200)]">
                Read-only
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
            Schedule one cookie at a time. The worker stores the latest value; this page never shows it.
          </p>
        </div>
      </div>

      {!loaded ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : jars.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
          No cookie jobs yet. They are created by the Cookie Jar worker.
        </p>
      ) : (
        <CookieJarEditor
          jars={orderedJars(jars)}
          selectedKey={
            jars.some((jar) => jar.key === selectedKey)
              ? selectedKey
              : (jars.find((jar) => jar.key === DEFAULT_JAR_KEY)?.key ?? jars[0].key)
          }
          onSelect={setSelectedKey}
          drafts={drafts}
          isAdmin={isAdmin}
          savingKey={savingKey}
          runningKey={runningKey}
          onUpdateDraft={updateDraft}
          onSave={saveJar}
          onRun={runJarNow}
        />
      )}
    </section>
  )
}

function CookieJarEditor({
  jars,
  selectedKey,
  onSelect,
  drafts,
  isAdmin,
  savingKey,
  runningKey,
  onUpdateDraft,
  onSave,
  onRun,
}: {
  jars: CookieJar[]
  selectedKey: string
  onSelect: (key: string) => void
  drafts: Record<string, Draft>
  isAdmin: boolean
  savingKey: string | null
  runningKey: string | null
  onUpdateDraft: (key: string, patch: Partial<Draft>) => void
  onSave: (jar: CookieJar) => void
  onRun: (jar: CookieJar) => void
}) {
  const jar = jars.find((item) => item.key === selectedKey) ?? jars[0]
  const draft = drafts[jar.key] ?? toDraft(jar)
  const saving = savingKey === jar.key
  const running = runningKey === jar.key
  const dirty = isDirty(jar, draft)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label htmlFor="cookie-jar-picker" className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)]">
          Cookie
        </label>
        <select
          id="cookie-jar-picker"
          value={jar.key}
          onChange={(event) => onSelect(event.target.value)}
          className="w-full cursor-pointer rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] sm:max-w-sm dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]"
        >
          {jars.map((item) => {
            const itemDraft = drafts[item.key] ?? toDraft(item)
            const itemDirty = isDirty(item, itemDraft)
            return (
              <option key={item.key} value={item.key}>
                {item.name}
                {itemDirty ? ' (unsaved)' : ''}
              </option>
            )
          })}
        </select>
      </div>

      <div className="rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] divide-y divide-[var(--bg-300)] dark:divide-[var(--bg-300)]">
                <div className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)]">Enabled</p>
                    <p className="text-xs text-slate-500 dark:text-[var(--text-200)] font-mono break-all">{jar.key}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.enabled}
                    aria-label={`Enable ${jar.name}`}
                    onClick={() => onUpdateDraft(jar.key, { enabled: !draft.enabled })}
                    disabled={!isAdmin}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                    } ${
                      draft.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-[var(--bg-300)]'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        draft.enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)]">Name</p>
                    <p className="text-xs text-slate-500 dark:text-[var(--text-200)]">Shown in the Cookie menu. Does not change which fetcher runs.</p>
                  </div>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => onUpdateDraft(jar.key, { name: e.target.value })}
                    disabled={!isAdmin}
                    maxLength={80}
                    className="w-48 max-w-full rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] px-3 py-2 text-sm text-slate-700 dark:text-[var(--text-100)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] disabled:opacity-50"
                  />
                </div>

                {!jar.manual && (
                <div className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)]">Cron schedule</p>
                    <p className="text-xs text-slate-500 dark:text-[var(--text-200)]">
                      Five fields in Philippines time, e.g. 0 0,6,12,18 * * * (12:00 AM, 6:00 AM, 12:00 PM, 6:00 PM).
                    </p>
                  </div>
                  <input
                    type="text"
                    value={draft.cron}
                    onChange={(e) => onUpdateDraft(jar.key, { cron: e.target.value })}
                    disabled={!isAdmin || !draft.enabled}
                    spellCheck={false}
                    className="w-48 max-w-full rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] px-3 py-2 text-sm font-mono text-slate-700 dark:text-[var(--text-100)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] disabled:opacity-50"
                  />
                </div>
                )}

                {jar.manual && (
                  <p className="px-4 py-3 text-xs text-slate-500 dark:text-[var(--text-200)]">
                    {hhJarHelp(jar.key) ||
                      'Manual session. Prefer Dropship (B2B) → Configurations. Not refreshed by Sphere.'}
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 text-xs">
                  <StatusCell
                    label="Cookie"
                    value={jar.hasCookie ? 'Stored' : 'None yet'}
                    tone={jar.hasCookie ? 'ok' : 'muted'}
                  />
                  <StatusCell label="Last success" value={formatWhen(jar.lastSuccessAt)} />
                  <StatusCell label="Last run" value={formatWhen(jar.lastRunAt)} />
                </div>

                {jar.lastError && (
                  <p className="px-4 py-3 text-xs text-red-600 dark:text-red-400 break-words">
                    Last error: {jar.lastError}
                  </p>
                )}

                {isAdmin ? (
                  <div className="flex items-center justify-end gap-2 p-4">
                    {jar.hasFetcher !== false && (
                    <button
                      type="button"
                      onClick={() => onRun(jar)}
                      disabled={saving || running}
                      className="rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] px-4 py-2 text-sm font-medium text-slate-700 dark:text-[var(--text-100)] hover:bg-[var(--bg-200)] dark:hover:bg-[var(--bg-300)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {running ? 'Running…' : 'Run now'}
                    </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSave(jar)}
                      disabled={saving || running || !dirty}
                      className="rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                ) : (
                  <p className="p-4 text-xs text-slate-500 dark:text-[var(--text-200)]">
                    Only an admin can change these settings.
                  </p>
                )}
      </div>
    </div>
  )
}

function StatusCell({
  label,
  value,
  tone = 'muted',
}: {
  label: string
  value: string
  tone?: 'ok' | 'muted'
}) {
  return (
    <div>
      <p className="uppercase tracking-wide text-slate-400 dark:text-[var(--text-200)] mb-0.5">{label}</p>
      <p className={`font-medium ${tone === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-[var(--text-100)]'}`}>
        {value}
      </p>
    </div>
  )
}

function CookieJarMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 8V7a4 4 0 118 0v1m-9.5 0h11A1.5 1.5 0 0119 9.5V11c0 5-2.5 9-7 9s-7-4-7-9V9.5A1.5 1.5 0 016.5 8z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 13h.01M15 13h.01M12 16h.01" />
    </svg>
  )
}
