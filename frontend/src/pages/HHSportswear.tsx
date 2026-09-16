import { useState } from 'react'
import { Link } from 'react-router-dom'
import { HHActionRow, HHCartBadge, HHConfirmDeleteModal, HHDetailsBadge, HHResyncButton, HHRowActions, HHRowActionsHeader, useHHOpenRow, useHHRowExit } from '../components/hh/hhUi'
import type { HHPendingDelete } from '../components/hh/hhUi'
import { useHHList } from '../context/HHListContext'
import { HHNotesField } from '../components/hh/HHNotesField'
import { deleteHHGroup, formatCreatedAt, hhFilterSummary } from '../lib/hhSportswear'
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
  } = useHHList()
  const [pendingDelete, setPendingDelete] = useState<HHPendingDelete | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
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

      <div className="overflow-x-auto">
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
              <Th>
                <HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Details" />
              </Th>
              <Th>
                <HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Cart" />
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
                <Td colSpan={7} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  Loading groups…
                </Td>
              </tr>
            ) : loadState === 'error' ? (
              <tr>
                <Td colSpan={7} className="py-10 text-center text-sm text-slate-500 dark:text-[var(--text-200)]">
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
                <Td colSpan={7} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  {selectedDetailsStatus || selectedCartStatus
                    ? searchInput.trim()
                      ? `No groups match "${searchInput.trim()}" with ${hhFilterSummary(selectedDetailsStatus, selectedCartStatus)}.`
                      : `No groups with ${hhFilterSummary(selectedDetailsStatus, selectedCartStatus)}.`
                    : searchInput.trim()
                      ? `No groups match "${searchInput.trim()}".`
                      : 'No groups yet. Import a spreadsheet to create a batch.'}
                </Td>
              </tr>
            ) : (
              paginated.map((group, idx) => {
                const orderCount = group.children.length
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
                      {formatCreatedAt(group.createdAt)}
                    </Td>
                    <Td compact className="max-w-[260px]">
                      <p className="truncate font-medium text-slate-800 dark:text-[var(--text-100)]">
                        {group.createdByName}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-[var(--text-200)]">
                        {group.createdByEmail}
                      </p>
                    </Td>
                    <Td compact className="max-w-md">
                      <HHNotesField
                        groupId={group.id}
                        notes={group.notes}
                        sourceFileName={group.sourceFileName}
                      />
                    </Td>
                    <Td compact>
                      <HHDetailsBadge status={group.detailsStatus} />
                    </Td>
                    <Td compact>
                      <HHCartBadge status={group.cartStatus} />
                    </Td>
                    <Td compact>
                      <Link
                        to={`/ordering/hh-sportswear/${group.id}`}
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
                        title="Re-sync details for this batch"
                        busy={resyncBusyId === group.id}
                        onClick={() => {
                          void rerunDetails(group.id)
                        }}
                      />
                      <DeleteBatchButton
                        size="sm"
                        title="Delete"
                        onClick={() => setPendingDelete({ kind: 'group', group })}
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
          onConfirm={() => {
            if (pendingDelete.kind !== 'group' || deleteBusy) return
            const groupId = pendingDelete.group.id
            setDeleteBusy(true)
            setDeleteError(null)
            deleteHHGroup(groupId)
              .then(() => {
                setPendingDelete(null)
                close()
                beginExit(groupId)
              })
              .catch((error: unknown) => {
                setDeleteError(error instanceof Error ? error.message : 'Failed to delete group')
              })
              .finally(() => {
                setDeleteBusy(false)
              })
          }}
        />
      )}
    </>
  )
}
