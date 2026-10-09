import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { authApi } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { subscribeDocTidyEvents } from '../lib/docTidyStore'
import { formatDateTime } from '../lib/format'
import { Banner, Spinner, Th } from '../components/docTidy/docTidyUi'
import {
  SERVICE_TIERS,
  USAGE_PURPOSE_LABELS,
  type ModelPrice,
  type OrganizationUsage,
  type Reconciliation,
  type ServiceTier,
  type TrueUpResult,
  type UsageSummary,
  type UsageSums,
} from '../types/docTidyUsage'

/* ───────────────────────────────────────────────────────── formatting ── */

const numberFormat = new Intl.NumberFormat('en-US')
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

const fmtTokens = (n: number) => numberFormat.format(Math.round(n))
const fmtCompact = (n: number) => compactFormat.format(n)

/** Sub-cent costs are the norm per call, so precision grows as values shrink. */
function fmtUsd(value: number): string {
  const abs = Math.abs(value)
  const digits = abs === 0 || abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

/** Plain dollars and cents for the Overview tab. */
function fmtMoney(value: number): string {
  if (value > 0 && value < 0.01) return '< $0.01'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** When the true-up finalises yesterday (06:00 UTC), in the viewer's own time. */
const finalisedAt = new Date(Date.UTC(2000, 0, 1, 6)).toLocaleTimeString([], { hour: 'numeric' })

/* ─────────────────────────────────────────────────────────── ranges ── */

type RangeKey = 'today' | '7d' | '30d' | 'mtd'
const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  mtd: 'Month to date',
}

/** Computed at fetch time so a live refetch always ends at "now". All UTC, to
 *  line up with OpenAI's daily billing buckets. */
function rangeFor(key: RangeKey): { from: string; to: string } {
  const now = new Date()
  const to = new Date(now.getTime() + 60_000)
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const from =
    key === 'today'
      ? new Date(startOfDay)
      : key === 'mtd'
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        : new Date(now.getTime() - (key === '7d' ? 7 : 30) * 86_400_000)
  return { from: from.toISOString(), to: to.toISOString() }
}

/* ────────────────────────────────────────────────────── small pieces ── */

const cardClass = 'rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)]'
const cellClass = 'px-3 py-2 border-b border-[var(--bg-300)] text-xs whitespace-nowrap'
const buttonClass =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-1.5 text-xs font-medium text-[var(--text-100)] hover:bg-[var(--primary-100)] disabled:opacity-50 disabled:cursor-not-allowed'

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${cardClass} p-4`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--text-100)] tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--text-200)]">{hint}</p>}
    </div>
  )
}

function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        live
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
          : 'bg-slate-200 text-slate-600 dark:bg-[var(--bg-300)] dark:text-[var(--text-200)]'
      }`}
      title={live ? 'Updates as usage is recorded' : 'Reconnecting to the live stream…'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
      {live ? 'Live' : 'Offline'}
    </span>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-[var(--text-200)] transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

/* ─────────────────────────────────────────────────── organizations ── */

const UNTRACKED_HINT =
  'Billed by OpenAI for Hermes but not matched to any recorded call (e.g. jobs run by a worker that was not reporting usage). Not charged to any workspace.'

function ShareBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--bg-300)]">
        <span className="block h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-10 text-right tabular-nums">{pct >= 0.05 || pct === 0 ? `${pct.toFixed(1)}%` : '< 0.1%'}</span>
    </span>
  )
}

function OrganizationTable({
  organizations,
  totalUsd,
}: {
  organizations: OrganizationUsage[]
  totalUsd: number
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (organizations.length === 0) {
    return <p className="p-6 text-center text-xs text-[var(--text-200)]">No organizations or workspaces yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <Th label="Organization / workspace" />
            <Th label="Documents" align="right" />
            <Th label="Input tokens" align="right" />
            <Th label="Cached" align="right" />
            <Th label="Output tokens" align="right" />
            <Th label="Spent" align="right" />
            <Th label="Share of total" align="right" />
          </tr>
        </thead>
        <tbody>
          {organizations.map((org) => {
            const key = org.organizationId ?? 'unassigned'
            const isOpen = open.has(key)
            return (
              <Fragment key={key}>
                <tr className="cursor-pointer hover:bg-[var(--primary-100)]" onClick={() => toggle(key)}>
                  <td className={`${cellClass} font-semibold text-[var(--text-100)]`}>
                    <span className="flex items-center gap-2">
                      <Chevron open={isOpen} />
                      {org.name}
                      <span className="font-normal text-[var(--text-200)]">
                        · {org.workspaces.length} workspace{org.workspaces.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  </td>
                  <OrgCells sums={org} totalUsd={totalUsd} strong />
                </tr>
                {isOpen &&
                  org.workspaces.map((ws) => (
                    <tr key={ws.untracked ? 'untracked' : (ws.workspaceId ?? 'none')} className="bg-[var(--bg-200)]/40">
                      <td
                        className={`${cellClass} pl-10 ${ws.untracked ? 'italic text-[var(--text-200)]' : 'text-[var(--text-100)]'}`}
                        title={ws.untracked ? UNTRACKED_HINT : undefined}
                      >
                        {ws.untracked ? 'Not linked to a workspace' : ws.name}
                        {ws.deleted && <span className="ml-1 text-[var(--text-200)]">({ws.workspaceId})</span>}
                      </td>
                      <OrgCells sums={ws} totalUsd={totalUsd} />
                    </tr>
                  ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Compact token count with the exact figure on hover; a dash for none. */
function TokenCell({ value }: { value: number }) {
  return (
    <td className={`${cellClass} text-right tabular-nums text-[var(--text-100)]`} title={value > 0 ? fmtTokens(value) : undefined}>
      {value > 0 ? fmtCompact(value) : '—'}
    </td>
  )
}

function OrgCells({ sums, totalUsd, strong = false }: { sums: UsageSums; totalUsd: number; strong?: boolean }) {
  const num = `${cellClass} text-right tabular-nums text-[var(--text-100)]`
  return (
    <>
      <td className={num}>{sums.jobs > 0 ? fmtTokens(sums.jobs) : '—'}</td>
      <TokenCell value={sums.inputTokens} />
      <TokenCell value={sums.cachedInputTokens} />
      <TokenCell value={sums.outputTokens} />
      <td className={`${num} ${strong ? 'font-semibold' : ''}`}>{fmtMoney(sums.costUsd)}</td>
      <td className={`${cellClass} text-[var(--text-200)]`}>
        <ShareBar value={sums.costUsd} total={totalUsd} />
      </td>
    </>
  )
}

/* ───────────────────────────────────────────────────────── trend ── */

const shortDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Every UTC day in the range, so quiet days show as gaps rather than vanishing. */
function DailyTrend({ summary }: { summary: UsageSummary }) {
  const days = useMemo(() => {
    const byDate = new Map(summary.daily.map((d) => [d.date, d.costUsd]))
    const out: Array<{ date: string; costUsd: number }> = []
    const end = new Date(summary.range.to).getTime()
    for (let t = new Date(summary.range.from.slice(0, 10)).getTime(); t < end; t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10)
      out.push({ date, costUsd: byDate.get(date) ?? 0 })
    }
    return out
  }, [summary])

  const max = Math.max(...days.map((d) => d.costUsd), 0)
  if (max === 0) {
    return <p className="p-6 text-center text-xs text-[var(--text-200)]">No spending in this range.</p>
  }
  const labelEvery = Math.max(1, Math.ceil(days.length / 8))
  return (
    <div className="px-4 pb-3 pt-4">
      <div className="flex h-36 items-end gap-1">
        {days.map((d) => (
          <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
            <div
              className={`w-full rounded-t ${d.costUsd > 0 ? 'bg-violet-500/80 group-hover:bg-violet-600' : 'bg-[var(--bg-300)]'}`}
              style={{ height: `${d.costUsd > 0 ? Math.max(3, (d.costUsd / max) * 100) : 1}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] text-white group-hover:block">
              {shortDate(d.date)}: {fmtMoney(d.costUsd)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {days.map((d, i) => (
          <span key={d.date} className="flex-1 truncate text-center text-[10px] text-[var(--text-200)]">
            {i % labelEvery === 0 ? shortDate(d.date) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────── reconciliation ── */

function TrueUpStatus({
  data,
  canEdit,
  onTrueUp,
}: {
  data: Extract<Reconciliation, { configured: true }>
  canEdit: boolean
  onTrueUp: () => Promise<void>
}) {
  const [running, setRunning] = useState(false)
  const last = data.lastTrueUp
  const skipped = last?.days.filter((d) => d.status === 'skipped' && d.reason !== 'No usage') ?? []

  if (data.calibrations.length === 0) return null
  return (
    <div className="space-y-2 rounded-lg border border-[var(--bg-300)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium text-[var(--text-100)]">Hermes calibration</p>
          {data.calibrations.map((c) => (
            <p key={c.model} className="text-[11px] text-[var(--text-200)]">
              <code>{c.model}</code> → <code>{c.upstreamModel}</code>:{' '}
              {c.calibrationFactor === null ? (
                <span className="text-amber-600 dark:text-amber-400">not calibrated yet, so estimates use list price</span>
              ) : (
                <>
                  billed at <strong className="text-[var(--text-100)]">{(c.calibrationFactor * 100).toFixed(1)}%</strong> of list
                  price over the last 7 days
                  {c.calibratedAt && ` (as of ${formatDateTime(c.calibratedAt)})`}
                </>
              )}
            </p>
          ))}
          <p className="text-[11px] text-[var(--text-200)]">
            Hermes hides which input was cached, so today's Hermes costs are estimates. Each complete UTC day is trued up to
            the actual bill about 6 hours after midnight UTC, then hourly.
            {last && ` Last true-up: ${formatDateTime(last.ranAt)}.`}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className={buttonClass}
            disabled={running}
            onClick={async () => {
              setRunning(true)
              try {
                await onTrueUp()
              } finally {
                setRunning(false)
              }
            }}
          >
            {running && <Spinner className="h-3 w-3" />} True up now
          </button>
        )}
      </div>
      {last?.error && <Banner kind="error">Last true-up failed: {last.error}</Banner>}
      {skipped.length > 0 && (
        <Banner kind="warning">
          {skipped.map((d) => (
            <span key={`${d.day}:${d.model}`} className="block">
              {d.day}: {d.reason}
            </span>
          ))}
        </Banner>
      )}
    </div>
  )
}

function ReconciliationCard({
  range,
  canEdit,
  onTrueUp,
}: {
  range: RangeKey
  canEdit: boolean
  onTrueUp: () => void
}) {
  const { addToast } = useToast()
  const [data, setData] = useState<Reconciliation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true)
      setError(null)
      try {
        const { from, to } = rangeFor(range)
        const params = new URLSearchParams({ from, to, ...(refresh ? { refresh: '1' } : {}) })
        const res = await authApi.get<{ data: Reconciliation }>(`/doc-tidy/usage/reconciliation?${params}`)
        setData(res.data)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [range]
  )

  useEffect(() => {
    load()
  }, [load])

  const trueUp = async () => {
    try {
      const res = await authApi.post<{ data: TrueUpResult }>('/doc-tidy/usage/true-up', {})
      const trued = res.data.days.filter((d) => d.status === 'trued-up').length
      addToast(`Trued up ${trued} day(s) and recalibrated today's estimates.`, 'success')
      onTrueUp()
      await load(true)
    } catch (err) {
      addToast((err as Error).message, 'error')
      await load()
    }
  }

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-100)]">Recorded vs. billed by OpenAI</h3>
          <p className="text-[11px] text-[var(--text-200)]">
            OpenAI's Costs API over whole UTC days, including Hermes's upstream calls on the same key.
          </p>
        </div>
        {data?.configured && canEdit && (
          <button type="button" className={buttonClass} disabled={loading} onClick={() => load(true)}>
            {loading && <Spinner className="h-3 w-3" />} Refresh
          </button>
        )}
      </div>
      <div className="p-4 text-xs">
        {error ? (
          <Banner kind="error">{error}</Banner>
        ) : !data ? (
          <Spinner />
        ) : !data.configured ? (
          <p className="text-[var(--text-200)]">
            Not connected to OpenAI billing yet. An admin can set <code>OPENAI_ADMIN_KEY</code> and{' '}
            <code>OPENAI_USAGE_API_KEY_IDS</code> on the server to compare these numbers with OpenAI's invoice.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Billed by OpenAI" value={fmtUsd(data.billedUsd)} hint={data.filteredByApiKey ? 'Doc Tidy key(s) only' : 'Whole organization'} />
              <StatCard
                label="Recorded here"
                value={fmtUsd(data.recordedUsd)}
                hint={`${fmtTokens(data.recordedCalls)} calls${data.untrackedUsd > 0 ? ` + ${fmtUsd(data.untrackedUsd)} untracked` : ''}`}
              />
              <StatCard
                label="Difference"
                value={fmtUsd(data.billedUsd - data.recordedUsd)}
                hint={data.billedUsd > 0 ? `${(((data.billedUsd - data.recordedUsd) / data.billedUsd) * 100).toFixed(1)}% of billed` : undefined}
              />
            </div>
            {!data.filteredByApiKey && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Not filtered by API key, so the billed figure includes every app in the OpenAI organization.
              </p>
            )}
            <TrueUpStatus data={data} canEdit={canEdit} onTrueUp={trueUp} />
            {data.lineItems.length > 0 && (
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <Th label="Line item" />
                    <Th label="Billed" align="right" />
                  </tr>
                </thead>
                <tbody>
                  {data.lineItems.map((item) => (
                    <tr key={item.lineItem}>
                      <td className={`${cellClass} text-[var(--text-100)]`}>{item.lineItem}</td>
                      <td className={`${cellClass} text-right tabular-nums text-[var(--text-100)]`}>{fmtUsd(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[10px] text-[var(--text-200)]">
              {formatDateTime(data.from)} – {formatDateTime(data.to)} · fetched {formatDateTime(data.fetchedAt)}. OpenAI's
              figures can lag by several hours.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────── prices ── */

type PriceDraft = Record<
  | 'model'
  | 'inputPer1M'
  | 'cachedInputPer1M'
  | 'cacheWritePer1M'
  | 'outputPer1M'
  | 'longContextThreshold'
  | 'longInputPer1M'
  | 'longCachedInputPer1M'
  | 'longCacheWritePer1M'
  | 'longOutputPer1M'
  | 'upstreamModel'
  | 'notes',
  string
> & { serviceTier: ServiceTier }

const RATE_KEYS = [
  'inputPer1M',
  'cachedInputPer1M',
  'cacheWritePer1M',
  'outputPer1M',
  'longContextThreshold',
  'longInputPer1M',
  'longCachedInputPer1M',
  'longCacheWritePer1M',
  'longOutputPer1M',
] as const

const toDraft = (price?: Partial<ModelPrice>): PriceDraft => ({
  model: price?.model ?? '',
  serviceTier: price?.serviceTier ?? 'standard',
  upstreamModel: price?.upstreamModel ?? '',
  notes: price?.notes ?? '',
  ...(Object.fromEntries(
    RATE_KEYS.map((key) => [key, price?.[key] === null || price?.[key] === undefined ? '' : String(price[key])])
  ) as Record<(typeof RATE_KEYS)[number], string>),
})

function PriceEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: ModelPrice | 'new'
  onClose: () => void
  onSaved: () => void
}) {
  const { addToast } = useToast()
  const [draft, setDraft] = useState<PriceDraft>(() => toDraft(initial === 'new' ? undefined : initial))
  const [saving, setSaving] = useState(false)
  const set = (key: keyof PriceDraft, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  const save = async () => {
    setSaving(true)
    try {
      const body = {
        model: draft.model.trim(),
        serviceTier: draft.serviceTier,
        upstreamModel: draft.upstreamModel.trim() || null,
        notes: draft.notes,
        ...Object.fromEntries(RATE_KEYS.map((key) => [key, draft[key].trim() === '' ? null : Number(draft[key])])),
      }
      if (initial === 'new') await authApi.post('/doc-tidy/usage/prices', body)
      else await authApi.put(`/doc-tidy/usage/prices/${initial._id}`, body)
      addToast('Price saved. Use “Re-price range” to apply it to past usage.', 'success')
      onSaved()
    } catch (err) {
      addToast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const field = (key: (typeof RATE_KEYS)[number], label: string, placeholder = '—') => (
    <label className="block">
      <span className="text-[11px] text-[var(--text-200)]">{label}</span>
      <input
        type="number"
        min={0}
        step="any"
        value={draft[key]}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
        className="mt-0.5 w-full rounded-md border border-[var(--bg-300)] bg-[var(--bg-100)] px-2 py-1 text-xs text-[var(--text-100)]"
      />
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg space-y-4 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-5 shadow-xl">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-100)]">
            {initial === 'new' ? 'Add model price' : `Edit ${initial.model}`}
          </h2>
          <p className="text-[11px] text-[var(--text-200)]">
            USD per 1M tokens, copied from openai.com/api/pricing. Leave cached / cache-write blank to bill them at the
            input rate. The model name must match what the API echoes back (e.g. <code>gpt-4o-mini</code>,{' '}
            <code>hermes-agent</code>).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] text-[var(--text-200)]">Model</span>
            <input
              value={draft.model}
              onChange={(e) => set('model', e.target.value)}
              className="mt-0.5 w-full rounded-md border border-[var(--bg-300)] bg-[var(--bg-100)] px-2 py-1 text-xs text-[var(--text-100)]"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-[var(--text-200)]">Service tier</span>
            <select
              value={draft.serviceTier}
              onChange={(e) => set('serviceTier', e.target.value)}
              className="mt-0.5 w-full rounded-md border border-[var(--bg-300)] bg-[var(--bg-100)] px-2 py-1 text-xs text-[var(--text-100)]"
            >
              {SERVICE_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {field('inputPer1M', 'Input', 'required')}
          {field('cachedInputPer1M', 'Cached input')}
          {field('cacheWritePer1M', 'Cache writes')}
          {field('outputPer1M', 'Output')}
        </div>
        <details className="rounded-lg border border-[var(--bg-300)] p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--text-100)]">Long-context pricing</summary>
          <div className="mt-3 space-y-3">
            {field('longContextThreshold', 'Applies above this many input tokens', 'e.g. 272000')}
            <div className="grid grid-cols-4 gap-3">
              {field('longInputPer1M', 'Input')}
              {field('longCachedInputPer1M', 'Cached input')}
              {field('longCacheWritePer1M', 'Cache writes')}
              {field('longOutputPer1M', 'Output')}
            </div>
          </div>
        </details>
        <label className="block">
          <span className="text-[11px] text-[var(--text-200)]">Upstream model (aliases only)</span>
          <input
            value={draft.upstreamModel}
            placeholder="e.g. gpt-5.6-sol for hermes-agent"
            onChange={(e) => set('upstreamModel', e.target.value)}
            className="mt-0.5 w-full rounded-md border border-[var(--bg-300)] bg-[var(--bg-100)] px-2 py-1 text-xs text-[var(--text-100)]"
          />
          <span className="mt-0.5 block text-[10px] text-[var(--text-200)]">
            For a model name that forwards to an OpenAI model without reporting cached tokens. Its costs are estimated,
            then trued up daily to that model's line items on the OpenAI bill.
          </span>
        </label>
        <label className="block">
          <span className="text-[11px] text-[var(--text-200)]">Notes</span>
          <input
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
            className="mt-0.5 w-full rounded-md border border-[var(--bg-300)] bg-[var(--bg-100)] px-2 py-1 text-xs text-[var(--text-100)]"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !draft.model.trim() || draft.inputPer1M.trim() === ''}
            onClick={save}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-violet-700"
          >
            {saving && <Spinner className="h-3 w-3" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}

function PricesCard({
  range,
  canEdit,
  onRepriced,
}: {
  range: RangeKey
  canEdit: boolean
  onRepriced: () => void
}) {
  const { addToast } = useToast()
  const [prices, setPrices] = useState<ModelPrice[] | null>(null)
  const [editing, setEditing] = useState<ModelPrice | 'new' | null>(null)
  const [repricing, setRepricing] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await authApi.get<{ data: ModelPrice[] }>('/doc-tidy/usage/prices')
      setPrices(res.data)
    } catch (err) {
      addToast((err as Error).message, 'error')
    }
  }, [addToast])

  useEffect(() => {
    load()
  }, [load])

  const remove = async (price: ModelPrice) => {
    if (!window.confirm(`Delete the ${price.serviceTier} price for ${price.model}?`)) return
    try {
      await authApi.delete(`/doc-tidy/usage/prices/${price._id}`)
      load()
    } catch (err) {
      addToast((err as Error).message, 'error')
    }
  }

  const reprice = async () => {
    setRepricing(true)
    try {
      const res = await authApi.post<{ data: { updated: number } }>('/doc-tidy/usage/reprice', rangeFor(range))
      addToast(`Re-priced ${fmtTokens(res.data.updated)} calls for ${RANGE_LABELS[range].toLowerCase()}.`, 'success')
      onRepriced()
    } catch (err) {
      addToast((err as Error).message, 'error')
    } finally {
      setRepricing(false)
    }
  }

  const rate = (value?: number | null) => (value === null || value === undefined ? '—' : `$${value}`)

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-100)]">Model prices</h3>
          <p className="text-[11px] text-[var(--text-200)]">
            USD per 1M tokens, from openai.com/api/pricing.
            {canEdit && ' Cost is fixed when a call is recorded; re-price to apply edits to past usage.'}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button type="button" className={buttonClass} disabled={repricing} onClick={reprice}>
              {repricing && <Spinner className="h-3 w-3" />} Re-price {RANGE_LABELS[range].toLowerCase()}
            </button>
            <button type="button" className={buttonClass} onClick={() => setEditing('new')}>
              + Add price
            </button>
          </div>
        )}
      </div>
      {!prices ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <Th label="Model" />
                <Th label="Tier" />
                <Th label="Input" align="right" />
                <Th label="Cached" align="right" />
                <Th label="Cache write" align="right" />
                <Th label="Output" align="right" />
                <Th label="Long context" />
                {canEdit && <Th label="" />}
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p._id}>
                  <td className={`${cellClass} font-medium text-[var(--text-100)]`} title={p.notes}>
                    {p.model}
                    {p.upstreamModel && (
                      <span className="ml-1 font-normal text-[var(--text-200)]">
                        → {p.upstreamModel}
                        {typeof p.calibrationFactor === 'number' && ` · ×${p.calibrationFactor.toFixed(3)}`}
                      </span>
                    )}
                  </td>
                  <td className={`${cellClass} text-[var(--text-200)]`}>{p.serviceTier}</td>
                  <td className={`${cellClass} text-right tabular-nums`}>{rate(p.inputPer1M)}</td>
                  <td className={`${cellClass} text-right tabular-nums`}>{rate(p.cachedInputPer1M)}</td>
                  <td className={`${cellClass} text-right tabular-nums`}>{rate(p.cacheWritePer1M)}</td>
                  <td className={`${cellClass} text-right tabular-nums`}>{rate(p.outputPer1M)}</td>
                  <td className={`${cellClass} text-[var(--text-200)]`}>
                    {p.longContextThreshold
                      ? `> ${fmtCompact(p.longContextThreshold)}: ${rate(p.longInputPer1M)} / ${rate(p.longOutputPer1M)}`
                      : '—'}
                  </td>
                  {canEdit && (
                    <td className={`${cellClass} text-right`}>
                      <button type="button" className="mr-3 cursor-pointer text-violet-600 hover:underline dark:text-violet-400" onClick={() => setEditing(p)}>
                        Edit
                      </button>
                      <button type="button" className="cursor-pointer text-rose-600 hover:underline dark:text-rose-400" onClick={() => remove(p)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <PriceEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────── tabs ── */

type TabKey = 'overview' | 'billing'
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'billing', label: 'Billing & prices' },
]

function TabButton({
  active,
  onClick,
  dot,
  children,
}: {
  active: boolean
  onClick: () => void
  dot?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-[var(--bg-100)] text-[var(--text-100)] shadow-sm'
          : 'text-[var(--text-200)] hover:text-[var(--text-100)]'
      }`}
    >
      {children}
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Needs attention" />}
    </button>
  )
}

function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-[var(--bg-300)] px-4 py-3">
      <h3 className="text-sm font-semibold text-[var(--text-100)]">{title}</h3>
      {subtitle && <p className="text-[11px] text-[var(--text-200)]">{subtitle}</p>}
    </div>
  )
}

/* ─────────────────────────────────────────────────────── overview ── */

function OverviewTab({ summary, range }: { summary: UsageSummary; range: RangeKey }) {
  const { totals } = summary
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Spent" value={fmtMoney(totals.costUsd)} hint={RANGE_LABELS[range]} />
        <StatCard label="Documents processed" value={fmtTokens(totals.jobs)} />
        <StatCard
          label="Average per document"
          value={totals.jobs > 0 ? fmtMoney(totals.costUsd / totals.jobs) : '—'}
        />
        <StatCard
          label="Tokens used"
          value={fmtCompact(totals.inputTokens + totals.outputTokens)}
          hint={`${fmtCompact(totals.inputTokens)} input (${fmtCompact(totals.cachedInputTokens)} cached) · ${fmtCompact(totals.outputTokens)} output`}
        />
      </div>
      {totals.estimatedCostUsd > 0 && (
        <p className="text-[11px] text-[var(--text-200)]">
          Today's amount is an estimate. It becomes final once OpenAI bills the day, around {finalisedAt} your time the
          next day.
        </p>
      )}

      <div className={cardClass}>
        <CardHeader title="Spending by organization" subtitle="Click an organization to see its workspaces." />
        <OrganizationTable organizations={summary.organizations} totalUsd={totals.costUsd} />
      </div>

      <div className={cardClass}>
        <CardHeader title="Daily spending" subtitle="Hover over a bar to see the amount." />
        <DailyTrend summary={summary} />
      </div>

      <BreakdownCard summary={summary} />
    </>
  )
}

/* ──────────────────────────────────────────────────────── billing ── */

function UsageWarnings({ summary }: { summary: UsageSummary }) {
  const { totals } = summary
  const unpricedModels = summary.breakdown.filter((row) => !row.priced)
  return (
    <>
      {unpricedModels.length > 0 && (
        <Banner kind="warning">
          {fmtTokens(totals.unpricedCalls)} call(s) used models with no price row, so they count as $0:{' '}
          <strong>{[...new Set(unpricedModels.map((r) => `${r.model} (${r.serviceTier})`))].join(', ')}</strong>. An
          admin can add a price below, then re-price.
        </Banner>
      )}
      {totals.missingUsageCalls > 0 && (
        <Banner kind="warning">
          {fmtTokens(totals.missingUsageCalls)} call(s) came back without token usage from the backend, so their tokens
          are unknown. Run <code>python diagnose_usage.py</code> on the worker machine to check what Hermes reports.
        </Banner>
      )}
    </>
  )
}

function BreakdownCard({ summary }: { summary: UsageSummary }) {
  return (
    <>
      <div className={cardClass}>
        <CardHeader title="By purpose & model" subtitle="What each part of Doc Tidy used and cost." />
        <div className="overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <Th label="Purpose" />
                <Th label="Model" />
                <Th label="Calls" align="right" />
                <Th label="Input" align="right" />
                <Th label="Cached" align="right" />
                <Th label="Output" align="right" />
                <Th label="Cost" align="right" />
              </tr>
            </thead>
            <tbody>
              {summary.breakdown.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-xs text-[var(--text-200)]">
                    No usage in this range.
                  </td>
                </tr>
              )}
              {summary.breakdown.map((row) => (
                <tr key={`${row.purpose}:${row.provider}:${row.model}:${row.serviceTier}:${row.priced}`}>
                  <td className={`${cellClass} text-[var(--text-100)]`}>{USAGE_PURPOSE_LABELS[row.purpose]}</td>
                  <td className={`${cellClass} text-[var(--text-200)]`}>
                    {row.model}
                    {row.serviceTier !== 'standard' && ` · ${row.serviceTier}`}
                    {row.provider === 'hermes' && ' · via Hermes'}
                    {!row.priced && <span className="ml-1 text-amber-600 dark:text-amber-400">(unpriced)</span>}
                  </td>
                  <td className={`${cellClass} text-right tabular-nums`}>{fmtTokens(row.calls)}</td>
                  <td className={`${cellClass} text-right tabular-nums`}>{fmtCompact(row.inputTokens)}</td>
                  <td className={`${cellClass} text-right tabular-nums`}>{fmtCompact(row.cachedInputTokens)}</td>
                  <td className={`${cellClass} text-right tabular-nums`}>{fmtCompact(row.outputTokens)}</td>
                  <td className={`${cellClass} text-right tabular-nums`}>
                    {fmtMoney(row.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ───────────────────────────────────────────────────────── page ── */

/**
 * Doc Tidy's LLM spend by organization and workspace, for every signed-in
 * user; only admins may change prices or true up. See
 * design-log/2026-10-10-token-usage-dashboard-simplified-tabs.md.
 */
export default function DocTidyUsage() {
  const { addToast } = useToast()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'overview'
  const setTab = (key: TabKey) =>
    setSearchParams(key === 'overview' ? {} : { tab: key }, { replace: true })

  const [range, setRange] = useState<RangeKey>('30d')
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const params = new URLSearchParams(rangeFor(range))
      const res = await authApi.get<{ data: UsageSummary }>(`/doc-tidy/usage/summary?${params}`)
      if (id === requestId.current) setSummary(res.data)
    } catch (err) {
      if (id === requestId.current) addToast((err as Error).message, 'error')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [range, addToast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(
    () =>
      subscribeDocTidyEvents(
        (event) => {
          if (event.type === 'connected' || event.type === 'ping') setLive(true)
          if (event.type === 'usage') load()
        },
        () => setLive(false)
      ),
    [load]
  )

  const needsAttention = Boolean(
    summary && (summary.totals.unpricedCalls > 0 || summary.totals.missingUsageCalls > 0)
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-[var(--text-100)]">Token Usage</h1>
            <LiveBadge live={live} />
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-200)]">
            How much Doc Tidy's AI has cost, by organization and workspace. Days follow UTC, like OpenAI's bill.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] p-1">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium ${
                range === key
                  ? 'bg-[var(--primary-100)] text-[var(--accent-200)]'
                  : 'text-[var(--text-200)] hover:text-[var(--text-100)]'
              }`}
            >
              {RANGE_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-0.5">
        {TABS.map((t) => (
          <TabButton
            key={t.key}
            active={tab === t.key}
            onClick={() => setTab(t.key)}
            dot={t.key === 'billing' && needsAttention}
          >
            {t.label}
          </TabButton>
        ))}
      </div>

      {tab === 'billing' ? (
        <>
          {summary && <UsageWarnings summary={summary} />}
          <ReconciliationCard range={range} canEdit={isAdmin} onTrueUp={load} />
          <PricesCard range={range} canEdit={isAdmin} onRepriced={load} />
        </>
      ) : loading && !summary ? (
        <div className="flex justify-center p-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : summary ? (
        <OverviewTab summary={summary} range={range} />
      ) : null}
    </div>
  )
}

