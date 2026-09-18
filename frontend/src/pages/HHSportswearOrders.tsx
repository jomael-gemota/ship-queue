import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { HHActionRow, HHBatchHeaderMenu, HHCartBadge, HHCartSummary, HHConfirmModal, HHDetailsBadge, HHDetailsSummary, HHPlaceButton, HHRedraftButton, HHResyncButton, HHRowActions, HHRowActionsHeader, useHHOpenRow, useHHRowExit } from '../components/hh/hhUi'
import type { HHPendingAction } from '../components/hh/hhUi'
import { HHBuyerInfo } from '../components/hh/HHBuyerInfo'
import { HHNotesField } from '../components/hh/HHNotesField'
import { HHVerifyCompare, HHVerifiedCell } from '../components/hh/HHVerifyCompare'
import { useHHList } from '../context/HHListContext'
import { deleteHHGroup, deleteHHOrder, formatCreatedAt, hhCartCanVerify, hhFilterSummary, hhGroupAllPlaced, hhGroupHasPlaced, hhOrderCanPlace, hhOrderIsLocked, hhPlaceActionTitle, hhPlaceableOrders } from '../lib/hhSportswear'
import {
  AmazonIcon,
  DeleteBatchButton,
  EyeIcon,
  HeaderLabel,
  IdIcon,
  StatusIcon,
  Td,
  Th,
  UserIcon,
} from '../components/labels/labelUi'

function PoIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h10M7 17h6" />
    </svg>
  )
}

function RefIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"
      />
    </svg>
  )
}

function NotesIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6M7 4h7l5 5v11H7V4z"
      />
    </svg>
  )
}

export default function HHSportswearOrders() {
  const { groupId = '' } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const { setGroups, getGroup, filteredOrders, selectedDetailsStatus, selectedCartStatus, searchInput, loadState, loadError, reload, rerunDetails, resyncBusyId, rerunCartDraft, cartDraftBusyId, placeOrders, placeBusyId, placeOrderEnabled } =
    useHHList()
  const group = getGroup(groupId)
  const [pendingAction, setPendingAction] = useState<HHPendingAction | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { openId, toggle, close } = useHHOpenRow()
  const { exitingId, beginExit, finishExit } = useHHRowExit((id) => {
    setGroups((current) =>
      current.map((item) =>
        item.id === groupId ? { ...item, children: item.children.filter((order) => order.id !== id) } : item,
      ),
    )
  })

  const confirmAction = (options?: { draftCart?: boolean }) => {
    if (!pendingAction || !group || actionBusy) return
    setActionBusy(true)
    setActionError(null)

    if (pendingAction.type === 'delete') {
      const request =
        pendingAction.target === 'group'
          ? deleteHHGroup(group.id)
          : deleteHHOrder(group.id, pendingAction.order.id)

      request
        .then(() => {
          if (pendingAction.target === 'group') {
            setGroups((current) => current.filter((item) => item.id !== group.id))
            setPendingAction(null)
            navigate('/ordering/hh-sportswear')
            return
          }
          const orderId = pendingAction.order.id
          setPendingAction(null)
          close()
          beginExit(orderId)
        })
        .catch((error: unknown) => {
          setActionError(error instanceof Error ? error.message : 'Failed to delete')
        })
        .finally(() => {
          setActionBusy(false)
        })
      return
    }

    const orderId = pendingAction.target === 'order' ? pendingAction.order.id : undefined
    const request =
      pendingAction.type === 'resync'
        ? rerunDetails(group.id, orderId, { draftCart: options?.draftCart !== false })
        : pendingAction.type === 'place'
          ? placeOrders(group.id, orderId)
          : rerunCartDraft(group.id, orderId)

    request
      .then(() => {
        setPendingAction(null)
        setActionError(null)
      })
      .catch((error: unknown) => {
        setActionError(
          error instanceof Error
            ? error.message
            : pendingAction.type === 'resync'
              ? 'Failed to re-sync details'
              : pendingAction.type === 'place'
                ? 'Failed to place orders'
                : 'Failed to regenerate draft',
        )
      })
      .finally(() => {
        setActionBusy(false)
      })
  }

  if (loadState === 'loading') {
    return <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-[var(--text-200)]">Loading group…</p>
  }

  if (loadState === 'error') {
    return (
      <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-[var(--text-200)]">
        <p>{loadError || 'Failed to load group.'}</p>
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

  if (!group) {
    return <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-[var(--text-200)]">Group not found.</p>
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--bg-300)] px-5 py-4 dark:border-[var(--bg-300)]">
        <div className="min-w-0">
          <h2 className="inline-flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
            <span>{formatCreatedAt(group.createdAt)}</span>
            <HHDetailsSummary orders={group.children} />
            <HHCartSummary orders={group.children} />
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
            {group.children.length} order{group.children.length === 1 ? '' : 's'}
            {' · '}
            {group.createdByName} ({group.createdByEmail})
          </p>
          <HHNotesField
            groupId={group.id}
            notes={group.notes}
            sourceFileName={group.sourceFileName}
            variant="header"
          />
        </div>
        <div className="flex items-center gap-2.5">
          {group.children.some((order) => hhCartCanVerify(order.cartStatus)) ? (
            <HHVerifyCompare
              size="md"
              groupId={group.id}
              orders={group.children}
            />
          ) : null}
          {hhPlaceableOrders(group.children).length > 0 ? (
            <HHPlaceButton
              size="md"
              title={hhPlaceActionTitle(placeOrderEnabled)}
              busy={placeBusyId === group.id}
              onClick={() => setPendingAction({ type: 'place', target: 'group', group })}
            />
          ) : null}
          <HHBatchHeaderMenu
            groupId={group.id}
            allPlaced={hhGroupAllPlaced(group)}
            hasPlaced={hhGroupHasPlaced(group)}
            resyncBusy={resyncBusyId === group.id}
            redraftBusy={cartDraftBusyId === group.id}
            onResync={() => setPendingAction({ type: 'resync', target: 'group', group })}
            onRedraft={() => setPendingAction({ type: 'redraft', target: 'group', group })}
            onDelete={() => setPendingAction({ type: 'delete', target: 'group', group })}
          />
        </div>
      </div>

      <div className="hh-table-scroll">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-200)] text-xs uppercase tracking-wide text-slate-500 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]">
            <tr className="text-left">
              <Th>
                <HeaderLabel icon={<IdIcon className="h-3.5 w-3.5" />} text="Order ID" />
              </Th>
              <Th>
                <HeaderLabel icon={<PoIcon className="h-3.5 w-3.5" />} text="PO" />
              </Th>
              <Th>
                <HeaderLabel icon={<RefIcon className="h-3.5 w-3.5" />} text="Reference Number" />
              </Th>
              <Th>
                <HeaderLabel icon={<UserIcon className="h-3.5 w-3.5" />} text="Buyer Info" />
              </Th>
              <Th>
                <HeaderLabel icon={<NotesIcon className="h-3.5 w-3.5" />} text="Notes" />
              </Th>
              <Th>
                <HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Details" />
              </Th>
              <Th>
                <HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Cart" />
              </Th>
              <Th>
                <HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Verified" />
              </Th>
              <Th>
                <HeaderLabel icon={<EyeIcon className="h-3.5 w-3.5" />} text="Items" />
              </Th>
              <HHRowActionsHeader />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-[13px] dark:divide-[var(--bg-300)]">
            {filteredOrders.length === 0 ? (
              <tr>
                <Td colSpan={10} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  {group.children.length === 0
                    ? 'No orders in this group.'
                    : selectedDetailsStatus || selectedCartStatus
                      ? searchInput.trim()
                        ? `No orders match "${searchInput.trim()}" with ${hhFilterSummary(selectedDetailsStatus, selectedCartStatus)}.`
                        : `No orders with ${hhFilterSummary(selectedDetailsStatus, selectedCartStatus)}.`
                      : searchInput.trim()
                          ? `No orders match "${searchInput.trim()}".`
                          : 'No orders in this group.'}
                </Td>
              </tr>
            ) : (
              filteredOrders.map((order, idx) => {
                const locked = hhOrderIsLocked(order)
                return (
                  <HHActionRow
                    key={order.id}
                    className={idx % 2 === 1 ? 'hh-row-alt' : ''}
                    open={openId === order.id}
                    exiting={exitingId === order.id}
                    onExitEnd={() => finishExit(order.id)}
                  >
                    <Td compact className="whitespace-nowrap font-mono text-slate-800 dark:text-[var(--text-100)]">
                      <span className="inline-flex items-center gap-1.5">
                        <AmazonIcon className="h-3.5 w-3.5 shrink-0" />
                        {order.orderId}
                      </span>
                    </Td>
                    <Td compact className="whitespace-nowrap font-mono text-slate-600 dark:text-[var(--text-200)]">
                      {order.po}
                    </Td>
                    <Td compact className="whitespace-nowrap font-mono text-slate-600 dark:text-[var(--text-200)]">
                      {order.referenceNumber || '—'}
                    </Td>
                    <Td compact className="max-w-[320px]">
                      <HHBuyerInfo order={order} />
                    </Td>
                    <Td compact className="max-w-xs">
                      <HHNotesField
                        groupId={group.id}
                        orderId={order.id}
                        notes={order.notes ?? ''}
                      />
                    </Td>
                    <Td compact>
                      <HHDetailsBadge status={order.detailsStatus} />
                    </Td>
                    <Td compact>
                      <HHCartBadge status={order.cartStatus} issues={order.verifyIssues} />
                    </Td>
                    <Td compact>
                      <HHVerifiedCell groupId={group.id} order={order} />
                    </Td>
                    <Td compact>
                      <Link
                        to={`/ordering/hh-sportswear/${group.id}/orders/${order.id}`}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-[var(--accent-100)] hover:underline dark:text-[var(--accent-200)]"
                      >
                        <EyeIcon className="h-3.5 w-3.5" />
                        View items ({order.items.length})
                      </Link>
                    </Td>
                    <HHRowActions
                      open={openId === order.id}
                      onToggle={() => toggle(order.id)}
                    >
                      <HHResyncButton
                        size="sm"
                        title={locked ? 'Placed orders cannot be re-synced' : 'Re-sync details for this order'}
                        disabled={locked}
                        busy={resyncBusyId === order.id}
                        onClick={() => setPendingAction({ type: 'resync', target: 'order', order })}
                      />
                      <HHRedraftButton
                        size="sm"
                        title={
                          locked
                            ? 'Placed orders cannot have their cart regenerated'
                            : 'Regenerate B2B draft for this order'
                        }
                        disabled={locked}
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
                      <DeleteBatchButton
                        size="sm"
                        title={locked ? 'Placed orders cannot be deleted' : 'Delete'}
                        disabled={locked}
                        onClick={() => setPendingAction({ type: 'delete', target: 'order', order })}
                      />
                    </HHRowActions>
                  </HHActionRow>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {pendingAction && (
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
          onConfirm={confirmAction}
        />
      )}
    </>
  )
}
