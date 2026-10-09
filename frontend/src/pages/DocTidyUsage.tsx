import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authApi } from '../lib/api'
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
  type UsageSummary,
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

function OrganizationTable({ organizations }: { organizations: OrganizationUsage[] }) {
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
            <Th label="Jobs" align="right" />
            <Th label="Input" align="right" />
            <Th label="Cached" align="right" />
            <Th label="Output" align="right" />
            <Th label="Cost" align="right" />
            <Th label="Avg / job" align="right" />
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
                  <UsageCells sums={org} strong />
                </tr>
                {isOpen &&
                  org.workspaces.map((ws) => (
                    <tr key={ws.workspaceId ?? 'none'} className="bg-[var(--bg-200)]/40">
                      <td className={`${cellClass} pl-10 text-[var(--text-100)]`}>
                        {ws.name}
                        {ws.deleted && <span className="ml-1 text-[var(--text-200)]">({ws.workspaceId})</span>}
                      </td>
                      <UsageCells sums={ws} />
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

function UsageCells({ sums, strong = false }: { sums: OrganizationUsage | OrganizationUsage['workspaces'][number]; strong?: boolean }) {
  const num = `${cellClass} text-right tabular-nums text-[var(--text-100)]`
  return (
    <>
      <td className={num}>{fmtTokens(sums.jobs)}</td>
      <td className={num}>{fmtTokens(sums.inputTokens)}</td>
      <td className={num}>{fmtTokens(sums.cachedInputTokens)}</td>
      <td className={num}>{fmtTokens(sums.outputTokens)}</td>
      <td className={`${num} ${strong ? 'font-semibold' : ''}`}>{fmtUsd(sums.costUsd)}</td>
      <td className={num}>{sums.jobs > 0 ? fmtUsd(sums.costUsd / sums.jobs) : '—'}</td>
    </>
  )
}

/* ───────────────────────────────────────────────────────── trend ── */

function DailyTrend({ daily }: { daily: UsageSummary['daily'] }) {
  const max = Math.max(...daily.map((d) => d.costUsd), 0)
  if (daily.length === 0) {
    return <p className="p-6 text-center text-xs text-[var(--text-200)]">No usage in this range.</p>
  }
  return (
    <div className="flex h-40 items-end gap-1 px-4 pb-2 pt-4">
      {daily.map((d) => (
        <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
          <div
            className="w-full rounded-t bg-violet-500/80 group-hover:bg-violet-600"
            style={{ height: `${max > 0 ? Math.max(2, (d.costUsd / max) * 100) : 2}%` }}
          />
          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] text-white group-hover:block">
            {d.date} · {fmtUsd(d.costUsd)} · {fmtCompact(d.tokens)} tokens
          </div>
        </div>
      ))}
    </div>
  )
}

/* ───────────────────────────────────────────────── reconciliation ── */

function ReconciliationCard({ range }: { range: RangeKey }) {
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

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-100)]">Recorded vs. billed by OpenAI</h3>
          <p className="text-[11px] text-[var(--text-200)]">
            OpenAI's Costs API over whole UTC days. Covers only calls made with our OpenAI key.
          </p>
        </div>
        {data?.configured && (
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
            Set <code>OPENAI_ADMIN_KEY</code> (and optionally <code>OPENAI_USAGE_API_KEY_IDS</code>) on the server to
            compare these numbers with OpenAI's invoice.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Billed by OpenAI" value={fmtUsd(data.billedUsd)} hint={data.filteredByApiKey ? 'Doc Tidy key(s) only' : 'Whole organization'} />
              <StatCard label="Recorded here" value={fmtUsd(data.recordedUsd)} hint={`${fmtTokens(data.recordedCalls)} OpenAI calls`} />
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

function PricesCard({ range, onRepriced }: { range: RangeKey; onRepriced: () => void }) {
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
            USD per 1M tokens. Cost is fixed when a call is recorded; re-price to apply edits to past usage.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={buttonClass} disabled={repricing} onClick={reprice}>
            {repricing && <Spinner className="h-3 w-3" />} Re-price {RANGE_LABELS[range].toLowerCase()}
          </button>
          <button type="button" className={buttonClass} onClick={() => setEditing('new')}>
            + Add price
          </button>
        </div>
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
                <Th label="" />
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p._id}>
                  <td className={`${cellClass} font-medium text-[var(--text-100)]`} title={p.notes}>
                    {p.model}
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
                  <td className={`${cellClass} text-right`}>
                    <button type="button" className="mr-3 cursor-pointer text-violet-600 hover:underline dark:text-violet-400" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                    <button type="button" className="cursor-pointer text-rose-600 hover:underline dark:text-rose-400" onClick={() => remove(p)}>
                      Delete
                    </button>
                  </td>
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

/* ───────────────────────────────────────────────────────── page ── */

/**
 * Admin-only: live token usage and cost per organization and workspace,
 * priced the way OpenAI bills. See
 * design-log/2026-10-10-doc-tidy-token-usage-and-cost-dashboard.md.
 */
export default function DocTidyUsage() {
  const { addToast } = useToast()
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

  const totals = summary?.totals
  const unpricedModels = useMemo(
    () => (summary?.breakdown ?? []).filter((row) => !row.priced),
    [summary]
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
            Tokens and cost of every Doc Tidy LLM call, by organization and workspace. Costs use each model's
            per-token prices, the same way OpenAI bills them. Times are UTC.
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

      {loading && !summary ? (
        <div className="flex justify-center p-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : summary && totals ? (
        <>
          {unpricedModels.length > 0 && (
            <Banner kind="warning">
              {fmtTokens(totals.unpricedCalls)} call(s) used models with no price row, so they count as $0:{' '}
              <strong>{[...new Set(unpricedModels.map((r) => `${r.model} (${r.serviceTier})`))].join(', ')}</strong>.
              Add a price below, then re-price.
            </Banner>
          )}
          {totals.missingUsageCalls > 0 && (
            <Banner kind="warning">
              {fmtTokens(totals.missingUsageCalls)} call(s) came back without token usage from the backend, so their
              tokens are unknown. Run <code>python diagnose_usage.py</code> on the worker machine to check what Hermes
              reports.
            </Banner>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total cost" value={fmtUsd(totals.costUsd)} hint={RANGE_LABELS[range]} />
            <StatCard
              label="Total tokens"
              value={fmtCompact(totals.inputTokens + totals.outputTokens)}
              hint={`${fmtCompact(totals.inputTokens)} in (${fmtCompact(totals.cachedInputTokens)} cached) · ${fmtCompact(totals.outputTokens)} out`}
            />
            <StatCard label="Parse jobs" value={fmtTokens(totals.jobs)} hint={`${fmtTokens(totals.calls)} LLM calls`} />
            <StatCard
              label="Avg cost / job"
              value={totals.jobs > 0 ? fmtUsd(totals.costUsd / totals.jobs) : '—'}
              hint={
                totals.inputTokens > 0
                  ? `${((totals.cachedInputTokens / totals.inputTokens) * 100).toFixed(1)}% of input served from cache`
                  : undefined
              }
            />
          </div>

          <div className={cardClass}>
            <div className="border-b border-[var(--bg-300)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--text-100)]">By organization</h3>
              <p className="text-[11px] text-[var(--text-200)]">Click an organization to see its workspaces.</p>
            </div>
            <OrganizationTable organizations={summary.organizations} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className={cardClass}>
              <div className="border-b border-[var(--bg-300)] px-4 py-3">
                <h3 className="text-sm font-semibold text-[var(--text-100)]">Daily cost</h3>
              </div>
              <DailyTrend daily={summary.daily} />
            </div>

            <div className={cardClass}>
              <div className="border-b border-[var(--bg-300)] px-4 py-3">
                <h3 className="text-sm font-semibold text-[var(--text-100)]">By purpose &amp; model</h3>
              </div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <Th label="Purpose" />
                      <Th label="Model" />
                      <Th label="Calls" align="right" />
                      <Th label="Tokens" align="right" />
                      <Th label="Cost" align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {summary.breakdown.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-xs text-[var(--text-200)]">
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
                        <td className={`${cellClass} text-right tabular-nums`}>{fmtCompact(row.inputTokens + row.outputTokens)}</td>
                        <td className={`${cellClass} text-right tabular-nums`}>{fmtUsd(row.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <ReconciliationCard range={range} />
          <PricesCard range={range} onRepriced={load} />
        </>
      ) : null}
    </div>
  )
}
