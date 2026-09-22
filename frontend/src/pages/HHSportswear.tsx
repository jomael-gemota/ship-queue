import { useState } from 'react'
import { Link } from 'react-router-dom'
import { HHActionRow, HHBatchProgress, HHBatchProgressLabels, HHConfirmModal, HHCopyIdButton, HHPlaceButton, HHRedraftButton, HHResyncButton, HHRowActions, HHRowActionsHeader, useHHOpenRow, useHHRowExit } from '../components/hh/hhUi'
import type { HHPendingAction } from '../components/hh/hhUi'
import { useHHList } from '../context/HHListContext'
import { HHNotesField } from '../components/hh/HHNotesField'
import { deleteHHGroup, formatCreatedAt, hhDraftableOrders, hhFilterSummary, hhGroupAllPlaced, hhGroupDetailsTitle, hhGroupDraftTitle, hhGroupHasPlaced, hhPlaceActionTitle, hhPlaceableOrders } from '../lib/hhSportswear'
import {
  ClockIcon,
  DeleteBatchButton,
  EyeIcon,
  HeaderLabel,
  StatusIcon,
  Td,
  Th,
  UserIcon,
} from '../components/labels/labelUi'

const PAGE_SIZE_OPTIONS = [10, 25, 50]

const paginationButtonClass =
  'p-1.5 rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] text-slate-700 dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] hover:text-slate-900 dark:hover:text-[var(--text-100)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors'

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

export default function HHSportswear() {
  const {
    setGroups,
    selectedDetailsStatus,
    selectedCartStatus,
    searchInput,
    pageSize,
    paginated,
    listTotal,
    pageCount,
    safePage,
    startItem,
    endItem,
    handlePageSizeChange,
    setPage,
    loadState,
    loadError,
    reload,
    rerunDetails,
    resyncBusyId,
    rerunCartDraft,
    cartDraftBusyId,
    placeOrders,
    placeBusyId,
    placeOrderEnabled,
    brand,
    brandPath,
  } = useHHList()
  const [pendingAction, setPendingAction] = useState<HHPendingAction | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { openId, toggle, close } = useHHOpenRow()
  const { exitingId, beginExit, finishExit } = useHHRowExit((id) => {
    setGroups((current) => current.filter((group) => group.id !== id))
  })

  const paginationArrows = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setPage(1)}
        disabled={safePage === 1}
        className={paginationButtonClass}
        aria-label="First page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setPage((current) => Math.max(1, current - 1))}
        disabled={safePage === 1}
        className={paginationButtonClass}
        aria-label="Previous page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="whitespace-nowrap px-2.5 py-1 text-sm text-gray-700 dark:text-[var(--text-200)]">
        Page {safePage} of {pageCount}
      </span>
      <button
        type="button"
        onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
        disabled={safePage === pageCount}
        className={paginationButtonClass}
        aria-label="Next page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setPage(pageCount)}
        disabled={safePage === pageCount}
        className={paginationButtonClass}
        aria-label="Last page"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )

  const rowsPerPageBar = (
    <div className="flex flex-col gap-3 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-[var(--text-200)]">
        <span>Rows per page:</span>
        <select
          value={pageSize}
          onChange={(event) => handlePageSizeChange(Number(event.target.value))}
          className="cursor-pointer rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span className="ml-1">
          {listTotal === 0 ? '0–0 of 0' : `${startItem}–${endItem} of ${listTotal.toLocaleString()}`}
        </span>
      </div>
      {paginationArrows}
    </div>
  )

  return (
    <>
      {listTotal > 0 && (
        <div className="border-b border-[var(--bg-300)] bg-[var(--bg-200)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)]">
          {rowsPerPageBar}
        </div>
      )}

      <div className="hh-table-scroll">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-200)] text-xs uppercase tracking-wide text-slate-500 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]">
            <tr className="text-left">
              <Th>
                <HeaderLabel icon={<ClockIcon className="h-3.5 w-3.5" />} text="Date Created" />
              </Th>
              <Th>
                <HeaderLabel icon={<UserIcon className="h-3.5 w-3.5" />} text="Created by" />
              </Th>
              <Th>
                <HeaderLabel icon={<NotesIcon className="h-3.5 w-3.5" />} text="Notes" />
              </Th>
              <Th className="text-center">
                <span className="inline-flex flex-col items-center gap-1">
                  <HeaderLabel className="justify-center" icon={<StatusIcon className="h-3.5 w-3.5" />} text="Progress" />
                  <HHBatchProgressLabels />
                </span>
              </Th>
              <Th>
                <HeaderLabel icon={<EyeIcon className="h-3.5 w-3.5" />} text="Orders" />
              </Th>
              <HHRowActionsHeader />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-[13px] dark:divide-[var(--bg-300)]">
            {loadState === 'loading' ? (
              <tr>
                <Td colSpan={6} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  Loading groups…
                </Td>
              </tr>
            ) : loadState === 'error' ? (
              <tr>
                <Td colSpan={6} className="py-10 text-center text-sm text-slate-500 dark:text-[var(--text-200)]">
                  <p>{loadError || 'Failed to load groups.'}</p>
                  <button
                    type="button"
                    onClick={reload}
                    className="mt-2 cursor-pointer text-sm font-medium text-[var(--accent-100)] hover:underline dark:text-[var(--accent-200)]"
                  >
                    Try again
                  </button>
                </Td>
              </tr>
            ) : paginated.length === 0 ? (
              <tr>
                <Td colSpan={6} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  {selectedDetailsStatus || selectedCartStatus
                    ? searchInput.trim()
                      ? `No groups match "${searchInput.trim()}" with ${hhFilterSummary(selectedDetailsStatus, selectedCartStatus)}.`
                      : `No groups with ${hhFilterSummary(selectedDetailsStatus, selectedCartStatus)}.`
                    : searchInput.trim()
                      ? `No groups match "${searchInput.trim()}".`
                      : 'No groups yet. Import orders to create a batch.'}
                </Td>
              </tr>
            ) : (
              paginated.map((group, idx) => {
                const orderCount = group.children.length
                const deleteLocked = hhGroupHasPlaced(group)
                const mutateLocked = hhGroupAllPlaced(group)
                const canDraft = hhDraftableOrders(group.children).length > 0
                return (
                  <HHActionRow
                    key={group.id}
                    rowId={group.id}
                    className={idx % 2 === 1 ? 'hh-row-alt' : ''}
                    open={openId === group.id}
                    exiting={exitingId === group.id}
                    onExitEnd={() => finishExit(group.id)}
                  >
                    <Td compact className="whitespace-nowrap text-slate-600 dark:text-[var(--text-100)]">
                      <span className="inline-flex items-center gap-1.5">
                        {formatCreatedAt(group.createdAt)}
                        <HHCopyIdButton value={group.id} title="Copy batch ID" />
                      </span>
                    </Td>
                    <Td compact className="max-w-[260px]">
                      <p className="truncate font-medium text-slate-800 dark:text-[var(--text-100)]">
                        {group.createdByName}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-[var(--text-200)]">
                        {group.createdByEmail}
                      </p>
                    </Td>
                    <Td compact className="max-w-[22rem]">
                      <HHNotesField
                        groupId={group.id}
                        notes={group.notes}
                        sourceFileName={group.sourceFileName}
                      />
                    </Td>
                    <Td compact className="text-center">
                      <HHBatchProgress orders={group.children} />
                    </Td>
                    <Td compact>
                      <Link
                        to={`${brandPath}/${group.id}`}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-[var(--accent-100)] hover:underline dark:text-[var(--accent-200)]"
                      >
                        <EyeIcon className="h-3.5 w-3.5" />
                        View orders ({orderCount})
                      </Link>
                    </Td>
                    <HHRowActions
                      open={openId === group.id}
                      onToggle={() => toggle(group.id)}
                    >
                      <HHResyncButton
                        size="sm"
                        title={hhGroupDetailsTitle(group.children)}
                        disabled={mutateLocked}
                        busy={resyncBusyId === group.id}
                        onClick={() => setPendingAction({ type: 'resync', target: 'group', group })}
                      />
                      <HHRedraftButton
                        size="sm"
                        title={hhGroupDraftTitle(group.children)}
                        disabled={mutateLocked || !canDraft}
                        busy={cartDraftBusyId === group.id}
                        onClick={() => setPendingAction({ type: 'redraft', target: 'group', group })}
                      />
                      {hhPlaceableOrders(group.children).length > 0 ? (
                        <HHPlaceButton
                          size="sm"
                          title={hhPlaceActionTitle(placeOrderEnabled)}
                          busy={placeBusyId === group.id}
                          onClick={() => setPendingAction({ type: 'place', target: 'group', group })}
                        />
                      ) : null}
                      <DeleteBatchButton
                        size="sm"
                        title={deleteLocked ? 'This batch has a placed order and cannot be deleted' : 'Delete'}
                        disabled={deleteLocked}
                        onClick={() => setPendingAction({ type: 'delete', target: 'group', group })}
                      />
                    </HHRowActions>
                  </HHActionRow>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {listTotal > 0 && (
        <div className="border-t border-[var(--bg-300)] bg-[var(--bg-200)] dark:border-[var(--bg-300)] dark:bg-transparent">
          {rowsPerPageBar}
        </div>
      )}

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
          onConfirm={(options) => {
            if (actionBusy || pendingAction.target !== 'group') return
            const pending = pendingAction
            const groupId = pending.group.id
            setActionBusy(true)
            setActionError(null)

            if (pending.type === 'delete') {
              deleteHHGroup(brand, groupId)
                .then(() => {
                  setPendingAction(null)
                  setActionError(null)
                  close()
                  beginExit(groupId)
                })
                .catch((error: unknown) => {
                  setActionError(error instanceof Error ? error.message : 'Failed to delete group')
                })
                .finally(() => setActionBusy(false))
              return
            }

            const request =
              pending.type === 'resync'
                ? rerunDetails(groupId, undefined, { draftCart: options?.draftCart !== false })
                : pending.type === 'place'
                  ? placeOrders(groupId)
                  : rerunCartDraft(groupId)
            request
              .then(() => {
                setPendingAction(null)
                setActionError(null)
              })
              .catch((error: unknown) => {
                setActionError(
                  error instanceof Error
                    ? error.message
                    : pending.type === 'resync'
                      ? 'Failed to sync details'
                    : pending.type === 'place'
                      ? 'Failed to place orders'
                      : 'Failed to draft cart',
                )
              })
              .finally(() => setActionBusy(false))
          }}
        />
      )}
    </>
  )
}
