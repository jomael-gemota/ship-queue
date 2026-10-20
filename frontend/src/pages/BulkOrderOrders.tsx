import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { HHActionRow, HHRowActions, HHRowActionsHeader, useHHOpenRow, useHHRowExit } from '../components/hh/hhUi'
import { Tooltip } from '../components/Tooltip'
import { ClockIcon, DeleteBatchButton, EyeIcon, HeaderLabel, IdIcon, StatusIcon, Td, Th, UploaderAvatar, UserIcon, formatDateTime } from '../components/labels/labelUi'
import { bulkOrderBrand } from '../lib/bulkOrder'
import { deleteBulkOrder, listBulkOrders, requestBulkOrderEdit, subscribeBulkOrdersChanged } from '../lib/bulkOrders'
import type { BulkOrderRow } from '../lib/bulkOrders'

function formatShipDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value || '—'
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function shipDateLabel(order: BulkOrderRow): string {
  const dates = [...new Set(order.shipments.map((shipment) => shipment.requestedShipDate).filter(Boolean))]
  if (dates.length === 0) return '—'
  if (dates.length > 1) return 'Multiple'
  return formatShipDate(dates[0])
}

function DeleteOrderModal({
  order,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  order: BulkOrderRow
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm space-y-4 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-6 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Delete order?</h3>
        <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
          This will remove order{' '}
          <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{order.orderName}</span> from Bulk
          Order. The Thorogood draft stays on the portal.
        </p>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="cursor-pointer rounded-lg bg-[var(--bg-200)] px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-[var(--bg-300)] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[var(--text-200)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="cursor-pointer rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BulkOrderOrders() {
  const { pathname } = useLocation()
  const brand = bulkOrderBrand(pathname)
  const [rows, setRows] = useState<BulkOrderRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<BulkOrderRow | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { openId, toggle, close } = useHHOpenRow()
  const { exitingId, beginExit, finishExit } = useHHRowExit((id) => {
    setRows((current) => current?.filter((order) => order.id !== id) ?? current)
  })

  useEffect(() => {
    let cancelled = false
    const load = () => {
      listBulkOrders()
        .then((res) => {
          if (cancelled) return
          setRows(res.data)
          setError(null)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : 'Could not load orders.')
        })
    }
    load()
    const unsubscribe = subscribeBulkOrdersChanged((next) => {
      setNotice(next)
      load()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const confirmDelete = () => {
    if (!pending || actionBusy) return
    const orderId = pending.id
    setActionBusy(true)
    setActionError(null)
    deleteBulkOrder(orderId)
      .then(() => {
        setPending(null)
        setActionError(null)
        close()
        beginExit(orderId)
      })
      .catch((err: unknown) => {
        setActionError(err instanceof Error ? err.message : 'Could not delete the order.')
      })
      .finally(() => setActionBusy(false))
  }

  return (
    <div>
      {notice ? (
        <p className="border-b border-[var(--bg-300)] px-4 py-3 text-sm text-slate-600 dark:text-[var(--text-200)]">{notice}</p>
      ) : null}
      <div className="hh-table-scroll">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-200)] text-xs uppercase tracking-wide text-slate-500 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]">
            <tr className="text-left">
              <Th>
                <HeaderLabel icon={<IdIcon className="h-3.5 w-3.5" />} text="Order Name" />
              </Th>
              <Th>
                <HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Status" />
              </Th>
              <Th>
                <HeaderLabel icon={<UserIcon className="h-3.5 w-3.5" />} text="Sold To" />
              </Th>
              <Th>
                <HeaderLabel icon={<ClockIcon className="h-3.5 w-3.5" />} text="Ship Date" />
              </Th>
              <Th>
                <HeaderLabel icon={<ClockIcon className="h-3.5 w-3.5" />} text="Date Created" />
              </Th>
              <Th>
                <HeaderLabel icon={<UserIcon className="h-3.5 w-3.5" />} text="Created by" />
              </Th>
              <Th>
                <HeaderLabel icon={<EyeIcon className="h-3.5 w-3.5" />} text="Shipments" />
              </Th>
              <HHRowActionsHeader />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-[13px] dark:divide-[var(--bg-300)]">
            {error ? (
              <tr>
                <Td colSpan={8} className="py-10 text-center text-red-600 dark:text-red-400">
                  {error}
                </Td>
              </tr>
            ) : rows == null ? (
              <tr>
                <Td colSpan={8} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  Loading orders…
                </Td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <Td colSpan={8} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  No orders yet.
                </Td>
              </tr>
            ) : (
              rows.map((order, index) => (
                <HHActionRow
                  key={order.id}
                  rowId={order.id}
                  className={`hh-actions-compact${index % 2 === 1 ? ' hh-row-alt' : ''}`}
                  open={openId === order.id}
                  exiting={exitingId === order.id}
                  onExitEnd={() => finishExit(order.id)}
                >
                  <Td compact className="font-medium text-slate-800 dark:text-[var(--text-100)]">
                    <span className="whitespace-nowrap" title={order.portalOrderCode}>
                      {order.orderName}
                    </span>
                  </Td>
                  <Td compact>
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]">
                      Draft
                    </span>
                  </Td>
                  <Td compact className="max-w-[16rem] text-slate-700 dark:text-[var(--text-100)]">
                    <span className="block truncate" title={order.soldToLabel}>
                      {order.soldToLabel}
                    </span>
                  </Td>
                  <Td compact className="whitespace-nowrap text-slate-600 dark:text-[var(--text-100)]">
                    {shipDateLabel(order)}
                  </Td>
                  <Td compact className="whitespace-nowrap text-slate-600 dark:text-[var(--text-100)]">
                    {formatDateTime(order.createdAt)}
                  </Td>
                  <Td compact className="max-w-[260px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <UploaderAvatar email={order.createdByEmail} name={order.createdByName} avatar={order.createdByAvatar} size="md" />
                      <span className="min-w-0">
                        <p className="truncate font-medium text-slate-800 dark:text-[var(--text-100)]">{order.createdByName || '—'}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-[var(--text-200)]" title={order.createdByEmail}>
                          {order.createdByEmail}
                        </p>
                      </span>
                    </span>
                  </Td>
                  <Td compact>
                    <Link
                      to={`${brand?.path ?? ''}/${order.id}`}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-[var(--accent-100)] hover:underline dark:text-[var(--accent-200)]"
                    >
                      <EyeIcon className="h-3.5 w-3.5" />
                      View shipments ({order.shipments.length})
                    </Link>
                  </Td>
                  <HHRowActions open={openId === order.id} onToggle={() => toggle(order.id)}>
                    <Tooltip content="Edit">
                      <button
                        type="button"
                        aria-label="Edit"
                        onClick={() => requestBulkOrderEdit(order)}
                        className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-2 py-1.5 text-[var(--accent-100)] transition-colors hover:bg-[var(--primary-100)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--accent-200)] dark:hover:bg-[var(--primary-100)]"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M4 20h4.5L19.5 9a1.5 1.5 0 000-2.121l-2.379-2.379a1.5 1.5 0 00-2.121 0L4 15.5V20z" />
                        </svg>
                      </button>
                    </Tooltip>
                    <DeleteBatchButton
                      size="sm"
                      title="Delete"
                      busy={actionBusy && pending?.id === order.id}
                      onClick={() => {
                        setActionError(null)
                        setPending(order)
                      }}
                    />
                  </HHRowActions>
                </HHActionRow>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pending ? (
        <DeleteOrderModal
          order={pending}
          busy={actionBusy}
          error={actionError}
          onCancel={() => {
            if (actionBusy) return
            setPending(null)
            setActionError(null)
          }}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  )
}
