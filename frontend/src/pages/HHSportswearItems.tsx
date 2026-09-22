import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { HHCartBadge, HHConfirmModal, HHDetailsBadge, HHPlaceButton, HHPlacedBadge, HHRedraftButton } from '../components/hh/hhUi'
import type { HHPendingAction } from '../components/hh/hhUi'
import { HHBuyerInfo } from '../components/hh/HHBuyerInfo'
import { HHNotesField } from '../components/hh/HHNotesField'
import { HHVerifiedCell } from '../components/hh/HHVerifyCompare'
import { useHHList } from '../context/HHListContext'
import {
  hhCartErrorMentionsSku,
  hhExcludedItems,
  hhItemIsExcluded,
  hhItemSubtotal,
  hhItemTax,
  hhItemTotal,
  hhOrderCanDraft,
  hhOrderCanPlace,
  hhOrderDraftTitle,
  hhOrderIsLocked,
  hhPlaceActionTitle,
} from '../lib/hhSportswear'
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

const MAX_EXCLUDE_NOTE = 500

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

function HHItemExcludeControls({
  item,
  locked,
  unmatched,
  busy,
  error,
  editing,
  note,
  onNoteChange,
  onStartExclude,
  onCancel,
  onExclude,
  onInclude,
}: {
  item: HHLineItem
  locked: boolean
  unmatched: boolean
  busy: boolean
  error: string | null
  editing: boolean
  note: string
  onNoteChange: (value: string) => void
  onStartExclude: () => void
  onCancel: () => void
  onExclude: () => void
  onInclude: () => void
}) {
  if (item.excluded) {
    return (
      <div className="mt-1.5 space-y-1">
        <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-700/70 dark:text-slate-200">
          Excluded from cart
        </span>
        {item.excludeNote ? (
          <p className="max-w-xs text-xs font-normal leading-snug text-slate-600 dark:text-[var(--text-200)]">
            {item.excludeNote}
          </p>
        ) : null}
        {locked ? null : (
          <button
            type="button"
            disabled={busy}
            onClick={onInclude}
            className="block cursor-pointer text-xs font-medium text-[var(--accent-100)] hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-[var(--accent-200)]"
          >
            {busy ? 'Saving…' : 'Include in cart'}
          </button>
        )}
        {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    )
  }

  if (locked) return null

  if (editing) {
    return (
      <div className="mt-1.5 max-w-xs space-y-1.5" onClick={(event) => event.stopPropagation()}>
        <textarea
          value={note}
          disabled={busy}
          maxLength={MAX_EXCLUDE_NOTE}
          rows={2}
          placeholder="Why? Workwear, OOS…"
          aria-label="Exclude note"
          onChange={(event) => onNoteChange(event.target.value)}
          className="w-full resize-y rounded-md border border-[var(--accent-200)] bg-[var(--bg-100)] px-2 py-1.5 text-[13px] leading-5 text-slate-800 outline-none focus:ring-2 focus:ring-[var(--accent-200)] disabled:opacity-60 dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            disabled={busy}
            onClick={onExclude}
            className="cursor-pointer text-xs font-medium text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-300"
          >
            {busy ? 'Saving…' : 'Exclude from cart'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="cursor-pointer text-xs font-medium text-slate-500 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-[var(--text-200)]"
          >
            Cancel
          </button>
        </div>
        {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onStartExclude}
      className={`mt-1.5 block cursor-pointer text-xs font-medium hover:underline disabled:cursor-not-allowed disabled:opacity-60 ${
        unmatched
          ? 'text-red-700 dark:text-red-300'
          : 'text-[var(--accent-100)] dark:text-[var(--accent-200)]'
      }`}
    >
      Exclude from cart
    </button>
  )
}

export default function HHSportswearItems() {
  const { groupId = '', orderId = '' } = useParams<{ groupId: string; orderId: string }>()
  const {
    getOrder,
    filteredItems,
    searchInput,
    loadState,
    loadError,
    reload,
    placeOrders,
    placeBusyId,
    placeOrderEnabled,
    rerunCartDraft,
    cartDraftBusyId,
    updateOrderItemExclude,
  } = useHHList()
  const match = getOrder(groupId, orderId)
  const [pendingAction, setPendingAction] = useState<HHPendingAction | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [excludeItemId, setExcludeItemId] = useState<string | null>(null)
  const [excludeNote, setExcludeNote] = useState('')
  const [excludeBusyId, setExcludeBusyId] = useState<string | null>(null)
  const [excludeError, setExcludeError] = useState<string | null>(null)

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
  const locked = hhOrderIsLocked(order)
  const excludedCount = hhExcludedItems(order.items).length
  const canDraft = hhOrderCanDraft(order)

  const saveExclude = (item: HHLineItem, excluded: boolean, note?: string) => {
    setExcludeBusyId(item.id)
    setExcludeError(null)
    updateOrderItemExclude(groupId, order.id, item.id, {
      excluded,
      excludeNote: excluded ? (note ?? '').trim() : '',
    })
      .then(() => {
        setExcludeItemId(null)
        setExcludeNote('')
        setExcludeError(null)
      })
      .catch((error: unknown) => {
        setExcludeError(error instanceof Error ? error.message : 'Failed to update item')
      })
      .finally(() => {
        setExcludeBusyId((current) => (current === item.id ? null : current))
      })
  }

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
            <HHCartBadge status={order.cartStatus} issues={order.verifyIssues} error={order.cartError} />
            <HHVerifiedCell groupId={groupId} order={order} />
            <HHPlacedBadge status={order.cartStatus} error={order.placeError} />
            <HHRedraftButton
              size="sm"
              title={hhOrderDraftTitle(order)}
              disabled={locked || !canDraft}
              busy={cartDraftBusyId === order.id}
              onClick={() => setPendingAction({ type: 'redraft', target: 'order', order })}
            />
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
            {excludedCount > 0 ? ` · ${excludedCount} excluded from cart` : ''}
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

      <div className="hh-table-scroll">
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
                const excluded = hhItemIsExcluded(item)
                const unmatched = !excluded && hhCartErrorMentionsSku(order.cartError, item.sku)
                return (
                  <tr
                    key={item.id}
                    className={`hh-table-row${idx % 2 === 1 ? ' hh-row-alt' : ''}${
                      excluded
                        ? ' bg-slate-50 opacity-80 dark:bg-slate-900/40'
                        : unmatched
                          ? ' bg-red-50 dark:bg-red-950/30'
                          : ''
                    }`}
                  >
                    <Td compact className="w-16 align-middle">
                      <ItemImage item={item} />
                    </Td>
                    <Td compact className="max-w-sm text-slate-800 dark:text-[var(--text-100)]">
                      <span className={`break-words ${excluded ? 'text-slate-500 dark:text-[var(--text-200)]' : ''}`} title={item.title}>
                        {item.title}
                      </span>
                      <HHItemExcludeControls
                        item={item}
                        locked={locked}
                        unmatched={unmatched}
                        busy={excludeBusyId === item.id}
                        error={excludeItemId === item.id || (excluded && excludeBusyId === item.id) ? excludeError : null}
                        editing={excludeItemId === item.id}
                        note={excludeItemId === item.id ? excludeNote : item.excludeNote}
                        onNoteChange={setExcludeNote}
                        onStartExclude={() => {
                          setExcludeItemId(item.id)
                          setExcludeNote(item.excludeNote ?? '')
                          setExcludeError(null)
                        }}
                        onCancel={() => {
                          if (excludeBusyId) return
                          setExcludeItemId(null)
                          setExcludeNote('')
                          setExcludeError(null)
                        }}
                        onExclude={() => saveExclude(item, true, excludeNote)}
                        onInclude={() => saveExclude(item, false)}
                      />
                    </Td>
                    <Td compact className="whitespace-nowrap font-mono text-slate-600 dark:text-[var(--text-200)]">
                      <span className={unmatched ? 'font-medium text-red-700 dark:text-red-300' : undefined}>
                        {item.sku}
                      </span>
                      {unmatched ? (
                        <span className="mt-0.5 block text-xs font-medium normal-case text-red-700 dark:text-red-300">
                          Did not match
                        </span>
                      ) : null}
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
                  {excludedCount > 0 ? (
                    <span className="ml-2 text-xs font-medium text-slate-500 dark:text-[var(--text-200)]">
                      Includes {excludedCount} excluded from cart
                    </span>
                  ) : null}
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
            if (actionBusy || pendingAction.target !== 'order') return
            if (pendingAction.type !== 'place' && pendingAction.type !== 'redraft') return
            setActionBusy(true)
            setActionError(null)
            const request =
              pendingAction.type === 'place'
                ? placeOrders(groupId, pendingAction.order.id)
                : rerunCartDraft(groupId, pendingAction.order.id)
            request
              .then(() => {
                setPendingAction(null)
                setActionError(null)
              })
              .catch((error: unknown) => {
                setActionError(
                  error instanceof Error
                    ? error.message
                    : pendingAction.type === 'place'
                      ? 'Failed to place order'
                      : 'Failed to draft cart',
                )
              })
              .finally(() => setActionBusy(false))
          }}
        />
      ) : null}
    </>
  )
}
