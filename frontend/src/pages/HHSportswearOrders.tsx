import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { HHActionRow, HHCartBadge, HHConfirmDeleteModal, HHDetailsBadge, HHResyncButton, HHRowActions, HHRowActionsHeader, useHHOpenRow, useHHRowExit } from '../components/hh/hhUi'
import type { HHPendingDelete } from '../components/hh/hhUi'
import { HHBuyerInfo } from '../components/hh/HHBuyerInfo'
import { HHNotesField } from '../components/hh/HHNotesField'
import { useHHList } from '../context/HHListContext'
import { deleteHHGroup, deleteHHOrder, formatCreatedAt, hhFilterSummary } from '../lib/hhSportswear'
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
  const { setGroups, getGroup, filteredOrders, selectedDetailsStatus, selectedCartStatus, searchInput, loadState, loadError, reload, rerunDetails, resyncBusyId } =
    useHHList()
  const group = getGroup(groupId)
  const [pendingDelete, setPendingDelete] = useState<HHPendingDelete | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { openId, toggle, close } = useHHOpenRow()
  const { exitingId, beginExit, finishExit } = useHHRowExit((id) => {
    setGroups((current) =>
      current.map((item) =>
        item.id === groupId ? { ...item, children: item.children.filter((order) => order.id !== id) } : item,
      ),
    )
  })

  const confirmDelete = () => {
    if (!pendingDelete || !group || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)

    const request =
      pendingDelete.kind === 'group'
        ? deleteHHGroup(group.id)
        : deleteHHOrder(group.id, pendingDelete.order.id)

    request
      .then(() => {
        if (pendingDelete.kind === 'group') {
          setGroups((current) => current.filter((item) => item.id !== group.id))
          setPendingDelete(null)
          navigate('/ordering/hh-sportswear')
          return
        }
        const orderId = pendingDelete.order.id
        setPendingDelete(null)
        close()
        beginExit(orderId)
      })
      .catch((error: unknown) => {
        setDeleteError(error instanceof Error ? error.message : 'Failed to delete')
      })
      .finally(() => {
        setDeleteBusy(false)
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
            <HHDetailsBadge status={group.detailsStatus} />
            <HHCartBadge status={group.cartStatus} />
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
        <div className="flex items-center gap-2">
          <HHResyncButton
            size="md"
            title="Re-sync details for this batch"
            busy={resyncBusyId === group.id}
            onClick={() => {
              void rerunDetails(group.id)
            }}
          />
          <DeleteBatchButton
            title="Delete group"
            onClick={() => setPendingDelete({ kind: 'group', group })}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
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
                <HeaderLabel icon={<EyeIcon className="h-3.5 w-3.5" />} text="Items" />
              </Th>
              <HHRowActionsHeader />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-[13px] dark:divide-[var(--bg-300)]">
            {filteredOrders.length === 0 ? (
              <tr>
                <Td colSpan={9} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
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
                      <HHCartBadge status={order.cartStatus} />
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
                        title="Re-sync details for this order"
                        busy={resyncBusyId === order.id}
                        onClick={() => {
                          void rerunDetails(group.id, order.id)
                        }}
                      />
                      <DeleteBatchButton
                        size="sm"
                        title="Delete"
                        onClick={() => setPendingDelete({ kind: 'order', order })}
                      />
                    </HHRowActions>
                  </HHActionRow>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {pendingDelete && (
        <HHConfirmDeleteModal
          pending={pendingDelete}
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => {
            if (deleteBusy) return
            setPendingDelete(null)
            setDeleteError(null)
          }}
          onConfirm={confirmDelete}
        />
      )}
    </>
  )
}
