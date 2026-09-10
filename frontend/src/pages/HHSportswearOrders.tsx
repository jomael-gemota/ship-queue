import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { HHActionRow, HHConfirmDeleteModal, HHRowActions, HHRowActionsHeader, HHStatusBadge, useHHOpenRow, useHHRowExit } from '../components/hh/hhUi'
import type { HHPendingDelete } from '../components/hh/hhUi'
import { useHHList } from '../context/HHListContext'
import { HH_STATUS_LABELS, formatCreatedAt } from '../lib/hhSportswear'
import {
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

function AddressIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  )
}

export default function HHSportswearOrders() {
  const { groupId = '' } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const { setGroups, getGroup, filteredOrders, selectedStatus, searchInput } = useHHList()
  const group = getGroup(groupId)
  const [pendingDelete, setPendingDelete] = useState<HHPendingDelete | null>(null)
  const { openId, toggle, close } = useHHOpenRow()
  const { exitingId, beginExit, finishExit } = useHHRowExit((id) => {
    setGroups((current) =>
      current.map((item) =>
        item.id === groupId ? { ...item, children: item.children.filter((order) => order.id !== id) } : item,
      ),
    )
  })

  const confirmDelete = () => {
    if (!pendingDelete || !group) return
    if (pendingDelete.kind === 'group') {
      setGroups((current) => current.filter((item) => item.id !== group.id))
      setPendingDelete(null)
      navigate('/ordering/hh-sportswear')
      return
    }
    setPendingDelete(null)
    close()
    beginExit(pendingDelete.order.id)
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
            <HHStatusBadge status={group.status} />
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
            {group.children.length} order{group.children.length === 1 ? '' : 's'}
            {' · '}
            {group.createdByName} ({group.createdByEmail})
          </p>
          {group.notes && (
            <p className="mt-2 max-w-3xl text-sm whitespace-pre-wrap text-slate-600 dark:text-[var(--text-200)]">
              {group.notes}
            </p>
          )}
        </div>
        <DeleteBatchButton
          title="Delete group"
          onClick={() => setPendingDelete({ kind: 'group', group })}
        />
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
                <HeaderLabel icon={<UserIcon className="h-3.5 w-3.5" />} text="Customer" />
              </Th>
              <Th>
                <HeaderLabel icon={<AddressIcon className="h-3.5 w-3.5" />} text="Address" />
              </Th>
              <Th>
                <HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Status" />
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
                <Td colSpan={7} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  {group.children.length === 0
                    ? 'No orders in this group.'
                    : selectedStatus && searchInput.trim()
                      ? `No orders match "${searchInput.trim()}" with status "${HH_STATUS_LABELS[selectedStatus]}".`
                      : selectedStatus
                        ? `No orders with status "${HH_STATUS_LABELS[selectedStatus]}".`
                        : searchInput.trim()
                          ? `No orders match "${searchInput.trim()}".`
                          : 'No orders in this group.'}
                </Td>
              </tr>
            ) : (
              filteredOrders.map((order, idx) => {
                const zebra = idx % 2 === 1
                const rowBg = zebra
                  ? 'bg-[var(--bg-200)] dark:bg-[var(--bg-200)]'
                  : 'bg-[var(--bg-100)] dark:bg-[var(--bg-100)]'
                return (
                  <HHActionRow
                    key={order.id}
                    className={rowBg}
                    open={openId === order.id}
                    exiting={exitingId === order.id}
                    onExitEnd={() => finishExit(order.id)}
                  >
                    <Td compact className="whitespace-nowrap font-mono text-slate-800 dark:text-[var(--text-100)]">
                      {order.orderId}
                    </Td>
                    <Td compact className="whitespace-nowrap font-mono text-slate-600 dark:text-[var(--text-200)]">
                      {order.po}
                    </Td>
                    <Td compact className="max-w-[280px]">
                      <p className="font-medium text-slate-800 dark:text-[var(--text-100)]">{order.customerName}</p>
                      <p className="break-all text-xs text-slate-500 dark:text-[var(--text-200)]">
                        {order.customerEmail}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-[var(--text-200)]">{order.customerPhone}</p>
                    </Td>
                    <Td compact className="max-w-[240px]">
                      <p className="text-slate-700 dark:text-[var(--text-100)]">{order.addressLine1}</p>
                      <p className="text-slate-600 dark:text-[var(--text-200)]">{order.addressLine2}</p>
                      <p className="text-slate-500 dark:text-[var(--text-200)]">{order.country}</p>
                    </Td>
                    <Td compact>
                      <HHStatusBadge status={order.status} />
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
                      className={rowBg}
                      open={openId === order.id}
                      onToggle={() => toggle(order.id)}
                    >
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
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </>
  )
}
