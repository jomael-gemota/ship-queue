import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { authApi } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import {
  Banner,
  DocumentTypeBadge,
  PaginationArrows,
  ParseProgressBadge,
  ParseStatusChip,
  Spinner,
  Th,
  avatarColour,
} from '../components/docTidy/docTidyUi'
import { ErrorIcon, SuccessIcon } from '../components/labels/labelUi'
import AttachmentIcons from '../components/docTidy/AttachmentIcons'
import { PARSEABLE } from '../components/docTidy/AttachmentCell'
import MessageDetailDrawer from '../components/docTidy/MessageDetailDrawer'
import ParseJobPanel from '../components/docTidy/ParseJobPanel'
import VendorSetup from '../components/docTidy/VendorSetup'
import WorkspaceRulesView from './DocTidyRules'
import WorkspaceVendorsView from './DocTidyVendors'
import { formatDate, formatDateTime } from '../lib/format'
import { Tooltip } from '../components/Tooltip'
import { subscribeDocTidyEvents } from '../lib/docTidyStore'
import {
  INVOICE_AUDIT_COLUMNS,
  WORKSPACE_EMAIL_COLUMNS,
  DEFAULT_AUDIT_COL_ORDER,
  DEFAULT_EMAIL_COL_ORDER,
  PAGE_SIZE_OPTIONS,
  loadAuditColumnVisibility,
  saveAuditColumnVisibility,
  loadCollapsedWeeks,
  saveCollapsedWeeks,
  extractJsonField,
  extractJsonArray,
  documentTypeOf,
  DOCUMENT_TYPE_LABELS,
  PARSE_STATUS_LABELS,
  type DocTidyMessage,
  type DocTidyMessagesResponse,
  type DocTidyWorkspace,
  type DocTidyEmailSource,
  type DocTidyOrganization,
  type InvoiceAuditColumn,
  type InvoiceAuditColumnId,
  type WorkspaceEmailColumn,
  type WorkspaceEmailColumnId,
  type ParseJobListItem,
  type ParseJobsResponse,
  type PdfImport,
  type PdfImportColumn,
  type PdfImportColumnId,
  PDF_IMPORT_COLUMNS,
  DEFAULT_PDF_IMPORT_COL_ORDER,
  isParseRunning,
  type ParseJobStatus,
  type DocTidyOrderImport,
  type OrderImportsResponse,
  type RunAllResult,
  type DocTidyConfig,
} from '../types/docTidy'

/**
 * How long an SSE-triggered refetch waits for the stream to go quiet.
 *
 * A bulk parse emits a status event per job per transition, and each one used to
 * fire its own full list request. 400ms collapses a whole wave into one.
 */
const SSE_REFETCH_DEBOUNCE_MS = 400

/** Trailing-edge debounce that always calls the latest `run`. */
function useDebouncedRefetch(run: () => void, delay = SSE_REFETCH_DEBOUNCE_MS): () => void {
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run })

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      runRef.current()
    }, delay)
  }, [delay])
}

/** Sentinel used in column filter sets to represent empty / blank cells. */
const BLANK_SENTINEL = '__BLANK__'

/* ──────────────────── Invoice match helpers ── */

/**
 * Normalise a string for PO # or SKU matching:
 * lowercase, strip whitespace / # / - / _ separators.
 */
function normForMatch(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/[\s#_-]+/g, '')
}

/**
 * Normalise a SKU for matching.
 *
 * On top of the standard normForMatch transforms, strips warehouse/variant
 * decorations that appear on order-import SKUs but not on supplier invoices:
 *  • Leading  "DUP-" or "DUP_"  prefix (case-insensitive)
 *  • Trailing "-V2"  or "_V2"   suffix (case-insensitive)
 *
 * This lets "DUP-ABC123-V2" match the invoice SKU "ABC123" without changing
 * the values that are displayed in the discrepancy tooltip.
 */
function normSkuForMatch(s: string): string {
  const stripped = (s ?? '').trim()
    .replace(/^DUP[-_]/i, '')   // strip leading DUP- / DUP_
    .replace(/[-_]V2$/i, '')    // strip trailing -V2 / _V2
  return normForMatch(stripped)
}

/**
 * The result of matching one `DocTidyOrderImport` row to a parsed invoice.
 * `item` is `null` when the invoice has no line items (document-level only).
 */
interface InvoiceMatch {
  job: ParseJobListItem
  item: Record<string, unknown> | null
}

/**
 * Find **all** parse jobs that match a given order import (PO # + SKU).
 *
 * Matching strategy:
 *  1. PO # from the job's `jsonOutput` normalises equal to `order.poNumber`.
 *  2. If `order.orderSku` is non-empty, the line-item SKU must also match.
 *     — If the job has no line items the PO match alone is accepted.
 *  3. If `order.orderSku` is blank (PO-only import), a PO match alone is
 *     sufficient even when the invoice has line items. Document-level fields
 *     are used; line-item fields will be empty.
 *
 * Returns all matching jobs so split-shipment invoices are all represented.
 * The caller aggregates the array for display (summed qty, joined invoice #s).
 */
function findAllInvoiceMatches(
  order: DocTidyOrderImport,
  jobs: ParseJobListItem[]
): InvoiceMatch[] {
  const normPo  = normForMatch(order.poNumber)
  const normSku = normSkuForMatch(order.orderSku)
  if (!normPo) return []

  const matches: InvoiceMatch[] = []

  for (const job of jobs) {
    const json = job.jsonOutput ?? null
    const jobPo = normForMatch(
      extractJsonField(json,
        'po_number', 'purchase_order_number', 'po_no', 'po',
        'purchase_order', 'order_number', 'order_no'
      )
    )
    if (!jobPo || jobPo !== normPo) continue

    const lineItems = extractJsonArray(json,
      'line_items', 'items', 'products', 'line items',
      'lineItems', 'order_items', 'orderItems'
    )

    if (lineItems.length === 0) {
      // No line items — PO match alone is sufficient
      matches.push({ job, item: null })
      continue
    }

    if (!normSku) {
      // PO-only import — accept a PO match regardless of line items
      matches.push({ job, item: null })
      continue
    }

    for (const item of lineItems) {
      const itemSku = normSkuForMatch(
        extractJsonField(item,
          'sku', 'part_number', 'part_no', 'item_code',
          'product_code', 'sku_number'
        )
      )
      if (itemSku === normSku) {
        matches.push({ job, item })
        break   // one match per job (same SKU won't appear twice in one invoice)
      }
    }
  }

  return matches
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/* ──────────────────────── Column-order merge helper ── */

/**
 * Merge a user's saved column order with the current default order.
 *
 * - Existing columns stay in the user's position.
 * - New columns (absent from the saved order) are inserted at their
 *   natural position in `defaults`, not appended at the far right.
 *   This prevents new columns from ending up hidden off-screen after
 *   a schema update.
 */
function mergeColOrder(stored: string[], defaults: string[]): string[] {
  const storedSet = new Set(stored)
  const newCols = defaults.filter((id) => !storedSet.has(id))
  if (newCols.length === 0) return stored

  const result = [...stored]
  for (const newId of newCols) {
    const defaultIdx = defaults.indexOf(newId)
    // Walk backwards in the default order to find the nearest predecessor
    // that already exists in the result array, then insert after it.
    let insertAfter = -1
    for (let i = defaultIdx - 1; i >= 0; i--) {
      const idx = result.indexOf(defaults[i])
      if (idx !== -1) { insertAfter = idx; break }
    }
    result.splice(insertAfter + 1, 0, newId)
  }
  return result
}

/* ──────────────────────────────── Drag-reorder helpers ── */

/** Moves `src` to the position of `dst` in-place order. */
function reorderCols<T>(arr: T[], src: T, dst: T): T[] {
  if (src === dst) return arr
  const next = arr.filter((x) => x !== src)
  const dstIdx = next.indexOf(dst)
  if (dstIdx === -1) return arr
  next.splice(dstIdx, 0, src)
  return next
}

/**
 * A table header cell that supports drag-to-reorder.
 * The fixed checkbox and actions columns are not wrapped with this.
 */
function DraggableTh({
  label,
  iconPath,
  align = 'left',
  isDragging,
  isDragTarget,
  hasActiveFilter,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onFilterClick,
}: {
  label: string
  iconPath?: string
  align?: 'left' | 'center' | 'right'
  isDragging?: boolean
  isDragTarget?: boolean
  hasActiveFilter?: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onFilterClick?: (rect: DOMRect) => void
}) {
  const textAlign =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const flexAlign =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''

  return (
    <th
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver() }}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      onDragEnd={onDragEnd}
      // Right-side column separator is an inline-style inset box-shadow instead of
      // border-r.  Inline styles survive Chrome's GPU re-compositing after tbody
      // content changes (skeleton → real rows), whereas Tailwind-generated CSS classes
      // can be dropped from the repainted layer.  When dragging, the separator is
      // replaced by a sky-blue inset ring drawn in the same property.
      style={{
        boxShadow: isDragging
          ? 'inset 0 0 0 2px rgb(56 189 248)' // sky-400 drag ring
          : 'inset -1px 0 0 var(--bg-300)',    // column separator
      }}
      className={[
        'sticky top-0 z-20 border-b border-b-[var(--bg-300)]',
        'px-3 py-1 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap select-none',
        'transition-all duration-100',
        textAlign,
        // ── Drag source: tinted background + opacity so it's obvious what's being moved
        isDragging
          ? 'opacity-60 cursor-grabbing bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300'
          : 'cursor-grab bg-[var(--bg-200)] text-slate-700 dark:text-[var(--text-200)]',
        // ── Drop target: thick sky-blue left bar as an insertion indicator
        isDragTarget
          ? 'border-l-[3px] border-l-sky-400 bg-sky-50 dark:bg-sky-500/10'
          : '',
      ].join(' ')}
    >
      <span className={`flex items-center gap-1 ${flexAlign}`}>
        {/* Six-dot drag handle */}
        <svg
          className={`h-3 w-3 shrink-0 ${isDragging ? 'text-sky-500' : 'text-slate-300 dark:text-[var(--bg-300)]'}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="6" cy="4" r="1.5" />
          <circle cx="14" cy="4" r="1.5" />
          <circle cx="6" cy="10" r="1.5" />
          <circle cx="14" cy="10" r="1.5" />
          <circle cx="6" cy="16" r="1.5" />
          <circle cx="14" cy="16" r="1.5" />
        </svg>
        {iconPath && (
          <svg
            className={`h-3.5 w-3.5 shrink-0 ${isDragging ? 'text-sky-500' : 'text-slate-400 dark:text-[var(--text-200)]'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
          </svg>
        )}
        <span className="flex-1 min-w-0">{label}</span>
        {/* Column filter button — shown for every draggable column */}
        {onFilterClick && (
          <button
            type="button"
            draggable={false}
            onDragStart={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onFilterClick(e.currentTarget.getBoundingClientRect())
            }}
            title={hasActiveFilter ? 'Filtered — click to edit' : 'Filter column'}
            className={[
              'shrink-0 rounded p-0.5 transition-colors cursor-pointer',
              hasActiveFilter
                ? 'text-[var(--accent-200)]'
                : 'text-slate-300 dark:text-[var(--bg-300)] hover:text-slate-500 dark:hover:text-[var(--text-200)]',
            ].join(' ')}
          >
            {hasActiveFilter ? (
              /* Solid funnel when filter is active */
              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 01.707 1.707L13 9.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-7.586L3.293 5.707A1 1 0 013 5V3z" clipRule="evenodd" />
              </svg>
            ) : (
              /* Outline funnel when no filter */
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 01.707 1.707L14 11.414V19a1 1 0 01-.553.894l-4 2A1 1 0 018 21v-9.586L3.293 5.707A1 1 0 013 5V4z" />
              </svg>
            )}
          </button>
        )}
      </span>
    </th>
  )
}

/* ──────────────────────────────── Column Filter Dropdown ── */

/**
 * Excel-style per-column filter dropdown.
 * Shows all unique values for the column (from the current page) with checkboxes.
 * A special "(Blank)" entry lets users filter for empty/null cells.
 */
function ColumnFilterDropdown({
  allValues,
  activeFilter,
  anchorRect,
  onApply,
  onClose,
}: {
  allValues: Map<string, number>
  activeFilter: Set<string> | null | undefined
  anchorRect: DOMRect
  onApply: (values: Set<string> | null) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() =>
    activeFilter ? new Set(activeFilter) : new Set()
  )
  const dropdownRef = useRef<HTMLDivElement>(null)

  /* Close on Escape or outside click */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  /* Split values: blank count + sorted non-blank entries */
  const { blankCount, nonBlank } = useMemo(() => {
    const blankCnt = allValues.get('') ?? 0
    const nonBlankEntries = Array.from(allValues.entries())
      .filter(([v]) => v !== '')
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    return { blankCount: blankCnt, nonBlank: nonBlankEntries }
  }, [allValues])

  /* Filter the non-blank list by search query */
  const filteredNonBlank = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return nonBlank
    return nonBlank.filter(([v]) => v.toLowerCase().includes(q))
  }, [nonBlank, search])

  /* All items currently visible in the list (for Select All logic) */
  const visibleItems = useMemo<string[]>(() => {
    const items: string[] = []
    if (!search.trim() && blankCount > 0) items.push(BLANK_SENTINEL)
    for (const [v] of filteredNonBlank) items.push(v)
    return items
  }, [search, blankCount, filteredNonBlank])

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((v) => selected.has(v))
  const someVisibleSelected = visibleItems.some((v) => selected.has(v))

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const v of visibleItems) next.delete(v)
      } else {
        for (const v of visibleItems) next.add(v)
      }
      return next
    })
  }

  const toggle = (v: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }

  const apply = () => {
    onApply(selected.size > 0 ? new Set(selected) : null)
    onClose()
  }

  const clear = () => {
    onApply(null)
    onClose()
  }

  /* Position the dropdown below (or above if near bottom) the anchor */
  const dropdownWidth = 240
  const left = Math.min(anchorRect.left, window.innerWidth - dropdownWidth - 8)
  const spaceBelow = window.innerHeight - anchorRect.bottom
  const top = spaceBelow < 280 ? anchorRect.top - 4 - 320 : anchorRect.bottom + 4

  return (
    <div
      ref={dropdownRef}
      style={{ position: 'fixed', top, left, width: dropdownWidth, zIndex: 9999 }}
      className="rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl overflow-hidden text-[10px] flex flex-col"
    >
      {/* Search */}
      <div className="px-2.5 py-2 border-b border-[var(--bg-300)]">
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search values…"
          className="w-full rounded-md border border-[var(--bg-300)] bg-[var(--bg-200)] px-2.5 py-1.5 text-[10px] text-[var(--text-100)] placeholder-[var(--text-200)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-200)]"
        />
      </div>

      {/* Select All row */}
      <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-200)] border-b border-[var(--bg-300)]">
        <input
          type="checkbox"
          checked={allVisibleSelected}
          ref={(el) => {
            if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected
          }}
          onChange={toggleSelectAll}
          className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-200)]"
        />
        <span className="font-semibold text-[var(--text-100)]">(Select All)</span>
      </label>

      {/* Values list */}
      <div className="max-h-56 overflow-y-auto">
        {/* Blank option */}
        {!search.trim() && blankCount > 0 && (
          <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-200)]">
            <input
              type="checkbox"
              checked={selected.has(BLANK_SENTINEL)}
              onChange={() => toggle(BLANK_SENTINEL)}
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-200)]"
            />
            <span className="italic text-[var(--text-200)] flex-1">(Blank)</span>
            <span className="text-[var(--text-200)] tabular-nums">{blankCount}</span>
          </label>
        )}
        {filteredNonBlank.map(([val, count]) => (
          <label key={val} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-200)]">
            <input
              type="checkbox"
              checked={selected.has(val)}
              onChange={() => toggle(val)}
              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent-200)]"
            />
            <span className="truncate text-[var(--text-100)] flex-1" title={val}>{val}</span>
            <span className="text-[var(--text-200)] tabular-nums shrink-0">{count}</span>
          </label>
        ))}
        {visibleItems.length === 0 && (
          <div className="px-3 py-4 text-center italic text-[var(--text-200)]">No matching values</div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-3 py-2">
        <button
          type="button"
          onClick={clear}
          className="cursor-pointer text-[10px] text-[var(--text-200)] hover:text-rose-500 hover:underline"
        >
          Clear filter
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-[var(--bg-300)] px-2.5 py-1 text-[10px] text-[var(--text-200)] hover:bg-[var(--bg-300)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="cursor-pointer rounded-lg bg-[var(--accent-200)] px-2.5 py-1 text-[10px] font-medium text-white"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────── Column Settings Drawer ── */

/** Reusable section header for the column settings drawer. */
function DrawerSectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)]">{label}</p>
    </div>
  )
}

function ColumnSettingsDrawer({
  visibility,
  onChange,
  onClose,
}: {
  visibility: Record<InvoiceAuditColumnId, boolean>
  onChange: (next: Record<InvoiceAuditColumnId, boolean>) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const toggle = (id: InvoiceAuditColumnId) => onChange({ ...visibility, [id]: !visibility[id] })

  const resetDefaults = () => {
    const defaults = Object.fromEntries(
      INVOICE_AUDIT_COLUMNS.map((c) => [c.id, c.defaultVisible])
    ) as Record<InvoiceAuditColumnId, boolean>
    onChange(defaults)
  }

  const orderCols    = INVOICE_AUDIT_COLUMNS.filter((c) => c.section === 'order')
  const invoiceCols  = INVOICE_AUDIT_COLUMNS.filter((c) => c.section === 'invoice')
  const computedCols = INVOICE_AUDIT_COLUMNS.filter((c) => c.section === 'computed')

  const ColRow = ({ col }: { col: (typeof INVOICE_AUDIT_COLUMNS)[number] }) => (
    <li>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-[var(--bg-200)]">
        <input
          type="checkbox"
          checked={visibility[col.id]}
          onChange={() => toggle(col.id)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-[var(--accent-200)]"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-100)]">{col.label}</p>
          <p className="text-[10px] text-[var(--text-200)]">{col.description}</p>
        </div>
      </label>
    </li>
  )

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Column settings"
        className="relative ml-auto flex h-full w-full max-w-xs flex-col overflow-hidden border-l border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-100)]">Column visibility</h3>
            <p className="mt-0.5 text-xs text-[var(--text-200)]">Toggle which fields are shown in the table.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-1 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 📋 Order fields */}
          <div>
            <DrawerSectionHeader
              label="Order fields"
              icon={
                <svg className="h-3.5 w-3.5 text-sky-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              }
            />
            <ul className="space-y-1">
              {orderCols.map((col) => <ColRow key={col.id} col={col} />)}
            </ul>
          </div>

          {/* 🧾 Invoice fields */}
          <div>
            <DrawerSectionHeader
              label="Invoice fields"
              icon={
                <svg className="h-3.5 w-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
            />
            <ul className="space-y-1">
              {invoiceCols.map((col) => <ColRow key={col.id} col={col} />)}
            </ul>
          </div>

          {/* 🔍 Computed */}
          <div>
            <DrawerSectionHeader
              label="Computed"
              icon={
                <svg className="h-3.5 w-3.5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              }
            />
            <ul className="space-y-1">
              {computedCols.map((col) => <ColRow key={col.id} col={col} />)}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--bg-300)] bg-[var(--bg-200)] px-5 py-3">
          <button type="button" onClick={resetDefaults}
            className="cursor-pointer text-xs text-[var(--text-200)] hover:text-[var(--accent-200)] hover:underline">
            Reset to defaults
          </button>
          <button type="button" onClick={onClose}
            className="cursor-pointer rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────── Workspace editor dialog ── */

function WorkspaceEditorDialog({
  initial,
  onSave,
  onClose,
  initialOrgId,
}: {
  initial: DocTidyWorkspace | null
  onSave: (workspace: DocTidyWorkspace) => void
  onClose: () => void
  /** When creating a new workspace inside an org, pre-assign this org. */
  initialOrgId?: string
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [importMode, setImportMode] = useState<'full' | 'header-only'>(
    initial?.importMode ?? 'full'
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  /* ── Email sources (only for existing workspaces) ── */
  const [emailSources, setEmailSources] = useState<DocTidyEmailSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null)

  useEffect(() => {
    if (!initial) return
    setSourcesLoading(true)
    authApi
      .get<{ data: DocTidyEmailSource[] }>(`/doc-tidy/workspaces/${initial._id}/email-sources`)
      .then((res) => setEmailSources(res.data))
      .catch((err) => setSourcesError(err instanceof Error ? err.message : 'Failed to load email sources'))
      .finally(() => setSourcesLoading(false))
  }, [initial])

  const handleConnectEmailSource = async () => {
    if (!initial) return
    setConnecting(true)
    try {
      const res = await authApi.get<{ url: string }>(`/auth/doc-tidy/workspaces/${initial._id}/connect`)
      window.location.href = res.url
    } catch (err) {
      setSourcesError(err instanceof Error ? err.message : 'Failed to initiate connection')
      setConnecting(false)
    }
  }

  const handleDisconnectSource = async (sourceId: string) => {
    if (!initial) return
    setDeletingSourceId(sourceId)
    try {
      await authApi.delete(`/doc-tidy/workspaces/${initial._id}/email-sources/${sourceId}`)
      setEmailSources((prev) => prev.filter((s) => s._id !== sourceId))
    } catch (err) {
      setSourcesError(err instanceof Error ? err.message : 'Failed to remove email source')
    } finally {
      setDeletingSourceId(null)
    }
  }

  useEffect(() => {
    nameRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const submit = async () => {
    if (!name.trim()) { setError('Please enter a workspace name.'); return }
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { name: name.trim() }
      if (!initial && initialOrgId) body.organizationId = initialOrgId
      // importMode is editable by all users, both when creating and editing a workspace.
      body.importMode = importMode
      let result: { data: DocTidyWorkspace }
      if (initial) {
        result = await authApi.put<{ data: DocTidyWorkspace }>(`/doc-tidy/workspaces/${initial._id}`, body)
      } else {
        result = await authApi.post<{ data: DocTidyWorkspace }>('/doc-tidy/workspaces', body)
      }
      onSave(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workspace')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl"
        style={{ maxHeight: 'min(80vh, 640px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-6 py-5">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-100)]">
              {initial ? 'Edit workspace' : 'New workspace'}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-200)]">
              {initial
                ? 'Rename this workspace. Rules are managed from the Rules tab inside the workspace.'
                : 'Give your workspace a name. You\'ll add rules from inside the workspace.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

          {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)] mb-1.5">
              Workspace name
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="e.g. Acme Invoices, Q3 Orders…"
              className="w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-3.5 py-2.5 text-sm text-gray-900 dark:text-[var(--text-100)] placeholder-[var(--text-200)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]"
            />
          </div>

          {/* Import mode — visible for all users, both when creating and editing */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)] mb-1.5">
              Import mode
            </label>
            <div className="flex rounded-lg border border-[var(--bg-300)] overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setImportMode('full')}
                className={`flex-1 px-4 py-2.5 text-left transition-colors cursor-pointer ${
                  importMode === 'full'
                    ? 'bg-[var(--accent-200)] text-white font-medium'
                    : 'bg-[var(--bg-100)] text-[var(--text-100)] hover:bg-[var(--bg-200)]'
                }`}
              >
                <span className="block font-medium">Full import</span>
                <span className={`block text-[10px] mt-0.5 ${importMode === 'full' ? 'text-white/80' : 'text-[var(--text-200)]'}`}>
                  All fields; PO # + SKU matching
                </span>
              </button>
              <button
                type="button"
                onClick={() => setImportMode('header-only')}
                className={`flex-1 px-4 py-2.5 text-left border-l border-[var(--bg-300)] transition-colors cursor-pointer ${
                  importMode === 'header-only'
                    ? 'bg-[var(--accent-200)] text-white font-medium'
                    : 'bg-[var(--bg-100)] text-[var(--text-100)] hover:bg-[var(--bg-200)]'
                }`}
              >
                <span className="block font-medium">Header only</span>
                <span className={`block text-[10px] mt-0.5 ${importMode === 'header-only' ? 'text-white/80' : 'text-[var(--text-200)]'}`}>
                  PO # only required; PO-level matching
                </span>
              </button>
            </div>
            {importMode === 'header-only' && (
              <p className="mt-1.5 text-[10px] text-[var(--text-200)]">
                Line-item columns (SKU, Qty, Item Cost, Discrepancy) will be hidden by default for this workspace.
              </p>
            )}
          </div>

          {/* Email Sources — only shown when editing an existing workspace */}
          {initial && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
                  Email sources
                </label>
                <button
                  type="button"
                  onClick={() => void handleConnectEmailSource()}
                  disabled={connecting}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-1.5 text-xs text-[var(--text-100)] hover:bg-[var(--bg-200)] disabled:opacity-60"
                >
                  {connecting ? (
                    <Spinner className="h-3 w-3 text-[var(--text-200)]" />
                  ) : (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  )}
                  {connecting ? 'Redirecting…' : 'Connect email account'}
                </button>
              </div>

              {sourcesLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-3.5 py-3 text-xs text-[var(--text-200)]">
                  <Spinner className="h-3.5 w-3.5 text-[var(--text-200)]" />
                  Loading…
                </div>
              ) : emailSources.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--bg-300)] px-3.5 py-3 text-xs text-[var(--text-200)]">
                  {'No email account connected. Click "Connect email account" to link a Gmail mailbox to this workspace. Rules in this workspace will not run until a source is connected.'}
                </div>
              ) : (
                <ul className="space-y-2">
                  {emailSources.map((src) => (
                    <li
                      key={src._id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-3.5 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[var(--text-100)]">
                          {src.emailAddress ?? '(unknown address)'}
                        </p>
                        {src.gmailConnectedAt && (
                          <p className="mt-0.5 text-[10px] text-[var(--text-200)]">
                            Connected {new Date(src.gmailConnectedAt).toLocaleDateString()}
                            {src.gmailConnectedByName ? ` by ${src.gmailConnectedByName}` : ''}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDisconnectSource(src._id)}
                        disabled={deletingSourceId === src._id}
                        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-1 text-[10px] text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-60"
                      >
                        {deletingSourceId === src._id ? (
                          <Spinner className="h-3 w-3 text-rose-500" />
                        ) : (
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        Disconnect
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {sourcesError && (
                <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 px-3.5 py-2 text-xs text-rose-600 dark:text-rose-400">
                  {sourcesError}
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-200)] px-6 py-4">
          <button type="button" onClick={onClose}
            className="cursor-pointer rounded-lg px-4 py-2 text-sm text-[var(--text-200)] hover:text-[var(--text-100)] hover:bg-[var(--bg-300)]">
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={saving}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {saving && <Spinner className="h-3.5 w-3.5 text-white" />}
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────── Workspace card ── */

function WorkspaceCard({
  workspace,
  onOpen,
  onEdit,
  onDelete,
  onMove,
  isAdmin = false,
}: {
  workspace: DocTidyWorkspace
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onMove?: () => void
  isAdmin?: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div onClick={onOpen}
      className="group flex flex-col rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] cursor-pointer transition-all hover:border-[var(--accent-100)] dark:hover:border-[var(--primary-200)] hover:shadow-md dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
      {/* Body */}
      <div className="flex-1 px-5 pt-5 pb-4">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-100)] dark:bg-[var(--bg-300)] text-[var(--accent-200)] dark:text-[var(--primary-300)]">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-[var(--text-100)] group-hover:text-[var(--accent-200)] dark:group-hover:text-[var(--primary-300)] transition-colors line-clamp-2">
          {workspace.name}
        </h3>
        <p className="mt-2 text-[10px] text-[var(--text-200)]">
          Open to manage rules, emails, and audit results.
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-[var(--bg-300)] px-5 py-3" onClick={(e) => e.stopPropagation()}>
        <span className="text-[10px] text-[var(--text-200)]">
          Created {new Date(workspace.createdAt).toLocaleDateString()}
        </span>
        <div className="flex items-center gap-1">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-rose-500">Delete?</span>
              <button onClick={onDelete} className="cursor-pointer rounded px-2 py-1 text-[10px] font-medium text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="cursor-pointer rounded px-2 py-1 text-[10px] text-[var(--text-200)] hover:bg-[var(--bg-300)]">No</button>
            </div>
          ) : (
            <>
              <button onClick={onEdit} className="cursor-pointer rounded px-2 py-1 text-[10px] text-[var(--text-200)] hover:bg-[var(--bg-300)] hover:text-[var(--text-100)]">Edit</button>
              {isAdmin && onMove && (
                <button onClick={onMove} className="cursor-pointer rounded px-2 py-1 text-[10px] text-[var(--text-200)] hover:bg-[var(--bg-300)] hover:text-[var(--text-100)]">Move</button>
              )}
              <button onClick={() => setConfirmDelete(true)} className="cursor-pointer rounded px-2 py-1 text-[10px] text-[var(--text-200)] hover:bg-[var(--bg-300)] hover:text-rose-500 dark:hover:text-rose-400">Delete</button>
              <button onClick={onOpen} className="cursor-pointer rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-3 py-1 text-[10px] font-medium text-white hover:opacity-80 transition-opacity">Open →</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────── Organization card ── */

function OrgCard({
  org,
  workspaceCount,
  onOpen,
  onEdit,
  onDelete,
  isAdmin = false,
  hasAccess = true,
}: {
  org: DocTidyOrganization
  workspaceCount: number
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  isAdmin?: boolean
  hasAccess?: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div
      onClick={hasAccess ? onOpen : undefined}
      className={`group relative flex items-center gap-4 rounded-xl border bg-[var(--bg-100)] dark:bg-[var(--bg-200)] overflow-hidden transition-all ${
        hasAccess
          ? 'border-[var(--bg-300)] cursor-pointer hover:border-violet-400 dark:hover:border-violet-500 hover:shadow-md dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)]'
          : 'border-[var(--bg-300)] cursor-not-allowed opacity-50 select-none'
      }`}
    >
      {/* Left accent stripe — violet when accessible, gray when locked */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${hasAccess ? 'bg-violet-500 dark:bg-violet-600' : 'bg-[var(--bg-300)]'}`} />

      {/* Icon */}
      <div className={`ml-5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${hasAccess ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400' : 'bg-[var(--bg-200)] dark:bg-[var(--bg-300)] text-[var(--text-200)]'}`}>
        {hasAccess ? (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        ) : (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 py-4 pr-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className={`text-sm font-semibold transition-colors ${hasAccess ? 'text-[var(--text-100)] group-hover:text-violet-600 dark:group-hover:text-violet-400' : 'text-[var(--text-200)]'}`}>
            {org.name}
          </h3>
          {/* No-access badge */}
          {!hasAccess && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-300)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-200)]">
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              No access
            </span>
          )}
          {/* Badge pills — only shown to members/admins */}
          {hasAccess && (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {org.memberUserIds.length} member{org.memberUserIds.length !== 1 ? 's' : ''}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-300)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-200)]">
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                {workspaceCount} workspace{workspaceCount !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>

        {/* Workspace name previews removed — keeps all rows uniform height */}
      </div>

      {/* Actions — only shown when the user has access (or is admin) */}
      <div
        className="flex items-center gap-1 pr-4 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-rose-500">Delete?</span>
            <button
              onClick={onDelete}
              className="cursor-pointer rounded px-2 py-1 text-[10px] font-medium text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="cursor-pointer rounded px-2 py-1 text-[10px] text-[var(--text-200)] hover:bg-[var(--bg-300)]"
            >
              No
            </button>
          </div>
        ) : (
          <>
            {isAdmin && (
              <>
                <button
                  onClick={onEdit}
                  className="cursor-pointer rounded px-2 py-1 text-[10px] text-[var(--text-200)] hover:bg-[var(--bg-300)] hover:text-[var(--text-100)]"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="cursor-pointer rounded px-2 py-1 text-[10px] text-[var(--text-200)] hover:bg-[var(--bg-300)] hover:text-rose-500 dark:hover:text-rose-400"
                >
                  Delete
                </button>
              </>
            )}
            {hasAccess && (
              <button
                onClick={onOpen}
                className="cursor-pointer rounded-lg bg-violet-600 dark:bg-violet-700 px-3 py-1.5 text-[10px] font-semibold text-white hover:opacity-80 transition-opacity whitespace-nowrap"
              >
                Open →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ──────────────────────────────── Organization editor dialog ── */

/** Slim user record returned by GET /doc-tidy/organizations/users */
interface OrgUserOption {
  _id: string
  name: string
  email: string
  avatar?: string
  role: string
}

function OrganizationEditorDialog({
  initial,
  onSave,
  onClose,
  workspaces,
  onWorkspaceMoved,
}: {
  initial: DocTidyOrganization | null
  onSave: (org: DocTidyOrganization) => void
  onClose: () => void
  /** All workspaces — used in the Workspaces tab for in-org and unassigned lists. */
  workspaces: DocTidyWorkspace[]
  /** Called after a workspace's organizationId is changed from within the dialog. */
  onWorkspaceMoved: (updated: DocTidyWorkspace) => void
}) {
  type Tab = 'settings' | 'workspaces'
  const [activeTab, setActiveTab] = useState<Tab>('settings')

  /* ── Settings tab state ── */
  const [name, setName] = useState(initial?.name ?? '')
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set(initial?.memberUserIds ?? []))
  const [users, setUsers] = useState<OrgUserOption[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  /* ── Workspaces tab state ── */
  const [wsMoving, setWsMoving] = useState<string | null>(null)     // id of ws being moved
  const [wsError, setWsError] = useState<string | null>(null)
  /** Which in-org workspace has the "Move to…" org picker expanded. */
  const [wsPickerOpen, setWsPickerOpen] = useState<string | null>(null)
  /** Which in-org workspace is showing the remove-confirmation panel. */
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  useEffect(() => {
    if (activeTab === 'settings') nameRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, activeTab])

  useEffect(() => {
    authApi
      .get<{ data: OrgUserOption[] }>('/doc-tidy/organizations/users')
      .then((res) => setUsers(res.data))
      .catch(() => setError('Could not load users'))
      .finally(() => setUsersLoading(false))
  }, [])

  /* ── Derived workspace lists (only relevant when editing an existing org) ── */
  const inOrgWorkspaces = initial
    ? workspaces.filter((w) => w.organizationId === initial._id)
    : []
  const unassignedWorkspaces = workspaces.filter((w) => !w.organizationId)

  const toggleMember = (userId: string) => {
    setMemberIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const submit = async () => {
    if (!name.trim()) { setError('Please enter an organization name.'); return }
    setSaving(true)
    setError(null)
    try {
      const body = { name: name.trim(), memberUserIds: Array.from(memberIds) }
      let result: { data: DocTidyOrganization }
      if (initial) {
        result = await authApi.put<{ data: DocTidyOrganization }>(`/doc-tidy/organizations/${initial._id}`, body)
      } else {
        result = await authApi.post<{ data: DocTidyOrganization }>('/doc-tidy/organizations', body)
      }
      onSave(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save organization')
    } finally {
      setSaving(false)
    }
  }

  /** Move a workspace to a new org (or unassign it). */
  const moveWorkspace = async (ws: DocTidyWorkspace, targetOrgId: string | null) => {
    setWsMoving(ws._id)
    setWsError(null)
    try {
      const result = await authApi.put<{ data: DocTidyWorkspace }>(
        `/doc-tidy/workspaces/${ws._id}`,
        { organizationId: targetOrgId }
      )
      onWorkspaceMoved(result.data)
      setWsPickerOpen(null)
      setConfirmRemoveId(null)
    } catch (err) {
      setWsError(err instanceof Error ? err.message : 'Failed to move workspace')
    } finally {
      setWsMoving(null)
    }
  }

  const allOrganizations = useRef<DocTidyOrganization[]>([])
  // We load orgs for the "move to another org" picker
  const [orgsForPicker, setOrgsForPicker] = useState<DocTidyOrganization[]>([])
  useEffect(() => {
    if (!initial) return
    authApi
      .get<{ data: DocTidyOrganization[] }>('/doc-tidy/organizations')
      .then((res) => {
        allOrganizations.current = res.data
        setOrgsForPicker(res.data.filter((o) => o._id !== initial._id))
      })
      .catch(() => {/* silently ignore */})
  }, [initial])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl"
        style={{ maxHeight: 'min(88vh, 720px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-6 py-5">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-100)]">
              {initial ? 'Edit organization' : 'New organization'}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-200)]">
              {initial
                ? 'Manage settings, members, and workspaces.'
                : 'Create a named organization to group workspaces and control access.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar — only shown when editing an existing org */}
        {initial && (
          <div className="flex border-b border-[var(--bg-300)] px-6">
            {(['settings', 'workspaces'] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={[
                  'cursor-pointer py-3 px-1 mr-5 text-xs font-semibold border-b-2 -mb-px transition-colors capitalize',
                  activeTab === tab
                    ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                    : 'border-transparent text-[var(--text-200)] hover:text-[var(--text-100)]',
                ].join(' ')}
              >
                {tab === 'workspaces'
                  ? `Workspaces (${inOrgWorkspaces.length})`
                  : 'Settings'}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Settings tab ── */}
          {activeTab === 'settings' && (
            <div className="space-y-5">
              {/* Name */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)] mb-1.5">
                  Organization name
                </label>
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void submit()}
                  placeholder="e.g. Outdoor Equipped, Operations Team…"
                  className="w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-3.5 py-2.5 text-sm text-gray-900 dark:text-[var(--text-100)] placeholder-[var(--text-200)] focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Members */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)] mb-1.5">
                  Members
                </label>
                <p className="text-[10px] text-[var(--text-200)] mb-2">
                  Checked users can view workspaces inside this organization. Admins always have access.
                </p>
                {usersLoading ? (
                  <div className="flex items-center gap-2 py-3 text-xs text-[var(--text-200)]">
                    <Spinner className="h-3.5 w-3.5" /> Loading users…
                  </div>
                ) : (
                  <div className="rounded-lg border border-[var(--bg-300)] overflow-hidden divide-y divide-[var(--bg-300)]" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                    {users.map((u) => {
                      const checked = memberIds.has(u._id)
                      return (
                        <label
                          key={u._id}
                          className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[var(--bg-200)] transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMember(u._id)}
                            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-violet-600"
                          />
                          <span
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                            style={{ backgroundColor: avatarColour(u.name) }}
                          >
                            {u.name.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[var(--text-100)] truncate">
                              {u.name}
                              {u.role === 'admin' && (
                                <span className="ml-1.5 text-[10px] text-violet-500 font-semibold">(admin)</span>
                              )}
                            </p>
                            <p className="text-[10px] text-[var(--text-200)] truncate">{u.email}</p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {error && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400">
                  {error}
                </p>
              )}
            </div>
          )}

          {/* ── Workspaces tab (edit mode only) ── */}
          {activeTab === 'workspaces' && initial && (
            <div className="space-y-6">
              {wsError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400">
                  {wsError}
                </p>
              )}

              {/* Workspaces currently in this org */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)] mb-2">
                  In this organization ({inOrgWorkspaces.length})
                </p>
                {inOrgWorkspaces.length === 0 ? (
                  <p className="text-xs text-[var(--text-200)] py-2">
                    No workspaces assigned to this organization yet. Add one from the unassigned list below.
                  </p>
                ) : (
                  <div className="rounded-lg border border-[var(--bg-300)] divide-y divide-[var(--bg-300)] overflow-hidden">
                    {inOrgWorkspaces.map((ws) => (
                      <div key={ws._id}>
                        {/* ── Main row ── */}
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <svg className="h-4 w-4 shrink-0 text-[var(--accent-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                          </svg>
                          <span className="flex-1 min-w-0 text-xs font-medium text-[var(--text-100)] truncate">{ws.name}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            {/* Move to another org — toggles inline picker below */}
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmRemoveId(null)
                                setWsPickerOpen(wsPickerOpen === ws._id ? null : ws._id)
                              }}
                              disabled={wsMoving === ws._id}
                              className={[
                                'cursor-pointer rounded px-2 py-1 text-[10px] hover:bg-[var(--bg-300)] disabled:opacity-40 transition-colors',
                                wsPickerOpen === ws._id
                                  ? 'bg-[var(--bg-300)] text-[var(--text-100)]'
                                  : 'text-[var(--text-200)] hover:text-[var(--text-100)]',
                              ].join(' ')}
                            >
                              Move to…
                            </button>
                            {/* Remove — toggles inline confirmation below */}
                            <button
                              type="button"
                              onClick={() => {
                                setWsPickerOpen(null)
                                setConfirmRemoveId(confirmRemoveId === ws._id ? null : ws._id)
                              }}
                              disabled={wsMoving === ws._id}
                              className={[
                                'cursor-pointer rounded px-2 py-1 text-[10px] disabled:opacity-40 transition-colors',
                                confirmRemoveId === ws._id
                                  ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
                                  : 'text-[var(--text-200)] hover:bg-[var(--bg-300)] hover:text-rose-500 dark:hover:text-rose-400',
                              ].join(' ')}
                            >
                              {wsMoving === ws._id ? '…' : 'Remove'}
                            </button>
                          </div>
                        </div>

                        {/* ── Inline org picker (fixes overflow clipping) ── */}
                        {wsPickerOpen === ws._id && (
                          <div className="border-t border-[var(--bg-300)] bg-[var(--bg-200)] px-4 py-3 space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)] mb-2">
                              Move to another organization:
                            </p>
                            {orgsForPicker.length === 0 ? (
                              <p className="text-xs text-[var(--text-200)]">No other organizations exist.</p>
                            ) : (
                              orgsForPicker.map((org) => (
                                <button
                                  key={org._id}
                                  type="button"
                                  onClick={() => void moveWorkspace(ws, org._id)}
                                  disabled={wsMoving === ws._id}
                                  className="w-full cursor-pointer text-left rounded-lg px-3 py-2 text-xs text-[var(--text-100)] hover:bg-[var(--bg-300)] disabled:opacity-40 transition-colors"
                                >
                                  {org.name}
                                </button>
                              ))
                            )}
                          </div>
                        )}

                        {/* ── Inline remove confirmation ── */}
                        {confirmRemoveId === ws._id && (
                          <div className="border-t border-[var(--bg-300)] bg-rose-50 dark:bg-rose-900/10 px-4 py-3">
                            <p className="text-xs text-[var(--text-100)] mb-2.5">
                              Remove <span className="font-semibold">{ws.name}</span> from this organization?
                              It will become unassigned and visible to all users.
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void moveWorkspace(ws, null)}
                                disabled={wsMoving === ws._id}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-rose-600 disabled:opacity-50"
                              >
                                {wsMoving === ws._id && <Spinner className="h-3 w-3 text-white" />}
                                {wsMoving === ws._id ? 'Removing…' : 'Yes, remove'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRemoveId(null)}
                                className="cursor-pointer rounded-lg px-3 py-1.5 text-[10px] text-[var(--text-200)] hover:bg-rose-100 dark:hover:bg-rose-900/20"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Unassigned workspaces — can be added to this org */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)] mb-2">
                  Unassigned workspaces ({unassignedWorkspaces.length})
                </p>
                {unassignedWorkspaces.length === 0 ? (
                  <p className="text-xs text-[var(--text-200)] py-2">
                    All workspaces are already assigned to an organization.
                  </p>
                ) : (
                  <div className="rounded-lg border border-[var(--bg-300)] divide-y divide-[var(--bg-300)] overflow-hidden">
                    {unassignedWorkspaces.map((ws) => (
                      <div key={ws._id} className="flex items-center gap-3 px-4 py-2.5">
                        <svg className="h-4 w-4 shrink-0 text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                        </svg>
                        <span className="flex-1 min-w-0 text-xs font-medium text-[var(--text-100)] truncate">{ws.name}</span>
                        <button
                          type="button"
                          onClick={() => void moveWorkspace(ws, initial._id)}
                          disabled={wsMoving === ws._id}
                          className="shrink-0 cursor-pointer rounded px-2 py-1 text-[10px] font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-40"
                        >
                          {wsMoving === ws._id ? '…' : 'Add to this org'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer — only show Save when on settings tab */}
        {activeTab === 'settings' && (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-200)] px-6 py-4">
            <button type="button" onClick={onClose}
              className="cursor-pointer rounded-lg px-4 py-2 text-sm text-[var(--text-200)] hover:text-[var(--text-100)] hover:bg-[var(--bg-300)]">
              Cancel
            </button>
            <button type="button" onClick={() => void submit()} disabled={saving || usersLoading}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 dark:bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {saving && <Spinner className="h-3.5 w-3.5 text-white" />}
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Create organization'}
            </button>
          </div>
        )}
        {activeTab === 'workspaces' && (
          <div className="flex items-center justify-end border-t border-[var(--bg-300)] bg-[var(--bg-200)] px-6 py-4">
            <button type="button" onClick={onClose}
              className="cursor-pointer rounded-lg px-4 py-2 text-sm text-[var(--text-200)] hover:text-[var(--text-100)] hover:bg-[var(--bg-300)]">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────── Move workspace dialog ── */

function MoveWorkspaceDialog({
  workspace,
  organizations,
  onSave,
  onClose,
}: {
  workspace: DocTidyWorkspace
  organizations: DocTidyOrganization[]
  onSave: (updated: DocTidyWorkspace) => void
  onClose: () => void
}) {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(workspace.organizationId ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await authApi.put<{ data: DocTidyWorkspace }>(
        `/doc-tidy/workspaces/${workspace._id}`,
        { organizationId: selectedOrgId ?? null }
      )
      onSave(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move workspace')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl"
        style={{ maxHeight: 'min(80vh, 560px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-6 py-5">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-100)]">Move workspace</h2>
            <p className="mt-0.5 text-xs text-[var(--text-200)]">
              Choose an organization for <span className="font-medium text-[var(--text-100)]">{workspace.name}</span>.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            {/* Unassigned option */}
            <label className="flex items-center gap-3 rounded-lg border border-[var(--bg-300)] px-4 py-3 cursor-pointer hover:bg-[var(--bg-200)] transition-colors">
              <input
                type="radio"
                name="orgPick"
                checked={selectedOrgId === null}
                onChange={() => setSelectedOrgId(null)}
                className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-violet-600"
              />
              <div>
                <p className="text-xs font-medium text-[var(--text-100)]">Unassigned</p>
                <p className="text-[10px] text-[var(--text-200)]">Visible to all users</p>
              </div>
            </label>

            {organizations.map((org) => (
              <label
                key={org._id}
                className="flex items-center gap-3 rounded-lg border border-[var(--bg-300)] px-4 py-3 cursor-pointer hover:bg-[var(--bg-200)] transition-colors"
              >
                <input
                  type="radio"
                  name="orgPick"
                  checked={selectedOrgId === org._id}
                  onChange={() => setSelectedOrgId(org._id)}
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-violet-600"
                />
                <div>
                  <p className="text-xs font-medium text-[var(--text-100)]">{org.name}</p>
                  <p className="text-[10px] text-[var(--text-200)]">
                    {org.memberUserIds.length} member{org.memberUserIds.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </label>
            ))}

            {organizations.length === 0 && (
              <p className="text-xs text-[var(--text-200)] py-2">No organizations exist yet. Create one first.</p>
            )}
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-200)] px-6 py-4">
          <button type="button" onClick={onClose}
            className="cursor-pointer rounded-lg px-4 py-2 text-sm text-[var(--text-200)] hover:text-[var(--text-100)] hover:bg-[var(--bg-300)]">
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={saving}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {saving && <Spinner className="h-3.5 w-3.5 text-white" />}
            {saving ? 'Moving…' : 'Move workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────── Line item cell helpers ── */

/* ────────────────── Audit cell value helpers ── */

/** Generic empty-dash cell. */
const emDash = <span className="text-[var(--text-200)]">—</span>

/** Text cell for codes / identifiers (SKU / PO # / invoice number). */
function monoCell(value: string): React.ReactNode {
  if (!value) return emDash
  return <span className="text-[10px] text-[var(--text-100)]">{value}</span>
}

/** Plain text cell. */
function textCell(value: string): React.ReactNode {
  if (!value) return emDash
  return <span className="text-[var(--text-100)]">{value}</span>
}

/** Numeric / currency cell. */
function numCell(value: string): React.ReactNode {
  if (!value) return emDash
  return <span className="tabular-nums text-[var(--text-100)]">{value}</span>
}

/** Extract a scalar from a line-item object (wraps extractJsonField). */
function liVal(item: Record<string, unknown> | null, ...candidates: string[]): string {
  if (!item) return ''
  return extractJsonField(item, ...candidates)
}

/** Minimal shape required by discount helpers — subset of resolveInvoiceFields return. */
type DiscountFields = { itemCost: string; discountedPrice: string; discountPct: string }

/**
 * Resolve the effective (post-discount) cost for COGS comparison and cell display.
 * Priority:
 *   1. discountedPrice — explicit after-discount price on the invoice.
 *   2. itemCost × (1 − discountPct/100) — computed when only a percentage is present.
 *   3. itemCost — raw price (no discount detected).
 */
function resolveEffectiveCost(inv: DiscountFields): string {
  if (inv.discountedPrice) return inv.discountedPrice

  if (inv.itemCost && inv.discountPct) {
    const costNum = parseFloat(inv.itemCost.replace(/[^0-9.-]/g, ''))
    const pctNum  = parseFloat(inv.discountPct.replace(/[^0-9.-]/g, ''))
    if (!isNaN(costNum) && !isNaN(pctNum) && pctNum > 0 && pctNum < 100) {
      const discounted = costNum * (1 - pctNum / 100)
      // Preserve dollar-sign prefix if the original had one.
      const prefix = inv.itemCost.trim().startsWith('$') ? '$' : ''
      return `${prefix}${discounted.toFixed(2)}`
    }
  }

  return inv.itemCost
}

/** True when the invoice has any discount signal (explicit price or percentage). */
function hasDiscount(inv: DiscountFields): boolean {
  return !!(inv.discountedPrice || inv.discountPct)
}

/**
 * Render the Discrepancy Checker cell.
 * Checks: Order SKU vs Invoice SKU, Order Qty vs Invoice Qty, Item Cost vs DC COGS.
 */
function discrepancyCell(
  order: DocTidyOrderImport,
  matches: InvoiceMatch[]
): React.ReactNode {
  // Use cached invoice data first; fall back to client-side matches.
  const inv = resolveInvoiceFields(order, matches)
  if (!inv.hasMatch) {
    return (
      <Tooltip trigger="click" richContent={
        <div className="px-3.5 py-3 space-y-1.5">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[10px] text-slate-400">–</span>
            <p className="text-[10px] font-semibold text-slate-300">No invoice matched</p>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Parse an invoice PDF containing this PO # to enable SKU, Qty, and COGS checks.
          </p>
        </div>
      }>
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-200)] italic underline decoration-dotted underline-offset-2">
          No match
        </span>
      </Tooltip>
    )
  }

  const invoiceSku    = inv.invoiceSku
  const invoiceQtyRaw = inv.invoiceQty
  // Use the effective (post-discount) cost for COGS validation so discounted
  // invoices don't produce false ✗ COGS mismatches.
  const effectiveCostRaw = resolveEffectiveCost(inv)

  const skuMatch  = normSkuForMatch(order.orderSku) === normSkuForMatch(invoiceSku)
  const qtyMatch  = normForMatch(order.orderQty) === normForMatch(invoiceQtyRaw)

  // COGS comparison: compare as floats (rounded to 2 dp) to handle minor formatting differences.
  const dcCogs = order.dcCogs && order.dcCogs !== 'n/a' ? order.dcCogs : null
  let cogsMatch: boolean | null = null
  if (dcCogs && effectiveCostRaw) {
    const costNum = parseFloat(effectiveCostRaw.replace(/[^0-9.-]/g, ''))
    const cogsNum = parseFloat(dcCogs.replace(/[^0-9.-]/g, ''))
    if (!isNaN(costNum) && !isNaN(cogsNum)) {
      cogsMatch = Math.abs(costNum - cogsNum) < 0.005
    }
  } else if (order.dcCogs == null) {
    // COGS not yet fetched — show pending state
    cogsMatch = null
  }

  // ── Build the rich hover tooltip showing all 3 checks ──
  type CheckRow = {
    key: string
    label: string
    orderVal: string
    invoiceVal: string
    /** true = match, false = mismatch, null = pending, undefined = no data to compare */
    status: boolean | null | undefined
    pending?: boolean
    noData?: boolean
  }

  const dash = '—'

  const cogsRow: CheckRow = (() => {
    if (order.dcCogs == null)
      return { key: 'cogs', label: 'COGS', orderVal: dash, invoiceVal: dash, status: null, pending: true }
    if (!dcCogs)
      return { key: 'cogs', label: 'COGS', orderVal: dash, invoiceVal: effectiveCostRaw || dash, status: undefined, noData: true }
    return {
      key: 'cogs', label: 'COGS',
      orderVal: dcCogs,
      invoiceVal: effectiveCostRaw || dash,
      status: cogsMatch,
    }
  })()

  const checkRows: CheckRow[] = [
    {
      key: 'sku', label: 'SKU',
      orderVal: order.orderSku || dash,
      invoiceVal: invoiceSku || dash,
      status: invoiceSku ? skuMatch : undefined,
      noData: !invoiceSku,
    },
    {
      key: 'qty', label: 'Qty',
      orderVal: order.orderQty || dash,
      invoiceVal: invoiceQtyRaw || dash,
      status: invoiceQtyRaw ? qtyMatch : undefined,
      noData: !invoiceQtyRaw,
    },
    cogsRow,
  ]

  const hasAnyMismatch = checkRows.some((r) => r.status === false)

  const discrepancyTooltip = (
    <div style={{ minWidth: 300 }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          {hasAnyMismatch ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-[10px] font-bold text-rose-400">!</span>
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-400">✓</span>
          )}
          <p className="text-[10px] font-semibold text-slate-200">
            {hasAnyMismatch ? 'Discrepancies found' : 'All checks passed'}
          </p>
        </div>
        <span className="text-[10px] text-slate-600">Click away to close</span>
      </div>

      {/* Column labels */}
      <div className="flex items-center gap-2.5 border-b border-white/5 px-3.5 py-1.5">
        <span className="w-5 shrink-0" />
        <span className="w-10 shrink-0 text-[9px] font-bold uppercase tracking-widest text-slate-600">Check</span>
        <div className="flex flex-1 items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-600">
          <span className="flex-1">Order</span>
          <span className="text-slate-700">→</span>
          <span className="flex-1">Invoice</span>
        </div>
      </div>

      {/* Check rows */}
      <div className="divide-y divide-white/5">
        {checkRows.map((row) => {
          const isPending  = row.pending
          const isNoData   = row.noData
          const isMatch    = row.status === true
          const isMismatch = row.status === false

          const iconBg = isPending  ? 'bg-amber-500/15 text-amber-400'
                       : isNoData   ? 'bg-slate-700/60 text-slate-500'
                       : isMatch    ? 'bg-emerald-500/15 text-emerald-400'
                       : isMismatch ? 'bg-rose-500/20 text-rose-400'
                       :              'bg-slate-700/60 text-slate-500'
          const icon   = isPending  ? '…'
                       : isNoData   ? '–'
                       : isMatch    ? '✓'
                       : isMismatch ? '✗'
                       :              '–'

          /* Row background tint for mismatches */
          const rowBg  = isMismatch ? 'bg-rose-500/5' : ''

          return (
            <div key={row.key} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${rowBg}`}>
              {/* Status icon */}
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${iconBg}`}>
                {icon}
              </span>

              {/* Label */}
              <span className="w-10 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {row.label}
              </span>

              {/* Values */}
              {isPending ? (
                <span className="italic text-[10px] text-amber-400">Pending DC COGS…</span>
              ) : isNoData ? (
                <span className="italic text-[10px] text-slate-600">
                  {row.key === 'cogs' ? 'No DC COGS on file' : 'Not on invoice'}
                </span>
              ) : (
                <div className="flex flex-1 items-center gap-1.5 font-mono text-[10px] min-w-0">
                  {/* Order value */}
                  <span className="flex-1 truncate text-slate-300">{row.orderVal}</span>
                  {/* Arrow */}
                  <span className={`shrink-0 text-[10px] font-bold ${isMismatch ? 'text-rose-600' : 'text-slate-600'}`}>→</span>
                  {/* Invoice value */}
                  <span className={`flex-1 truncate font-semibold ${isMismatch ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {row.invoiceVal}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-white/10 bg-white/3 px-3.5 py-2">
        <p className="text-[10px] text-slate-600">
          {hasAnyMismatch
            ? 'Review highlighted values — invoice differs from order.'
            : 'Order data matches the matched invoice.'}
        </p>
      </div>
    </div>
  )

  // Collect only the badges that need attention (mismatches, pending, or unknown).
  // Matches are intentionally omitted — if nothing is collected the row is clean.
  const badges: React.ReactNode[] = []

  if (invoiceSku && !skuMatch)
    badges.push(
      <span key="sku" className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
        ✗ SKU
      </span>
    )

  if (invoiceQtyRaw && !qtyMatch)
    badges.push(
      <span key="qty" className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
        ✗ Qty
      </span>
    )

  if (order.dcCogs == null)
    badges.push(
      <span key="cogs-pending" className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--bg-200)] text-[var(--text-200)] italic">
        COGS…
      </span>
    )
  else if (cogsMatch === false)
    badges.push(
      <span key="cogs" className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
        ✗ COGS
      </span>
    )

  if (badges.length === 0)
    return (
      <Tooltip trigger="click" richContent={discrepancyTooltip}>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 underline decoration-dotted underline-offset-2 dark:text-emerald-400">
          All good
          <svg className="h-2.5 w-2.5 opacity-50" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        </span>
      </Tooltip>
    )

  return (
    <Tooltip trigger="click" richContent={discrepancyTooltip}>
      <span className="inline-flex flex-wrap items-center gap-1">
        {badges}
        <svg className="h-2.5 w-2.5 shrink-0 text-slate-400 dark:text-slate-500 opacity-60" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      </span>
    </Tooltip>
  )
}

/** Return the plain-string value for a column (used by Excel export). */
/**
 * Resolve invoice field values for a row, preferring the server-written
/**
 * Sum a list of numeric strings, ignoring blanks.
 * Returns '' if nothing is summable, otherwise a string rounded to 2dp.
 */
function sumNumericStrings(values: string[]): string {
  let total = 0
  let anyValid = false
  for (const v of values) {
    const n = parseFloat(v)
    if (!isNaN(n)) { total += n; anyValid = true }
  }
  if (!anyValid) return ''
  // Round to 2 decimal places; strip trailing zeros
  const rounded = Math.round(total * 100) / 100
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2)
}

/**
 * Return the lexicographically earliest non-empty date string.
 * ISO/partial-ISO strings sort correctly as strings.
 */
function earliestDateStr(values: string[]): string {
  let earliest = ''
  for (const v of values) {
    if (!v) continue
    if (!earliest || v < earliest) earliest = v
  }
  return earliest
}

/**
 * Resolve invoice field values for a row, aggregating across ALL matched
 * invoices (supports split-shipment: same PO+SKU across multiple PDFs).
 *
 * Priority order:
 *   1. `order.matchedInvoices[]` — server-written cache (fast path, multiple)
 *   2. `order.matchedInvoice`   — legacy singular cache (backward compat)
 *   3. `matches` array          — client-side fallback (when cache is absent)
 */
function resolveInvoiceFields(
  order: DocTidyOrderImport,
  matches: InvoiceMatch[]
) {
  // ── Build a unified list of "per-invoice" value sets ──────────────────────
  // Each entry in `perInvoice` has all fields for one matched invoice.
  type PerInvoice = {
    driveFileId: string
    invoiceSku: string
    invoiceDate: string
    invoiceNumber: string
    terms: string
    itemCost: string
    invoiceQty: string
    discountedPrice: string
    discountPct: string
    dropshipFee: string
    miscCharges: string
    totalCost: string
    jobId?: string
  }

  let perInvoice: PerInvoice[] = []

  // Fast path: server-written matchedInvoices[] array (new field)
  if (order.matchedInvoices && order.matchedInvoices.length > 0) {
    perInvoice = order.matchedInvoices.map((c) => ({
      driveFileId:     c.driveFileId     ?? '',
      invoiceSku:      c.invoiceSku      ?? '',
      invoiceDate:     c.invoiceDate     ?? '',
      invoiceNumber:   c.invoiceNumber   ?? '',
      terms:           c.terms           ?? '',
      itemCost:        c.itemCost        ?? '',
      invoiceQty:      c.invoiceQty      ?? '',
      discountedPrice: c.discountedPrice ?? '',
      discountPct:     c.discountPct     ?? '',
      dropshipFee:     c.dropshipFee     ?? '',
      miscCharges:     c.miscCharges     ?? '',
      totalCost:       c.totalCost       ?? '',
      jobId:           c.jobId,
    }))
  } else if (order.matchedInvoice) {
    // Backward compat: legacy singular cache
    const c = order.matchedInvoice
    perInvoice = [{
      driveFileId:     c.driveFileId     ?? '',
      invoiceSku:      c.invoiceSku      ?? '',
      invoiceDate:     c.invoiceDate     ?? '',
      invoiceNumber:   c.invoiceNumber   ?? '',
      terms:           c.terms           ?? '',
      itemCost:        c.itemCost        ?? '',
      invoiceQty:      c.invoiceQty      ?? '',
      discountedPrice: c.discountedPrice ?? '',
      discountPct:     c.discountPct     ?? '',
      dropshipFee:     c.dropshipFee     ?? '',
      miscCharges:     c.miscCharges     ?? '',
      totalCost:       c.totalCost       ?? '',
      jobId:           c.jobId,
    }]
  } else if (matches.length > 0) {
    // Client-side fallback (no server cache yet)
    perInvoice = matches.map((m) => {
      const json = m.job.jsonOutput ?? null
      const item = m.item ?? null
      return {
        driveFileId:     m.job.driveFileId ?? '',
        invoiceSku:      liVal(item, 'sku', 'part_number', 'part_no', 'item_code', 'product_code', 'sku_number'),
        invoiceDate:     extractJsonField(json, 'invoice_date', 'date', 'billing_date', 'bill_date', 'invoice date'),
        invoiceNumber:   extractJsonField(json, 'invoice_number', 'invoice_no', 'invoice_num', 'inv_number', 'inv_no', 'invoice#', 'invoice'),
        terms:           extractJsonField(json, 'payment_terms', 'terms', 'net_terms', 'payment terms'),
        itemCost:        liVal(item, 'unit_price', 'price', 'rate', 'cost', 'unit_cost', 'item_cost', 'list_price'),
        invoiceQty:      liVal(item, 'quantity', 'qty', 'units', 'ordered_quantity', 'order_qty'),
        discountedPrice: liVal(item, 'discounted_price', 'sale_price', 'net_price', 'after_discount', 'final_price', 'net_unit_price', 'your_price'),
        discountPct:     liVal(item, 'discount_percent', 'discount_pct', 'discount_rate', 'discount', 'disc_pct', 'disc'),
        dropshipFee:     liVal(item, 'dropship_fee', 'ds_fee', 'drop_ship_fee', 'dropship fee', 'dropship') || extractJsonField(json, 'dropship_fee', 'ds_fee', 'drop_ship_fee', 'dropship fee', 'dropship'),
        miscCharges:     liVal(item, 'misc_charges', 'miscellaneous_charges', 'misc_fees', 'other_charges', 'misc', 'miscellaneous') || extractJsonField(json, 'misc_charges', 'miscellaneous_charges', 'misc_fees', 'other_charges', 'misc', 'miscellaneous'),
        totalCost:       liVal(item, 'total', 'line_total', 'subtotal', 'extended_price', 'total_cost', 'extended_amount', 'ext_price') || extractJsonField(json, 'total_cost', 'total_costs', 'total', 'grand_total', 'total_amount', 'total_value', 'invoice_total', 'amount_due', 'balance_due', 'total_due', 'total_invoice'),
        jobId:           String(m.job._id),
      }
    })
  }

  if (perInvoice.length === 0) {
    return {
      hasMatch:        false,
      matchCount:      0,
      driveFileId:     undefined as string | undefined,
      primaryJobId:    undefined as string | undefined,
      invoiceSku:      '',
      invoiceDate:     '',
      invoiceNumber:   '',
      terms:           '',
      itemCost:        '',
      invoiceQty:      '',
      discountedPrice: '',
      discountPct:     '',
      dropshipFee:     '',
      miscCharges:     '',
      totalCost:       '',
    }
  }

  // ── Aggregate across all matched invoices ─────────────────────────────────
  const first = perInvoice[0]

  // Invoice # — unique values joined (preserves order)
  const uniqueInvNums = [...new Set(perInvoice.map((p) => p.invoiceNumber).filter(Boolean))]
  const invoiceNumber = uniqueInvNums.join(', ')

  return {
    hasMatch:        true,
    matchCount:      perInvoice.length,
    driveFileId:     first.driveFileId || undefined,
    primaryJobId:    first.jobId,
    invoiceSku:      first.invoiceSku,
    invoiceDate:     earliestDateStr(perInvoice.map((p) => p.invoiceDate)),
    invoiceNumber,
    terms:           first.terms,
    // Pricing fields from first match (same SKU → same price across invoices)
    itemCost:        first.itemCost,
    discountedPrice: first.discountedPrice,
    discountPct:     first.discountPct,
    // Quantities and charges sum across all invoices
    invoiceQty:      sumNumericStrings(perInvoice.map((p) => p.invoiceQty)),
    dropshipFee:     sumNumericStrings(perInvoice.map((p) => p.dropshipFee)),
    miscCharges:     sumNumericStrings(perInvoice.map((p) => p.miscCharges)),
    totalCost:       sumNumericStrings(perInvoice.map((p) => p.totalCost)),
  }
}

/**
 * Extracts a plain string value from a header-only parse job for a given
 * InvoiceAuditColumn. Mirrors the field-extraction logic in `headerOnlyCellFor`
 * but returns a raw string suitable for filter comparisons.
 */
function headerOnlyColStr(colId: InvoiceAuditColumnId, job: ParseJobListItem): string {
  const json = job.jsonOutput ?? null
  switch (colId) {
    case 'poNumber':
      return extractJsonField(json,
        'po_number', 'purchase_order_number', 'po_no', 'po', 'purchase_order', 'order_number', 'order_no')
    case 'invoiceDate':
      return extractJsonField(json, 'invoice_date', 'date', 'billing_date', 'bill_date', 'invoice date')
    case 'invoiceNumber':
      return extractJsonField(json, 'invoice_number', 'invoice_no', 'invoice_num', 'inv_number', 'inv_no', 'invoice#', 'invoice')
    case 'terms':
      return extractJsonField(json, 'payment_terms', 'terms', 'net_terms', 'payment terms')
    case 'totalCost':
      return extractJsonField(json,
        'total_cost', 'total_costs', 'total', 'grand_total', 'total_amount',
        'total_value', 'invoice_total', 'amount_due', 'balance_due', 'total_due', 'total_invoice')
    case 'parsedAt':
      return job.completedAt ? formatDate(job.completedAt) : ''
    default:
      return ''
  }
}

function auditColStr(
  colId: InvoiceAuditColumnId,
  order: DocTidyOrderImport,
  matches: InvoiceMatch[]
): string {
  switch (colId) {
    case 'poNumber':      return order.poNumber
    case 'orderSku':      return order.orderSku
    case 'orderQty':      return order.orderQty
    case 'lesd':          return order.lesd ?? ''
    case 'customerName':  return order.customerName ?? ''
    case 'purchasedDate': return order.purchasedDate ?? ''
    case 'status':        return order.status ?? ''
    case 'dcCogs':        return (order.dcCogs && order.dcCogs !== 'n/a') ? order.dcCogs : ''
    default: break
  }
  const inv = resolveInvoiceFields(order, matches)
  switch (colId) {
    case 'invoiceSku':        return inv.invoiceSku
    case 'invoiceDate':       return inv.invoiceDate
    case 'invoiceNumber':     return inv.invoiceNumber
    case 'terms':             return inv.terms
    case 'itemCost':          return inv.itemCost
    case 'invoiceQty':        return inv.invoiceQty
    case 'discountedCostPct': {
      // Strip any trailing % the AI may have already included before re-adding it.
      const pctStr = inv.discountPct ? inv.discountPct.trim().replace(/%+$/, '') : ''
      return [inv.discountedPrice, pctStr ? `(${pctStr}%)` : ''].filter(Boolean).join(' ')
    }
    case 'dropshipFee':       return inv.dropshipFee
    case 'miscCharges':       return inv.miscCharges
    case 'totalCost':         return inv.totalCost
    case 'parsedAt': {
      // Show the earliest cachedAt across all matched invoices
      const cachedDates = [
        ...(order.matchedInvoices?.map((c) => c.cachedAt).filter(Boolean) ?? []),
        ...(order.matchedInvoice?.cachedAt ? [order.matchedInvoice.cachedAt] : []),
      ]
      const earliest = cachedDates.reduce<string | undefined>((acc, d) => {
        const s = typeof d === 'string' ? d : (d as Date).toISOString()
        return !acc || s < acc ? s : acc
      }, undefined)
      return earliest ? formatDate(earliest) : ''
    }
    case 'discrepancy': {
      if (!inv.hasMatch) return 'No match'
      const issues: string[] = []
      if (inv.invoiceSku && normSkuForMatch(order.orderSku) !== normSkuForMatch(inv.invoiceSku)) issues.push('✗ SKU')
      if (inv.invoiceQty && normForMatch(order.orderQty) !== normForMatch(inv.invoiceQty)) issues.push('✗ Qty')
      if (order.dcCogs == null) {
        issues.push('COGS pending')
      } else {
        const dcCogs = order.dcCogs !== 'n/a' ? order.dcCogs : null
        // Use effective (post-discount) cost so discounts don't flag false mismatches.
        const effectiveCost = resolveEffectiveCost(inv)
        if (dcCogs && effectiveCost) {
          const costNum = parseFloat(effectiveCost.replace(/[^0-9.-]/g, ''))
          const cogsNum = parseFloat(dcCogs.replace(/[^0-9.-]/g, ''))
          if (!isNaN(costNum) && !isNaN(cogsNum) && Math.abs(costNum - cogsNum) >= 0.005) issues.push('✗ COGS')
        }
      }
      return issues.length === 0 ? 'All good' : issues.join(', ')
    }
    default: return ''
  }
}

/** Maps a `DocTidyMessage` column to a plain string for column-filter comparisons. */
function emailColStr(colId: WorkspaceEmailColumnId, msg: DocTidyMessage): string {
  switch (colId) {
    case 'received':     return formatDate(msg.sentAt)
    case 'from':         return msg.fromName ? msg.fromName : msg.from
    case 'to':           return msg.to?.join(', ') ?? ''
    case 'subject':      return msg.subject ?? ''
    case 'documentType': return DOCUMENT_TYPE_LABELS[documentTypeOf(msg.documentType)]
    case 'rule':         return msg.ruleName ?? ''
    case 'attachments':  return msg.attachments?.map((a) => a.filename).join(', ') ?? ''
    default:             return ''
  }
}

/**
 * Derive the single most-urgent parse status across all of a message's parse
 * jobs, for use in the parse-status filter.
 * Priority: processing > pending > failed > completed > none (no jobs at all).
 */
function emailEffectiveParseStatus(msg: DocTidyMessage): ParseJobStatus | 'none' {
  const jobs = msg.parseJobs ?? []
  if (jobs.length === 0) return 'none'
  if (jobs.some((j) => j.status === 'processing')) return 'processing'
  if (jobs.some((j) => j.status === 'pending'))    return 'pending'
  if (jobs.some((j) => j.status === 'failed'))     return 'failed'
  return 'completed'
}

/** Maps a `PdfImport` column to a plain string for column-filter comparisons. */
function pdfColStr(colId: PdfImportColumnId, imp: PdfImport): string {
  switch (colId) {
    case 'imported':     return formatDate(imp.createdAt)
    case 'importedBy':   return imp.uploadedByName ?? ''
    case 'size':         return formatBytes(imp.size)
    case 'filename':     return imp.filename ?? ''
    case 'parseStatus':  return imp.parseJob ? PARSE_STATUS_LABELS[imp.parseJob.status] : 'Not sent'
    default:             return ''
  }
}

/* ─────────────────────────── Week-grouping helpers ── */

/**
 * Returns the ISO date string (YYYY-MM-DD) for the **Sunday** that starts the
 * calendar week (Sun → Sat) containing `dateStr`.
 * Returns `null` if `dateStr` is not parseable.
 */
/**
 * Parse a date string that may be in ISO, MM/DD/YYYY, or MM/DD/YY format.
 * `new Date()` alone rejects the common AI-produced MM/DD/YY (2-digit year)
 * format, so we handle it explicitly before falling back to native parsing.
 */
function parseFlexDate(dateStr: string): Date | null {
  if (!dateStr) return null
  // MM/DD/YY — 2-digit year; treat 00–49 as 2000–2049, 50–99 as 1950–1999.
  const m2 = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (m2) {
    const yy = parseInt(m2[3], 10)
    const year = yy < 50 ? 2000 + yy : 1900 + yy
    const d = new Date(year, parseInt(m2[1], 10) - 1, parseInt(m2[2], 10))
    if (!isNaN(d.getTime())) return d
  }
  // Everything else: ISO, MM/DD/YYYY, "Month DD YYYY", etc.
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Normalise any supported date string to "YYYY-MM-DD" using **local** date
 * parts so string comparisons against `<input type="date">` values work
 * regardless of server/client timezone.  Returns null when the string cannot
 * be parsed.
 */
function toISODateStr(dateStr: string): string | null {
  const d = parseFlexDate(dateStr)
  if (!d) return null
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function getWeekStartKey(dateStr: string): string | null {
  const d = parseFlexDate(dateStr)
  if (!d) return null
  const day = d.getDay() // 0=Sun … 6=Sat
  const diffToSunday = -day  // 0 → stay; 1..6 → go back by that many days
  const sunday = new Date(d)
  sunday.setDate(d.getDate() + diffToSunday)
  const yyyy = sunday.getFullYear()
  const mm = String(sunday.getMonth() + 1).padStart(2, '0')
  const dd = String(sunday.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Formats a week-start ISO key (YYYY-MM-DD, a Sunday) as a human-readable range:
 * "Sun Sep 21 – Sat Sep 27, 2026".
 */
function formatWeekLabel(weekKey: string): string {
  const sunday = new Date(`${weekKey}T00:00:00`)
  const saturday = new Date(sunday)
  saturday.setDate(sunday.getDate() + 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return `${fmt(sunday)} – ${fmt(saturday)}, ${saturday.getFullYear()}`
}

/* ─────────────────────────── Confirm Delete Dialog ── */

function ConfirmDeleteDialog({
  title,
  description,
  deleting,
  onConfirm,
  onCancel,
}: {
  title: string
  description: React.ReactNode
  deleting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !deleting) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, deleting])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => { if (!deleting) onCancel() }} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-6 shadow-2xl space-y-4"
      >
        {/* Icon + title */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-900/20">
            <svg className="h-5 w-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-100)]">{title}</h3>
            <p className="mt-1 text-xs text-[var(--text-200)] leading-relaxed">{description}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="cursor-pointer rounded-lg border border-[var(--bg-300)] px-4 py-2 text-sm text-[var(--text-100)] transition-colors hover:bg-[var(--bg-200)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:bg-rose-700 disabled:opacity-60"
          >
            {deleting && (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────── Page ── */

const AUDIT_PAGE_SIZES = [500, 1000, 2000, 5000]

export default function DocTidyInvoiceAudit() {
  const { user: currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()

  /* ── Global success banner (e.g. after OAuth redirects back) ── */
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null)

  /* ── View state ── */
  type View = 'organizations' | 'workspaces' | 'audit'
  const [view, setView] = useState<View>('organizations')
  const [activeOrg, setActiveOrg] = useState<DocTidyOrganization | null>(null)
  const [activeWorkspace, setActiveWorkspace] = useState<DocTidyWorkspace | null>(null)
  /** True while a header-only mode workspace is active. Drives several UI branches. */
  const isHeaderOnly = activeWorkspace?.importMode === 'header-only'
  /** Which sub-tab is active inside a workspace detail page. */
  type WorkspaceTab = 'audit' | 'emails' | 'rules' | 'vendors' | 'pdf-imports'
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('audit')

  /* ── Organizations ── */
  const [organizations, setOrganizations] = useState<DocTidyOrganization[]>([])
  const [orgLoading, setOrgLoading] = useState(true)
  const [orgError, setOrgError] = useState<string | null>(null)

  /* ── Organization editor ── */
  const [editOrgTarget, setEditOrgTarget] = useState<DocTidyOrganization | 'new' | null>(null)

  /* ── Move workspace dialog ── */
  const [moveTarget, setMoveTarget] = useState<DocTidyWorkspace | null>(null)

  /* ── Workspaces ── */
  const [workspaces, setWorkspaces] = useState<DocTidyWorkspace[]>([])
  const [wsLoading, setWsLoading] = useState(true)
  const [wsError, setWsError] = useState<string | null>(null)

  /* ── Workspace editor ── */
  const [editTarget, setEditTarget] = useState<DocTidyWorkspace | 'new' | null>(null)

  /* ── Tidy Agent worker status ── */const [workerOnline, setWorkerOnline] = useState<boolean | null>(null)

  /* ── Audit table — Order Imports (primary rows) ── */
  const [orderImports, setOrderImports] = useState<DocTidyOrderImport[]>([])
  const [orderPagination, setOrderPagination] = useState({ total: 0, pages: 1 })
  const [orderLoading, setOrderLoading] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [orderPage, setOrderPage] = useState(1)
  const [orderPageSize, setOrderPageSize] = useState(500)
  const [auditSearch, setAuditSearch] = useState('')
  const [debouncedAuditSearch, setDebouncedAuditSearch] = useState('')
  const [auditDateFrom, setAuditDateFrom] = useState('')
  const [auditDateTo, setAuditDateTo] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  /** Vendor setup overlay — set when a row's matched job has vendorNeedsSetup=true. */
  const [addVendorTarget, setAddVendorTarget] = useState<{ jobId: string; suggestedName?: string | null } | null>(null)
  /** Week keys (YYYY-MM-DD of Sunday) whose rows are currently collapsed. Persisted to localStorage. */
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(loadCollapsedWeeks)
  // Initialized to defaults; reloaded from workspace-scoped localStorage on enterWorkspace().
  const [colVisibility, setColVisibility] = useState<Record<InvoiceAuditColumnId, boolean>>(
    () => Object.fromEntries(INVOICE_AUDIT_COLUMNS.map((c) => [c.id, c.defaultVisible])) as Record<InvoiceAuditColumnId, boolean>
  )
  const [showColSettings, setShowColSettings] = useState(false)

  /* ── Column filters (Excel-style per-column value filters) ── */
  /** Map of colId → set of allowed values (including BLANK_SENTINEL for empty cells). null/absent = no filter. */
  const [colFilters, setColFilters] = useState<Partial<Record<InvoiceAuditColumnId, Set<string>>>>({})
  /** Which column's filter dropdown is currently open. */
  const [filterOpenColId, setFilterOpenColId] = useState<InvoiceAuditColumnId | null>(null)
  /** Bounding rect of the filter button that was clicked (used to position the dropdown). */
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null)

  /* ── Email column filters ── */
  const [emailColFilters, setEmailColFilters] = useState<Partial<Record<WorkspaceEmailColumnId, Set<string>>>>({})
  const [emailFilterOpenColId, setEmailFilterOpenColId] = useState<WorkspaceEmailColumnId | null>(null)
  const [emailFilterAnchorRect, setEmailFilterAnchorRect] = useState<DOMRect | null>(null)

  /* ── PDF import column filters ── */
  const [pdfColFilters, setPdfColFilters] = useState<Partial<Record<PdfImportColumnId, Set<string>>>>({})
  const [pdfFilterOpenColId, setPdfFilterOpenColId] = useState<PdfImportColumnId | null>(null)
  const [pdfFilterAnchorRect, setPdfFilterAnchorRect] = useState<DOMRect | null>(null)

  /* ── All parse jobs for matching (fetched silently per workspace open) ── */
  const [jobs, setJobs] = useState<ParseJobListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* ── Order import file upload ── */
  const [showImportModal, setShowImportModal] = useState(false)
  const [importDragOver, setImportDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<{ count: number; batchId: string } | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)

  /* ── Shared column ordering (server-persisted, real-time via SSE) ── */
  const [auditColOrder, setAuditColOrder] = useState<string[]>(DEFAULT_AUDIT_COL_ORDER)
  const [emailColOrder, setEmailColOrder] = useState<WorkspaceEmailColumnId[]>(DEFAULT_EMAIL_COL_ORDER)
  /** State tracks both source and hover target so `isDragging` is readable in render. */
  const [auditDragSrc, setAuditDragSrc] = useState<string | null>(null)
  const [auditDragTarget, setAuditDragTarget] = useState<string | null>(null)
  const [emailDragSrc, setEmailDragSrc] = useState<WorkspaceEmailColumnId | null>(null)
  const [emailDragTarget, setEmailDragTarget] = useState<WorkspaceEmailColumnId | null>(null)

  /* ── Workspace Emails tab ── */
  const [emailMessages, setEmailMessages] = useState<DocTidyMessage[]>([])
  const [emailPagination, setEmailPagination] = useState({ total: 0, pages: 1, parsedCount: 0 })
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailPage, setEmailPage] = useState(1)
  const [emailPageSize, setEmailPageSize] = useState(PAGE_SIZE_OPTIONS[0])
  const [emailSearch, setEmailSearch] = useState('')
  const [emailDebouncedSearch, setEmailDebouncedSearch] = useState('')
  const [emailDateFrom, setEmailDateFrom] = useState('')
  const [emailDateTo, setEmailDateTo] = useState('')
  const [emailParseStatusFilter, setEmailParseStatusFilter] = useState<'' | 'none' | ParseJobStatus>('')
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const [viewMessage, setViewMessage] = useState<DocTidyMessage | null>(null)
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set())
  const selectAllEmailRef = useRef<HTMLInputElement>(null)

  const emailCheckboxClass =
    'h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent-200)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-200)]'

  /* Fetch Emails button state */
  const [emailFetching, setEmailFetching] = useState(false)
  const [emailFetchNotice, setEmailFetchNotice] = useState<string | null>(null)

  /* Background poller / manual-fetch SSE status chips */
  const [pollerRunning, setPollerRunning] = useState(false)
  const [pollError, setPollError] = useState<string | null>(null)
  const [showFetchDone, setShowFetchDone] = useState(false)
  const fetchDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up fetch-done timer on unmount.
  useEffect(() => {
    return () => { if (fetchDoneTimerRef.current) clearTimeout(fetchDoneTimerRef.current) }
  }, [])

  /* Countdown to next automated poll */
  const [nextSyncAt, setNextSyncAt] = useState<Date | null>(null)
  const pollerIntervalMsRef = useRef<number>(30_000)
  // 1-second tick to keep the countdown display fresh.
  const [, setCountdownTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setCountdownTick((n) => n + 1), 1_000)
    return () => clearInterval(id)
  }, [])

  // Fetch the poller config once to seed the initial countdown.
  useEffect(() => {
    authApi.get<{ data: DocTidyConfig }>('/doc-tidy/config').catch(() => null).then((res) => {
      if (!res) return
      const intervalMs = (res.data.pollerIntervalSeconds ?? 30) * 1_000
      pollerIntervalMsRef.current = intervalMs
      const base = res.data.lastPollAt ? new Date(res.data.lastPollAt).getTime() : Date.now()
      setNextSyncAt(new Date(base + intervalMs))
    })
  }, [])

  /* ── Handle redirect back from per-workspace email source OAuth ── */
  useEffect(() => {
    const wsSource = searchParams.get('ws_source')
    const wsSourceError = searchParams.get('ws_source_error')
    const wsId = searchParams.get('workspaceId')

    if (wsSource === 'connected') {
      setGlobalSuccess('Email account connected successfully.')
      // Auto-open the workspace editor so the user can see the new source.
      if (wsId) {
        setWorkspaces((prev) => {
          const ws = prev.find((w) => w._id === wsId)
          if (ws) setEditTarget(ws)
          return prev
        })
      }
      setSearchParams({}, { replace: true })
    } else if (wsSourceError) {
      setWsError(
        wsSourceError === 'no_refresh_token'
          ? 'Email connection failed: no refresh token returned. Try reconnecting and ensure you grant all requested permissions.'
          : 'Email connection failed. Please try again.'
      )
      setSearchParams({}, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── PDF Imports tab ── */
  const [pdfImports, setPdfImports] = useState<PdfImport[]>([])
  const [pdfImportsPagination, setPdfImportsPagination] = useState({ total: 0, pages: 1, parsedCount: 0 })
  const [pdfImportsLoading, setPdfImportsLoading] = useState(false)
  const [pdfImportsError, setPdfImportsError] = useState<string | null>(null)
  const [pdfPage, setPdfPage] = useState(1)
  const [pdfPageSize, setPdfPageSize] = useState(PAGE_SIZE_OPTIONS[0])
  const [pdfSearch, setPdfSearch] = useState('')
  const [pdfDebouncedSearch, setPdfDebouncedSearch] = useState('')
  const [pdfDateFrom, setPdfDateFrom] = useState('')
  const [pdfDateTo, setPdfDateTo] = useState('')
  const [pdfParseStatusFilter, setPdfParseStatusFilter] = useState<'' | 'none' | ParseJobStatus>('')
  const [pdfUploading, setPdfUploading] = useState(false)
  const [pdfUploadError, setPdfUploadError] = useState<string | null>(null)
  const [pdfSendingIds, setPdfSendingIds] = useState<Set<string>>(new Set())
  const [pdfSelectedIds, setPdfSelectedIds] = useState<Set<string>>(new Set())
  const pdfSelectAllRef = useRef<HTMLInputElement>(null)
  const [pdfDragOver, setPdfDragOver] = useState(false)
  const [showPdfUploadModal, setShowPdfUploadModal] = useState(false)
  const pdfFileInputRef = useRef<HTMLInputElement>(null)

  /* ── PDF import column drag-reorder ── */
  const [pdfColOrder, setPdfColOrder] = useState<PdfImportColumnId[]>(DEFAULT_PDF_IMPORT_COL_ORDER)
  const [pdfDragSrc, setPdfDragSrc] = useState<PdfImportColumnId | null>(null)
  const [pdfDragTarget, setPdfDragTarget] = useState<PdfImportColumnId | null>(null)
  const pdfColOrderRef = useRef(pdfColOrder)
  useEffect(() => { pdfColOrderRef.current = pdfColOrder }, [pdfColOrder])

  /* ── Confirm-delete dialogs ── */
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<import('../types/docTidy').DocTidyMessage | null>(null)
  const [emailDeleting, setEmailDeleting] = useState(false)
  const [confirmDeletePdf, setConfirmDeletePdf] = useState<PdfImport | null>(null)
  const [pdfDeleting, setPdfDeleting] = useState(false)

  /* ── Bulk delete: emails ── */
  const [confirmBulkDeleteEmails, setConfirmBulkDeleteEmails] = useState(false)
  const [emailBulkDeleting, setEmailBulkDeleting] = useState(false)

  /* ── Bulk delete: PDF imports ── */
  const [confirmBulkDeletePdfs, setConfirmBulkDeletePdfs] = useState(false)
  const [pdfBulkDeleting, setPdfBulkDeleting] = useState(false)

  /* ── Bulk parse: emails and PDFs ── */
  const [emailBulkSending, setEmailBulkSending] = useState(false)
  const [emailBulkAborting, setEmailBulkAborting] = useState(false)
  const [pdfBulkSending, setPdfBulkSending] = useState(false)
  const [pdfBulkAborting, setPdfBulkAborting] = useState(false)

  /* ── Audit table delete (full-import mode) ── */
  const [confirmDeleteAuditRow, setConfirmDeleteAuditRow] = useState<DocTidyOrderImport | null>(null)
  const [auditRowDeleting, setAuditRowDeleting] = useState(false)
  const [confirmBulkDeleteAudit, setConfirmBulkDeleteAudit] = useState(false)
  const [auditBulkDeleting, setAuditBulkDeleting] = useState(false)

  /* ── Header-only parse-job delete ── */
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set())
  const [confirmDeleteJob, setConfirmDeleteJob] = useState<ParseJobListItem | null>(null)
  const [jobDeleting, setJobDeleting] = useState(false)
  const [confirmBulkDeleteJobs, setConfirmBulkDeleteJobs] = useState(false)
  const [jobBulkDeleting, setJobBulkDeleting] = useState(false)

  /* ── Filtered views (client-side column filters applied to the loaded page) ── */
  const filteredEmailMessages = useMemo(() => {
    const activeEntries = Object.entries(emailColFilters).filter(
      (entry): entry is [WorkspaceEmailColumnId, Set<string>] => entry[1] != null && entry[1].size > 0
    )
    return emailMessages.filter((msg) => {
      // Parse-status filter
      if (emailParseStatusFilter) {
        if (emailEffectiveParseStatus(msg) !== emailParseStatusFilter) return false
      }
      // Column filters
      return activeEntries.every(([colId, allowed]) => {
        const val = emailColStr(colId, msg).trim()
        if (!val) return allowed.has(BLANK_SENTINEL)
        return allowed.has(val)
      })
    })
  }, [emailMessages, emailColFilters, emailParseStatusFilter])

  const filteredPdfImports = useMemo(() => {
    const activeEntries = Object.entries(pdfColFilters).filter(
      (entry): entry is [PdfImportColumnId, Set<string>] => entry[1] != null && entry[1].size > 0
    )
    return pdfImports.filter((imp) => {
      // Parse-status filter
      if (pdfParseStatusFilter) {
        const impStatus: ParseJobStatus | 'none' = imp.parseJob?.status ?? 'none'
        if (impStatus !== pdfParseStatusFilter) return false
      }
      // Column filters
      return activeEntries.every(([colId, allowed]) => {
        const val = pdfColStr(colId, imp).trim()
        if (!val) return allowed.has(BLANK_SENTINEL)
        return allowed.has(val)
      })
    })
  }, [pdfImports, pdfColFilters, pdfParseStatusFilter])

  /* Debounce search */
  useEffect(() => {
    const t = setTimeout(() => setPdfDebouncedSearch(pdfSearch.trim()), 350)
    return () => clearTimeout(t)
  }, [pdfSearch])

  /* Reset page + selection when filters change */
  useEffect(() => { setPdfPage(1); setPdfSelectedIds(new Set()) }, [pdfDebouncedSearch, pdfDateFrom, pdfDateTo, pdfPageSize, pdfParseStatusFilter])

  /** Generation counter — incremented on every fetch so stale responses are discarded. */
  const pdfFetchGenRef = useRef(0)

  const fetchPdfImports = useCallback(async () => {
    if (!activeWorkspace) return
    const gen = ++pdfFetchGenRef.current
    setPdfImportsLoading(true)
    setPdfImportsError(null)
    try {
      const params = new URLSearchParams({
        workspaceId: activeWorkspace._id,
        page: String(pdfPage),
        pageSize: String(pdfPageSize),
      })
      if (pdfDebouncedSearch) params.set('search', pdfDebouncedSearch)
      if (pdfDateFrom) params.set('dateFrom', pdfDateFrom)
      if (pdfDateTo) params.set('dateTo', pdfDateTo)
      const res = await authApi.get<{ data: PdfImport[]; pagination: { total: number; pages: number; parsedCount: number } }>(
        `/doc-tidy/pdf-imports?${params.toString()}`
      )
      if (gen !== pdfFetchGenRef.current) return  // stale response — a newer fetch is in flight
      setPdfImports(res.data)
      setPdfImportsPagination({ total: res.pagination.total, pages: Math.max(1, res.pagination.pages), parsedCount: res.pagination.parsedCount ?? 0 })
    } catch (err) {
      if (gen !== pdfFetchGenRef.current) return
      setPdfImportsError(err instanceof Error ? err.message : 'Failed to load PDF imports')
    } finally {
      if (gen === pdfFetchGenRef.current) setPdfImportsLoading(false)
    }
  }, [activeWorkspace, pdfPage, pdfPageSize, pdfDebouncedSearch, pdfDateFrom, pdfDateTo])

  useEffect(() => {
    if (workspaceTab === 'pdf-imports') void fetchPdfImports()
  }, [workspaceTab, fetchPdfImports])

  const handlePdfFilesSelected = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (fileArray.length === 0) {
      setPdfUploadError('Please select PDF files only.')
      return
    }
    if (!activeWorkspace) return
    setPdfUploading(true)
    setPdfUploadError(null)
    try {
      const formData = new FormData()
      formData.append('workspaceId', activeWorkspace._id)
      for (const file of fileArray) formData.append('files', file)
      await authApi.upload<{ data: PdfImport[] }>('/doc-tidy/pdf-imports', formData)
      setShowPdfUploadModal(false)
      setPdfPage(1)
      void fetchPdfImports()
    } catch (err) {
      setPdfUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setPdfUploading(false)
    }
  }

  const handleSendToAgent = async (imp: PdfImport) => {
    setPdfSendingIds((prev) => new Set(prev).add(imp._id))
    setPdfImportsError(null)
    try {
      await authApi.post(`/doc-tidy/pdf-imports/${imp._id}/parse`)
      void fetchPdfImports()
    } catch (err) {
      setPdfImportsError(err instanceof Error ? err.message : 'Failed to send to Tidy Agent')
    } finally {
      setPdfSendingIds((prev) => { const next = new Set(prev); next.delete(imp._id); return next })
    }
  }


  const confirmAndDeletePdfImport = async (imp: PdfImport) => {
    setPdfDeleting(true)
    try {
      await authApi.delete(`/doc-tidy/pdf-imports/${imp._id}`)
      setPdfSelectedIds((prev) => { const next = new Set(prev); next.delete(imp._id); return next })
      setConfirmDeletePdf(null)
      void fetchPdfImports()
    } catch (err) {
      setPdfImportsError(err instanceof Error ? err.message : 'Failed to delete import')
      setConfirmDeletePdf(null)
    } finally {
      setPdfDeleting(false)
    }
  }

  const handleDeleteEmail = async (msg: import('../types/docTidy').DocTidyMessage) => {
    setEmailDeleting(true)
    try {
      await authApi.delete(`/doc-tidy/messages/${msg._id}`)
      setSelectedEmailIds((prev) => { const next = new Set(prev); next.delete(msg._id); return next })
      setConfirmDeleteEmail(null)
      void fetchEmails(true)
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to delete message')
      setConfirmDeleteEmail(null)
    } finally {
      setEmailDeleting(false)
    }
  }

  /* ── Emails: bulk delete selected messages ── */
  const handleBulkDeleteEmails = async () => {
    const ids = Array.from(selectedEmailIds)
    setEmailBulkDeleting(true)
    try {
      await authApi.post('/doc-tidy/messages/bulk-delete', { ids })
      setEmailMessages((prev) => prev.filter((m) => !selectedEmailIds.has(m._id)))
      setEmailPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - ids.length) }))
      setSelectedEmailIds(new Set())
      setConfirmBulkDeleteEmails(false)
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to delete selected messages')
      setConfirmBulkDeleteEmails(false)
    } finally {
      setEmailBulkDeleting(false)
    }
  }

  /* ── PDF Imports: bulk delete selected imports ── */
  const handleBulkDeletePdfs = async () => {
    const ids = Array.from(pdfSelectedIds)
    setPdfBulkDeleting(true)
    try {
      await authApi.post('/doc-tidy/pdf-imports/bulk-delete', { ids })
      setPdfImports((prev) => prev.filter((i) => !pdfSelectedIds.has(i._id)))
      setPdfImportsPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - ids.length) }))
      setPdfSelectedIds(new Set())
      setConfirmBulkDeletePdfs(false)
    } catch (err) {
      setPdfImportsError(err instanceof Error ? err.message : 'Failed to delete selected PDF imports')
      setConfirmBulkDeletePdfs(false)
    } finally {
      setPdfBulkDeleting(false)
    }
  }

  /* ── Audit table: single-row delete ── */
  const handleDeleteOrderImport = async (order: DocTidyOrderImport) => {
    setAuditRowDeleting(true)
    try {
      await authApi.delete(`/doc-tidy/order-imports/${order._id}`)
      setOrderImports((prev) => prev.filter((o) => o._id !== order._id))
      setSelectedRowKeys((prev) => { const next = new Set(prev); next.delete(order._id); return next })
      setOrderPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }))
      setConfirmDeleteAuditRow(null)
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Failed to delete order')
      setConfirmDeleteAuditRow(null)
    } finally {
      setAuditRowDeleting(false)
    }
  }

  /* ── Audit table: bulk delete selected rows ── */
  const handleBulkDeleteOrderImports = async () => {
    const ids = Array.from(selectedRowKeys)
    setAuditBulkDeleting(true)
    try {
      await authApi.post('/doc-tidy/order-imports/bulk-delete', { ids })
      setOrderImports((prev) => prev.filter((o) => !selectedRowKeys.has(o._id)))
      setOrderPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - ids.length) }))
      setSelectedRowKeys(new Set())
      setConfirmBulkDeleteAudit(false)
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Failed to delete selected orders')
      setConfirmBulkDeleteAudit(false)
    } finally {
      setAuditBulkDeleting(false)
    }
  }

  /* ── Emails: bulk send selected messages to Tidy Agent for parsing ── */
  const handleBulkSendEmailsToAgent = async () => {
    const selectedMsgs = emailMessages.filter((m) => selectedEmailIds.has(m._id))
    const tasks: Array<{ msgId: string; index: number }> = []
    for (const msg of selectedMsgs) {
      for (let i = 0; i < msg.attachments.length; i++) {
        const att = msg.attachments[i]
        if (!PARSEABLE.test(att.filename) || !att.driveFileId || att.uploadError) continue
        const job = msg.parseJobs?.find((j) => j.attachmentIndex === i)
        if (job && (job.status === 'pending' || job.status === 'processing')) continue
        tasks.push({ msgId: msg._id, index: i })
      }
    }
    if (tasks.length === 0) return
    setEmailBulkSending(true)
    try {
      await Promise.allSettled(
        tasks.map(({ msgId, index }) =>
          authApi.post(`/doc-tidy/messages/${msgId}/attachments/${index}/parse`)
        )
      )
      void fetchEmails(true)
    } finally {
      setEmailBulkSending(false)
    }
  }

  /** Send all selected PDF imports to the Tidy Agent (skips actively running/pending jobs). */
  const handleBulkSendPdfsToAgent = async () => {
    const selected = pdfImports.filter(
      (imp) =>
        pdfSelectedIds.has(imp._id) &&
        imp.parseJob?.status !== 'pending' &&
        imp.parseJob?.status !== 'processing'
    )
    if (selected.length === 0) return
    setPdfBulkSending(true)
    try {
      await Promise.allSettled(
        selected.map((imp) => authApi.post(`/doc-tidy/pdf-imports/${imp._id}/parse`))
      )
      void fetchPdfImports()
    } finally {
      setPdfBulkSending(false)
    }
  }

  /** Abort all running/pending parse jobs across selected email rows. */
  const handleBulkAbortEmails = async () => {
    const jobIds: string[] = []
    for (const msg of emailMessages) {
      if (!selectedEmailIds.has(msg._id)) continue
      for (const job of msg.parseJobs ?? []) {
        if (job.status === 'pending' || job.status === 'processing') jobIds.push(job._id)
      }
    }
    if (jobIds.length === 0) return
    setEmailBulkAborting(true)
    try {
      await Promise.allSettled(jobIds.map((id) => authApi.post(`/doc-tidy/parse-jobs/${id}/abort`)))
      void fetchEmails(true)
    } finally {
      setEmailBulkAborting(false)
    }
  }

  /** Abort all running/pending parse jobs across selected PDF imports. */
  const handleBulkAbortPdfs = async () => {
    const jobIds = pdfImports
      .filter(
        (imp) =>
          pdfSelectedIds.has(imp._id) &&
          imp.parseJob != null &&
          (imp.parseJob.status === 'pending' || imp.parseJob.status === 'processing')
      )
      .map((imp) => imp.parseJob!._id)
    if (jobIds.length === 0) return
    setPdfBulkAborting(true)
    try {
      await Promise.allSettled(jobIds.map((id) => authApi.post(`/doc-tidy/parse-jobs/${id}/abort`)))
      void fetchPdfImports()
    } finally {
      setPdfBulkAborting(false)
    }
  }

  /* Selection helpers */
  const allPdfOnPageSelected = filteredPdfImports.length > 0 && filteredPdfImports.every((i) => pdfSelectedIds.has(i._id))
  const somePdfOnPageSelected = filteredPdfImports.some((i) => pdfSelectedIds.has(i._id))

  /** True when every parseable attachment across all selected emails already has a completed parse job. */
  const allSelectedEmailsCompleted =
    selectedEmailIds.size > 0 &&
    emailMessages
      .filter((m) => selectedEmailIds.has(m._id))
      .every((m) => {
        let hasParseable = false
        for (let i = 0; i < m.attachments.length; i++) {
          const att = m.attachments[i]
          if (!PARSEABLE.test(att.filename) || !att.driveFileId || att.uploadError) continue
          hasParseable = true
          const job = m.parseJobs?.find((j) => j.attachmentIndex === i)
          if (!job || job.status !== 'completed') return false
        }
        return hasParseable
      })

  /** True when at least one selected email has a running (pending/processing) parse job. */
  const anySelectedEmailRunning =
    selectedEmailIds.size > 0 &&
    emailMessages
      .filter((m) => selectedEmailIds.has(m._id))
      .some((m) => m.parseJobs?.some((j) => j.status === 'pending' || j.status === 'processing'))

  /** True when at least one selected PDF import has a running parse job. */
  const anySelectedPdfRunning =
    pdfSelectedIds.size > 0 &&
    pdfImports
      .filter((imp) => pdfSelectedIds.has(imp._id))
      .some((imp) => imp.parseJob?.status === 'pending' || imp.parseJob?.status === 'processing')

  /** True when every selected PDF import already has a completed parse job. */
  const allSelectedPdfsCompleted =
    pdfSelectedIds.size > 0 &&
    pdfImports
      .filter((imp) => pdfSelectedIds.has(imp._id))
      .every((imp) => imp.parseJob?.status === 'completed')


  useEffect(() => {
    if (pdfSelectAllRef.current) {
      pdfSelectAllRef.current.indeterminate = somePdfOnPageSelected && !allPdfOnPageSelected
    }
  }, [somePdfOnPageSelected, allPdfOnPageSelected])

  const togglePdfRow = (id: string) => {
    setPdfSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAllPdfOnPage = () => {
    setPdfSelectedIds((prev) => {
      const next = new Set(prev)
      for (const imp of filteredPdfImports) {
        if (allPdfOnPageSelected) next.delete(imp._id); else next.add(imp._id)
      }
      return next
    })
  }

  const pdfHasActiveFilters = Boolean(pdfSearch || pdfDateFrom || pdfDateTo || pdfParseStatusFilter || Object.values(pdfColFilters).some((s) => s?.size))
  const orderedPdfCols = pdfColOrder
    .map((id) => PDF_IMPORT_COLUMNS.find((c) => c.id === id))
    .filter((c): c is PdfImportColumn => Boolean(c))

  /* ── Load workspaces on mount ── */
  const loadWorkspaces = useCallback(async () => {
    setWsLoading(true)
    setWsError(null)
    try {
      const res = await authApi.get<{ data: DocTidyWorkspace[] }>('/doc-tidy/workspaces')
      setWorkspaces(res.data)
    } catch (err) {
      setWsError(err instanceof Error ? err.message : 'Failed to load workspaces')
    } finally {
      setWsLoading(false)
    }
  }, [])

  useEffect(() => { void loadWorkspaces() }, [loadWorkspaces])

  /* ── Load organizations on mount ── */
  const loadOrganizations = useCallback(async () => {
    setOrgLoading(true)
    setOrgError(null)
    try {
      const res = await authApi.get<{ data: DocTidyOrganization[] }>('/doc-tidy/organizations')
      setOrganizations(res.data)
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : 'Failed to load organizations')
    } finally {
      setOrgLoading(false)
    }
  }, [])

  useEffect(() => { void loadOrganizations() }, [loadOrganizations])

  // Column orders are now loaded per-workspace inside enterWorkspace().
  // The old global-singleton fetch on mount has been removed.

  /** Persist column orders to the server scoped to the active workspace (non-blocking, fire-and-forget). */
  const saveColOrders = useCallback(
    (auditOrder: string[], emailOrder: WorkspaceEmailColumnId[], pdfOrder: PdfImportColumnId[], workspaceId: string) => {
      void authApi.put('/doc-tidy/ui-prefs', {
        workspaceId,
        auditColumnOrder: auditOrder,
        wsEmailColumnOrder: emailOrder,
        pdfImportColOrder: pdfOrder,
      }).catch(() => { /* Non-critical. */ })
    },
    []
  )

  /* Keep a stable ref so drag handlers always call the latest save without stale closures. */
  const saveColOrdersRef = useRef(saveColOrders)
  useEffect(() => { saveColOrdersRef.current = saveColOrders }, [saveColOrders])
  /* Same for the email/audit order values, so onDrop closures always read the current state. */
  const auditColOrderRef = useRef(auditColOrder)
  useEffect(() => { auditColOrderRef.current = auditColOrder }, [auditColOrder])
  const emailColOrderRef = useRef(emailColOrder)
  useEffect(() => { emailColOrderRef.current = emailColOrder }, [emailColOrder])

  /* ── Email search debounce ── */
  useEffect(() => {
    const t = setTimeout(() => setEmailDebouncedSearch(emailSearch.trim()), 350)
    return () => clearTimeout(t)
  }, [emailSearch])

  /* Reset email page when filters change */
  useEffect(() => { setEmailPage(1); setSelectedEmailIds(new Set()) }, [emailDebouncedSearch, emailDateFrom, emailDateTo, emailPageSize, emailParseStatusFilter])

  /* ── Manually trigger all enabled rules and refresh the email list ── */
  const handleFetchEmails = async () => {
    setEmailFetching(true)
    setEmailFetchNotice(null)
    setEmailError(null)
    try {
      const res = await authApi.post<{ data: RunAllResult }>('/doc-tidy/run')
      const totalImported = res.data.results.reduce((sum, r) => sum + (r.imported ?? 0), 0)
      const totalMatched = res.data.results.reduce((sum, r) => sum + (r.matched ?? 0), 0)
      const errors = res.data.results.filter((r) => r.error)
      if (errors.length > 0) {
        setEmailError(`${errors.length} rule${errors.length === 1 ? '' : 's'} failed: ${errors.map((e) => e.error).join('; ')}`)
      } else if (totalImported > 0) {
        setEmailFetchNotice(`Fetched ${totalImported} new email${totalImported === 1 ? '' : 's'} (${totalMatched} matched).`)
      } else {
        setEmailFetchNotice(`No new emails — ${totalMatched} message${totalMatched === 1 ? '' : 's'} matched, none were new.`)
      }
      // Refresh the table so newly imported emails appear immediately.
      void fetchEmails(true)
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to fetch emails')
    } finally {
      setEmailFetching(false)
    }
  }

  /* ── Fetch workspace emails (with parse jobs) ── */
  /** Generation counter — incremented on every fetch so stale responses are discarded. */
  const emailFetchGenRef = useRef(0)

  const fetchEmails = useCallback(async (silent = false) => {
    if (!activeWorkspace) return
    const gen = ++emailFetchGenRef.current
    if (!silent) setEmailLoading(true)
    setEmailError(null)
    try {
      const params = new URLSearchParams({
        workspaceId: activeWorkspace._id,
        page: String(emailPage),
        pageSize: String(emailPageSize),
      })
      if (emailDebouncedSearch) params.set('search', emailDebouncedSearch)
      if (emailDateFrom) params.set('dateFrom', emailDateFrom)
      if (emailDateTo) params.set('dateTo', emailDateTo)
      const res = await authApi.get<DocTidyMessagesResponse>(`/doc-tidy/messages?${params.toString()}`)
      if (gen !== emailFetchGenRef.current) return  // stale response — a newer fetch is in flight
      setEmailMessages(res.data)
      setEmailPagination({ total: res.pagination.total, pages: Math.max(1, res.pagination.pages), parsedCount: res.pagination.parsedCount ?? 0 })
    } catch (err) {
      if (gen !== emailFetchGenRef.current) return
      setEmailError(err instanceof Error ? err.message : 'Failed to load messages')
    } finally {
      if (gen === emailFetchGenRef.current && !silent) setEmailLoading(false)
    }
  }, [activeWorkspace, emailPage, emailPageSize, emailDebouncedSearch, emailDateFrom, emailDateTo])

  useEffect(() => {
    if (workspaceTab === 'emails') void fetchEmails()
  }, [fetchEmails, workspaceTab])

  /* Keep a stable ref so the SSE handler always calls the latest fetcher
     without needing to reconnect on every filter change. */
  const fetchEmailsRef = useRef(fetchEmails)
  useEffect(() => { fetchEmailsRef.current = fetchEmails }, [fetchEmails])
  const refetchEmailsSoon = useDebouncedRefetch(() => { void fetchEmailsRef.current(true) })

  /* SSE — subscribe while on the emails tab to keep parse statuses live */
  useEffect(() => {
    if (workspaceTab !== 'emails' || !activeWorkspace) return
    return subscribeDocTidyEvents(
      (event) => {
        if (event.type === 'imported') {
          refetchEmailsSoon()
        }
        if (event.type === 'parse_status' &&
            (event.parseStatus === 'completed' || event.parseStatus === 'failed')) {
          refetchEmailsSoon()
        }
        if (event.type === 'worker_status') {
          setWorkerOnline(event.workerOnline ?? false)
        }
        if (event.type === 'poll_status') {
          setPollerRunning(event.pollerRunning ?? false)
          setPollError(event.pollError ?? null)
          if (!event.pollerRunning) {
            // Reset the countdown whenever a poll finishes (success or error).
            setNextSyncAt(new Date(Date.now() + pollerIntervalMsRef.current))
            if (!event.pollError) {
              setShowFetchDone(true)
              if (fetchDoneTimerRef.current) clearTimeout(fetchDoneTimerRef.current)
              fetchDoneTimerRef.current = setTimeout(() => setShowFetchDone(false), 8_000)
            }
          }
        }
        if (event.type === 'ui_prefs' && event.workspaceId === activeWorkspace?._id) {
          if (event.auditColumnOrder && event.auditColumnOrder.length > 0) {
            const valid = event.auditColumnOrder.filter(
              (id) => INVOICE_AUDIT_COLUMNS.some((c) => c.id === id) || /^dyn_(doc|li)_/.test(id)
            )
            setAuditColOrder(mergeColOrder(valid, DEFAULT_AUDIT_COL_ORDER))
          }
          if (event.wsEmailColumnOrder && event.wsEmailColumnOrder.length > 0) {
            const valid = event.wsEmailColumnOrder.filter((id): id is WorkspaceEmailColumnId => WORKSPACE_EMAIL_COLUMNS.some((c) => c.id === id))
            setEmailColOrder(mergeColOrder(valid, DEFAULT_EMAIL_COL_ORDER) as WorkspaceEmailColumnId[])
          }
          if (event.pdfImportColOrder && event.pdfImportColOrder.length > 0) {
            const valid = event.pdfImportColOrder.filter((id): id is PdfImportColumnId => PDF_IMPORT_COLUMNS.some((c) => c.id === id))
            setPdfColOrder(mergeColOrder(valid, DEFAULT_PDF_IMPORT_COL_ORDER) as PdfImportColumnId[])
          }
        }
      },
      () => {}
    )
  }, [workspaceTab, activeWorkspace, refetchEmailsSoon])

  /* SSE — subscribe while on the audit tab to auto-populate completed results */
  const refetchAllJobsSoon = useDebouncedRefetch(() => { void fetchAllJobsRef.current() })
  useEffect(() => {
    if (workspaceTab !== 'audit' || !activeWorkspace) return
    return subscribeDocTidyEvents(
      (event) => {
        if (event.type === 'parse_status' && event.parseStatus === 'completed') {
          refetchAllJobsSoon()
        }
        if (event.type === 'worker_status') {
          setWorkerOnline(event.workerOnline ?? false)
        }
        if (event.type === 'ui_prefs' && event.workspaceId === activeWorkspace?._id) {
          if (event.auditColumnOrder && event.auditColumnOrder.length > 0) {
            const valid = event.auditColumnOrder.filter(
              (id) => INVOICE_AUDIT_COLUMNS.some((c) => c.id === id) || /^dyn_(doc|li)_/.test(id)
            )
            setAuditColOrder(mergeColOrder(valid, DEFAULT_AUDIT_COL_ORDER))
          }
          if (event.wsEmailColumnOrder && event.wsEmailColumnOrder.length > 0) {
            const valid = event.wsEmailColumnOrder.filter((id): id is WorkspaceEmailColumnId => WORKSPACE_EMAIL_COLUMNS.some((c) => c.id === id))
            setEmailColOrder(mergeColOrder(valid, DEFAULT_EMAIL_COL_ORDER) as WorkspaceEmailColumnId[])
          }
          if (event.pdfImportColOrder && event.pdfImportColOrder.length > 0) {
            const valid = event.pdfImportColOrder.filter((id): id is PdfImportColumnId => PDF_IMPORT_COLUMNS.some((c) => c.id === id))
            setPdfColOrder(mergeColOrder(valid, DEFAULT_PDF_IMPORT_COL_ORDER) as PdfImportColumnId[])
          }
        }
      },
      () => {}
    )
  }, [workspaceTab, activeWorkspace, refetchAllJobsSoon])

  /* SSE — refresh PDF imports when a parse job status changes */
  const fetchPdfImportsRef = useRef(fetchPdfImports)
  useEffect(() => { fetchPdfImportsRef.current = fetchPdfImports }, [fetchPdfImports])
  const refetchPdfImportsSoon = useDebouncedRefetch(() => { void fetchPdfImportsRef.current() })
  useEffect(() => {
    if (workspaceTab !== 'pdf-imports' || !activeWorkspace) return
    return subscribeDocTidyEvents(
      (event) => {
        if (event.type === 'parse_status') refetchPdfImportsSoon()
        if (event.type === 'worker_status') setWorkerOnline(event.workerOnline ?? false)
      },
      () => {}
    )
  }, [workspaceTab, activeWorkspace, refetchPdfImportsSoon])

  /* Fetch initial worker status whenever a workspace is active */
  useEffect(() => {
    if (!activeWorkspace) return
    authApi.get<{ data: { connected: boolean } }>('/doc-tidy/worker/status')
      .then((res) => setWorkerOnline(res.data.connected))
      .catch(() => setWorkerOnline(false))
  }, [activeWorkspace])

  /* Indeterminate state on the select-all checkbox */
  const allEmailsOnPageSelected =
    filteredEmailMessages.length > 0 && filteredEmailMessages.every((m) => selectedEmailIds.has(m._id))
  const someEmailsOnPageSelected = filteredEmailMessages.some((m) => selectedEmailIds.has(m._id))
  useEffect(() => {
    if (selectAllEmailRef.current) {
      selectAllEmailRef.current.indeterminate = someEmailsOnPageSelected && !allEmailsOnPageSelected
    }
  }, [someEmailsOnPageSelected, allEmailsOnPageSelected])

  const toggleEmailRow = (id: string) => {
    setSelectedEmailIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAllEmailsOnPage = () => {
    setSelectedEmailIds((prev) => {
      const next = new Set(prev)
      for (const msg of filteredEmailMessages) {
        if (allEmailsOnPageSelected) next.delete(msg._id)
        else next.add(msg._id)
      }
      return next
    })
  }

  /* ── Audit search debounce ── */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedAuditSearch(auditSearch.trim()), 350)
    return () => clearTimeout(t)
  }, [auditSearch])

  useEffect(() => { setOrderPage(1); setSelectedRowKeys(new Set()); setSelectedJobIds(new Set()) }, [debouncedAuditSearch, auditDateFrom, auditDateTo, orderPageSize])

  /* ── Fetch order imports (primary table rows) ── */
  /** Generation counter — incremented on every fetch so stale responses are discarded. */
  const orderFetchGenRef = useRef(0)

  const fetchOrderImports = useCallback(async () => {
    if (!activeWorkspace) return
    const gen = ++orderFetchGenRef.current
    setOrderLoading(true)
    setOrderError(null)
    try {
      const params = new URLSearchParams({
        workspaceId: activeWorkspace._id,
        page: String(orderPage),
        pageSize: String(orderPageSize),
      })
      if (debouncedAuditSearch) params.set('search', debouncedAuditSearch)
      const res = await authApi.get<OrderImportsResponse>(`/doc-tidy/order-imports?${params.toString()}`)
      if (gen !== orderFetchGenRef.current) return  // stale response — a newer fetch is in flight
      setOrderImports(res.data)
      setOrderPagination({ total: res.pagination.total, pages: Math.max(1, res.pagination.pages) })
    } catch (err) {
      if (gen !== orderFetchGenRef.current) return
      setOrderError(err instanceof Error ? err.message : 'Failed to load order imports')
    } finally {
      if (gen === orderFetchGenRef.current) setOrderLoading(false)
    }
  }, [activeWorkspace, orderPage, orderPageSize, debouncedAuditSearch])

  useEffect(() => {
    if (workspaceTab === 'audit') void fetchOrderImports()
  }, [workspaceTab, fetchOrderImports])

  /* ── Fetch all parse jobs (for invoice matching — fallback for uncached rows) ──
   *
   * Once every row in the workspace has a `matchedInvoices[]` cache written by
   * the server, this call is skipped entirely so the table stays fast even as
   * the parse-job collection grows into the thousands.
   */
  const fetchAllJobs = useCallback(async () => {
    if (!activeWorkspace) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        status: 'completed',
        workspaceId: activeWorkspace._id,
        page: '1',
        pageSize: '5000',
      })
      const res = await authApi.get<ParseJobsResponse>(`/doc-tidy/parse-jobs?${params.toString()}`)
      setJobs(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoice data for matching')
    } finally {
      setLoading(false)
    }
  }, [activeWorkspace])

  useEffect(() => {
    if (workspaceTab !== 'audit') return
    // Header-only workspaces use jobs as the primary display data source —
    // always fetch them regardless of the orderImports cache state.
    // For full-mode workspaces, skip the fetch if every row already has a
    // server-written matchedInvoices[] cache so the table stays fast.
    // A row is considered cached when it has at least one entry in
    // matchedInvoices[] (new) OR a legacy matchedInvoice (singular) set.
    if (!isHeaderOnly && orderImports.length > 0 && orderImports.every(
      (o) => (o.matchedInvoices != null && o.matchedInvoices.length > 0) || o.matchedInvoice != null
    )) {
      setJobs([])   // clear any stale jobs from a previous workspace
      setLoading(false)
      return
    }
    void fetchAllJobs()
  }, [workspaceTab, fetchAllJobs, orderImports, isHeaderOnly])

  /* Keep stable refs for SSE-triggered refetches */
  const fetchOrderImportsRef = useRef(fetchOrderImports)
  const fetchAllJobsRef = useRef(fetchAllJobs)
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { fetchOrderImportsRef.current = fetchOrderImports }, [fetchOrderImports])
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { fetchAllJobsRef.current = fetchAllJobs }, [fetchAllJobs])

  /* ── Trigger DC COGS refresh for any pending rows in the workspace ── */
  const triggerCogsRefresh = useCallback(async () => {
    if (!activeWorkspace) return
    try {
      await authApi.post(`/doc-tidy/order-imports/workspace/${activeWorkspace._id}/refresh-cogs`)
    } catch {
      // Non-critical: COGS refresh failing should not surface as a blocking error.
    }
  }, [activeWorkspace])

  /* ── Trigger server-side invoice match cache rebuild for uncached rows ── */
  const triggerMatchCacheRebuild = useCallback(async () => {
    if (!activeWorkspace) return
    try {
      await authApi.post(`/doc-tidy/order-imports/workspace/${activeWorkspace._id}/rebuild-match-cache`)
    } catch {
      // Non-critical.
    }
  }, [activeWorkspace])

  /* Auto-trigger on audit tab open:
     1. Kick off COGS refresh and match cache rebuild (fire-and-forget).
     2. Re-poll order imports 4 s later to surface the newly written values. */
  useEffect(() => {
    if (workspaceTab !== 'audit' || !activeWorkspace) return
    void Promise.all([triggerCogsRefresh(), triggerMatchCacheRebuild()]).then(() => {
      setTimeout(() => void fetchOrderImportsRef.current(), 4000)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceTab, activeWorkspace])

  /* ── Handle order file import ── */
  const handleImportFile = async (file: File) => {
    if (!activeWorkspace) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      setImportError('Please select a CSV or Excel (.xlsx) file.')
      return
    }
    setImporting(true)
    setImportError(null)
    setImportSuccess(null)
    try {
      const formData = new FormData()
      formData.append('workspaceId', activeWorkspace._id)
      formData.append('file', file)
      const res = await authApi.upload<{ count: number; importBatchId: string }>('/doc-tidy/order-imports', formData)
      setImportSuccess({ count: res.count, batchId: res.importBatchId })
      setShowImportModal(false)
      void fetchOrderImportsRef.current()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  /* ── Workspace navigation ── */
  const enterWorkspace = (ws: DocTidyWorkspace) => {
    setActiveWorkspace(ws)
    setView('audit')
    setWorkspaceTab('audit')
    setOrderPage(1)
    setAuditSearch('')
    setDebouncedAuditSearch('')
    setSelectedRowKeys(new Set())
    setColFilters({})
    setFilterOpenColId(null)
    setFilterAnchorRect(null)
    setError(null)
    setOrderError(null)
    setImportSuccess(null)
    // Reset email sub-view state
    setEmailPage(1)
    setEmailSearch('')
    setEmailDebouncedSearch('')
    setEmailDateFrom('')
    setEmailDateTo('')
    setEmailError(null)
    setEmailMessages([])
    setSelectedEmailIds(new Set())

    // Reload workspace-scoped column visibility from localStorage.
    // Pass importMode so header-only workspaces start with line-item columns hidden.
    setColVisibility(loadAuditColumnVisibility(ws._id, ws.importMode))

    // Reset column orders to defaults, then fetch this workspace's saved orders.
    setAuditColOrder(DEFAULT_AUDIT_COL_ORDER)
    setEmailColOrder(DEFAULT_EMAIL_COL_ORDER)
    setPdfColOrder(DEFAULT_PDF_IMPORT_COL_ORDER)
    authApi
      .get<{ data: { auditColumnOrder?: string[]; wsEmailColumnOrder?: string[]; pdfImportColOrder?: string[] } }>(
        `/doc-tidy/ui-prefs?workspaceId=${ws._id}`
      )
      .then((res) => {
        const { auditColumnOrder, wsEmailColumnOrder, pdfImportColOrder } = res.data
        if (auditColumnOrder && auditColumnOrder.length > 0) {
          const valid = auditColumnOrder.filter(
            (id) => INVOICE_AUDIT_COLUMNS.some((c) => c.id === id) || /^dyn_(doc|li)_/.test(id)
          )
          setAuditColOrder(mergeColOrder(valid, DEFAULT_AUDIT_COL_ORDER))
        }
        if (wsEmailColumnOrder && wsEmailColumnOrder.length > 0) {
          const valid = wsEmailColumnOrder.filter((id): id is WorkspaceEmailColumnId =>
            WORKSPACE_EMAIL_COLUMNS.some((c) => c.id === id)
          )
          setEmailColOrder(mergeColOrder(valid, DEFAULT_EMAIL_COL_ORDER) as WorkspaceEmailColumnId[])
        }
        if (pdfImportColOrder && pdfImportColOrder.length > 0) {
          const valid = pdfImportColOrder.filter((id): id is PdfImportColumnId =>
            PDF_IMPORT_COLUMNS.some((c) => c.id === id)
          )
          setPdfColOrder(mergeColOrder(valid, DEFAULT_PDF_IMPORT_COL_ORDER) as PdfImportColumnId[])
        }
      })
      .catch(() => { /* Non-critical — silently fall back to defaults. */ })
  }

  const leaveWorkspace = () => {
    // Go back to the org's workspace list if we came from one, else org landing
    if (activeOrg) {
      setView('workspaces')
    } else {
      setView('organizations')
    }
    setActiveWorkspace(null)
    setJobs([])
    setOrderImports([])
    setOrderPagination({ total: 0, pages: 1 })
    setWorkspaceTab('audit')
    setAuditSearch('')
    setDebouncedAuditSearch('')
    setSelectedRowKeys(new Set())
    setColFilters({})
    setFilterOpenColId(null)
    setFilterAnchorRect(null)
    setEmailMessages([])
    setEmailPagination({ total: 0, pages: 1, parsedCount: 0 })
    setEmailSearch('')
    setEmailDateFrom('')
    setEmailDateTo('')
    setEmailParseStatusFilter('')
    setEmailColFilters({})
    setPdfImports([])
    setPdfImportsPagination({ total: 0, pages: 1, parsedCount: 0 })
    setPdfSearch('')
    setPdfDateFrom('')
    setPdfDateTo('')
    setPdfParseStatusFilter('')
    setPdfColFilters({})
    // Reset column orders so no stale workspace layout bleeds into the next open.
    setAuditColOrder(DEFAULT_AUDIT_COL_ORDER)
    setEmailColOrder(DEFAULT_EMAIL_COL_ORDER)
    setPdfColOrder(DEFAULT_PDF_IMPORT_COL_ORDER)
  }

  /* ── Organization navigation ── */
  const enterOrg = (org: DocTidyOrganization) => {
    if (org.hasAccess === false) return   // safety guard — locked orgs must not be opened
    setActiveOrg(org)
    setView('workspaces')
  }

  const leaveOrg = () => {
    setActiveOrg(null)
    setView('organizations')
  }

  const openEditor = (target: DocTidyWorkspace | 'new') => {
    setEditTarget(target)
  }

  const openOrgEditor = (target: DocTidyOrganization | 'new') => {
    setEditOrgTarget(target)
  }

  const handleWorkspaceSaved = (saved: DocTidyWorkspace) => {
    setWorkspaces((prev) => {
      const idx = prev.findIndex((w) => w._id === saved._id)
      if (idx === -1) return [...prev, saved]
      const next = [...prev]
      next[idx] = saved
      return next
    })
    if (activeWorkspace?._id === saved._id) setActiveWorkspace(saved)
    setEditTarget(null)
    setMoveTarget(null)
  }

  const handleOrgSaved = (saved: DocTidyOrganization) => {
    setOrganizations((prev) => {
      const idx = prev.findIndex((o) => o._id === saved._id)
      if (idx === -1) return [...prev, saved]
      const next = [...prev]
      next[idx] = saved
      return next
    })
    setEditOrgTarget(null)
  }

  const handleDeleteWorkspace = async (ws: DocTidyWorkspace) => {
    try {
      await authApi.delete(`/doc-tidy/workspaces/${ws._id}`)
      setWorkspaces((prev) => prev.filter((w) => w._id !== ws._id))
      if (activeWorkspace?._id === ws._id) leaveWorkspace()
    } catch (err) {
      setWsError(err instanceof Error ? err.message : 'Failed to delete workspace')
    }
  }

  const handleDeleteOrg = async (org: DocTidyOrganization) => {
    try {
      await authApi.delete(`/doc-tidy/organizations/${org._id}`)
      setOrganizations((prev) => prev.filter((o) => o._id !== org._id))
      // Workspaces in the deleted org become unassigned — clear their organizationId in local state
      setWorkspaces((prev) =>
        prev.map((w) => w.organizationId === org._id ? { ...w, organizationId: undefined } : w)
      )
      if (activeOrg?._id === org._id) leaveOrg()
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : 'Failed to delete organization')
    }
  }

  /* ── Column helpers ── */
  const handleColVisChange = (next: Record<InvoiceAuditColumnId, boolean>) => {
    setColVisibility(next)
    if (activeWorkspace) saveAuditColumnVisibility(next, activeWorkspace._id)
  }

  /** Persist collapsed weeks to localStorage whenever the set changes. */
  useEffect(() => {
    saveCollapsedWeeks(collapsedWeeks)
  }, [collapsedWeeks])

  /**
   * Pre-compute all invoice matches for every loaded order import row.
   * Keyed by order._id for O(1) lookup in the render loop.
   * Each value is an array — multiple entries when a vendor splits delivery
   * across more than one invoice / PDF.
   */
  const invoiceMatchMap = useMemo<Map<string, InvoiceMatch[]>>(() => {
    const map = new Map<string, InvoiceMatch[]>()
    for (const order of orderImports) {
      map.set(order._id, findAllInvoiceMatches(order, jobs))
    }
    return map
  }, [orderImports, jobs])

  /** Fast lookup of parse jobs by id — used to check vendorNeedsSetup in table rows. */
  const jobsById = useMemo(() => {
    const map = new Map<string, ParseJobListItem>()
    for (const job of jobs) map.set(job._id, job)
    return map
  }, [jobs])

  /**
   * Collect unique string values for a given column across all currently loaded
   * order import rows. Used to populate the column filter dropdown.
   * Returns Map<displayValue, count> ('' key = blank/empty cells).
   */
  const getColUniqueValues = useCallback((colId: InvoiceAuditColumnId): Map<string, number> => {
    const vals = new Map<string, number>()
    if (isHeaderOnly) {
      // Header-only workspaces: rows are parse jobs, not order imports
      for (const job of jobs) {
        const val = headerOnlyColStr(colId, job).trim()
        vals.set(val, (vals.get(val) ?? 0) + 1)
      }
    } else {
      for (const order of orderImports) {
        const matches = invoiceMatchMap.get(order._id) ?? []
        const val = auditColStr(colId, order, matches).trim()
        vals.set(val, (vals.get(val) ?? 0) + 1)
      }
    }
    return vals
  }, [isHeaderOnly, jobs, orderImports, invoiceMatchMap])

  /**
   * Client-side filter applied on top of the server-fetched `orderImports`.
   *
   * - Column filters (AND-ed together): exact value matching per visible column.
   * - Date range filter: matched against the resolved invoice date, falling back
   *   to processedDate then purchasedDate — same priority used by the week dividers.
   *   Input values come from `<input type="date">` so they are already YYYY-MM-DD.
   */
  const filteredOrderImports = useMemo(() => {
    const activeEntries = Object.entries(colFilters).filter(
      (entry): entry is [InvoiceAuditColumnId, Set<string>] => entry[1] != null && entry[1].size > 0
    )
    const hasDateFilter = Boolean(auditDateFrom || auditDateTo)

    if (activeEntries.length === 0 && !hasDateFilter) return orderImports

    return orderImports.filter((order) => {
      // ── Column filters ──
      if (activeEntries.length > 0) {
        const matches = invoiceMatchMap.get(order._id) ?? []
        const passesCol = activeEntries.every(([colId, allowed]) => {
          const val = auditColStr(colId, order, matches).trim()
          if (!val) return allowed.has(BLANK_SENTINEL)
          return allowed.has(val)
        })
        if (!passesCol) return false
      }

      // ── Date range filter ──
      // Priority: matchedInvoice.invoiceDate → processedDate → purchasedDate
      if (hasDateFilter) {
        const raw = order.matchedInvoice?.invoiceDate ?? order.processedDate ?? order.purchasedDate ?? ''
        const ds = toISODateStr(raw)
        if (!ds) return false                              // no parseable date → hide
        if (auditDateFrom && ds < auditDateFrom) return false
        if (auditDateTo   && ds > auditDateTo)   return false
      }

      return true
    })
  }, [orderImports, colFilters, invoiceMatchMap, auditDateFrom, auditDateTo])

  const activeFilterCount = Object.values(colFilters).filter((s) => s != null && s.size > 0).length

  /**
   * For header-only workspaces: completed parse jobs filtered by the active
   * date range (using invoice date extracted from the job's JSON output).
   */
  const filteredHeaderOnlyJobs = useMemo(() => {
    if (!isHeaderOnly) return jobs

    const activeColEntries = Object.entries(colFilters).filter(
      (entry): entry is [InvoiceAuditColumnId, Set<string>] => entry[1] != null && entry[1].size > 0
    )
    const hasDateFilter = Boolean(auditDateFrom || auditDateTo)

    if (activeColEntries.length === 0 && !hasDateFilter) return jobs

    return jobs.filter((job) => {
      // ── Column filters ──
      if (activeColEntries.length > 0) {
        const passesCol = activeColEntries.every(([colId, allowed]) => {
          const val = headerOnlyColStr(colId, job).trim()
          if (!val) return allowed.has(BLANK_SENTINEL)
          return allowed.has(val)
        })
        if (!passesCol) return false
      }

      // ── Date range filter ──
      if (hasDateFilter) {
        const raw = extractJsonField(job.jsonOutput ?? null,
          'invoice_date', 'date', 'billing_date', 'bill_date', 'invoice date')
        const ds = toISODateStr(raw)
        if (!ds) return false
        if (auditDateFrom && ds < auditDateFrom) return false
        if (auditDateTo   && ds > auditDateTo)   return false
      }

      return true
    })
  }, [isHeaderOnly, jobs, colFilters, auditDateFrom, auditDateTo])

  /* ── Org / workspace grouping ── */
  /** Workspaces that have no organization assignment (visible to all users). */
  const unassignedWorkspaces = useMemo(
    () => workspaces.filter((w) => !w.organizationId),
    [workspaces]
  )

  /** Workspaces belonging to the currently active organization. */
  const orgWorkspaces = useMemo(
    () => (activeOrg ? workspaces.filter((w) => w.organizationId === activeOrg._id) : []),
    [workspaces, activeOrg]
  )

  /* ── Email column filter helpers ── */
  const getEmailColUniqueValues = useCallback((colId: WorkspaceEmailColumnId): Map<string, number> => {
    const vals = new Map<string, number>()
    for (const msg of emailMessages) {
      const val = emailColStr(colId, msg).trim()
      vals.set(val, (vals.get(val) ?? 0) + 1)
    }
    return vals
  }, [emailMessages])

  const emailActiveFilterCount = Object.values(emailColFilters).filter((s) => s != null && s.size > 0).length + (emailParseStatusFilter ? 1 : 0)

  /* ── PDF import column filter helpers ── */
  const getPdfColUniqueValues = useCallback((colId: PdfImportColumnId): Map<string, number> => {
    const vals = new Map<string, number>()
    for (const imp of pdfImports) {
      const val = pdfColStr(colId, imp).trim()
      vals.set(val, (vals.get(val) ?? 0) + 1)
    }
    return vals
  }, [pdfImports])

  const pdfActiveFilterCount = Object.values(pdfColFilters).filter((s) => s != null && s.size > 0).length

  const visibleCols = useMemo<InvoiceAuditColumn[]>(
    () => {
      const colById = new Map(INVOICE_AUDIT_COLUMNS.map((c) => [c.id, c]))
      return auditColOrder
        .map((id) => colById.get(id as InvoiceAuditColumnId))
        .filter((c): c is InvoiceAuditColumn => c !== undefined && colVisibility[c.id])
    },
    [auditColOrder, colVisibility]
  )

  /** Email columns in user-defined order. */
  const orderedEmailCols = useMemo(
    () =>
      emailColOrder
        .map((id) => WORKSPACE_EMAIL_COLUMNS.find((c) => c.id === id))
        .filter((c): c is WorkspaceEmailColumn => c !== undefined),
    [emailColOrder]
  )

  /* ── Selection helpers (audit table — one key per order import row) ── */
  const pageRowKeys = useMemo(() => filteredOrderImports.map((o) => o._id), [filteredOrderImports])
  const allPageSelected = pageRowKeys.length > 0 && pageRowKeys.every((k) => selectedRowKeys.has(k))
  const somePageSelected = pageRowKeys.some((k) => selectedRowKeys.has(k))
  // Reserved for pagination display (not yet wired to JSX)
  void (orderPagination.total === 0 ? 0 : (orderPage - 1) * orderPageSize + 1)  // auditStartItem
  void Math.min(orderPage * orderPageSize, orderPagination.total)                // auditEndItem
  const auditSelectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (auditSelectAllRef.current) {
      auditSelectAllRef.current.indeterminate = somePageSelected && !allPageSelected
    }
  }, [somePageSelected, allPageSelected])

  const toggleAuditRow = (rowKey: string) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
  }
  const toggleAllAuditPage = () => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev)
      for (const key of pageRowKeys) {
        if (allPageSelected) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }

  /* ── Header-only job selection ── */
  const allJobsSelected = filteredHeaderOnlyJobs.length > 0 && filteredHeaderOnlyJobs.every((j) => selectedJobIds.has(j._id))
  const someJobsSelected = filteredHeaderOnlyJobs.some((j) => selectedJobIds.has(j._id))
  const jobSelectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (jobSelectAllRef.current) {
      jobSelectAllRef.current.indeterminate = someJobsSelected && !allJobsSelected
    }
  }, [someJobsSelected, allJobsSelected])

  const toggleJobRow = (id: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAllJobs = () => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev)
      for (const j of filteredHeaderOnlyJobs) {
        if (allJobsSelected) next.delete(j._id)
        else next.add(j._id)
      }
      return next
    })
  }

  /* ── Header-only parse-job delete handlers ── */
  const handleDeleteParseJob = async (job: ParseJobListItem) => {
    setJobDeleting(true)
    try {
      await authApi.delete(`/doc-tidy/parse-jobs/${job._id}`)
      setJobs((prev) => prev.filter((j) => j._id !== job._id))
      setSelectedJobIds((prev) => { const next = new Set(prev); next.delete(job._id); return next })
      setConfirmDeleteJob(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete parse job')
      setConfirmDeleteJob(null)
    } finally {
      setJobDeleting(false)
    }
  }

  const handleBulkDeleteParseJobs = async () => {
    const ids = Array.from(selectedJobIds)
    setJobBulkDeleting(true)
    try {
      await authApi.post('/doc-tidy/parse-jobs/bulk-delete', { ids })
      setJobs((prev) => prev.filter((j) => !selectedJobIds.has(j._id)))
      setSelectedJobIds(new Set())
      setConfirmBulkDeleteJobs(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete parse jobs')
      setConfirmBulkDeleteJobs(false)
    } finally {
      setJobBulkDeleting(false)
    }
  }

  /* ── Excel export ── */
  const exportToExcel = async (mode: 'selection' | 'all') => {
    if (!activeWorkspace) return
    setExporting(true)
    setError(null)
    try {
      const XLSX = await import('xlsx')

      let exportOrders: DocTidyOrderImport[]
      if (mode === 'selection') {
        exportOrders = orderImports.filter((o) => selectedRowKeys.has(o._id))
      } else {
        // Fetch all order imports (search is server-side; date filter is client-side below)
        const params = new URLSearchParams({
          workspaceId: activeWorkspace._id,
          page: '1',
          pageSize: '5000',
        })
        if (debouncedAuditSearch) params.set('search', debouncedAuditSearch)
        const res = await authApi.get<OrderImportsResponse>(`/doc-tidy/order-imports?${params.toString()}`)
        exportOrders = res.data
        // Apply the same client-side date filter used by the table.
        if (auditDateFrom || auditDateTo) {
          exportOrders = exportOrders.filter((o) => {
            const ds = toISODateStr(o.matchedInvoice?.invoiceDate ?? o.processedDate ?? o.purchasedDate ?? '')
            if (!ds) return false
            if (auditDateFrom && ds < auditDateFrom) return false
            if (auditDateTo && ds > auditDateTo) return false
            return true
          })
        }
      }

      const rows: Record<string, string>[] = []
      for (const order of exportOrders) {
        const matches = invoiceMatchMap.get(order._id) ?? findAllInvoiceMatches(order, jobs)
        const row: Record<string, string> = {}
        for (const col of visibleCols) {
          row[col.label] = auditColStr(col.id, order, matches)
        }
        rows.push(row)
      }

      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Invoice Audit')
      XLSX.writeFile(wb, `invoice-audit-${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const inputClass =
    'text-[10px] border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]'

  /* ── Per-row cell renderer (new v2 columns) ── */
  const auditCellFor = (
    colId: InvoiceAuditColumnId,
    order: DocTidyOrderImport,
    matches: InvoiceMatch[]
  ): React.ReactNode => {
    // ── Order import fields (always from the DB row directly) ──
    switch (colId) {
      case 'poNumber':      return monoCell(order.poNumber)
      case 'orderSku':      return monoCell(order.orderSku)
      case 'orderQty':      return numCell(order.orderQty)
      case 'lesd':          return textCell(order.lesd ?? '')
      case 'customerName': {
        const name = order.customerName ?? ''
        if (!name) return emDash
        const words = name.trim().split(/\s+/)
        const display = words.length > 3 ? words.slice(0, 3).join(' ') + '…' : name
        return (
          <span className="block max-w-[110px] truncate text-[var(--text-100)]" title={name}>
            {display}
          </span>
        )
      }
      case 'purchasedDate': return textCell(order.purchasedDate ?? '')
      case 'status':        return textCell(order.status ?? '')
      case 'dcCogs': {
        if (order.dcCogs == null) {
          return <span className="text-[10px] italic text-[var(--text-200)]">pending…</span>
        }
        if (order.dcCogs === 'n/a') return emDash
        return numCell(order.dcCogs)
      }
      default: break
    }

    // ── Invoice fields — prefer matchedInvoices cache, fall back to client matches ──
    const inv = resolveInvoiceFields(order, matches)

    switch (colId) {
      case 'invoiceSku':    return monoCell(inv.invoiceSku)
      case 'invoiceDate':   return textCell(inv.invoiceDate)
      case 'invoiceNumber': {
        if (!inv.invoiceNumber) return emDash
        if (inv.driveFileId) {
          return (
            <span className="inline-flex items-center gap-1 flex-wrap">
              <a href={`https://drive.google.com/file/d/${inv.driveFileId}/view`}
                target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[10px] text-[var(--accent-200)] hover:underline">
                <svg className="h-3 w-3 shrink-0 text-rose-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M7 3a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5H7zm5 1.5L17.5 10H12V4.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16z"/>
                </svg>
                {inv.invoiceNumber}
              </a>
              {inv.matchCount > 1 && (
                <Tooltip content={`${inv.matchCount} invoices matched for this PO+SKU`}>
                  <span className="rounded px-1 py-0.5 text-[9px] font-semibold leading-none bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400 cursor-default select-none">
                    +{inv.matchCount - 1}
                  </span>
                </Tooltip>
              )}
            </span>
          )
        }
        return (
          <span className="inline-flex items-center gap-1">
            {monoCell(inv.invoiceNumber)}
            {inv.matchCount > 1 && (
              <Tooltip content={`${inv.matchCount} invoices matched for this PO+SKU`}>
                <span className="rounded px-1 py-0.5 text-[9px] font-semibold leading-none bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400 cursor-default select-none">
                  +{inv.matchCount - 1}
                </span>
              </Tooltip>
            )}
          </span>
        )
      }
      case 'terms':       return textCell(inv.terms)
      case 'itemCost': {
        const effectiveCost = resolveEffectiveCost(inv)
        if (!effectiveCost) return emDash
        const discounted = hasDiscount(inv)
        return (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <span className="text-[var(--text-100)]">{effectiveCost}</span>
            {discounted && (
              <Tooltip richContent={(() => {
                  // Compute display discount pct
                  let pctDisplay = ''
                  if (inv.discountPct) {
                    pctDisplay = inv.discountPct.trim().replace(/%+$/, '') + '%'
                  } else if (inv.itemCost && inv.discountedPrice) {
                    const orig = parseFloat(inv.itemCost.replace(/[^0-9.-]/g, ''))
                    const disc = parseFloat(inv.discountedPrice.replace(/[^0-9.-]/g, ''))
                    if (!isNaN(orig) && !isNaN(disc) && orig > 0) {
                      pctDisplay = ((1 - disc / orig) * 100).toFixed(1) + '%'
                    }
                  }
                  return (
                    <div>
                      {/* Header */}
                      <div className="border-b border-white/10 bg-white/5 px-3.5 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                          Discount Breakdown
                        </p>
                      </div>
                      {/* Rows */}
                      <div className="divide-y divide-white/5 px-1 py-1">
                        {inv.itemCost && (
                          <div className="flex items-center justify-between gap-6 px-2.5 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[10px] text-slate-400">$</span>
                              <span className="text-[10px] text-slate-400">List price</span>
                            </div>
                            <span className="tabular-nums text-[10px] text-slate-300 line-through decoration-slate-600">
                              {inv.itemCost}
                            </span>
                          </div>
                        )}
                        {pctDisplay && (
                          <div className="flex items-center justify-between gap-6 px-2.5 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-400">%</span>
                              <span className="text-[10px] text-slate-400">Discount</span>
                            </div>
                            <span className="tabular-nums text-[10px] font-semibold text-amber-400">
                              {pctDisplay} off
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-6 px-2.5 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-400">✓</span>
                            <span className="text-[10px] font-semibold text-slate-300">You pay</span>
                          </div>
                          <span className="tabular-nums text-[10px] font-bold text-emerald-400">
                            {effectiveCost}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })()}>
                <span className="rounded px-1 py-0.5 text-[9px] font-semibold leading-none bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 cursor-default select-none">
                  % OFF
                </span>
              </Tooltip>
            )}
          </span>
        )
      }
      case 'invoiceQty':  return numCell(inv.invoiceQty)
      case 'discountedCostPct': {
        if (!inv.discountedPrice && !inv.discountPct) return emDash
        // Strip any trailing % the AI may have already included before re-adding it.
        const pctDisplay = inv.discountPct ? inv.discountPct.trim().replace(/%+$/, '') : ''
        return (
          <span className="tabular-nums text-[var(--text-100)]">
            {inv.discountedPrice}
            {inv.discountedPrice && pctDisplay ? ' ' : ''}
            {pctDisplay ? <span className="text-[var(--text-200)]">({pctDisplay}%)</span> : null}
          </span>
        )
      }
      case 'dropshipFee': return numCell(inv.dropshipFee)
      case 'miscCharges': return numCell(inv.miscCharges)
      case 'totalCost':   return numCell(inv.totalCost)
      case 'parsedAt': {
        // Show the earliest cachedAt across all matched invoices
        const cachedDates = [
          ...(order.matchedInvoices?.map((c) => c.cachedAt).filter(Boolean) ?? []),
          ...(order.matchedInvoice?.cachedAt ? [order.matchedInvoice.cachedAt] : []),
        ]
        const earliest = cachedDates.reduce<string | undefined>((acc, d) => {
          const s = typeof d === 'string' ? d : (d as Date).toISOString()
          return !acc || s < acc ? s : acc
        }, undefined)
        if (!earliest) return emDash
        return (
          <span title={formatDateTime(earliest)} className="text-[var(--text-200)]">
            {formatDate(earliest)}
          </span>
        )
      }

      // ── Computed ──
      case 'discrepancy': return discrepancyCell(order, matches)

      default: return null
    }
  }

  /**
   * Cell renderer for header-only workspaces where parse jobs are the primary
   * data source.  Extracts all values directly from `job.jsonOutput`.
   */
  const headerOnlyCellFor = (colId: InvoiceAuditColumnId, job: ParseJobListItem): React.ReactNode => {
    const json = job.jsonOutput ?? null
    switch (colId) {
      case 'poNumber':
        return monoCell(extractJsonField(json,
          'po_number', 'purchase_order_number', 'po_no', 'po', 'purchase_order', 'order_number', 'order_no'))
      case 'invoiceDate':
        return textCell(extractJsonField(json, 'invoice_date', 'date', 'billing_date', 'bill_date', 'invoice date'))
      case 'invoiceNumber': {
        const num = extractJsonField(json, 'invoice_number', 'invoice_no', 'invoice_num', 'inv_number', 'inv_no', 'invoice#', 'invoice')
        if (!num) return emDash
        const fileId = job.driveFileId
        if (fileId) {
          return (
            <a href={`https://drive.google.com/file/d/${fileId}/view`}
              target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[10px] text-[var(--accent-200)] hover:underline">
              <svg className="h-3 w-3 shrink-0 text-rose-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M7 3a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5H7zm5 1.5L17.5 10H12V4.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16z"/>
              </svg>
              {num}
            </a>
          )
        }
        return monoCell(num)
      }
      case 'terms':
        return textCell(extractJsonField(json, 'payment_terms', 'terms', 'net_terms', 'payment terms'))
      case 'totalCost':
        return numCell(extractJsonField(json,
          'total_cost', 'total_costs', 'total', 'grand_total', 'total_amount',
          'total_value', 'invoice_total', 'amount_due', 'balance_due', 'total_due', 'total_invoice'))
      case 'parsedAt': {
        if (!job.completedAt) return emDash
        return (
          <span title={formatDateTime(job.completedAt)} className="text-[var(--text-200)]">
            {formatDate(job.completedAt)}
          </span>
        )
      }
      default:
        return emDash
    }
  }

  /* ── Render ── */
  return (
    <div className="space-y-4">
      {/* ── Global error banners ── */}
      {wsError && <Banner kind="error" onDismiss={() => setWsError(null)}>{wsError}</Banner>}
      {orgError && <Banner kind="error" onDismiss={() => setOrgError(null)}>{orgError}</Banner>}
      {globalSuccess && <Banner kind="success" onDismiss={() => setGlobalSuccess(null)}>{globalSuccess}</Banner>}

      {/* ══════════════════════════ ORGANIZATIONS LANDING ══════════════════════════ */}
      {view === 'organizations' && (
        <div className="space-y-8">

          {/* ── Organizations section ── */}
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-100)]">Organizations</h2>
                <p className="mt-0.5 text-xs text-[var(--text-200)]">
                  Group workspaces by team or project and control who can access them.
                </p>
              </div>
              {isAdmin && (
                <button type="button" onClick={() => openOrgEditor('new')}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 dark:bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New organization
                </button>
              )}
            </div>

            {orgLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="relative flex items-center gap-4 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] overflow-hidden h-16">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--bg-300)]" />
                    <div className="ml-5 h-11 w-11 shrink-0 animate-pulse rounded-xl bg-[var(--bg-300)]" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3.5 w-1/3 animate-pulse rounded bg-[var(--bg-300)]" />
                      <div className="h-2.5 w-1/4 animate-pulse rounded bg-[var(--bg-300)]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : organizations.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--bg-300)] bg-[var(--bg-100)] py-14 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 mb-4">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-[var(--text-100)]">No organizations yet</h3>
                <p className="mt-1.5 max-w-sm text-xs text-[var(--text-200)]">
                  {isAdmin
                    ? 'Create an organization to group workspaces and control who can access them.'
                    : 'No organizations have been created yet. Contact an admin.'}
                </p>
                {isAdmin && (
                  <button type="button" onClick={() => openOrgEditor('new')}
                    className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 dark:bg-violet-700 px-5 py-2.5 text-sm font-medium text-white hover:opacity-90">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create first organization
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {organizations.map((org) => (
                  <OrgCard
                    key={org._id}
                    org={org}
                    workspaceCount={workspaces.filter((w) => w.organizationId === org._id).length}
                    onOpen={() => enterOrg(org)}
                    onEdit={() => openOrgEditor(org)}
                    onDelete={() => void handleDeleteOrg(org)}
                    isAdmin={isAdmin}
                    hasAccess={org.hasAccess ?? true}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Divider between organizations and unassigned workspaces ── */}
          {!orgLoading && organizations.length > 0 && (wsLoading || unassignedWorkspaces.length > 0) && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[var(--bg-300)]" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-200)] px-1">
                Unassigned
              </span>
              <div className="flex-1 h-px bg-[var(--bg-300)]" />
            </div>
          )}

          {/* ── Unassigned workspaces section ── */}
          {(wsLoading || unassignedWorkspaces.length > 0) && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-100)]">Unassigned Workspaces</h3>
                  <p className="mt-0.5 text-xs text-[var(--text-200)]">
                    Not linked to any organization — visible to all users.
                    {isAdmin && ' Use Edit on an organization to assign them.'}
                  </p>
                </div>
                <button type="button" onClick={() => openEditor('new')}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New workspace
                </button>
              </div>

              {wsLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-5">
                      <div className="mb-4 h-10 w-10 animate-pulse rounded-xl bg-[var(--bg-300)]" />
                      <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--bg-300)]" />
                      <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-[var(--bg-300)]" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {unassignedWorkspaces.map((ws) => (
                    <WorkspaceCard
                      key={ws._id}
                      workspace={ws}
                      onOpen={() => enterWorkspace(ws)}
                      onEdit={() => openEditor(ws)}
                      onDelete={() => void handleDeleteWorkspace(ws)}
                      onMove={() => setMoveTarget(ws)}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════ WORKSPACES WITHIN ORG ══════════════════════════ */}
      {view === 'workspaces' && activeOrg && (
        <div className="space-y-5">
          {/* Breadcrumb */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button type="button" onClick={leaveOrg}
                className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-[var(--text-200)] hover:text-[var(--accent-200)] transition-colors">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Organizations
              </button>
              <svg className="h-3.5 w-3.5 shrink-0 text-[var(--bg-300)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-sm font-semibold text-[var(--text-100)] truncate">{activeOrg.name}</span>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button type="button" onClick={() => openOrgEditor(activeOrg)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--bg-300)] px-3 py-1.5 text-xs text-[var(--text-200)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit organization
                </button>
              )}
              <button type="button" onClick={() => openEditor('new')}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New workspace
              </button>
            </div>
          </div>

          {/* Members badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-[var(--text-200)]">
              {activeOrg.memberUserIds.length} member{activeOrg.memberUserIds.length !== 1 ? 's' : ''}
            </span>
            <span className="text-[10px] text-[var(--bg-300)]">·</span>
            <span className="text-[10px] text-[var(--text-200)]">
              {orgWorkspaces.length} workspace{orgWorkspaces.length !== 1 ? 's' : ''}
            </span>
          </div>

          {wsLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-5">
                  <div className="mb-4 h-10 w-10 animate-pulse rounded-xl bg-[var(--bg-300)]" />
                  <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--bg-300)]" />
                  <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-[var(--bg-300)]" />
                  <div className="mt-4 h-px bg-[var(--bg-300)]" />
                  <div className="mt-3 flex justify-end gap-2">
                    <div className="h-6 w-10 animate-pulse rounded bg-[var(--bg-300)]" />
                    <div className="h-6 w-16 animate-pulse rounded bg-[var(--bg-300)]" />
                  </div>
                </div>
              ))}
            </div>
          ) : orgWorkspaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--bg-300)] bg-[var(--bg-100)] py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary-100)] text-[var(--accent-200)] mb-4">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-[var(--text-100)]">No workspaces in this organization</h3>
              <p className="mt-1.5 max-w-sm text-xs text-[var(--text-200)]">
                Create a workspace here or move an existing one into this organization.
              </p>
              <button type="button" onClick={() => openEditor('new')}
                className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create first workspace
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {orgWorkspaces.map((ws) => (
                <WorkspaceCard
                  key={ws._id}
                  workspace={ws}
                  onOpen={() => enterWorkspace(ws)}
                  onEdit={() => openEditor(ws)}
                  onDelete={() => void handleDeleteWorkspace(ws)}
                  onMove={() => setMoveTarget(ws)}
                  isAdmin={isAdmin}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════ AUDIT DETAIL ══════════════════════════════ */}
      {view === 'audit' && activeWorkspace && (
        <div className="flex flex-col gap-4 overflow-hidden" style={{ height: 'calc(100vh - 7rem)' }}>

          {/* Breadcrumb */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <button type="button" onClick={leaveWorkspace}
                className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-[var(--text-200)] hover:text-[var(--accent-200)] transition-colors">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {activeOrg ? activeOrg.name : 'Organizations'}
              </button>
              <svg className="h-3.5 w-3.5 shrink-0 text-[var(--bg-300)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-sm font-semibold text-[var(--text-100)] truncate">{activeWorkspace.name}</span>
            </div>
            <button type="button" onClick={() => openEditor(activeWorkspace)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--bg-300)] px-3 py-1.5 text-xs text-[var(--text-200)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit workspace
            </button>
          </div>

          {/* ── Workspace sub-tab bar ─────────────────────────────── */}
          <div className="flex items-center border-b border-[var(--bg-300)] gap-0">
            {([
              ['audit',       'Invoice Audit', 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'],
              ['emails',      'Emails',        'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'],
              ['pdf-imports', 'PDF Imports',   'M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'],
              ['rules',       'Rules',         'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z'],
              ['vendors',     'Vendors',       'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4'],
            ] as const).map(([tab, label, icon]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setWorkspaceTab(tab)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  workspaceTab === tab
                    ? 'border-[var(--accent-200)] text-[var(--accent-200)]'
                    : 'border-transparent text-[var(--text-200)] hover:text-[var(--text-100)]'
                }`}
              >
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
                </svg>
                {label}
              </button>
            ))}

            {/* ── Tidy Agent status badge ── */}
            <div className="ml-auto flex items-center gap-1.5 pr-4 pb-px shrink-0">
              <span
                title={workerOnline === null ? 'Checking Tidy Agent status…' : workerOnline ? 'Tidy Agent is connected and ready' : 'Tidy Agent is offline — parses will queue until it reconnects'}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${
                  workerOnline === null
                    ? 'bg-[var(--bg-200)] text-[var(--text-200)]'
                    : workerOnline
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                      : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${
                  workerOnline === null
                    ? 'bg-[var(--text-200)] animate-pulse'
                    : workerOnline
                      ? 'bg-emerald-500 animate-pulse'
                      : 'bg-rose-500'
                }`} />
                Tidy Agent · {workerOnline === null ? 'Checking…' : workerOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>

          {/* ══════════════ EMAILS TAB ══════════════ */}
          {workspaceTab === 'emails' && (
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              {emailError && <Banner kind="error" onDismiss={() => setEmailError(null)}>{emailError}</Banner>}
              {emailFetchNotice && <Banner kind="success" onDismiss={() => setEmailFetchNotice(null)}>{emailFetchNotice}</Banner>}

              <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-md">
                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/60 text-[10px] text-[var(--text-200)]">
                  {/* Search */}
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 text-[var(--text-200)]">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" /></svg>
                    </span>
                    <input type="text" value={emailSearch} onChange={(e) => setEmailSearch(e.target.value)}
                      placeholder="Search…" className={`${inputClass} pl-6 pr-6 w-[17.5rem]`} />
                    {emailSearch && (
                      <button onClick={() => setEmailSearch('')} aria-label="Clear search"
                        className="absolute inset-y-0 right-0 flex items-center pr-2 text-[var(--text-200)] hover:text-[var(--text-100)] cursor-pointer">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                  {/* Date range */}
                  <input type="date" value={emailDateFrom} onChange={(e) => setEmailDateFrom(e.target.value)} className={inputClass} />
                  <span>–</span>
                  <input type="date" value={emailDateTo} onChange={(e) => setEmailDateTo(e.target.value)} className={inputClass} />
                  {/* Parse status filter */}
                  <select
                    value={emailParseStatusFilter}
                    onChange={(e) => setEmailParseStatusFilter(e.target.value as '' | 'none' | ParseJobStatus)}
                    className={`${inputClass} cursor-pointer`}
                    aria-label="Filter by parse status"
                  >
                    <option value="">All statuses</option>
                    <option value="none">Unparsed</option>
                    <option value="pending">Queued</option>
                    <option value="processing">Parsing</option>
                    <option value="completed">Parsed</option>
                    <option value="failed">Failed</option>
                  </select>
                  {(emailSearch || emailDateFrom || emailDateTo || emailParseStatusFilter) && (
                    <button onClick={() => { setEmailSearch(''); setEmailDateFrom(''); setEmailDateTo(''); setEmailParseStatusFilter('') }}
                      className="text-[var(--accent-200)] hover:underline cursor-pointer whitespace-nowrap">Clear</button>
                  )}
                  <div className="h-4 w-px bg-[var(--bg-300)]" />
                  {/* Fetch Emails icon button */}
                  <button type="button" onClick={() => void handleFetchEmails()} disabled={emailFetching}
                    title="Fetch Emails — run all enabled rules and import matching emails"
                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--bg-300)] text-[var(--text-200)] transition-colors hover:bg-[var(--bg-300)] hover:text-[var(--text-100)] disabled:cursor-not-allowed disabled:opacity-40">
                    {emailFetching ? <Spinner className="h-3.5 w-3.5" /> : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                  </button>
                  {/* Fetch status chips */}
                  {pollerRunning && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                      title="Fetching emails from the mailbox — new messages will appear shortly"
                    >
                      <svg className="h-3.5 w-3.5 shrink-0 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                      </svg>
                      Fetching emails…
                    </span>
                  )}
                  {!pollerRunning && pollError && (
                    <span
                      className="inline-flex cursor-help items-center gap-1.5 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400"
                      title={`Last email fetch failed: ${pollError}`}
                    >
                      <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                      Fetch error
                    </span>
                  )}
                  {!pollerRunning && !pollError && showFetchDone && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                      title="Mailbox checked — all matched emails are now imported"
                    >
                      <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Fetched
                    </span>
                  )}
                  {/* Next poll countdown */}
                  {nextSyncAt && (
                    <span
                      className="inline-flex items-center gap-1 text-[var(--text-200)]"
                      title="Estimated time until the next automated email fetch"
                    >
                      <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {pollerRunning
                        ? 'syncing…'
                        : (() => {
                            const s = Math.max(0, Math.round((nextSyncAt.getTime() - Date.now()) / 1_000))
                            return s > 0 ? `next in ${s}s` : 'syncing…'
                          })()
                      }
                    </span>
                  )}
                  {/* Right: stats + bulk actions + rows per page + pagination */}
                  <div className="ml-auto flex items-center gap-2">
                    {/* Stats: parsed / total emails */}
                    {emailPagination.total > 0 && (
                      <span className="text-[10px] text-[var(--text-200)] whitespace-nowrap">
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">{emailPagination.parsedCount.toLocaleString()}</span>
                        <span className="opacity-50">/</span>
                        <span>{emailPagination.total.toLocaleString()}</span>
                        {' '}email{emailPagination.total === 1 ? '' : 's'}
                      </span>
                    )}
                    {/* Abort Jobs */}
                    {anySelectedEmailRunning && (
                      <button
                        type="button"
                        title={`Abort running parse jobs across ${selectedEmailIds.size} selected message${selectedEmailIds.size === 1 ? '' : 's'}`}
                        onClick={() => void handleBulkAbortEmails()}
                        disabled={emailBulkAborting}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-medium text-rose-600 transition-colors hover:bg-rose-50 hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-900/40 dark:text-rose-400 dark:hover:bg-rose-900/15"
                      >
                        {emailBulkAborting ? <Spinner className="h-3 w-3" /> : (
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        Abort Jobs
                      </button>
                    )}
                    {/* Send to Tidy Agent */}
                    {selectedEmailIds.size > 0 && (
                      <button
                        type="button"
                        title={
                          !workerOnline
                            ? 'Tidy Agent is offline'
                            : allSelectedEmailsCompleted
                              ? `Rerun Tidy Agent on ${selectedEmailIds.size} already-parsed message${selectedEmailIds.size === 1 ? '' : 's'}`
                              : `Send ${selectedEmailIds.size} selected message${selectedEmailIds.size === 1 ? '' : 's'} to Tidy Agent`
                        }
                        onClick={() => void handleBulkSendEmailsToAgent()}
                        disabled={emailBulkSending || workerOnline === false}
                        className={`inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                          allSelectedEmailsCompleted
                            ? 'bg-amber-500 text-white hover:bg-amber-600'
                            : 'bg-[var(--accent-200)] dark:bg-[var(--accent-100)] text-white hover:opacity-90'
                        }`}
                      >
                        {emailBulkSending ? <Spinner className="h-3 w-3" /> : (
                          <svg className="h-3 w-3 opacity-90" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                          </svg>
                        )}
                        {allSelectedEmailsCompleted
                          ? `Rerun ${selectedEmailIds.size}`
                          : `Send ${selectedEmailIds.size} to Agent`}
                      </button>
                    )}
                    {/* Bulk delete emails */}
                    {selectedEmailIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setConfirmBulkDeleteEmails(true)}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-rose-700"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete {selectedEmailIds.size}
                      </button>
                    )}
                    <span className="whitespace-nowrap">Rows per page:</span>
                    <select value={emailPageSize} onChange={(e) => setEmailPageSize(Number(e.target.value))}
                      className="border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] cursor-pointer">
                      {PAGE_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {emailPagination.pages > 0 && (
                      <PaginationArrows page={emailPage} pages={emailPagination.pages} onChange={setEmailPage} />
                    )}
                  </div>
                </div>

                {/* Table */}
                <div className="relative overflow-x-auto overflow-y-auto flex-1 min-h-0">
                  {/* Resync overlay — thin violet progress bar; no layout shift */}
                  {emailLoading && (
                    <div className="sticky top-0 left-0 z-30 w-full">
                      <div className="h-1 w-full overflow-hidden bg-orange-200 dark:bg-orange-800/40">
                        <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-orange-400 to-orange-600"
                          style={{ animation: 'audit-resync-slide 1.4s ease-in-out infinite' }} />
                      </div>
                    </div>
                  )}
                  <style>{`
                    @keyframes audit-resync-slide {
                      0%   { transform: translateX(-100%); }
                      50%  { transform: translateX(200%); }
                      100% { transform: translateX(-100%); }
                    }
                  `}</style>
                  <table className="w-full text-[10px] border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <Th className="w-8">
                          <input ref={selectAllEmailRef} type="checkbox"
                            checked={allEmailsOnPageSelected}
                            onChange={toggleAllEmailsOnPage}
                            disabled={emailMessages.length === 0}
                            title={allEmailsOnPageSelected ? 'Clear this page' : 'Select this page'}
                            aria-label={allEmailsOnPageSelected ? 'Clear this page' : 'Select this page'}
                            className={`${emailCheckboxClass} disabled:cursor-not-allowed disabled:opacity-40`}
                          />
                        </Th>
                        {/* Actions — second column, right after the checkbox */}
                        <Th label="Actions" align="center" className="w-[68px]" />
                        {orderedEmailCols.map((col) => (
                          <DraggableTh
                            key={col.id}
                            label={col.label}
                            iconPath={col.iconPath}
                            isDragging={emailDragSrc === col.id}
                            isDragTarget={emailDragTarget === col.id}
                            hasActiveFilter={!!(emailColFilters[col.id]?.size)}
                            onDragStart={() => setEmailDragSrc(col.id)}
                            onDragOver={() => setEmailDragTarget(col.id)}
                            onDrop={() => {
                              if (emailDragSrc && emailDragSrc !== col.id) {
                                const newOrder = reorderCols(emailColOrderRef.current, emailDragSrc, col.id)
                                setEmailColOrder(newOrder)
                                saveColOrdersRef.current(auditColOrderRef.current, newOrder, pdfColOrderRef.current, activeWorkspace?._id ?? '')
                              }
                            }}
                            onDragEnd={() => { setEmailDragSrc(null); setEmailDragTarget(null) }}
                            onFilterClick={(rect) => {
                              if (emailFilterOpenColId === col.id) {
                                setEmailFilterOpenColId(null)
                                setEmailFilterAnchorRect(null)
                              } else {
                                setEmailFilterOpenColId(col.id)
                                setEmailFilterAnchorRect(rect)
                              }
                            }}
                          />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {emailLoading && emailMessages.length === 0 ? (
                        Array.from({ length: 8 }).map((_, i) => (
                          <tr key={i} className="border-b border-[var(--bg-300)]">
                            <td className="px-3 py-px"><div className="h-3.5 w-3.5 animate-pulse rounded bg-[var(--bg-300)]" /></td>
                            <td className="px-3 py-px">
                              <div className="flex justify-center gap-1">
                                <div className="h-4 w-6 animate-pulse rounded bg-[var(--bg-300)]" />
                                <div className="h-4 w-4 animate-pulse rounded bg-[var(--bg-300)]" />
                              </div>
                            </td>
                            {orderedEmailCols.map((col) => (
                              <td key={col.id} className="px-3 py-px">
                                {col.id === 'from' ? (
                                  <div className="flex items-center gap-2">
                                    <div className="h-6 w-6 animate-pulse rounded-full bg-[var(--bg-300)]" />
                                    <div className="space-y-1.5">
                                      <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-300)]" />
                                      <div className="h-2.5 w-32 animate-pulse rounded bg-[var(--bg-300)]" />
                                    </div>
                                  </div>
                                ) : col.id === 'documentType' || col.id === 'rule' ? (
                                  <div className="h-5 w-24 animate-pulse rounded-full bg-[var(--bg-300)]" />
                                ) : (
                                  <div className="h-3 w-20 animate-pulse rounded bg-[var(--bg-300)]" />
                                )}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : emailMessages.length === 0 ? (
                        <tr>
                          <td colSpan={orderedEmailCols.length + 2} className="py-16 text-center">
                            <div className="flex flex-col items-center gap-3">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-200)]">
                                <svg className="h-6 w-6 text-[var(--text-200)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                </svg>
                              </div>
                              <div>
                                <p className="text-[10px] font-medium text-[var(--text-100)]">
                                  {(emailSearch || emailDateFrom || emailDateTo) ? 'No messages match' : 'No emails in this workspace yet'}
                                </p>
                                <p className="mt-0.5 text-[10px] text-[var(--text-200)]">
                                  {(emailSearch || emailDateFrom || emailDateTo)
                                    ? 'Try adjusting or clearing the filters.'
                                    : 'Emails matching this workspace\'s rules will appear here. Add rules in the Rules tab.'}
                                </p>
                              </div>
                              {(emailSearch || emailDateFrom || emailDateTo) && (
                                <button onClick={() => { setEmailSearch(''); setEmailDateFrom(''); setEmailDateTo(''); setEmailParseStatusFilter('') }}
                                  className="text-[10px] text-[var(--accent-200)] hover:underline cursor-pointer">
                                  Clear filters
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : filteredEmailMessages.length === 0 && emailActiveFilterCount > 0 ? (
                        <tr>
                          <td colSpan={orderedEmailCols.length + 2} className="py-14 text-center">
                            <div className="flex flex-col items-center gap-3">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary-100)]">
                                <svg className="h-6 w-6 text-[var(--accent-200)]" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 01.707 1.707L13 9.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-7.586L3.293 5.707A1 1 0 013 5V3z" clipRule="evenodd" />
                                </svg>
                              </div>
                              <div>
                                <p className="text-[10px] font-medium text-[var(--text-100)]">No rows match the active column filters</p>
                                <p className="mt-0.5 text-[10px] text-[var(--text-200)]">Try adjusting your filters or clearing them.</p>
                              </div>
                              <button onClick={() => setEmailColFilters({})} className="text-[10px] text-[var(--accent-200)] hover:underline cursor-pointer">
                                Clear all column filters
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredEmailMessages.map((msg) => {
                          const isSelected = selectedEmailIds.has(msg._id)
                          const senderSeed = msg.fromName || msg.from
                          return (
                            <tr key={msg._id}
                              onClick={() => setViewMessage(msg)}
                              className={`group cursor-pointer align-middle transition-all duration-100 hover:relative hover:z-[1] hover:shadow-[0_2px_8px_rgba(0,0,0,0.14),0_-1px_2px_rgba(0,0,0,0.06)] ${
                                isSelected
                                  ? 'bg-[var(--primary-100)]/70 hover:bg-[var(--primary-100)]'
                                  : 'odd:bg-[var(--bg-100)] even:bg-[var(--bg-200)] hover:bg-[var(--bg-100)]'
                              }`}
                            >
                              {/* Checkbox — always first */}
                              <td className="px-3 py-px" onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" checked={isSelected} onChange={() => toggleEmailRow(msg._id)}
                                  aria-label={`Select ${msg.subject || 'message'}`}
                                  className={emailCheckboxClass} />
                              </td>

                              {/* Actions — second column, right after the checkbox */}
                              <td className="px-3 py-px text-center" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-center gap-0.5">
                                  <AttachmentIcons
                                    message={msg}
                                    onOpenJob={setOpenJobId}
                                    onChanged={() => void fetchEmails(true)}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteEmail(msg)}
                                    title="Delete this message"
                                    aria-label="Delete message"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400 cursor-pointer"
                                  >
                                    <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              </td>

                              {/* Dynamic ordered columns */}
                              {orderedEmailCols.map((col) => {
                                // Column-level drag highlight applied to every <td> in this column
                                const emailColDragCls =
                                  emailDragSrc === col.id
                                    ? 'bg-sky-100/70 dark:bg-sky-500/15'
                                    : emailDragTarget === col.id
                                      ? 'bg-sky-50 dark:bg-sky-500/10 border-l-[3px] border-l-sky-400'
                                      : ''

                                switch (col.id) {
                                  case 'received':
                                    return (
                                      <td key="received" className={`px-3 py-px whitespace-nowrap text-[var(--text-200)] ${emailColDragCls}`} title={formatDateTime(msg.sentAt)}>
                                        {formatDate(msg.sentAt)}
                                      </td>
                                    )
                                  case 'from':
                                    return (
                                      <td key="from" className={`px-3 py-px min-w-0 ${emailColDragCls}`}>
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white ${avatarColour(senderSeed)}`}>
                                            {senderSeed.charAt(0).toUpperCase()}
                                          </span>
                                          <div className="min-w-0 truncate text-[var(--text-100)]"
                                            title={msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from}>
                                            {msg.fromName || msg.from}
                                          </div>
                                        </div>
                                      </td>
                                    )
                                  case 'to':
                                    return (
                                      <td key="to" className={`px-3 py-px min-w-0 max-w-[180px] ${emailColDragCls}`}>
                                        {msg.to && msg.to.length > 0 ? (
                                          <div className="truncate text-[var(--text-200)]" title={msg.to.join(', ')}>
                                            {msg.to[0]}
                                            {msg.to.length > 1 && (
                                              <span className="ml-1 rounded-full bg-[var(--bg-300)] px-1.5 py-0.5 text-[10px] text-[var(--text-200)]">
                                                +{msg.to.length - 1}
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <span className="italic text-[var(--text-200)]">—</span>
                                        )}
                                      </td>
                                    )
                                  case 'subject':
                                    return (
                                      <td key="subject" className={`px-3 py-px min-w-0 ${emailColDragCls}`}>
                                        <div className="truncate text-[var(--text-100)]" title={msg.subject}>
                                          {msg.subject || <span className="italic text-[var(--text-200)]">(no subject)</span>}
                                        </div>
                                      </td>
                                    )
                                  case 'documentType':
                                    return (
                                      <td key="documentType" className={`px-3 py-px whitespace-nowrap ${emailColDragCls}`}>
                                        <DocumentTypeBadge value={msg.documentType} />
                                      </td>
                                    )
                                  case 'rule':
                                    return (
                                      <td key="rule" className={`px-3 py-px ${emailColDragCls}`}>
                                        {msg.ruleName ? (
                                          <span title={msg.ruleName}
                                            className="inline-flex max-w-[160px] items-center gap-1 rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[10px] text-[var(--accent-200)]">
                                            <svg className="h-2.5 w-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
                                            </svg>
                                            <span className="truncate">{msg.ruleName}</span>
                                          </span>
                                        ) : (
                                          <span className="text-[10px] italic text-[var(--text-200)]">—</span>
                                        )}
                                      </td>
                                    )
                                  case 'attachments':
                                    return (
                                      <td key="attachments" className={`px-3 py-px ${emailColDragCls}`} onClick={(e) => e.stopPropagation()}>
                                        {msg.attachments && msg.attachments.length > 0 ? (
                                          <div className="space-y-0.5">
                                            {msg.attachments.map((att, ai) => {
                                              const href = att.webViewLink
                                                || (att.driveFileId ? `https://drive.google.com/file/d/${att.driveFileId}/view` : null)
                                              const isPdf = att.mimeType === 'application/pdf' || /\.pdf$/i.test(att.filename)
                                              return (
                                                <div key={ai} className="flex items-center gap-1.5">
                                                  {href ? (
                                                    <a href={href} target="_blank" rel="noopener noreferrer"
                                                      onClick={(e) => e.stopPropagation()} title={att.filename}
                                                      className="inline-flex items-center gap-1 text-[var(--accent-200)] hover:underline">
                                                      {isPdf ? (
                                                        <svg className="h-3 w-3 shrink-0 text-rose-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                                          <path d="M7 3a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5H7zm5 1.5L17.5 10H12V4.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16z"/>
                                                        </svg>
                                                      ) : (
                                                        <svg className="h-3 w-3 shrink-0 text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                                        </svg>
                                                      )}
                                                      <span className="truncate max-w-[140px] text-[10px]">{att.filename}</span>
                                                    </a>
                                                  ) : (
                                                    <>
                                                      {isPdf ? (
                                                        <svg className="h-3 w-3 shrink-0 text-rose-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                                          <path d="M7 3a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5H7zm5 1.5L17.5 10H12V4.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16z"/>
                                                        </svg>
                                                      ) : (
                                                        <svg className="h-3 w-3 shrink-0 text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                                        </svg>
                                                      )}
                                                      <span className="truncate max-w-[140px] text-[10px] text-[var(--text-100)]" title={att.filename}>{att.filename}</span>
                                                    </>
                                                  )}
                                                  {att.size > 0 && (
                                                    <span className="shrink-0 text-[10px] text-[var(--text-200)]">
                                                      {formatBytes(att.size)}
                                                    </span>
                                                  )}
                                                </div>
                                              )
                                            })}
                                          </div>
                                        ) : (
                                          <span className="italic text-[var(--text-200)]">—</span>
                                        )}
                                      </td>
                                    )
                                  default:
                                    return null
                                }
                              })}

                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

              </div>
            </div>
          )}

          {/* ══════════════ RULES TAB ══════════════ */}
          {workspaceTab === 'rules' && (
            <WorkspaceRulesView workspaceId={activeWorkspace._id} />
          )}

          {/* ══════════════ VENDORS TAB ══════════════ */}
          {workspaceTab === 'vendors' && (
            <WorkspaceVendorsView workspaceId={activeWorkspace._id} />
          )}

          {/* ══════════════ PDF IMPORTS TAB ══════════════ */}
          {workspaceTab === 'pdf-imports' && (
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              {pdfImportsError && (
                <Banner kind="error" onDismiss={() => setPdfImportsError(null)}>{pdfImportsError}</Banner>
              )}

              <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-md">

                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/60 text-[10px] text-[var(--text-200)]">
                  {/* Search */}
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 text-[var(--text-200)]">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" /></svg>
                    </span>
                    <input type="text" value={pdfSearch} onChange={(e) => setPdfSearch(e.target.value)}
                      placeholder="Search…" className={`${inputClass} pl-6 pr-6 w-[17.5rem]`} />
                    {pdfSearch && (
                      <button onClick={() => setPdfSearch('')} aria-label="Clear search"
                        className="absolute inset-y-0 right-0 flex items-center pr-2 text-[var(--text-200)] hover:text-[var(--text-100)] cursor-pointer">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                  {/* Date range */}
                  <input type="date" value={pdfDateFrom} onChange={(e) => setPdfDateFrom(e.target.value)} className={inputClass} />
                  <span>–</span>
                  <input type="date" value={pdfDateTo} onChange={(e) => setPdfDateTo(e.target.value)} className={inputClass} />
                  {/* Parse status filter */}
                  <select
                    value={pdfParseStatusFilter}
                    onChange={(e) => setPdfParseStatusFilter(e.target.value as '' | 'none' | ParseJobStatus)}
                    className={`${inputClass} cursor-pointer`}
                    aria-label="Filter by parse status"
                  >
                    <option value="">All statuses</option>
                    <option value="none">Unparsed</option>
                    <option value="pending">Queued</option>
                    <option value="processing">Parsing</option>
                    <option value="completed">Parsed</option>
                    <option value="failed">Failed</option>
                  </select>
                  {pdfHasActiveFilters && (
                    <button onClick={() => { setPdfSearch(''); setPdfDateFrom(''); setPdfDateTo(''); setPdfParseStatusFilter('') }}
                      className="text-[var(--accent-200)] hover:underline cursor-pointer whitespace-nowrap">Clear</button>
                  )}
                  <div className="h-4 w-px bg-[var(--bg-300)]" />
                  {/* Import PDFs icon button */}
                  <button type="button" onClick={() => { setPdfUploadError(null); setShowPdfUploadModal(true) }}
                    title="Import PDFs — upload PDF files to parse"
                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--bg-300)] text-[var(--text-200)] transition-colors hover:bg-[var(--bg-300)] hover:text-[var(--text-100)]">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </button>
                  {/* Right: stats + bulk actions + rows per page + pagination */}
                  <div className="ml-auto flex items-center gap-2">
                    {/* Stats: total / parsed / pending */}
                    {pdfImportsPagination.total > 0 && (
                      <span className="flex items-center gap-1.5 text-[10px] text-[var(--text-200)]">
                        <span>{pdfImportsPagination.total.toLocaleString()} file{pdfImportsPagination.total === 1 ? '' : 's'}</span>
                        <span className="opacity-30">·</span>
                        <span className="text-emerald-600 dark:text-emerald-400">{pdfImportsPagination.parsedCount.toLocaleString()} parsed</span>
                        <span className="opacity-30">·</span>
                        <span className="text-amber-600 dark:text-amber-400">{(pdfImportsPagination.total - pdfImportsPagination.parsedCount).toLocaleString()} pending</span>
                      </span>
                    )}
                    {/* Abort Jobs */}
                    {anySelectedPdfRunning && (
                      <button
                        type="button"
                        title={`Abort running parse jobs for ${pdfSelectedIds.size} selected file${pdfSelectedIds.size === 1 ? '' : 's'}`}
                        onClick={() => void handleBulkAbortPdfs()}
                        disabled={pdfBulkAborting}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-medium text-rose-600 transition-colors hover:bg-rose-50 hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-900/40 dark:text-rose-400 dark:hover:bg-rose-900/15"
                      >
                        {pdfBulkAborting ? <Spinner className="h-3 w-3" /> : (
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        Abort Jobs
                      </button>
                    )}
                    {/* Send to Tidy Agent */}
                    {pdfSelectedIds.size > 0 && (
                      <button
                        type="button"
                        title={
                          !workerOnline
                            ? 'Tidy Agent is offline'
                            : allSelectedPdfsCompleted
                              ? `Rerun Tidy Agent on ${pdfSelectedIds.size} already-parsed file${pdfSelectedIds.size === 1 ? '' : 's'}`
                              : `Send ${pdfSelectedIds.size} selected file${pdfSelectedIds.size === 1 ? '' : 's'} to Tidy Agent`
                        }
                        onClick={() => void handleBulkSendPdfsToAgent()}
                        disabled={pdfBulkSending || workerOnline === false}
                        className={`inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                          allSelectedPdfsCompleted
                            ? 'bg-amber-500 text-white hover:bg-amber-600'
                            : 'bg-[var(--accent-200)] dark:bg-[var(--accent-100)] text-white hover:opacity-90'
                        }`}
                      >
                        {pdfBulkSending ? <Spinner className="h-3 w-3" /> : (
                          <svg className="h-3 w-3 opacity-90" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                          </svg>
                        )}
                        {allSelectedPdfsCompleted
                          ? `Rerun ${pdfSelectedIds.size}`
                          : `Send ${pdfSelectedIds.size} to Agent`}
                      </button>
                    )}
                    {/* Bulk delete PDF imports */}
                    {pdfSelectedIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setConfirmBulkDeletePdfs(true)}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-rose-700"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete {pdfSelectedIds.size}
                      </button>
                    )}
                    <span className="whitespace-nowrap">Rows per page:</span>
                    <select value={pdfPageSize} onChange={(e) => setPdfPageSize(Number(e.target.value))}
                      className="border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] cursor-pointer">
                      {PAGE_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {pdfImportsPagination.pages > 0 && (
                      <PaginationArrows page={pdfPage} pages={pdfImportsPagination.pages} onChange={setPdfPage} />
                    )}
                  </div>
                </div>

                {/* ── Table ── */}
                <div className="relative overflow-x-auto overflow-y-auto flex-1 min-h-0">
                  {/* Resync overlay — thin violet progress bar; no layout shift */}
                  {pdfImportsLoading && (
                    <div className="sticky top-0 left-0 z-30 w-full">
                      <div className="h-1 w-full overflow-hidden bg-orange-200 dark:bg-orange-800/40">
                        <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-orange-400 to-orange-600"
                          style={{ animation: 'audit-resync-slide 1.4s ease-in-out infinite' }} />
                      </div>
                    </div>
                  )}
                  <style>{`
                    @keyframes audit-resync-slide {
                      0%   { transform: translateX(-100%); }
                      50%  { transform: translateX(200%); }
                      100% { transform: translateX(-100%); }
                    }
                  `}</style>
                  {pdfImportsLoading && pdfImports.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-16 text-[var(--text-200)]">
                      <Spinner className="h-4 w-4" />
                      <span className="text-sm">Loading…</span>
                    </div>
                  ) : pdfImports.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-16 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-200)]">
                        <svg className="h-6 w-6 text-[var(--text-200)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium text-[var(--text-100)]">
                          {pdfHasActiveFilters ? 'No files match' : 'No PDFs imported yet'}
                        </p>
                        <p className="mt-0.5 text-[10px] text-[var(--text-200)]">
                          {pdfHasActiveFilters
                            ? 'Try adjusting or clearing the filters.'
                            : 'Click "Import PDFs" above to upload files.'}
                        </p>
                      </div>
                      {pdfHasActiveFilters && (
                        <button
                          onClick={() => { setPdfSearch(''); setPdfDateFrom(''); setPdfDateTo(''); setPdfParseStatusFilter('') }}
                          className="text-[10px] text-[var(--accent-200)] hover:underline cursor-pointer"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  ) : filteredPdfImports.length === 0 && pdfActiveFilterCount > 0 ? (
                    <div className="flex flex-col items-center gap-3 py-14 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary-100)]">
                        <svg className="h-6 w-6 text-[var(--accent-200)]" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 01.707 1.707L13 9.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-7.586L3.293 5.707A1 1 0 013 5V3z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium text-[var(--text-100)]">No rows match the active column filters</p>
                        <p className="mt-0.5 text-[10px] text-[var(--text-200)]">Try adjusting your filters or clearing them.</p>
                      </div>
                      <button onClick={() => setPdfColFilters({})} className="text-[10px] text-[var(--accent-200)] hover:underline cursor-pointer">
                        Clear all column filters
                      </button>
                    </div>
                  ) : (
                    <table className="text-[10px] border-separate border-spacing-0">
                      <thead>
                        <tr>
                          {/* Checkbox — select all */}
                          <Th className="w-8">
                            <input
                              ref={pdfSelectAllRef}
                              type="checkbox"
                              checked={allPdfOnPageSelected}
                              onChange={toggleAllPdfOnPage}
                              disabled={pdfImports.length === 0}
                              title={allPdfOnPageSelected ? 'Clear this page' : 'Select this page'}
                              aria-label={allPdfOnPageSelected ? 'Clear this page' : 'Select this page'}
                              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent-200)] disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </Th>
                          {orderedPdfCols.map((col) => (
                            <DraggableTh
                              key={col.id}
                              label={col.label}
                              iconPath={col.iconPath}
                              align={col.align}
                              isDragging={pdfDragSrc === col.id}
                              isDragTarget={pdfDragTarget === col.id}
                              hasActiveFilter={!!(pdfColFilters[col.id]?.size)}
                              onDragStart={() => setPdfDragSrc(col.id)}
                              onDragOver={() => setPdfDragTarget(col.id)}
                              onDrop={() => {
                                if (pdfDragSrc && pdfDragSrc !== col.id) {
                                  const newOrder = reorderCols(pdfColOrderRef.current, pdfDragSrc, col.id)
                                  setPdfColOrder(newOrder)
                                  saveColOrdersRef.current(auditColOrderRef.current, emailColOrderRef.current, newOrder, activeWorkspace?._id ?? '')
                                }
                              }}
                              onDragEnd={() => { setPdfDragSrc(null); setPdfDragTarget(null) }}
                              onFilterClick={(rect) => {
                                if (pdfFilterOpenColId === col.id) {
                                  setPdfFilterOpenColId(null)
                                  setPdfFilterAnchorRect(null)
                                } else {
                                  setPdfFilterOpenColId(col.id)
                                  setPdfFilterAnchorRect(rect)
                                }
                              }}
                            />
                          ))}
                          <Th label="Actions" align="center" className="min-w-[200px]" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPdfImports.map((imp) => {
                          const isSending = pdfSendingIds.has(imp._id)
                          const isSelected = pdfSelectedIds.has(imp._id)
                          const job = imp.parseJob
                          const isRunning = job && isParseRunning(job.status)
                          const dragCls = (id: PdfImportColumnId) =>
                            pdfDragSrc === id
                              ? 'bg-sky-100/70 dark:bg-sky-500/15'
                              : pdfDragTarget === id
                                ? 'bg-sky-50 dark:bg-sky-500/10 border-l-[3px] border-l-sky-400'
                                : ''

                          return (
                            <tr
                              key={imp._id}
                              className={`align-middle transition-all duration-100 hover:relative hover:z-[1] hover:shadow-[0_2px_8px_rgba(0,0,0,0.14),0_-1px_2px_rgba(0,0,0,0.06)] ${
                                isSelected
                                  ? 'bg-[var(--primary-100)]/70 hover:bg-[var(--primary-100)]'
                                  : 'odd:bg-[var(--bg-100)] even:bg-[var(--bg-200)] hover:bg-[var(--bg-100)]'
                              }`}
                            >
                              {/* Checkbox */}
                              <td className="px-3 py-px" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => togglePdfRow(imp._id)}
                                  aria-label={`Select ${imp.filename}`}
                                  className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent-200)]"
                                />
                              </td>

                              {orderedPdfCols.map((col) => {
                                const cls = `${dragCls(col.id)}`
                                switch (col.id) {
                                  case 'imported':
                                    return (
                                      <td key="imported" className={`px-3 py-px whitespace-nowrap text-[var(--text-200)] ${cls}`} title={formatDateTime(imp.createdAt)}>
                                        {formatDate(imp.createdAt)}
                                      </td>
                                    )
                                  case 'importedBy':
                                    return (
                                      <td key="importedBy" className={`px-3 py-px whitespace-nowrap text-[var(--text-200)] ${cls}`}>
                                        {imp.uploadedByName ?? <span className="italic">—</span>}
                                      </td>
                                    )
                                  case 'size':
                                    return (
                                      <td key="size" className={`px-3 py-px whitespace-nowrap text-right tabular-nums text-[var(--text-200)] ${cls}`}>
                                        {formatBytes(imp.size)}
                                      </td>
                                    )
                                  case 'filename':
                                    return (
                                      <td key="filename" className={`px-3 py-px min-w-0 max-w-[300px] ${cls}`}>
                                        {imp.driveWebViewLink ? (
                                          <a
                                            href={imp.driveWebViewLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title={`Open ${imp.filename} in Google Drive`}
                                            className="inline-flex items-center gap-1.5 min-w-0 group"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <svg className="h-3.5 w-3.5 shrink-0 text-rose-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                              <path d="M7 3a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5H7zm5 1.5L17.5 10H12V4.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16z"/>
                                            </svg>
                                            <span className="truncate text-[var(--accent-200)] no-underline group-hover:underline underline-offset-2" title={imp.filename}>{imp.filename}</span>
                                          </a>
                                        ) : (
                                          <div className="flex items-center gap-1.5 min-w-0">
                                            <svg className="h-3.5 w-3.5 shrink-0 text-rose-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                              <path d="M7 3a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5H7zm5 1.5L17.5 10H12V4.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16z"/>
                                            </svg>
                                            <span className="truncate text-[var(--text-100)]" title={imp.filename}>{imp.filename}</span>
                                          </div>
                                        )}
                                      </td>
                                    )
                                  default:
                                    return null
                                  case 'parseStatus':
                                    return (
                                      <td key="parseStatus" className={`px-3 py-px whitespace-nowrap ${cls}`}>
                                        {imp.parseJob ? (
                                          <div className="flex flex-col gap-0.5">
                                            <ParseStatusChip status={imp.parseJob.status} />
                                            {imp.parseJob.completedAt && (
                                              <span title={formatDateTime(imp.parseJob.completedAt)} className="text-[10px] text-[var(--text-200)]">
                                                {formatDate(imp.parseJob.completedAt)}
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ring-1 ring-inset bg-slate-100 text-slate-500 ring-slate-200/70 dark:bg-[var(--bg-300)] dark:text-[var(--text-200)] dark:ring-white/5">
                                            Not sent
                                          </span>
                                        )}
                                      </td>
                                    )
                                }
                              })}

                              {/* Actions — mirrors the Emails tab AttachmentIcons states */}
                              <td className="px-3 py-px text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-center gap-0.5">
                                  {(() => {
                                    // No job yet — paper-airplane button (sky blue)
                                    if (!job) {
                                      return (
                                        <button
                                          type="button"
                                          title={!workerOnline ? 'Tidy Agent is offline' : 'Send this document to Tidy Agent for parsing'}
                                          onClick={() => void handleSendToAgent(imp)}
                                          disabled={isSending || !workerOnline}
                                          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sky-500 transition-colors hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:text-sky-600 dark:hover:text-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                          {isSending ? (
                                            <Spinner className="h-3.5 w-3.5" />
                          ) : (
                            /* Envelope + arrow — "send to Tidy Agent for processing" */
                            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 10.5v7.5a2.25 2.25 0 0 0 2.25 2.25h12.75a2.25 2.25 0 0 0 2.25-2.25v-7.5M2.25 10.5 12 15l9.75-4.5M2.25 10.5v-.75A2.25 2.25 0 0 1 4.5 7.5h9.75" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 5.25 21 2.25m0 0h-3.75m3.75 0v3.75" />
                            </svg>
                          )}
                                        </button>
                                      )
                                    }

                                    // Running — % progress badge; click opens the panel to watch
                                    if (isRunning) {
                                      return (
                                        <ParseProgressBadge
                                          jobId={job._id}
                                          onClick={() => setOpenJobId(job._id)}
                                        />
                                      )
                                    }

                                    // Completed — emerald icon button
                                    if (job.status === 'completed') {
                                      return (
                                        <button
                                          type="button"
                                          title="Open Tidy Agent's reasoning and output"
                                          onClick={() => setOpenJobId(job._id)}
                                          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-emerald-500 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400"
                                        >
                                          <SuccessIcon className="h-5 w-5" />
                                        </button>
                                      )
                                    }

                                    // Failed — rose icon button, click retries
                                    return (
                                      <button
                                        type="button"
                                        title={job.error ?? 'Parse failed — click to retry'}
                                        onClick={() => void handleSendToAgent(imp)}
                                        disabled={isSending || !workerOnline}
                                        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-rose-500 transition-colors hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600 dark:hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        {isSending ? (
                                          <Spinner className="h-3.5 w-3.5" />
                                        ) : (
                                          <ErrorIcon className="h-4 w-4" />
                                        )}
                                      </button>
                                    )
                                  })()}

                                  {/* Delete — always visible */}
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeletePdf(imp)}
                                    title="Delete this import"
                                    aria-label="Delete import"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400 cursor-pointer"
                                  >
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* ── end workspaceTab === 'pdf-imports' ── */}

          {/* ══ PDF Import Upload Modal ══ */}
          {showPdfUploadModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => { if (!pdfUploading) setShowPdfUploadModal(false) }} />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Import PDFs"
                className="relative w-full max-w-md rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl"
              >
                {/* Modal header */}
                <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-5 py-4">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-100)]">Import PDFs</h3>
                    <p className="mt-0.5 text-xs text-[var(--text-200)]">Multiple files accepted · PDF only · Max 50 MB each</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPdfUploadModal(false)}
                    disabled={pdfUploading}
                    aria-label="Close"
                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Modal body — upload zone */}
                <div className="px-5 py-5 space-y-4">
                  {pdfUploadError && (
                    <Banner kind="error" onDismiss={() => setPdfUploadError(null)}>{pdfUploadError}</Banner>
                  )}

                  {/* Hidden file input — triggered by clicking anywhere on the zone */}
                  <input
                    ref={pdfFileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void handlePdfFilesSelected(e.target.files)
                      e.target.value = ''
                    }}
                  />

                  <div
                    onClick={() => { if (!pdfUploading) pdfFileInputRef.current?.click() }}
                    onDragOver={(e) => { e.preventDefault(); setPdfDragOver(true) }}
                    onDragLeave={() => setPdfDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setPdfDragOver(false)
                      void handlePdfFilesSelected(e.dataTransfer.files)
                    }}
                    className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors select-none ${
                      pdfUploading
                        ? 'border-[var(--bg-300)] bg-[var(--bg-200)]/40 cursor-wait'
                        : pdfDragOver
                          ? 'border-[var(--accent-200)] bg-[var(--primary-100)] cursor-copy'
                          : 'border-[var(--bg-300)] bg-[var(--bg-200)]/40 hover:border-[var(--accent-200)] hover:bg-[var(--primary-100)]/40 cursor-pointer'
                    }`}
                  >
                    {pdfUploading ? (
                      <>
                        <Spinner className="h-7 w-7 text-[var(--accent-200)]" />
                        <p className="text-sm text-[var(--text-200)]">Uploading files…</p>
                      </>
                    ) : (
                      <>
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary-100)] text-[var(--accent-200)]">
                          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[var(--text-100)]">
                            Click or drop PDF files here
                          </p>
                          <p className="mt-1 text-xs text-[var(--text-200)]">Multiple files accepted · uploads to Drive + parsed on demand</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════ AUDIT RESULTS TAB ══════════════ */}
          {workspaceTab === 'audit' && (
            <div className="flex-1 min-h-0 flex flex-col gap-4">
            {(orderError || error) && (
              <Banner kind="error" onDismiss={() => { setOrderError(null); setError(null) }}>
                {orderError || error}
              </Banner>
            )}

            {/* Table card */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-md">

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/60 text-[10px] text-[var(--text-200)]">
                {/* Search */}
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 text-[var(--text-200)]">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" /></svg>
                  </span>
                  <input type="text" value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Search…" className={`${inputClass} pl-6 pr-6 w-[17.5rem]`} />
                  {auditSearch && (
                    <button onClick={() => setAuditSearch('')} aria-label="Clear search"
                      className="absolute inset-y-0 right-0 flex items-center pr-2 text-[var(--text-200)] hover:text-[var(--text-100)] cursor-pointer">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
                {/* Date range */}
                <input type="date" value={auditDateFrom} onChange={(e) => setAuditDateFrom(e.target.value)} className={inputClass} />
                <span>–</span>
                <input type="date" value={auditDateTo} onChange={(e) => setAuditDateTo(e.target.value)} className={inputClass} />
                {(auditSearch || auditDateFrom || auditDateTo) && (
                  <button onClick={() => { setAuditSearch(''); setAuditDateFrom(''); setAuditDateTo('') }}
                    className="text-[var(--accent-200)] hover:underline cursor-pointer whitespace-nowrap">Clear</button>
                )}
                <div className="h-4 w-px bg-[var(--bg-300)]" />
                {/* Import Orders icon button */}
                <button type="button"
                  onClick={() => { if (!isHeaderOnly) { setShowImportModal(true); setImportSuccess(null); setImportError(null) } }}
                  disabled={isHeaderOnly}
                  title={isHeaderOnly ? 'Header-only workspaces use parsed PDFs directly — no order import needed' : 'Import Orders — upload a CSV or Excel file'}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--bg-300)] text-sky-500 transition-colors hover:bg-[var(--bg-300)] hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-40">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </button>
                {/* Resync icon button */}
                <button type="button"
                  onClick={() => {
                    void fetchAllJobsRef.current()
                    void fetchOrderImportsRef.current()
                    void Promise.all([triggerCogsRefresh(), triggerMatchCacheRebuild()]).then(() => {
                      setTimeout(() => void fetchOrderImportsRef.current(), 4000)
                    })
                  }}
                  disabled={loading || orderLoading}
                  title="Resync Invoice Data — re-fetch parsed invoices, COGS and re-match orders"
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--bg-300)] text-emerald-500 transition-colors hover:bg-[var(--bg-300)] hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
                  {loading ? <Spinner className="h-3.5 w-3.5 text-[var(--accent-200)]" /> : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                </button>
                {/* Column settings icon button */}
                <button type="button" onClick={() => setShowColSettings(true)}
                  title={`Column Settings — ${visibleCols.length} columns visible`}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--bg-300)] text-[var(--text-200)] transition-colors hover:bg-[var(--bg-300)] hover:text-[var(--text-100)]">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4a1 1 0 001-1V5a1 1 0 00-1-1zm10 0h-4a1 1 0 00-1 1v14a1 1 0 001 1h4a1 1 0 001-1V5a1 1 0 00-1-1z" />
                  </svg>
                </button>
                {/* Export icon button */}
                <button type="button"
                  onClick={() => void exportToExcel(selectedRowKeys.size > 0 ? 'selection' : 'all')}
                  disabled={exporting}
                  title={selectedRowKeys.size > 0 ? `Export ${selectedRowKeys.size} selected rows` : 'Export all rows to Excel'}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--bg-300)] text-emerald-600 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {exporting ? <Spinner className="h-3.5 w-3.5" /> : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  )}
                </button>
                {/* Right: row count + bulk delete + rows per page + pagination */}
                <div className="ml-auto flex items-center gap-2">
                  {/* Row count / filter count / selection count */}
                  {orderPagination.total > 0 && (
                    <span className="flex items-center gap-1.5 text-[10px] text-[var(--text-200)]">
                      {activeFilterCount > 0 && (
                        <>
                          <span className="opacity-30">·</span>
                          <span className="flex items-center gap-0.5 text-[var(--accent-200)] font-medium">
                            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                              <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 01.707 1.707L13 9.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-7.586L3.293 5.707A1 1 0 013 5V3z" clipRule="evenodd" />
                            </svg>
                            {filteredOrderImports.length} shown
                          </span>
                        </>
                      )}
                      {selectedRowKeys.size > 0 && (
                        <>
                          <span className="opacity-30">·</span>
                          <span className="flex items-center gap-1">
                            <span className="rounded-full bg-[var(--primary-100)] px-1.5 py-0.5 text-[10px] text-[var(--accent-200)]">
                              {selectedRowKeys.size} selected
                            </span>
                            <button onClick={() => setSelectedRowKeys(new Set())} className="text-[10px] text-[var(--accent-200)] hover:underline cursor-pointer">Clear</button>
                          </span>
                        </>
                      )}
                    </span>
                  )}
                  {/* Bulk delete — full-import mode */}
                  {!isHeaderOnly && selectedRowKeys.size > 0 && (
                    <button type="button" onClick={() => setConfirmBulkDeleteAudit(true)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-rose-700">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete {selectedRowKeys.size}
                    </button>
                  )}
                  {/* Bulk delete — header-only mode */}
                  {isHeaderOnly && selectedJobIds.size > 0 && (
                    <button type="button" onClick={() => setConfirmBulkDeleteJobs(true)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-rose-700">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete {selectedJobIds.size}
                    </button>
                  )}
                  <span className="whitespace-nowrap">Rows per page:</span>
                  <select value={orderPageSize} onChange={(e) => setOrderPageSize(Number(e.target.value))}
                    className="border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] cursor-pointer">
                    {AUDIT_PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {orderPagination.pages > 0 && (
                    <PaginationArrows page={orderPage} pages={orderPagination.pages} onChange={setOrderPage} />
                  )}
                </div>
              </div>

              {/* Table */}
              <div className="relative overflow-x-auto overflow-y-auto flex-1 min-h-0">
                {/* Resync overlay — thin progress bar only; no text banner to avoid table layout shift */}
                {loading && (
                  <div className="sticky top-0 left-0 z-30 w-full">
                    <div className="h-1 w-full overflow-hidden bg-orange-200 dark:bg-orange-800/40">
                      <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-orange-400 to-orange-600"
                        style={{ animation: 'audit-resync-slide 1.4s ease-in-out infinite' }} />
                    </div>
                  </div>
                )}
                <style>{`
                  @keyframes audit-resync-slide {
                    0%   { transform: translateX(-100%); }
                    50%  { transform: translateX(200%); }
                    100% { transform: translateX(-100%); }
                  }
                `}</style>
                <table className="text-[10px] border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <Th className="w-8">
                        {isHeaderOnly ? (
                          <input
                            ref={jobSelectAllRef}
                            type="checkbox"
                            checked={allJobsSelected}
                            onChange={toggleAllJobs}
                            disabled={filteredHeaderOnlyJobs.length === 0}
                            aria-label={allJobsSelected ? 'Deselect all' : 'Select all'}
                            className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-200)] disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        ) : (
                          <input
                            ref={auditSelectAllRef}
                            type="checkbox"
                            checked={allPageSelected}
                            onChange={toggleAllAuditPage}
                            disabled={filteredOrderImports.length === 0}
                            aria-label={allPageSelected ? 'Deselect all on page' : 'Select all on page'}
                            className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-200)] disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        )}
                      </Th>
                      {/* Fixed actions column header — second column, right after the checkbox */}
                      <Th label="Actions" align="center" className="w-20" />
                      {visibleCols.map((col) => (
                        <DraggableTh
                          key={col.id}
                          label={col.label}
                          align={col.center ? 'center' : col.numeric ? 'right' : 'left'}
                          isDragging={auditDragSrc === col.id}
                          isDragTarget={auditDragTarget === col.id}
                          hasActiveFilter={!!(colFilters[col.id]?.size)}
                          onDragStart={() => setAuditDragSrc(col.id)}
                          onDragOver={() => setAuditDragTarget(col.id)}
                          onDrop={() => {
                            if (auditDragSrc && auditDragSrc !== col.id) {
                              const newOrder = reorderCols(auditColOrderRef.current, auditDragSrc, col.id)
                              setAuditColOrder(newOrder)
                              saveColOrdersRef.current(newOrder, emailColOrderRef.current, pdfColOrderRef.current, activeWorkspace?._id ?? '')
                            }
                          }}
                          onDragEnd={() => { setAuditDragSrc(null); setAuditDragTarget(null) }}
                          onFilterClick={(rect) => {
                            if (filterOpenColId === col.id) {
                              setFilterOpenColId(null)
                              setFilterAnchorRect(null)
                            } else {
                              setFilterOpenColId(col.id)
                              setFilterAnchorRect(rect)
                            }
                          }}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* ── Loading skeleton ──
                        Only show on the *initial* load (no data yet). While a background
                        resync is running the violet progress bar at the top of the table
                        provides feedback without replacing the visible rows with skeletons.
                        - header-only:  skeleton while jobs haven't arrived at all yet
                        - full mode:    skeleton while orderImports haven't arrived yet,
                          OR while jobs haven't arrived yet on first load (prevents a flash
                          where rows render with "—" matched-invoice cells before jobs load) */}
                    {(isHeaderOnly ? (loading && jobs.length === 0) : ((orderLoading && orderImports.length === 0) || (loading && jobs.length === 0))) ? (
                      Array.from({ length: 12 }).map((_, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-[var(--bg-100)]' : 'bg-[var(--bg-200)]'}>
                          <td className="px-2.5 py-px"><div className="h-3.5 w-3.5 animate-pulse rounded bg-[var(--bg-300)]" /></td>
                          <td className="px-2.5 py-px" />
                          {visibleCols.map((col) => (
                            <td key={col.id} className="px-2.5 py-px">
                              <div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-300)]" />
                            </td>
                          ))}
                        </tr>
                      ))
                    /* ── Header-only: flat list of completed parse jobs ── */
                    ) : isHeaderOnly ? (
                      filteredHeaderOnlyJobs.length === 0 ? (
                        <tr>
                          <td colSpan={visibleCols.length + 2} className="py-16 text-center">
                            <div className="flex flex-col items-center gap-3">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-200)]">
                                <svg className="h-6 w-6 text-[var(--text-200)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                    d="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </div>
                              <div>
                                <p className="text-[10px] font-medium text-[var(--text-100)]">
                                  {(auditDateFrom || auditDateTo) ? 'No invoices match the date range' : 'No parsed invoices yet'}
                                </p>
                                <p className="mt-0.5 text-[10px] text-[var(--text-200)]">
                                  {(auditDateFrom || auditDateTo)
                                    ? 'Try adjusting or clearing the date filter.'
                                    : 'Upload PDFs in the PDF Imports tab and send them to Tidy Agent — parsed invoices appear here automatically.'}
                                </p>
                              </div>
                              {(auditDateFrom || auditDateTo) && (
                                <button onClick={() => { setAuditDateFrom(''); setAuditDateTo('') }}
                                  className="text-[10px] text-[var(--accent-200)] hover:underline cursor-pointer">
                                  Clear date filter
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <>
                          {filteredHeaderOnlyJobs.map((job, rowIdx) => {
                            const isEven = rowIdx % 2 === 0
                            const isSelected = selectedJobIds.has(job._id)
                            return (
                              <tr key={job._id}
                                className={`group transition-colors align-middle ${isSelected ? 'bg-[var(--primary-100)]/70 hover:bg-[var(--primary-100)]' : isEven ? 'bg-[var(--bg-100)] hover:bg-[var(--primary-100)]/50' : 'bg-[var(--bg-200)] hover:bg-[var(--primary-100)]/50'}`}>
                                <td className="px-2.5 py-0.5" onClick={(e) => e.stopPropagation()}>
                                  <input type="checkbox" checked={isSelected}
                                    onChange={() => toggleJobRow(job._id)}
                                    aria-label={`Select job ${job.filename}`}
                                    className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-200)]" />
                                </td>
                                {/* Per-row actions — always visible, second column */}
                                <td className="px-1.5 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteJob(job)}
                                      title="Delete this parse job"
                                      className="cursor-pointer rounded p-1 text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600 dark:hover:text-rose-300 transition-colors"
                                    >
                                      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </td>
                                {visibleCols.map((col) => (
                                  <td key={col.id}
                                    className={[
                                      'px-2.5 py-0.5 text-[10px] whitespace-nowrap',
                                      col.center ? 'text-center tabular-nums' : col.numeric ? 'text-right tabular-nums' : '',
                                    ].join(' ')}>
                                    {headerOnlyCellFor(col.id, job)}
                                  </td>
                                ))}
                              </tr>
                            )
                          })}
                        </>
                      )

                    /* ── Full mode: existing empty state ── */
                    ) : orderImports.length === 0 ? (
                      <tr>
                        <td colSpan={visibleCols.length + 2} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-200)]">
                              <svg className="h-6 w-6 text-[var(--text-200)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-[var(--text-100)]">
                                {debouncedAuditSearch ? 'No orders match this search' : 'No orders imported yet'}
                              </p>
                              <p className="mt-0.5 text-[10px] text-[var(--text-200)]">
                                {debouncedAuditSearch ? 'Try clearing the filter above.' : 'Click “Import Orders” above to upload a CSV or Excel file.'}
                              </p>
                            </div>
                            {debouncedAuditSearch && (
                              <button onClick={() => setAuditSearch('')} className="text-[10px] text-[var(--accent-200)] hover:underline cursor-pointer">
                                Clear filter
                              </button>
                            )}
                            {!debouncedAuditSearch && (
                              <button onClick={() => { setShowImportModal(true); setImportSuccess(null); setImportError(null) }}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent-200)] px-4 py-2 text-[10px] font-medium text-white">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Import Orders
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : filteredOrderImports.length === 0 && activeFilterCount > 0 ? (
                      /* Column filters eliminated all rows on this page */
                      <tr>
                        <td colSpan={visibleCols.length + 2} className="py-14 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary-100)]">
                              <svg className="h-6 w-6 text-[var(--accent-200)]" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 01.707 1.707L13 9.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-7.586L3.293 5.707A1 1 0 013 5V3z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-[var(--text-100)]">No rows match the active column filters</p>
                              <p className="mt-0.5 text-[10px] text-[var(--text-200)]">Try adjusting your filters or clearing them.</p>
                            </div>
                            <button onClick={() => setColFilters({})} className="text-[10px] text-[var(--accent-200)] hover:underline cursor-pointer">
                              Clear all column filters
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      (() => {
                        const weekMap = new Map<string, DocTidyOrderImport[]>()
                        const UNKNOWN_KEY = '__unknown__'
                        for (const order of filteredOrderImports) {
                          // processedDate is '' when the imported CSV had no matching column
                          // (common in header-only workspaces). Fall back to the matched
                          // invoice date so rows aren't silently bucketed as "Unknown date".
                          const key =
                            getWeekStartKey(order.processedDate) ??
                            getWeekStartKey(order.matchedInvoice?.invoiceDate ?? '') ??
                            UNKNOWN_KEY
                          if (!weekMap.has(key)) weekMap.set(key, [])
                          weekMap.get(key)!.push(order)
                        }
                        const sortedKeys = Array.from(weekMap.keys()).sort((a, b) => {
                          if (a === UNKNOWN_KEY) return 1
                          if (b === UNKNOWN_KEY) return -1
                          return b.localeCompare(a)
                        })
                        let rowIdx = 0
                        const totalCols = visibleCols.length + 2
                        return sortedKeys.flatMap((weekKey) => {
                          const groupOrders = weekMap.get(weekKey)!
                          const isCollapsed = collapsedWeeks.has(weekKey)
                          const label = weekKey === UNKNOWN_KEY ? 'Unknown date' : formatWeekLabel(weekKey)
                          const groupRowKeys = groupOrders.map((o) => o._id)
                          const allGroupSelected = groupRowKeys.length > 0 && groupRowKeys.every((k) => selectedRowKeys.has(k))
                          const someGroupSelected = groupRowKeys.some((k) => selectedRowKeys.has(k))
                          const toggleWeek = () => setCollapsedWeeks((prev) => {
                            const next = new Set(prev)
                            if (next.has(weekKey)) next.delete(weekKey)
                            else next.add(weekKey)
                            return next
                          })
                          const toggleGroupSelection = (e: React.MouseEvent) => {
                            e.stopPropagation()
                            setSelectedRowKeys((prev) => {
                              const next = new Set(prev)
                              if (allGroupSelected) { for (const k of groupRowKeys) next.delete(k) }
                              else { for (const k of groupRowKeys) next.add(k) }
                              return next
                            })
                          }
                          const groupHeader = (
                            <tr key={`week-${weekKey}`} className="sticky top-[33px] z-10">
                              <td className="border-y border-[var(--primary-200)] bg-[var(--primary-100)] dark:border-[var(--primary-200)]/60 px-2.5 py-2 border-l-[3px] border-l-[var(--accent-200)]"
                                onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" checked={allGroupSelected}
                                  ref={(el) => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected }}
                                  onChange={() => {}} onClick={toggleGroupSelection}
                                  aria-label={`Select all rows in week: ${label}`}
                                  className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-200)]" />
                              </td>
                              <td colSpan={totalCols - 1} onClick={toggleWeek}
                                className="cursor-pointer select-none border-y border-[var(--primary-200)] bg-[var(--primary-100)] dark:border-[var(--primary-200)]/60 px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <svg className={`h-3 w-3 shrink-0 text-[var(--accent-200)] transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                  <svg className="h-3.5 w-3.5 shrink-0 text-[var(--accent-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                  <span className="text-[10px] font-semibold text-[var(--text-100)]">{label}</span>
                                  <span className="rounded-full bg-[var(--accent-200)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-200)]">
                                    {groupOrders.length} {groupOrders.length === 1 ? 'order' : 'orders'}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          )
                          if (isCollapsed) return [groupHeader]
                          const dataRows = groupOrders.map((order) => {
                            const matches = invoiceMatchMap.get(order._id) ?? []
                            // Resolve the matched parse job for vendorNeedsSetup detection.
                            const matchedJob = matches[0]?.job
                              ?? (order.matchedInvoice?.jobId ? jobsById.get(order.matchedInvoice.jobId) : undefined)
                              ?? (order.matchedInvoices?.[0]?.jobId ? jobsById.get(order.matchedInvoices[0].jobId) : undefined)
                            const vendorNeedsSetup = matchedJob?.vendorNeedsSetup === true
                            const isEven = rowIdx % 2 === 0
                            const isSelected = selectedRowKeys.has(order._id)
                            rowIdx++
                            return (
                              <tr key={order._id}
                                className={`transition-colors align-middle ${isSelected ? 'bg-[var(--primary-100)]/70 hover:bg-[var(--primary-100)]' : isEven ? 'bg-[var(--bg-100)] hover:bg-[var(--primary-100)]/50' : 'bg-[var(--bg-200)] hover:bg-[var(--primary-100)]/50'}`}>
                                <td className="px-2.5 py-0.5" onClick={(e) => e.stopPropagation()}>
                                  <input type="checkbox" checked={isSelected}
                                    onChange={() => toggleAuditRow(order._id)}
                                    aria-label={`Select order ${order.poNumber}`}
                                    className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-200)]" />
                                </td>
                                {/* Per-row actions — always visible, second column */}
                                <td className="px-1.5 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-center gap-1">
                                    {vendorNeedsSetup && matchedJob && (
                                      <button
                                        type="button"
                                        onClick={() => setAddVendorTarget({ jobId: matchedJob._id, suggestedName: matchedJob.vendorName })}
                                        title="Register the vendor for this invoice"
                                        className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-amber-900/30 transition-colors whitespace-nowrap"
                                      >
                                        + Add Vendor
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteAuditRow(order)}
                                      title="Delete this order"
                                      className="cursor-pointer rounded p-1 text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600 dark:hover:text-rose-300 transition-colors"
                                    >
                                      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </td>
                                {visibleCols.map((col) => (
                                  <td key={col.id}
                                    className={[
                                      'px-2.5 py-0.5 text-[10px] whitespace-nowrap',
                                      col.center ? 'text-center tabular-nums' : col.numeric ? 'text-right tabular-nums' : '',
                                      auditDragSrc === col.id ? 'bg-sky-100/70 dark:bg-sky-500/15' :
                                        auditDragTarget === col.id ? 'bg-sky-50 dark:bg-sky-500/10 border-l-[3px] border-l-sky-400' : '',
                                    ].join(' ')}>
                                    {auditCellFor(col.id, order, matches)}
                                  </td>
                                ))}
                              </tr>
                            )
                          })
                          return [groupHeader, ...dataRows]
                        })
                      })()
                    )}
                  </tbody>
                </table>
              </div>

            </div>
            </div>
          )}
          {/* ── end workspaceTab === 'audit' ── */}
        </div>
      )}

      {/* ── Column settings drawer ── */}
      {showColSettings && (
        <ColumnSettingsDrawer
          visibility={colVisibility}
          onChange={handleColVisChange}
          onClose={() => setShowColSettings(false)}
        />
      )}

      {/* ── Column filter dropdown (portal-rendered, fixed position) ── */}
      {filterOpenColId && filterAnchorRect && (
        <ColumnFilterDropdown
          allValues={getColUniqueValues(filterOpenColId)}
          activeFilter={colFilters[filterOpenColId]}
          anchorRect={filterAnchorRect}
          onApply={(values) => {
            setColFilters((prev) => {
              const next = { ...prev }
              if (values == null || values.size === 0) {
                delete next[filterOpenColId]
              } else {
                next[filterOpenColId] = values
              }
              return next
            })
          }}
          onClose={() => { setFilterOpenColId(null); setFilterAnchorRect(null) }}
        />
      )}

      {/* ── Email column filter dropdown ── */}
      {emailFilterOpenColId && emailFilterAnchorRect && (
        <ColumnFilterDropdown
          allValues={getEmailColUniqueValues(emailFilterOpenColId)}
          activeFilter={emailColFilters[emailFilterOpenColId]}
          anchorRect={emailFilterAnchorRect}
          onApply={(values) => {
            setEmailColFilters((prev) => {
              const next = { ...prev }
              if (values == null || values.size === 0) {
                delete next[emailFilterOpenColId]
              } else {
                next[emailFilterOpenColId] = values
              }
              return next
            })
          }}
          onClose={() => { setEmailFilterOpenColId(null); setEmailFilterAnchorRect(null) }}
        />
      )}

      {/* ── PDF imports column filter dropdown ── */}
      {pdfFilterOpenColId && pdfFilterAnchorRect && (
        <ColumnFilterDropdown
          allValues={getPdfColUniqueValues(pdfFilterOpenColId)}
          activeFilter={pdfColFilters[pdfFilterOpenColId]}
          anchorRect={pdfFilterAnchorRect}
          onApply={(values) => {
            setPdfColFilters((prev) => {
              const next = { ...prev }
              if (values == null || values.size === 0) {
                delete next[pdfFilterOpenColId]
              } else {
                next[pdfFilterOpenColId] = values
              }
              return next
            })
          }}
          onClose={() => { setPdfFilterOpenColId(null); setPdfFilterAnchorRect(null) }}
        />
      )}

      {/* ── Order Import modal ── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            onClick={() => { if (!importing) setShowImportModal(false) }} />
          <div
            role="dialog"
            aria-modal="true"
            className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--bg-300)] px-6 py-5">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-100)]">Import Order File</h2>
                <p className="mt-0.5 text-xs text-[var(--text-200)]">
                  Upload a CSV or Excel (.xlsx) file with your order details.
                </p>
              </div>
              <button type="button" onClick={() => setShowImportModal(false)} disabled={importing}
                aria-label="Close"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)] disabled:opacity-40">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {(() => {
                const isHeaderOnly = activeWorkspace?.importMode === 'header-only'
                const templateHeader = isHeaderOnly
                  ? 'PO #'
                  : 'Processed Date,PO #,Purchased Date,Customer Name,Order ID,Order SKU,Order Qty,LESD,Status'
                const templateFilename = isHeaderOnly
                  ? 'order-import-template-po-only.csv'
                  : 'order-import-template.csv'
                return (
                  <div className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-semibold text-[var(--text-200)] uppercase tracking-wide">Expected columns</p>
                      <button
                        type="button"
                        onClick={() => {
                          const blob = new Blob([templateHeader + '\n'], { type: 'text/csv' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = templateFilename
                          a.click()
                          URL.revokeObjectURL(url)
                        }}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--bg-300)] bg-[var(--bg-100)] px-2 py-1 text-[10px] text-[var(--text-200)] hover:bg-[var(--bg-300)] hover:text-[var(--text-100)] transition-colors"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download template
                      </button>
                    </div>
                    {isHeaderOnly ? (
                      <>
                        <p className="text-[10px] text-[var(--text-200)] leading-relaxed font-mono">
                          <span className="font-semibold text-[var(--text-100)]">PO #</span>
                          {' · '}
                          <span className="opacity-60">Processed Date · Purchased Date · Customer Name · Order ID · Order SKU · Order Qty · LESD · Status</span>
                        </p>
                        <p className="mt-1.5 text-[10px] text-[var(--text-200)]">
                          Only <strong>PO #</strong> is required — all other columns are optional. Rows will be matched to invoices by PO # alone.
                        </p>
                      </>
                    ) : (
                      <p className="text-[10px] text-[var(--text-200)] leading-relaxed font-mono">
                        Processed Date · PO # · Purchased Date · Customer Name · Order ID · Order SKU · Order Qty · LESD · Status
                      </p>
                    )}
                  </div>
                )
              })()}
              <label
                onDragOver={(e) => { e.preventDefault(); setImportDragOver(true) }}
                onDragLeave={() => setImportDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setImportDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file) void handleImportFile(file)
                }}
                className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${
                  importDragOver
                    ? 'border-[var(--accent-200)] bg-[var(--primary-100)]'
                    : 'border-[var(--bg-300)] hover:border-[var(--accent-200)] hover:bg-[var(--bg-200)]'
                }`}
              >
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleImportFile(file)
                    e.target.value = ''
                  }}
                  disabled={importing}
                />
                {importing ? (
                  <Spinner className="h-8 w-8 text-[var(--accent-200)]" />
                ) : (
                  <svg className="h-8 w-8 text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                )}
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--text-100)]">
                    {importing ? 'Uploading…' : 'Drop your file here'}
                  </p>
                  <p className="text-xs text-[var(--text-200)]">
                    {importing ? 'Please wait' : 'or click to browse — CSV or Excel (.xlsx)'}
                  </p>
                </div>
              </label>
              {importError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400">
                  {importError}
                </p>
              )}
              {importSuccess && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 px-3.5 py-2.5 space-y-1">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    ✓ Imported {importSuccess.count.toLocaleString()} order {importSuccess.count === 1 ? 'row' : 'rows'} successfully.
                  </p>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-500">
                    DC COGS is being fetched in the background — close this dialog and use <strong>Resync</strong> in a moment to see the values.
                  </p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-200)] px-6 py-4">
              <button type="button" onClick={() => setShowImportModal(false)} disabled={importing}
                className="cursor-pointer rounded-lg px-4 py-2 text-sm text-[var(--text-200)] hover:text-[var(--text-100)] hover:bg-[var(--bg-300)] disabled:opacity-40">
                {importSuccess ? 'Close' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Workspace editor ── */}
      {editTarget !== null && (
        <WorkspaceEditorDialog
          initial={editTarget === 'new' ? null : editTarget}
          onSave={handleWorkspaceSaved}
          onClose={() => setEditTarget(null)}
          initialOrgId={editTarget === 'new' ? (activeOrg?._id) : undefined}
        />
      )}

      {/* ── Organization editor (admin only) ── */}
      {editOrgTarget !== null && (
        <OrganizationEditorDialog
          initial={editOrgTarget === 'new' ? null : editOrgTarget}
          onSave={handleOrgSaved}
          onClose={() => setEditOrgTarget(null)}
          workspaces={workspaces}
          onWorkspaceMoved={handleWorkspaceSaved}
        />
      )}

      {/* ── Move workspace dialog (admin only) ── */}
      {moveTarget !== null && (
        <MoveWorkspaceDialog
          workspace={moveTarget}
          organizations={organizations}
          onSave={handleWorkspaceSaved}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {/* ── Add Vendor overlay (Invoice Audit tab) ── */}
      {addVendorTarget && activeWorkspace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={() => setAddVendorTarget(null)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-100)]">Register vendor</h2>
                <p className="mt-0.5 text-xs text-[var(--text-200)]">Add this supplier so Tidy Agent scopes its corrections correctly.</p>
              </div>
              <button type="button" onClick={() => setAddVendorTarget(null)} aria-label="Close"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <VendorSetup
              jobId={addVendorTarget.jobId}
              workspaceId={activeWorkspace._id}
              suggestedName={addVendorTarget.suggestedName}
              onRegistered={() => {
                setAddVendorTarget(null)
                void fetchAllJobsRef.current()
                void fetchOrderImportsRef.current()
              }}
            />
          </div>
        </div>
      )}

      {/* ── Parse job reasoning panel (workspace emails tab) ── */}
      {openJobId && (
        <ParseJobPanel
          jobId={openJobId}
          onClose={() => setOpenJobId(null)}
          onChanged={() => void fetchEmails(true)}
        />
      )}

      {/* ── Message detail drawer (workspace emails tab) ── */}
      {viewMessage && (
        <MessageDetailDrawer
          message={viewMessage}
          onClose={() => setViewMessage(null)}
          onOpenJob={setOpenJobId}
        />
      )}

      {/* ── Confirm delete: email message ── */}
      {confirmDeleteEmail && (
        <ConfirmDeleteDialog
          title="Delete this message?"
          description={
            <>
              <span className="font-medium text-[var(--text-100)]">{confirmDeleteEmail.subject || '(no subject)'}</span>
              {' '}from <span className="font-medium text-[var(--text-100)]">{confirmDeleteEmail.fromName || confirmDeleteEmail.from}</span>
              <br />
              <span className="text-[var(--text-200)]">The message record and any Drive attachments will be permanently removed. This cannot be undone.</span>
            </>
          }
          deleting={emailDeleting}
          onConfirm={() => void handleDeleteEmail(confirmDeleteEmail)}
          onCancel={() => setConfirmDeleteEmail(null)}
        />
      )}

      {/* ── Confirm delete: PDF import ── */}
      {confirmDeletePdf && (
        <ConfirmDeleteDialog
          title="Delete this PDF import?"
          description={
            <>
              <span className="font-medium text-[var(--text-100)]">{confirmDeletePdf.filename}</span>
              <br />
              <span className="text-[var(--text-200)]">
                {confirmDeletePdf.driveFileId
                  ? 'The import record and its Google Drive copy will be permanently removed.'
                  : 'The import record will be permanently removed.'}
                {' '}This cannot be undone.
              </span>
            </>
          }
          deleting={pdfDeleting}
          onConfirm={() => void confirmAndDeletePdfImport(confirmDeletePdf)}
          onCancel={() => setConfirmDeletePdf(null)}
        />
      )}

      {/* ── Confirm bulk delete: emails ── */}
      {confirmBulkDeleteEmails && (
        <ConfirmDeleteDialog
          title={`Delete ${selectedEmailIds.size} selected message${selectedEmailIds.size !== 1 ? 's' : ''}?`}
          description={
            <span className="text-[var(--text-200)]">
              {selectedEmailIds.size} message{selectedEmailIds.size !== 1 ? 's' : ''}, their attachments, and associated parse jobs will be permanently removed. This cannot be undone.
            </span>
          }
          deleting={emailBulkDeleting}
          onConfirm={() => void handleBulkDeleteEmails()}
          onCancel={() => setConfirmBulkDeleteEmails(false)}
        />
      )}

      {/* ── Confirm bulk delete: PDF imports ── */}
      {confirmBulkDeletePdfs && (
        <ConfirmDeleteDialog
          title={`Delete ${pdfSelectedIds.size} selected PDF import${pdfSelectedIds.size !== 1 ? 's' : ''}?`}
          description={
            <span className="text-[var(--text-200)]">
              {pdfSelectedIds.size} import record{pdfSelectedIds.size !== 1 ? 's' : ''} and any associated Google Drive copies will be permanently removed. This cannot be undone.
            </span>
          }
          deleting={pdfBulkDeleting}
          onConfirm={() => void handleBulkDeletePdfs()}
          onCancel={() => setConfirmBulkDeletePdfs(false)}
        />
      )}

      {/* ── Confirm delete: single audit row ── */}
      {confirmDeleteAuditRow && (
        <ConfirmDeleteDialog
          title="Delete this order?"
          description={
            <>
              <span className="font-medium text-[var(--text-100)]">
                {confirmDeleteAuditRow.poNumber
                  ? `PO #${confirmDeleteAuditRow.poNumber}`
                  : confirmDeleteAuditRow.orderId || 'This order'}
              </span>
              {confirmDeleteAuditRow.customerName && (
                <> for <span className="font-medium text-[var(--text-100)]">{confirmDeleteAuditRow.customerName}</span></>
              )}
              <br />
              <span className="text-[var(--text-200)]">The row will be permanently removed from the audit table. This cannot be undone.</span>
            </>
          }
          deleting={auditRowDeleting}
          onConfirm={() => void handleDeleteOrderImport(confirmDeleteAuditRow)}
          onCancel={() => setConfirmDeleteAuditRow(null)}
        />
      )}

      {/* ── Confirm delete: bulk audit rows ── */}
      {confirmBulkDeleteAudit && (
        <ConfirmDeleteDialog
          title={`Delete ${selectedRowKeys.size} selected order${selectedRowKeys.size !== 1 ? 's' : ''}?`}
          description={
            <span className="text-[var(--text-200)]">
              {selectedRowKeys.size} row{selectedRowKeys.size !== 1 ? 's' : ''} will be permanently removed from the audit table. This cannot be undone.
            </span>
          }
          deleting={auditBulkDeleting}
          onConfirm={() => void handleBulkDeleteOrderImports()}
          onCancel={() => setConfirmBulkDeleteAudit(false)}
        />
      )}

      {/* ── Confirm delete: single header-only parse job ── */}
      {confirmDeleteJob && (
        <ConfirmDeleteDialog
          title="Delete this parsed invoice?"
          description={
            <>
              <span className="font-medium text-[var(--text-100)]">{confirmDeleteJob.filename}</span>
              <br />
              <span className="text-[var(--text-200)]">The parse job and its extracted data will be permanently removed. This cannot be undone.</span>
            </>
          }
          deleting={jobDeleting}
          onConfirm={() => void handleDeleteParseJob(confirmDeleteJob)}
          onCancel={() => setConfirmDeleteJob(null)}
        />
      )}

      {/* ── Confirm delete: bulk header-only parse jobs ── */}
      {confirmBulkDeleteJobs && (
        <ConfirmDeleteDialog
          title={`Delete ${selectedJobIds.size} selected invoice${selectedJobIds.size !== 1 ? 's' : ''}?`}
          description={
            <span className="text-[var(--text-200)]">
              {selectedJobIds.size} parse job{selectedJobIds.size !== 1 ? 's' : ''} and their extracted data will be permanently removed. This cannot be undone.
            </span>
          }
          deleting={jobBulkDeleting}
          onConfirm={() => void handleBulkDeleteParseJobs()}
          onCancel={() => setConfirmBulkDeleteJobs(false)}
        />
      )}
    </div>
  )
}

