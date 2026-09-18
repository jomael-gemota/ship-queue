import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { HHCartBadge, HHConfirmModal, HHDetailsBadge, HHPlaceButton } from '../components/hh/hhUi'
import type { HHPendingAction } from '../components/hh/hhUi'
import { HHBuyerInfo } from '../components/hh/HHBuyerInfo'
import { HHNotesField } from '../components/hh/HHNotesField'
import { HHVerifiedCell } from '../components/hh/HHVerifyCompare'
import { useHHList } from '../context/HHListContext'
import { hhItemSubtotal, hhItemTax, hhItemTotal, hhOrderCanPlace, hhPlaceActionTitle } from '../lib/hhSportswear'
import type { HHLineItem } from '../lib/hhSportswear'
import {
  AmazonIcon,
  BoxIcon,
  DollarIcon,
  formatCurrency,
  HeaderLabel,
  IdIcon,
  Td,
  Th,
} from '../components/labels/labelUi'

function TitleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10" />
    </svg>
  )
}

function QtyIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h10M7 16h6" />
    </svg>
  )
}

function ImageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm3 10l2.5-3 2 2.5L15 11l5 6"
      />
    </svg>
  )
}

function ItemImage({ item }: { item: HHLineItem }) {
  if (!item.imageUrl) {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded border border-[var(--bg-300)] bg-[var(--bg-200)] text-[10px] text-slate-400 dark:text-[var(--text-200)]">
        —
      </div>
    )
  }
  return (
    <div className="h-14 w-14 overflow-hidden rounded border border-[var(--bg-300)] bg-white dark:bg-[var(--bg-200)]">
      <img
        src={item.imageUrl}
        alt=""
        className="h-full w-full object-contain"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  )
}

function ProceedsCell({
  subtotal,
  tax,
  total,
  emphasizeTotal = false,
}: {
  subtotal: number
  tax: number
  total: number
  emphasizeTotal?: boolean
}) {
  return (
    <div className="ml-auto w-max text-right text-[12px] leading-5">
      <p>
        <span className="text-slate-500 dark:text-[var(--text-200)]">Item subtotal: </span>
        <span className="tabular-nums text-slate-700 dark:text-[var(--text-100)]">{formatCurrency(subtotal)}</span>
      </p>
      <p>
        <span className="text-slate-500 dark:text-[var(--text-200)]">Tax: </span>
        <span className="tabular-nums text-slate-700 dark:text-[var(--text-100)]">{formatCurrency(tax)}</span>
      </p>
      <p className={emphasizeTotal ? 'font-semibold' : ''}>
        <span className="text-slate-500 dark:text-[var(--text-200)]">Item total: </span>
        <span className="tabular-nums text-slate-800 dark:text-[var(--text-100)]">{formatCurrency(total)}</span>
      </p>
    </div>
  )
}

export default function HHSportswearItems() {
  const { groupId = '', orderId = '' } = useParams<{ groupId: string; orderId: string }>()
  const { getOrder, filteredItems, searchInput, loadState, loadError, reload, placeOrders, placeBusyId, placeOrderEnabled } = useHHList()
  const match = getOrder(groupId, orderId)
  const [pendingAction, setPendingAction] = useState<HHPendingAction | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const totals = useMemo(() => {
    return filteredItems.reduce(
      (acc, item) => ({
        quantity: acc.quantity + item.quantity,
        subtotal: acc.subtotal + hhItemSubtotal(item),
        tax: acc.tax + hhItemTax(item),
        amount: acc.amount + hhItemTotal(item),
      }),
      { quantity: 0, subtotal: 0, tax: 0, amount: 0 },
    )
  }, [filteredItems])

  if (loadState === 'loading') {
    return <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-[var(--text-200)]">Loading order…</p>
  }

  if (loadState === 'error') {
    return (
      <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-[var(--text-200)]">
        <p>{loadError || 'Failed to load order.'}</p>
        <button
          type="button"
          onClick={reload}
          className="mt-2 cursor-pointer font-medium text-[var(--accent-100)] hover:underline dark:text-[var(--accent-200)]"
        >
          Try again
        </button>
      </div>
    )
  }

  if (!match) {
    return <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-[var(--text-200)]">Order not found.</p>
  }

  const { order } = match

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--bg-300)] px-5 py-4 dark:border-[var(--bg-300)]">
        <div className="min-w-0">
          <h2 className="inline-flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
            <span className="inline-flex items-center gap-1.5 font-mono">
              <AmazonIcon className="h-4 w-4 shrink-0" />
              {order.orderId}
            </span>
            <HHDetailsBadge status={order.detailsStatus} />
            <HHCartBadge status={order.cartStatus} issues={order.verifyIssues} />
            <HHVerifiedCell groupId={groupId} order={order} />
            {hhOrderCanPlace(order) ? (
              <HHPlaceButton
                size="sm"
                title={hhPlaceActionTitle(placeOrderEnabled)}
                busy={placeBusyId === order.id}
                onClick={() => setPendingAction({ type: 'place', target: 'order', order })}
              />
            ) : null}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
            PO {order.po}
            {order.referenceNumber ? ` · Ref ${order.referenceNumber}` : ''}
            {' · '}
            {order.items.length} item{order.items.length === 1 ? '' : 's'}
          </p>
          <div className="mt-3 max-w-xl text-sm">
            <HHBuyerInfo order={order} />
            <HHNotesField
              groupId={groupId}
              orderId={order.id}
              notes={order.notes ?? ''}
              variant="header"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-200)] text-xs uppercase tracking-wide text-slate-500 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]">
            <tr className="text-left">
              <Th>
                <HeaderLabel icon={<ImageIcon className="h-3.5 w-3.5" />} text="Image" />
              </Th>
              <Th>
                <HeaderLabel icon={<TitleIcon className="h-3.5 w-3.5" />} text="Title" />
              </Th>
              <Th>
                <HeaderLabel icon={<BoxIcon className="h-3.5 w-3.5" />} text="SKU" />
              </Th>
              <Th>
                <HeaderLabel icon={<IdIcon className="h-3.5 w-3.5" />} text="ASIN" />
              </Th>
              <Th className="text-right">
                <HeaderLabel className="justify-end" icon={<QtyIcon className="h-3.5 w-3.5" />} text="Quantity" />
              </Th>
              <Th className="text-right">
                <HeaderLabel className="justify-end" icon={<DollarIcon className="h-3.5 w-3.5" />} text="Unit Price" />
              </Th>
              <Th className="text-right">
                <HeaderLabel className="justify-end" icon={<DollarIcon className="h-3.5 w-3.5" />} text="Proceeds" />
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-[13px] dark:divide-[var(--bg-300)]">
            {filteredItems.length === 0 ? (
              <tr>
                <Td colSpan={7} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  {order.items.length === 0
                    ? 'No line items.'
                    : searchInput.trim()
                      ? `No items match "${searchInput.trim()}".`
                      : 'No line items.'}
                </Td>
              </tr>
            ) : (
              filteredItems.map((item, idx) => {
                return (
                  <tr key={item.id} className={`hh-table-row${idx % 2 === 1 ? ' hh-row-alt' : ''}`}>
                    <Td compact className="w-16 align-middle">
                      <ItemImage item={item} />
                    </Td>
                    <Td compact className="max-w-sm text-slate-800 dark:text-[var(--text-100)]">
                      <span className="break-words" title={item.title}>
                        {item.title}
                      </span>
                    </Td>
                    <Td compact className="whitespace-nowrap font-mono text-slate-600 dark:text-[var(--text-200)]">
                      {item.sku}
                    </Td>
                    <Td compact className="whitespace-nowrap font-mono text-slate-600 dark:text-[var(--text-200)]">
                      {item.asin}
                    </Td>
                    <Td compact className="whitespace-nowrap text-right tabular-nums text-slate-700 dark:text-[var(--text-100)]">
                      {item.quantity}
                    </Td>
                    <Td compact className="whitespace-nowrap text-right tabular-nums text-slate-700 dark:text-[var(--text-100)]">
                      {formatCurrency(item.unitPrice)}
                    </Td>
                    <Td compact className="align-middle">
                      <ProceedsCell
                        subtotal={hhItemSubtotal(item)}
                        tax={hhItemTax(item)}
                        total={hhItemTotal(item)}
                        emphasizeTotal
                      />
                    </Td>
                  </tr>
                )
              })
            )}
          </tbody>
          {filteredItems.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[var(--bg-300)] bg-[var(--bg-200)] text-[13px] font-semibold dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)]">
                <Td compact colSpan={4} className="text-slate-800 dark:text-[var(--text-100)]">
                  Total
                </Td>
                <Td compact className="whitespace-nowrap text-right tabular-nums text-slate-800 dark:text-[var(--text-100)]">
                  {totals.quantity}
                </Td>
                <Td compact>{null}</Td>
                <Td compact className="align-middle">
                  <ProceedsCell subtotal={totals.subtotal} tax={totals.tax} total={totals.amount} emphasizeTotal />
                </Td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {pendingAction ? (
        <HHConfirmModal
          pending={pendingAction}
          busy={actionBusy}
          error={actionError}
          placeOrderEnabled={placeOrderEnabled}
          onCancel={() => {
            if (actionBusy) return
            setPendingAction(null)
            setActionError(null)
          }}
          onConfirm={() => {
            if (actionBusy || pendingAction.type !== 'place' || pendingAction.target !== 'order') return
            setActionBusy(true)
            setActionError(null)
            placeOrders(groupId, pendingAction.order.id)
              .then(() => {
                setPendingAction(null)
                setActionError(null)
              })
              .catch((error: unknown) => {
                setActionError(error instanceof Error ? error.message : 'Failed to place order')
              })
              .finally(() => setActionBusy(false))
          }}
        />
      ) : null}
    </>
  )
}
