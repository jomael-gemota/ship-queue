import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { BulkShipmentDialog } from '../components/bulk/BulkShipmentDialog'
import { HHActionRow, HHRowActions, HHRowActionsHeader, useHHOpenRow } from '../components/hh/hhUi'
import { Tooltip } from '../components/Tooltip'
import { DeleteBatchButton, EyeIcon, HeaderLabel, IdIcon, Td, Th, ClockIcon, BoxIcon } from '../components/labels/labelUi'
import { bulkOrderBrand } from '../lib/bulkOrder'
import { bulkShipmentPayload, getBulkOrder, notifyBulkOrdersChanged, updateBulkOrder } from '../lib/bulkOrders'
import type { BulkOrderRow, BulkOrderShipment } from '../lib/bulkOrders'

function formatShipDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value || '—'
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function dropShipLabel(shipment: BulkOrderShipment): string {
  if (!shipment.useDropShip) return '—'
  return shipment.dropShipName.trim() || '—'
}

function DeleteShipmentModal({
  label,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  label: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm space-y-4 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-6 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Delete shipment?</h3>
        <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
          This removes{' '}
          <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{label}</span> from the Thorogood
          draft. The other shipments stay on the order.
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

export default function BulkOrderShipments() {
  const { orderId } = useParams<{ orderId: string }>()
  const { pathname } = useLocation()
  const brand = bulkOrderBrand(pathname)
  const [order, setOrder] = useState<BulkOrderRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ shipment: BulkOrderShipment | null; index: number | null } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { openId, toggle, close } = useHHOpenRow()

  const confirmDelete = () => {
    if (!order || pendingDelete == null || actionBusy) return
    if (order.shipments.length <= 1) return
    const removeAt = pendingDelete
    setActionBusy(true)
    setActionError(null)
    const shipments = order.shipments.flatMap((shipment, index) =>
      index === removeAt ? [] : [bulkShipmentPayload(shipment, index)],
    )
    updateBulkOrder(order.id, {
      orderName: order.orderName,
      soldToCode: order.soldToCode,
      shipToCode: order.shipToCode,
      shipments,
    })
      .then((res) => {
        notifyBulkOrdersChanged(res.warning || '')
        setOrder(res.data)
        setPendingDelete(null)
        setActionError(null)
        close()
        setEditor((current) => {
          if (!current || current.index == null) return current
          if (current.index === removeAt) return null
          if (current.index > removeAt) return { ...current, index: current.index - 1 }
          return current
        })
      })
      .catch((err: unknown) => {
        setActionError(err instanceof Error ? err.message : 'Could not delete the shipment.')
      })
      .finally(() => setActionBusy(false))
  }

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    getBulkOrder(orderId)
      .then((res) => {
        if (cancelled) return
        setOrder(res.data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load shipments.')
      })
    return () => {
      cancelled = true
    }
  }, [orderId])

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--bg-300)] px-4 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">{order?.orderName || 'Shipments'}</h2>
          {order ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
              {order.soldToLabel} · {order.shipments.length} shipment{order.shipments.length === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={!order}
          onClick={() => setEditor({ shipment: null, index: null })}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add shipment
        </button>
      </div>
      <div className="hh-table-scroll bulk-shipment-table">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-200)] text-xs uppercase tracking-wide text-slate-500 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]">
            <tr className="text-left">
              <Th>
                <HeaderLabel icon={<IdIcon className="h-3.5 w-3.5" />} text="Shipment" />
              </Th>
              <Th>
                <HeaderLabel icon={<IdIcon className="h-3.5 w-3.5" />} text="Customer PO" />
              </Th>
              <Th>
                <HeaderLabel icon={<BoxIcon className="h-3.5 w-3.5" />} text="Catalog" />
              </Th>
              <Th>
                <HeaderLabel icon={<BoxIcon className="h-3.5 w-3.5" />} text="Ship To" />
              </Th>
              <Th>
                <HeaderLabel icon={<BoxIcon className="h-3.5 w-3.5" />} text="Drop Ship" />
              </Th>
              <Th>
                <HeaderLabel icon={<ClockIcon className="h-3.5 w-3.5" />} text="Ship Date" />
              </Th>
              <Th>
                <HeaderLabel icon={<EyeIcon className="h-3.5 w-3.5" />} text="Items" />
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
            ) : !order ? (
              <tr>
                <Td colSpan={8} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  Loading shipments…
                </Td>
              </tr>
            ) : order.shipments.length === 0 ? (
              <tr>
                <Td colSpan={8} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  No shipments on this order.
                </Td>
              </tr>
            ) : (
              order.shipments.map((shipment, index) => (
                <HHActionRow
                  key={`${shipment.customerPo}-${index}`}
                  className={`hh-actions-compact${index % 2 === 1 ? ' hh-row-alt' : ''}`}
                  open={openId === String(index)}
                >
                  <Td compact className="font-medium text-slate-800 dark:text-[var(--text-100)]">
                    Shipment {index + 1}
                  </Td>
                  <Td compact className="whitespace-nowrap text-slate-700 dark:text-[var(--text-100)]">{shipment.customerPo}</Td>
                  <Td compact className="text-slate-700 dark:text-[var(--text-100)]">{shipment.catalogName}</Td>
                  <Td compact className="max-w-[18rem] text-slate-700 dark:text-[var(--text-100)]">
                    <span className="block truncate" title={shipment.shipToLabel}>
                      {shipment.shipToLabel}
                    </span>
                  </Td>
                  <Td compact className="text-slate-700 dark:text-[var(--text-100)]">{dropShipLabel(shipment)}</Td>
                  <Td compact className="whitespace-nowrap text-slate-600 dark:text-[var(--text-100)]">
                    {formatShipDate(shipment.requestedShipDate)}
                  </Td>
                  <Td compact>
                    <Link
                      to={`${brand?.path ?? ''}/${order.id}/shipments/${index}`}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-[var(--accent-100)] hover:underline dark:text-[var(--accent-200)]"
                    >
                      <EyeIcon className="h-3.5 w-3.5" />
                      View items
                    </Link>
                  </Td>
                  <HHRowActions open={openId === String(index)} onToggle={() => toggle(String(index))}>
                    <Tooltip content="Edit">
                      <button
                        type="button"
                        aria-label="Edit"
                        onClick={() => setEditor({ shipment, index })}
                        className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-2 py-1.5 text-[var(--accent-100)] transition-colors hover:bg-[var(--primary-100)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--accent-200)] dark:hover:bg-[var(--primary-100)]"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M4 20h4.5L19.5 9a1.5 1.5 0 000-2.121l-2.379-2.379a1.5 1.5 0 00-2.121 0L4 15.5V20z" />
                        </svg>
                      </button>
                    </Tooltip>
                    <DeleteBatchButton
                      size="sm"
                      title={order.shipments.length > 1 ? 'Delete' : 'An order needs at least one shipment.'}
                      disabled={order.shipments.length <= 1}
                      busy={actionBusy && pendingDelete === index}
                      onClick={() => {
                        if (order.shipments.length <= 1) return
                        setActionError(null)
                        setPendingDelete(index)
                      }}
                    />
                  </HHRowActions>
                </HHActionRow>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pendingDelete != null && order ? (
        <DeleteShipmentModal
          label={`Shipment ${pendingDelete + 1}`}
          busy={actionBusy}
          error={actionError}
          onCancel={() => {
            if (actionBusy) return
            setPendingDelete(null)
            setActionError(null)
          }}
          onConfirm={confirmDelete}
        />
      ) : null}
      {order && editor ? (
        <BulkShipmentDialog
          order={order}
          shipment={editor.shipment}
          shipmentIndex={editor.index}
          onClose={() => setEditor(null)}
          onSaved={(next) => setOrder(next)}
        />
      ) : null}
    </div>
  )
}
