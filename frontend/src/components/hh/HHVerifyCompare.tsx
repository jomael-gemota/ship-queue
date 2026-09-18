import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useHHList } from '../../context/HHListContext'
import {
  compareHHCart,
  formatCreatedAt,
  hhCartStatusLabel,
  hhOrderVerifiedResult,
  hhStoredCartCompare,
  type HHCartCompareOrder,
  type HHChildOrder,
  type HHCompareRow,
} from '../../lib/hhSportswear'
import { Spinner } from '../labels/labelUi'
import { Tooltip } from '../Tooltip'

function VerifiedLabel({ result }: { result: 'match' | 'review' }) {
  return result === 'match' ? (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
      Match
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">
      Review
    </span>
  )
}

function blockingMismatches(rows: HHCompareRow[]): HHCompareRow[] {
  return rows.filter((row) => !row.match && row.field !== 'orderNumber')
}

function summaryResult(row: HHCartCompareOrder): 'match' | 'review' | 'skip' | 'error' {
  if (row.error) return 'error'
  if (row.skipped) return 'skip'
  return blockingMismatches(row.rows).length === 0 ? 'match' : 'review'
}

const SHIP_FIELDS = ['name', 'address1', 'address2', 'city', 'state', 'zip', 'country']
const ORDER_FIELDS = ['po', 'orderNumber']

function groupedCompareRows(rows: HHCompareRow[]): Array<{ label: string; rows: HHCompareRow[] }> {
  const byField = new Map(rows.map((row) => [row.field, row]))
  const groups: Array<{ label: string; rows: HHCompareRow[] }> = []
  const ship = SHIP_FIELDS.map((field) => byField.get(field)).filter((row): row is HHCompareRow => Boolean(row))
  if (ship.length > 0) groups.push({ label: 'Ship-to', rows: ship })
  const order = ORDER_FIELDS.map((field) => byField.get(field)).filter((row): row is HHCompareRow => Boolean(row))
  if (order.length > 0) groups.push({ label: 'Order', rows: order })
  const items = rows.filter((row) => row.field.startsWith('sku:'))
  if (items.length > 0) groups.push({ label: 'Items', rows: items })
  const used = new Set([...SHIP_FIELDS, ...ORDER_FIELDS, ...items.map((row) => row.field)])
  const other = rows.filter((row) => !used.has(row.field))
  if (other.length > 0) groups.push({ label: 'Other', rows: other })
  return groups
}

function CheckGlyph({ match }: { match: boolean }) {
  return match ? (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" aria-label="Match">
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M16.704 5.29a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06L8.67 12.19l6.97-6.97a.75.75 0 011.06 0z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
      Review
    </span>
  )
}

function CompareValue({ value, mismatch }: { value: string; mismatch: boolean }) {
  const empty = value === '—'
  return (
    <span
      className={`inline-block max-w-full break-words font-mono text-[13px] leading-5 ${
        empty
          ? 'text-slate-400 dark:text-[var(--text-200)]'
          : mismatch
            ? 'rounded-md bg-white/80 px-1.5 py-0.5 font-medium text-red-800 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900/60'
            : 'text-slate-700 dark:text-[var(--text-100)]'
      }`}
    >
      {value}
    </span>
  )
}

function CompareTable({ rows }: { rows: HHCompareRow[] }) {
  const groups = groupedCompareRows(rows)
  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead className="sticky top-0 z-[1] bg-[var(--bg-100)] text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:bg-[var(--bg-100)] dark:text-[var(--text-200)]">
        <tr>
          <th className="border-b border-[var(--bg-300)] px-3 py-2.5 font-semibold">Field</th>
          <th className="border-b border-[var(--bg-300)] px-3 py-2.5 font-semibold">Order details</th>
          <th className="border-b border-[var(--bg-300)] px-1 py-2.5" aria-hidden="true" />
          <th className="border-b border-[var(--bg-300)] px-3 py-2.5 font-semibold">B2B cart</th>
          <th className="border-b border-[var(--bg-300)] px-3 py-2.5 font-semibold">
            <span className="sr-only">Check</span>
          </th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.label}>
          <tr>
            <th
              colSpan={5}
              className="bg-[var(--bg-200)] px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]"
            >
              {group.label}
            </th>
          </tr>
          {group.rows.map((row) => (
            <tr
              key={row.field}
              className={
                row.match
                  ? 'bg-[var(--bg-100)]'
                  : 'bg-red-50/90 dark:bg-red-950/30'
              }
            >
              <td
                className={`whitespace-nowrap border-l-2 px-3 py-2.5 text-[13px] font-medium text-slate-600 dark:text-[var(--text-100)] ${
                  row.match ? 'border-transparent' : 'border-red-500'
                }`}
              >
                {row.label}
              </td>
              <td className="px-3 py-2.5">
                <CompareValue value={row.expected} mismatch={!row.match} />
              </td>
              <td className="px-1 py-2.5 text-center text-xs font-semibold text-slate-400 dark:text-[var(--text-200)]">
                {row.match ? '=' : '→'}
              </td>
              <td className="px-3 py-2.5">
                <CompareValue value={row.actual} mismatch={!row.match} />
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right">
                <CheckGlyph match={row.match} />
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  )
}

function SummaryList({ results }: { results: HHCartCompareOrder[] }) {
  return (
    <ul className="divide-y divide-[var(--bg-300)]">
      {results.map((row) => {
        const result = summaryResult(row)
        const pip =
          result === 'match'
            ? 'bg-emerald-500'
            : result === 'review'
              ? 'bg-red-500'
              : 'bg-slate-400'
        return (
          <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`h-2 w-2 shrink-0 rounded-full ${pip}`} aria-hidden="true" />
              <span className="truncate font-mono text-[13px] text-slate-800 dark:text-[var(--text-100)]">
                {row.orderId}
              </span>
            </div>
            {result === 'match' ? (
              <VerifiedLabel result="match" />
            ) : result === 'review' ? (
              <VerifiedLabel result="review" />
            ) : (
              <span className="max-w-[12rem] truncate text-right text-xs text-slate-400 dark:text-[var(--text-200)]">
                {row.error || row.skipped || '—'}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function DetailBody({ result, live }: { result: HHCartCompareOrder; live: boolean }) {
  const mismatchCount = blockingMismatches(result.rows).length
  const matchedCount = result.rows.filter((row) => row.field !== 'orderNumber' && row.match).length
  const source = live ? 'the live cart' : 'the last check'
  return (
    <div>
      {result.error ? (
        <p className="px-3 py-2 text-sm text-red-600 dark:text-red-400">{result.error}</p>
      ) : result.skipped ? (
        <p className="px-3 py-2 text-sm text-slate-500 dark:text-[var(--text-200)]">
          {result.skipped}. Cart status: {hhCartStatusLabel(result.cartStatus)}.
        </p>
      ) : result.rows.length === 0 ? (
        <p className="px-3 py-2 text-sm text-slate-500 dark:text-[var(--text-200)]">
          {result.cartStatus === 'ready'
            ? 'Last check matched. Refresh to load field-by-field from the live cart.'
            : 'No fields to compare.'}
        </p>
      ) : (
        <>
          <div
            className={`mx-3 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 ${
              mismatchCount > 0
                ? 'border-red-200 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/20'
                : 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20'
            }`}
          >
            <p
              className={`text-sm font-medium ${
                mismatchCount > 0 ? 'text-red-800 dark:text-red-300' : 'text-emerald-800 dark:text-emerald-300'
              }`}
            >
              {mismatchCount > 0
                ? `${mismatchCount} field${mismatchCount === 1 ? '' : 's'} differ from ${source}`
                : `All fields match ${source}`}
            </p>
            <p className="text-xs text-slate-500 dark:text-[var(--text-200)]">
              {matchedCount} matched
              {mismatchCount > 0 ? ` · Place Order blocked until this matches` : ' · Place Order will re-check first'}
            </p>
          </div>
          <div className="overflow-x-auto px-1 pb-1">
            <CompareTable rows={result.rows} />
          </div>
        </>
      )}
    </div>
  )
}

function CompareIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>
  )
}

function CompareModal({
  title,
  subtitle,
  busy,
  error,
  wide,
  onClose,
  onRefresh,
  children,
}: {
  title: string
  subtitle: string
  busy: boolean
  error: string | null
  wide?: boolean
  onClose: () => void
  onRefresh: () => void
  children: ReactNode
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hh-compare-title"
        className={`relative z-10 flex max-h-[min(90vh,44rem)] w-full flex-col overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--bg-300)] px-6 py-4 dark:border-[var(--bg-300)]">
          <div className="min-w-0">
            <h3 id="hh-compare-title" className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
              {title}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-[var(--text-200)]">{subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onRefresh}
              disabled={busy}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-[var(--primary-100)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]"
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
              {busy ? 'Checking…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-[var(--bg-200)] hover:text-slate-600 dark:hover:text-[var(--text-100)]"
              aria-label="Close"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error ? <p className="px-3 pb-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function lastCheckedSubtitle(orders: HHChildOrder[], live: boolean): string {
  if (live) return 'Live Helly Hansen cart · Refresh to check again'
  const times = orders.map((order) => order.verifiedAt).filter((value): value is string => Boolean(value))
  if (times.length === 0) return 'Last saved result · Refresh to check the live cart'
  const latest = times.reduce((max, value) => (value > max ? value : max))
  return `Last check ${formatCreatedAt(latest)} · Refresh to check the live cart`
}

function useCompareModal(groupId: string, orderId?: string) {
  const { setGroups } = useHHList()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<HHCartCompareOrder[] | null>(null)
  const [live, setLive] = useState(false)

  const close = () => {
    setOpen(false)
    setBusy(false)
    setError(null)
    setResults(null)
    setLive(false)
  }

  const runCompare = () => {
    setBusy(true)
    setError(null)
    compareHHCart(groupId, orderId)
      .then((res) => {
        setGroups((current) => current.map((group) => (group.id === res.data.id ? res.data : group)))
        setResults(res.compare)
        setLive(true)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to compare order details to the live B2B cart')
      })
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  return { open, setOpen, close, busy, error, results, live, runCompare }
}

export function HHVerifyCompare({
  groupId,
  orders,
  size = 'md',
}: {
  groupId: string
  orders: HHChildOrder[]
  size?: 'sm' | 'md'
}) {
  const { open, setOpen, close, busy, error, results, live, runCompare } = useCompareModal(groupId)
  if (orders.length === 0) return null

  const title = 'Order details vs B2B cart'
  const sizing = size === 'sm' ? 'px-1.5 py-1' : 'p-2'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const shown = results ?? orders.map(hhStoredCartCompare)

  return (
    <>
      <Tooltip content={title}>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setOpen(true)
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={title}
          className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] text-slate-500 hover:bg-[var(--primary-100)] hover:text-[var(--accent-200)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-200)] dark:hover:bg-[var(--primary-100)] dark:hover:text-[var(--accent-200)] transition-colors ${sizing}`}
        >
          <CompareIcon className={iconSize} />
        </button>
      </Tooltip>

      {open ? (
        <CompareModal
          title={title}
          subtitle={lastCheckedSubtitle(orders, live)}
          busy={busy}
          error={error}
          onClose={close}
          onRefresh={runCompare}
        >
          <SummaryList results={shown} />
        </CompareModal>
      ) : null}
    </>
  )
}

export function HHVerifiedCell({
  groupId,
  order,
}: {
  groupId: string
  order: HHChildOrder
}) {
  const verified = hhOrderVerifiedResult(order)
  const { open, setOpen, close, busy, error, results, live, runCompare } = useCompareModal(groupId, order.id)

  if (!verified) {
    return <span className="text-slate-400 dark:text-[var(--text-200)]">—</span>
  }

  const detail = results?.[0] ?? hhStoredCartCompare(order)

  return (
    <>
      <Tooltip content="View order details vs B2B cart">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setOpen(true)
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-200)]"
        >
          <VerifiedLabel result={verified} />
        </button>
      </Tooltip>

      {open ? (
        <CompareModal
          title="Order details vs B2B cart"
          subtitle={`${order.orderId} · ${lastCheckedSubtitle([order], live)}`}
          busy={busy}
          error={error}
          wide
          onClose={close}
          onRefresh={runCompare}
        >
          <DetailBody result={detail} live={live} />
        </CompareModal>
      ) : null}
    </>
  )
}
