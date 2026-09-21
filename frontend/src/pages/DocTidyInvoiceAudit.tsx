import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authApi } from '../lib/api'
import {
  Banner,
  DocumentTypeBadge,
  PaginationArrows,
  Spinner,
  Th,
  avatarColour,
} from '../components/docTidy/docTidyUi'
import AttachmentIcons from '../components/docTidy/AttachmentIcons'
import MessageDetailDrawer from '../components/docTidy/MessageDetailDrawer'
import ParseJobPanel from '../components/docTidy/ParseJobPanel'
import WorkspaceRulesView from './DocTidyRules'
import WorkspaceVendorsView from './DocTidyVendors'
import { formatDate, formatDateTime } from '../lib/format'
import {
  INVOICE_AUDIT_COLUMNS,
  WORKSPACE_EMAIL_COLUMNS,
  DEFAULT_AUDIT_COL_ORDER,
  DEFAULT_EMAIL_COL_ORDER,
  PAGE_SIZE_OPTIONS,
  loadAuditColumnVisibility,
  saveAuditColumnVisibility,
  extractJsonField,
  extractJsonArray,
  type DocTidyEvent,
  type DocTidyMessage,
  type DocTidyMessagesResponse,
  type DocTidyWorkspace,
  type InvoiceAuditColumn,
  type InvoiceAuditColumnId,
  type WorkspaceEmailColumn,
  type WorkspaceEmailColumnId,
  type ParseJobListItem,
  type ParseJobsResponse,
} from '../types/docTidy'

/** Strip common currency prefixes/symbols for cleaner display. */
function formatTotal(raw: string): string {
  return raw.trim()
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  label: string
  iconPath?: string
  align?: 'left' | 'center' | 'right'
  isDragging?: boolean
  isDragTarget?: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
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
      className={[
        'sticky top-0 z-20 border-b border-[var(--bg-300)] border-r border-[var(--bg-300)] last:border-r-0',
        'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap select-none',
        'transition-all duration-100',
        textAlign,
        // ── Drag source: sky-blue ring + tinted background so it's obvious what's being moved
        isDragging
          ? 'opacity-60 cursor-grabbing bg-sky-100 dark:bg-sky-500/20 ring-2 ring-inset ring-sky-400 text-sky-700 dark:text-sky-300'
          : 'cursor-grab bg-[var(--bg-200)] text-slate-700 dark:text-[var(--text-200)]',
        // ── Drop target: thick sky-blue left bar as an insertion indicator
        isDragTarget
          ? 'border-l-[3px] border-l-sky-400 bg-sky-50 dark:bg-sky-500/10'
          : '',
      ].join(' ')}
    >
      <span className={`flex items-center gap-1.5 ${flexAlign}`}>
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
        {label}
      </span>
    </th>
  )
}

/* ──────────────────────────────── Column Settings Drawer ── */

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

  const docCols   = INVOICE_AUDIT_COLUMNS.filter((c) => c.section === 'document')
  const liCols    = INVOICE_AUDIT_COLUMNS.filter((c) => c.section === 'lineItem')

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
          <p className="text-[11px] text-[var(--text-200)]">{col.description}</p>
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
            <p className="mt-0.5 text-xs text-[var(--text-200)]">
              Toggle which fields are shown in the table.
            </p>
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
          {/* Document fields section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <svg className="h-3.5 w-3.5 text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
                Document fields
              </p>
            </div>
            <ul className="space-y-1">
              {docCols.map((col) => <ColRow key={col.id} col={col} />)}
            </ul>
          </div>

          {/* Line item fields section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <svg className="h-3.5 w-3.5 text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
                Line item fields
              </p>
            </div>
            <ul className="space-y-1">
              {liCols.map((col) => <ColRow key={col.id} col={col} />)}
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
}: {
  initial: DocTidyWorkspace | null
  onSave: (workspace: DocTidyWorkspace) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

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
      const body = { name: name.trim() }
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
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-200)] mb-1.5">
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
}: {
  workspace: DocTidyWorkspace
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
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
        <p className="mt-2 text-[11px] text-[var(--text-200)]">
          Open to manage rules, emails, and audit results.
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-[var(--bg-300)] px-5 py-3" onClick={(e) => e.stopPropagation()}>
        <span className="text-[11px] text-[var(--text-200)]">
          Created {new Date(workspace.createdAt).toLocaleDateString()}
        </span>
        <div className="flex items-center gap-1">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-rose-500">Delete?</span>
              <button onClick={onDelete} className="cursor-pointer rounded px-2 py-1 text-[11px] font-medium text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="cursor-pointer rounded px-2 py-1 text-[11px] text-[var(--text-200)] hover:bg-[var(--bg-300)]">No</button>
            </div>
          ) : (
            <>
              <button onClick={onEdit} className="cursor-pointer rounded px-2 py-1 text-[11px] text-[var(--text-200)] hover:bg-[var(--bg-300)] hover:text-[var(--text-100)]">Edit</button>
              <button onClick={() => setConfirmDelete(true)} className="cursor-pointer rounded px-2 py-1 text-[11px] text-[var(--text-200)] hover:bg-[var(--bg-300)] hover:text-rose-500 dark:hover:text-rose-400">Delete</button>
              <button onClick={onOpen} className="cursor-pointer rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-3 py-1 text-[11px] font-medium text-white hover:opacity-80 transition-opacity">Open →</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────── Line item cell helpers ── */

/** Pull a scalar value from a line-item object. */
function liField(item: Record<string, unknown>, ...candidates: string[]): string {
  return extractJsonField(item, ...candidates)
}

/** Text cell — monospace variant for codes. */
function liText(value: string, mono = false): React.ReactNode {
  if (!value) return <span className="text-[var(--text-200)]">—</span>
  return <span className={mono ? 'font-mono text-[var(--text-100)]' : 'text-[var(--text-100)]'}>{value}</span>
}

/** Numeric / currency cell. */
function liNum(value: string): React.ReactNode {
  if (!value) return <span className="text-[var(--text-200)]">—</span>
  return <span className="tabular-nums text-[var(--text-100)]">{value}</span>
}

/** Render an inline line item column cell for the given item (null = no item). */
function liCellFor(colId: InvoiceAuditColumnId, item: Record<string, unknown> | null): React.ReactNode {
  if (!item) return <span className="text-[var(--text-200)]">—</span>
  switch (colId) {
    case 'liSku':             return liText(liField(item, 'sku', 'part_number', 'part_no', 'item_code', 'product_code', 'sku_number'), true)
    case 'liModel':           return liText(liField(item, 'model', 'model_number', 'model_no', 'style', 'style_number', 'style_no'), true)
    case 'liDescription':     return liText(liField(item, 'description', 'name', 'product', 'item', 'item_description', 'desc', 'product_name'))
    case 'liQuantity':        return liNum(liField(item, 'quantity', 'qty', 'units', 'ordered_quantity', 'order_qty', 'amount'))
    case 'liUnitPrice':       return liNum(liField(item, 'unit_price', 'price', 'rate', 'cost', 'unit_cost', 'item_cost', 'list_price'))
    case 'liDiscountedPrice': return liNum(liField(item, 'discounted_price', 'sale_price', 'net_price', 'after_discount', 'final_price', 'net_unit_price', 'your_price'))
    case 'liDiscountPercent': return liNum(liField(item, 'discount_percent', 'discount_pct', 'discount_rate', 'discount', 'disc_pct', 'disc'))
    case 'liLineTotal':       return liNum(liField(item, 'total', 'line_total', 'subtotal', 'extended_price', 'total_cost', 'extended_amount', 'ext_price', 'amount'))
    case 'liUom':             return liText(liField(item, 'uom', 'unit', 'unit_of_measure', 'unit_measure'), true)
    case 'liTaxAmount':       return liNum(liField(item, 'tax', 'tax_amount', 'tax_value', 'vat', 'gst', 'hst'))
    case 'liNotes':           return liText(liField(item, 'notes', 'note', 'remarks', 'comments', 'comment'))
    default:                  return null
  }
}

/** True if the column id belongs to the line item section. */
function isLineItemCol(id: InvoiceAuditColumnId): boolean {
  return id.startsWith('li')
}

/* ──────────────────────────────────────────────── Page ── */

/** Smaller page sizes for the audit table, which flattens one row per line item. */
const AUDIT_PAGE_SIZES = [500, 1000, 2000, 5000]

export default function DocTidyInvoiceAudit() {
  /* ── View state ── */
  type View = 'workspaces' | 'audit'
  const [view, setView] = useState<View>('workspaces')
  const [activeWorkspace, setActiveWorkspace] = useState<DocTidyWorkspace | null>(null)
  /** Which sub-tab is active inside a workspace detail page. */
  type WorkspaceTab = 'audit' | 'emails' | 'rules' | 'vendors'
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('audit')

  /* ── Workspaces ── */
  const [workspaces, setWorkspaces] = useState<DocTidyWorkspace[]>([])
  const [wsLoading, setWsLoading] = useState(true)
  const [wsError, setWsError] = useState<string | null>(null)

  /* ── Workspace editor ── */
  const [editTarget, setEditTarget] = useState<DocTidyWorkspace | 'new' | null>(null)

  /* ── Tidy Agent worker status ── */
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null)

  /* ── Audit table ── */
  const [jobs, setJobs] = useState<ParseJobListItem[]>([])
  const [pagination, setPagination] = useState({ total: 0, pages: 1 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [auditSearch, setAuditSearch] = useState('')
  const [debouncedAuditSearch, setDebouncedAuditSearch] = useState('')
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [colVisibility, setColVisibility] = useState<Record<InvoiceAuditColumnId, boolean>>(loadAuditColumnVisibility)
  const [showColSettings, setShowColSettings] = useState(false)

  /* ── Shared column ordering (server-persisted, real-time via SSE) ── */
  const [auditColOrder, setAuditColOrder] = useState<InvoiceAuditColumnId[]>(DEFAULT_AUDIT_COL_ORDER)
  const [emailColOrder, setEmailColOrder] = useState<WorkspaceEmailColumnId[]>(DEFAULT_EMAIL_COL_ORDER)
  /** State tracks both source and hover target so `isDragging` is readable in render. */
  const [auditDragSrc, setAuditDragSrc] = useState<InvoiceAuditColumnId | null>(null)
  const [auditDragTarget, setAuditDragTarget] = useState<InvoiceAuditColumnId | null>(null)
  const [emailDragSrc, setEmailDragSrc] = useState<WorkspaceEmailColumnId | null>(null)
  const [emailDragTarget, setEmailDragTarget] = useState<WorkspaceEmailColumnId | null>(null)

  /* ── Workspace Emails tab ── */
  const [emailMessages, setEmailMessages] = useState<DocTidyMessage[]>([])
  const [emailPagination, setEmailPagination] = useState({ total: 0, pages: 1 })
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailPage, setEmailPage] = useState(1)
  const [emailPageSize, setEmailPageSize] = useState(PAGE_SIZE_OPTIONS[0])
  const [emailSearch, setEmailSearch] = useState('')
  const [emailDebouncedSearch, setEmailDebouncedSearch] = useState('')
  const [emailDateFrom, setEmailDateFrom] = useState('')
  const [emailDateTo, setEmailDateTo] = useState('')
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const [viewMessage, setViewMessage] = useState<DocTidyMessage | null>(null)
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set())
  const selectAllEmailRef = useRef<HTMLInputElement>(null)

  const emailCheckboxClass =
    'h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent-200)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-200)]'

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

  /* ── Load shared column order from server on mount ── */
  useEffect(() => {
    authApi
      .get<{ data: { auditColumnOrder?: string[]; wsEmailColumnOrder?: string[] } }>('/doc-tidy/ui-prefs')
      .then((res) => {
        const { auditColumnOrder, wsEmailColumnOrder } = res.data

        if (auditColumnOrder && auditColumnOrder.length > 0) {
          // Preserve any stored order; append new column ids that don't exist yet
          const valid = auditColumnOrder.filter((id): id is InvoiceAuditColumnId =>
            INVOICE_AUDIT_COLUMNS.some((c) => c.id === id)
          )
          const merged = [...valid, ...DEFAULT_AUDIT_COL_ORDER.filter((id) => !valid.includes(id))]
          setAuditColOrder(merged)
        }

        if (wsEmailColumnOrder && wsEmailColumnOrder.length > 0) {
          const valid = wsEmailColumnOrder.filter((id): id is WorkspaceEmailColumnId =>
            WORKSPACE_EMAIL_COLUMNS.some((c) => c.id === id)
          )
          const merged = [...valid, ...DEFAULT_EMAIL_COL_ORDER.filter((id) => !valid.includes(id))]
          setEmailColOrder(merged)
        }
      })
      .catch(() => { /* Non-critical — silently fall back to defaults. */ })
  }, [])

  /** Persist column orders to the server (non-blocking, fire-and-forget). */
  const saveColOrders = useCallback(
    (auditOrder: InvoiceAuditColumnId[], emailOrder: WorkspaceEmailColumnId[]) => {
      void authApi.put('/doc-tidy/ui-prefs', {
        auditColumnOrder: auditOrder,
        wsEmailColumnOrder: emailOrder,
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
  useEffect(() => { setEmailPage(1); setSelectedEmailIds(new Set()) }, [emailDebouncedSearch, emailDateFrom, emailDateTo, emailPageSize])

  /* ── Fetch workspace emails (with parse jobs) ── */
  const fetchEmails = useCallback(async (silent = false) => {
    if (!activeWorkspace) return
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
      setEmailMessages(res.data)
      setEmailPagination({ total: res.pagination.total, pages: Math.max(1, res.pagination.pages) })
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to load messages')
    } finally {
      if (!silent) setEmailLoading(false)
    }
  }, [activeWorkspace, emailPage, emailPageSize, emailDebouncedSearch, emailDateFrom, emailDateTo])

  useEffect(() => {
    if (workspaceTab === 'emails') void fetchEmails()
  }, [fetchEmails, workspaceTab])

  /* Keep a stable ref so the SSE handler always calls the latest fetcher
     without needing to reconnect on every filter change. */
  const fetchEmailsRef = useRef(fetchEmails)
  useEffect(() => { fetchEmailsRef.current = fetchEmails }, [fetchEmails])

  /* SSE — subscribe while on the emails tab to keep parse statuses live */
  useEffect(() => {
    if (workspaceTab !== 'emails' || !activeWorkspace) return
    return authApi.eventStream<DocTidyEvent>(
      '/doc-tidy/stream',
      (event) => {
        if (event.type === 'imported') {
          void fetchEmailsRef.current(true)
        }
        if (event.type === 'parse_status' &&
            (event.parseStatus === 'completed' || event.parseStatus === 'failed')) {
          void fetchEmailsRef.current(true)
        }
        if (event.type === 'worker_status') {
          setWorkerOnline(event.workerOnline ?? false)
        }
        if (event.type === 'ui_prefs') {
          if (event.auditColumnOrder && event.auditColumnOrder.length > 0) {
            const valid = event.auditColumnOrder.filter((id): id is InvoiceAuditColumnId =>
              INVOICE_AUDIT_COLUMNS.some((c) => c.id === id)
            )
            setAuditColOrder([...valid, ...DEFAULT_AUDIT_COL_ORDER.filter((id) => !valid.includes(id))])
          }
          if (event.wsEmailColumnOrder && event.wsEmailColumnOrder.length > 0) {
            const valid = event.wsEmailColumnOrder.filter((id): id is WorkspaceEmailColumnId =>
              WORKSPACE_EMAIL_COLUMNS.some((c) => c.id === id)
            )
            setEmailColOrder([...valid, ...DEFAULT_EMAIL_COL_ORDER.filter((id) => !valid.includes(id))])
          }
        }
      },
      () => {}
    )
  }, [workspaceTab, activeWorkspace])

  /* SSE — subscribe while on the audit tab to auto-populate completed results */
  useEffect(() => {
    if (workspaceTab !== 'audit' || !activeWorkspace) return
    return authApi.eventStream<DocTidyEvent>(
      '/doc-tidy/stream',
      (event) => {
        if (event.type === 'parse_status' && event.parseStatus === 'completed') {
          void fetchJobsRef.current()
        }
        if (event.type === 'worker_status') {
          setWorkerOnline(event.workerOnline ?? false)
        }
        if (event.type === 'ui_prefs') {
          if (event.auditColumnOrder && event.auditColumnOrder.length > 0) {
            const valid = event.auditColumnOrder.filter((id): id is InvoiceAuditColumnId =>
              INVOICE_AUDIT_COLUMNS.some((c) => c.id === id)
            )
            setAuditColOrder([...valid, ...DEFAULT_AUDIT_COL_ORDER.filter((id) => !valid.includes(id))])
          }
          if (event.wsEmailColumnOrder && event.wsEmailColumnOrder.length > 0) {
            const valid = event.wsEmailColumnOrder.filter((id): id is WorkspaceEmailColumnId =>
              WORKSPACE_EMAIL_COLUMNS.some((c) => c.id === id)
            )
            setEmailColOrder([...valid, ...DEFAULT_EMAIL_COL_ORDER.filter((id) => !valid.includes(id))])
          }
        }
      },
      () => {}
    )
  }, [workspaceTab, activeWorkspace])

  /* SSE — also track worker status from the emails tab */
  useEffect(() => {
    if (workspaceTab !== 'emails' || !activeWorkspace) return
    // worker_status events are handled within the existing emails SSE — merged below
  }, [workspaceTab, activeWorkspace])

  /* Fetch initial worker status whenever a workspace is active */
  useEffect(() => {
    if (!activeWorkspace) return
    authApi.get<{ data: { connected: boolean } }>('/doc-tidy/worker/status')
      .then((res) => setWorkerOnline(res.data.connected))
      .catch(() => setWorkerOnline(false))
  }, [activeWorkspace])

  /* Indeterminate state on the select-all checkbox */
  const allEmailsOnPageSelected =
    emailMessages.length > 0 && emailMessages.every((m) => selectedEmailIds.has(m._id))
  const someEmailsOnPageSelected = emailMessages.some((m) => selectedEmailIds.has(m._id))
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
      for (const msg of emailMessages) {
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

  useEffect(() => { setPage(1); setSelectedJobIds(new Set()) }, [debouncedAuditSearch, pageSize])

  /* ── Fetch parse jobs ── */
  const fetchJobs = useCallback(async () => {
    if (!activeWorkspace) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        status: 'completed',
        workspaceId: activeWorkspace._id,
      })

      if (debouncedAuditSearch) {
        // Fetch all records for this workspace and filter client-side so that
        // every value in the table (vendor, SKU, invoice #, description, etc.)
        // is searchable — deeply nested jsonOutput fields can't be queried server-side.
        params.set('page', '1')
        params.set('pageSize', '5000')
      } else {
        params.set('page', String(page))
        params.set('pageSize', String(pageSize))
      }

      const res = await authApi.get<ParseJobsResponse>(`/doc-tidy/parse-jobs?${params.toString()}`)

      if (debouncedAuditSearch) {
        const term = debouncedAuditSearch.toLowerCase()
        const filtered = res.data.filter((j) => jobMatchesSearch(j, term))
        setJobs(filtered)
        // Treat the filtered set as one page so pagination arrows stay hidden
        setPagination({ total: filtered.length, pages: 1 })
      } else {
        setJobs(res.data)
        setPagination({ total: res.pagination.total, pages: Math.max(1, res.pagination.pages) })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoice data')
    } finally {
      setLoading(false)
    }
  }, [activeWorkspace, page, pageSize, debouncedAuditSearch])

  useEffect(() => { void fetchJobs() }, [fetchJobs])

  /* Keep a stable ref so the audit-tab SSE handler always calls the latest
     fetchJobs without reconnecting when filters change. */
  const fetchJobsRef = useRef(fetchJobs)
  useEffect(() => { fetchJobsRef.current = fetchJobs }, [fetchJobs])

  /* Re-fetch whenever the user switches to the audit tab so results that
     completed while the user was on the Emails tab appear immediately —
     the audit SSE is disconnected during that time and misses the event. */
  useEffect(() => {
    if (workspaceTab === 'audit') void fetchJobsRef.current()
  }, [workspaceTab])

  /* ── Workspace navigation ── */
  const enterWorkspace = (ws: DocTidyWorkspace) => {
    setActiveWorkspace(ws)
    setView('audit')
    setWorkspaceTab('audit')
    setPage(1)
    setAuditSearch('')
    setDebouncedAuditSearch('')
    setSelectedJobIds(new Set())
    setError(null)
    // Reset email sub-view state
    setEmailPage(1)
    setEmailSearch('')
    setEmailDebouncedSearch('')
    setEmailDateFrom('')
    setEmailDateTo('')
    setEmailError(null)
    setEmailMessages([])
    setSelectedEmailIds(new Set())
  }

  const leaveWorkspace = () => {
    setView('workspaces')
    setActiveWorkspace(null)
    setJobs([])
    setPagination({ total: 0, pages: 1 })
    setWorkspaceTab('audit')
    setAuditSearch('')
    setDebouncedAuditSearch('')
    setSelectedJobIds(new Set())
    setEmailMessages([])
    setEmailPagination({ total: 0, pages: 1 })
  }

  const openEditor = (target: DocTidyWorkspace | 'new') => {
    setEditTarget(target)
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

  /* ── Column helpers ── */
  const handleColVisChange = (next: Record<InvoiceAuditColumnId, boolean>) => {
    setColVisibility(next)
    saveAuditColumnVisibility(next)
  }

  const visibleCols = useMemo(
    () =>
      auditColOrder
        .map((id) => INVOICE_AUDIT_COLUMNS.find((c) => c.id === id))
        .filter((c): c is InvoiceAuditColumn => c !== undefined && colVisibility[c.id]),
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

  /* ── Selection helpers (audit table) ── */
  const pageJobIds = useMemo(() => [...new Set(jobs.map((j) => j._id))], [jobs])
  const allPageSelected = pageJobIds.length > 0 && pageJobIds.every((id) => selectedJobIds.has(id))
  const somePageSelected = pageJobIds.some((id) => selectedJobIds.has(id))
  const auditSelectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (auditSelectAllRef.current) {
      auditSelectAllRef.current.indeterminate = somePageSelected && !allPageSelected
    }
  }, [somePageSelected, allPageSelected])

  const toggleAuditJob = (jobId: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }
  const toggleAllAuditPage = () => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev)
      for (const id of pageJobIds) {
        if (allPageSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  /* ── Excel export ── */
  const exportToExcel = async (mode: 'selection' | 'all') => {
    if (!activeWorkspace) return
    setExporting(true)
    setError(null)
    try {
      const XLSX = await import('xlsx')

      let exportJobs: ParseJobListItem[]
      if (mode === 'selection') {
        exportJobs = jobs.filter((j) => selectedJobIds.has(j._id))
      } else {
        // Fetch all matching records regardless of current pagination
        const params = new URLSearchParams({
          status: 'completed',
          page: '1',
          pageSize: '5000',
          workspaceId: activeWorkspace._id,
        })
        if (debouncedAuditSearch) params.set('search', debouncedAuditSearch)
        const res = await authApi.get<ParseJobsResponse>(`/doc-tidy/parse-jobs?${params.toString()}`)
        exportJobs = res.data
      }

      // Use visibleCols so the export matches the current column order and visibility in the UI
      const rows: Record<string, string>[] = []
      for (const job of exportJobs) {
        const json = job.jsonOutput ?? null
        const lineItems = extractJsonArray(json, 'line_items', 'items', 'products', 'line items', 'lineItems', 'order_items', 'orderItems')
        const rowItems: (Record<string, unknown> | null)[] = lineItems.length > 0 ? lineItems : [null]

        for (const item of rowItems) {
          const row: Record<string, string> = {}
          for (const col of visibleCols) {
            if (isLineItemCol(col.id)) {
              row[col.label] = item ? liField(item as Record<string, unknown>, ...liFieldKeys(col.id)) : ''
            } else {
              row[col.label] = docFieldStr(col.id, job)
            }
          }
          rows.push(row)
        }
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

  const startItem = pagination.total === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, pagination.total)

  const inputClass =
    'text-[11px] border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]'

  /* ── Document-level cell renderer ── */
  const docCellFor = (colId: InvoiceAuditColumnId, job: ParseJobListItem): React.ReactNode => {
    const json = job.jsonOutput ?? null
    switch (colId) {
      case 'vendorName':
        return (
          <span className="font-medium text-[var(--text-100)]">
            {job.vendorName ||
              extractJsonField(json, 'vendor_name', 'vendor', 'supplier', 'company', 'from') ||
              <span className="italic text-[var(--text-200)]">—</span>}
          </span>
        )
      case 'documentType': {
        const rawType = extractJsonField(json, 'document_type', 'type', 'doc_type')
        const norm = rawType.toLowerCase().replace(/[\s_-]+/g, '_')
        if (norm.includes('invoice')) return <DocumentTypeBadge value="invoice" />
        if (norm.includes('order') || norm.includes('confirmation') || norm.includes('po')) return <DocumentTypeBadge value="order_confirmation" />
        if (rawType) return <span className="text-[var(--text-200)]">{rawType}</span>
        return <DocumentTypeBadge value={undefined} />
      }
      case 'invoiceNumber': {
        const invNum = extractJsonField(json, 'invoice_number', 'invoice_no', 'invoice_num', 'inv_number', 'inv_no', 'invoice#', 'invoice')
        if (!invNum) return <span className="text-[var(--text-200)]">—</span>
        if (job.driveFileId) {
          return (
            <a
              href={`https://drive.google.com/file/d/${job.driveFileId}/view`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[var(--accent-200)] hover:underline"
            >
              <svg className="h-3 w-3 shrink-0 text-rose-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M7 3a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5H7zm5 1.5L17.5 10H12V4.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16z"/>
              </svg>
              {invNum}
            </a>
          )
        }
        return cell(invNum)
      }
      case 'poNumber':        return cell(extractJsonField(json, 'po_number', 'purchase_order_number', 'po_no', 'po', 'purchase_order', 'order_number', 'order_no'))
      case 'orderDate':       return cell(extractJsonField(json, 'order_date', 'date_of_order', 'order date'))
      case 'invoiceDate':     return cell(extractJsonField(json, 'invoice_date', 'date', 'billing_date', 'bill_date', 'invoice date'))
      case 'terms':           return cell(extractJsonField(json, 'payment_terms', 'terms', 'net_terms', 'payment terms'))
      case 'trackingNumber':  return cell(extractJsonField(json, 'tracking_number', 'tracking', 'tracking_no', 'shipment_tracking', 'tracking number'))
      case 'totalValue':
        return (
          <span className="font-semibold tabular-nums text-[var(--text-100)]">
            {formatTotal(extractJsonField(json, 'total', 'grand_total', 'total_amount', 'total_cost', 'total_value', 'invoice_total', 'amount_due', 'balance_due')) ||
              <span className="font-normal text-[var(--text-200)]">—</span>}
          </span>
        )
      case 'filename':
        return (
          <span className="font-mono text-[var(--text-200)] truncate max-w-[160px] block" title={job.filename}>
            {job.filename}
          </span>
        )
      case 'parsedAt':
        return (
          <span className="text-[var(--text-200)]" title={job.completedAt ? formatDateTime(job.completedAt) : ''}>
            {job.completedAt ? formatDate(job.completedAt) : '—'}
          </span>
        )
      case 'requestedBy':
        return <span className="text-[var(--text-200)]">{job.requestedByName || '—'}</span>
      default:
        return null
    }
  }

  /* ── Render ── */
  return (
    <div className="space-y-4">
      {/* ── Global error banner ── */}
      {wsError && <Banner kind="error" onDismiss={() => setWsError(null)}>{wsError}</Banner>}

      {/* ══════════════════════════════ WORKSPACE LIST ══════════════════════════════ */}
      {view === 'workspaces' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-100)]">Invoice Workspaces</h2>
              <p className="mt-0.5 text-xs text-[var(--text-200)]">
                Create a workspace to scope your invoice audit to specific filter rules.
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
          ) : workspaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--bg-300)] bg-[var(--bg-100)] py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary-100)] text-[var(--accent-200)] mb-4">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-[var(--text-100)]">No workspaces yet</h3>
              <p className="mt-1.5 max-w-sm text-xs text-[var(--text-200)]">
                Workspaces let you scope the invoice audit to a named set of filter rules.
              </p>
              <button type="button" onClick={() => openEditor('new')}
                className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create your first workspace
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workspaces.map((ws) => (
                <WorkspaceCard
                  key={ws._id}
                  workspace={ws}
                  onOpen={() => enterWorkspace(ws)}
                  onEdit={() => openEditor(ws)}
                  onDelete={() => void handleDeleteWorkspace(ws)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════ AUDIT DETAIL ══════════════════════════════ */}
      {view === 'audit' && activeWorkspace && (
        <div className="space-y-4">

          {/* Breadcrumb */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button type="button" onClick={leaveWorkspace}
                className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-[var(--text-200)] hover:text-[var(--accent-200)] transition-colors">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Workspaces
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
              ['audit',   'Invoice Audit', 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'],
              ['emails',  'Emails',        'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'],
              ['rules',   'Rules',         'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z'],
              ['vendors', 'Vendors',       'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4'],
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
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
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
            <div className="space-y-2">
              {emailError && <Banner kind="error" onDismiss={() => setEmailError(null)}>{emailError}</Banner>}

              <div className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-md">
                {/* Filter bar */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/40">
                  {/* Search */}
                  <div className="relative min-w-[200px] flex-1 max-w-sm">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--text-200)]">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" />
                      </svg>
                    </span>
                    <input type="text" value={emailSearch} onChange={(e) => setEmailSearch(e.target.value)}
                      placeholder="Search subject, sender, attachment…"
                      className={`${inputClass} w-full pl-8 pr-8`} />
                    {emailSearch && (
                      <button onClick={() => setEmailSearch('')} aria-label="Clear search"
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-200)] hover:text-[var(--text-100)] cursor-pointer">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {/* Date range */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[var(--text-200)]">From</span>
                    <input type="date" value={emailDateFrom} onChange={(e) => setEmailDateFrom(e.target.value)} className={inputClass} />
                    <span className="text-[11px] text-[var(--text-200)]">to</span>
                    <input type="date" value={emailDateTo} onChange={(e) => setEmailDateTo(e.target.value)} className={inputClass} />
                  </div>
                  {(emailSearch || emailDateFrom || emailDateTo) && (
                    <button onClick={() => { setEmailSearch(''); setEmailDateFrom(''); setEmailDateTo('') }}
                      className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer whitespace-nowrap">
                      Clear filters
                    </button>
                  )}
                  <span className="ml-auto flex items-center gap-2 text-[11px] text-[var(--text-200)]">
                    {emailLoading && <Spinner className="h-3 w-3" />}
                    {emailPagination.total > 0 && (
                      <span>{emailPagination.total.toLocaleString()} message{emailPagination.total === 1 ? '' : 's'}</span>
                    )}
                  </span>
                </div>

                {/* Top pagination */}
                {!emailLoading && emailPagination.total > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-2 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/60">
                    <div className="flex items-center gap-2 text-[11px] text-[var(--text-200)]">
                      <span>Rows per page:</span>
                      <select value={emailPageSize} onChange={(e) => setEmailPageSize(Number(e.target.value))}
                        className="border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] cursor-pointer">
                        {PAGE_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <span>
                        {emailPagination.total === 0 ? 0 : (emailPage - 1) * emailPageSize + 1}–{Math.min(emailPage * emailPageSize, emailPagination.total)} of {emailPagination.total.toLocaleString()}
                      </span>
                      {selectedEmailIds.size > 0 && (
                        <span className="flex items-center gap-1.5">
                          <span className="rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[11px] text-[var(--accent-200)]">{selectedEmailIds.size} selected</span>
                          <button onClick={() => setSelectedEmailIds(new Set())} className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer">Clear</button>
                        </span>
                      )}
                    </div>
                    <PaginationArrows page={emailPage} pages={emailPagination.pages} onChange={setEmailPage} />
                  </div>
                )}

                {/* Table */}
                <div className="relative overflow-x-auto overflow-y-auto max-h-[calc(100vh-26rem)]">
                  <table className="w-full text-[11px] border-separate border-spacing-0">
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
                        {orderedEmailCols.map((col) => (
                          <DraggableTh
                            key={col.id}
                            label={col.label}
                            iconPath={col.iconPath}
                            isDragging={emailDragSrc === col.id}
                            isDragTarget={emailDragTarget === col.id}
                            onDragStart={() => setEmailDragSrc(col.id)}
                            onDragOver={() => setEmailDragTarget(col.id)}
                            onDrop={() => {
                              if (emailDragSrc && emailDragSrc !== col.id) {
                                const newOrder = reorderCols(emailColOrderRef.current, emailDragSrc, col.id)
                                setEmailColOrder(newOrder)
                                saveColOrdersRef.current(auditColOrderRef.current, newOrder)
                              }
                            }}
                            onDragEnd={() => { setEmailDragSrc(null); setEmailDragTarget(null) }}
                          />
                        ))}
                        <Th label="Actions" align="center" />
                      </tr>
                    </thead>
                    <tbody>
                      {emailLoading ? (
                        Array.from({ length: 8 }).map((_, i) => (
                          <tr key={i} className="border-b border-[var(--bg-300)]">
                            <td className="px-3 py-1"><div className="h-3.5 w-3.5 animate-pulse rounded bg-[var(--bg-300)]" /></td>
                            {orderedEmailCols.map((col) => (
                              <td key={col.id} className="px-3 py-1">
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
                            <td className="px-3 py-1"><div className="flex justify-center gap-1.5"><div className="h-7 w-7 animate-pulse rounded-md bg-[var(--bg-300)]" /></div></td>
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
                                <p className="text-[11px] font-medium text-[var(--text-100)]">
                                  {(emailSearch || emailDateFrom || emailDateTo) ? 'No messages match' : 'No emails in this workspace yet'}
                                </p>
                                <p className="mt-0.5 text-[11px] text-[var(--text-200)]">
                                  {(emailSearch || emailDateFrom || emailDateTo)
                                    ? 'Try adjusting or clearing the filters.'
                                    : 'Emails matching this workspace\'s rules will appear here. Add rules in the Rules tab.'}
                                </p>
                              </div>
                              {(emailSearch || emailDateFrom || emailDateTo) && (
                                <button onClick={() => { setEmailSearch(''); setEmailDateFrom(''); setEmailDateTo('') }}
                                  className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer">
                                  Clear filters
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        emailMessages.map((msg) => {
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
                              {/* Checkbox — always first, not draggable */}
                              <td className="px-3 py-1" onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" checked={isSelected} onChange={() => toggleEmailRow(msg._id)}
                                  aria-label={`Select ${msg.subject || 'message'}`}
                                  className={emailCheckboxClass} />
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
                                      <td key="received" className={`px-3 py-1 whitespace-nowrap text-[var(--text-200)] ${emailColDragCls}`} title={formatDateTime(msg.sentAt)}>
                                        {formatDate(msg.sentAt)}
                                      </td>
                                    )
                                  case 'from':
                                    return (
                                      <td key="from" className={`px-3 py-1 min-w-0 ${emailColDragCls}`}>
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${avatarColour(senderSeed)}`}>
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
                                      <td key="to" className={`px-3 py-1 min-w-0 max-w-[180px] ${emailColDragCls}`}>
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
                                      <td key="subject" className={`px-3 py-1 min-w-0 ${emailColDragCls}`}>
                                        <div className="truncate text-[var(--text-100)]" title={msg.subject}>
                                          {msg.subject || <span className="italic text-[var(--text-200)]">(no subject)</span>}
                                        </div>
                                      </td>
                                    )
                                  case 'documentType':
                                    return (
                                      <td key="documentType" className={`px-3 py-1 whitespace-nowrap ${emailColDragCls}`}>
                                        <DocumentTypeBadge value={msg.documentType} />
                                      </td>
                                    )
                                  case 'rule':
                                    return (
                                      <td key="rule" className={`px-3 py-1 ${emailColDragCls}`}>
                                        {msg.ruleName ? (
                                          <span title={msg.ruleName}
                                            className="inline-flex max-w-[160px] items-center gap-1 rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[11px] text-[var(--accent-200)]">
                                            <svg className="h-2.5 w-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
                                            </svg>
                                            <span className="truncate">{msg.ruleName}</span>
                                          </span>
                                        ) : (
                                          <span className="text-[11px] italic text-[var(--text-200)]">—</span>
                                        )}
                                      </td>
                                    )
                                  case 'attachments':
                                    return (
                                      <td key="attachments" className={`px-3 py-1 ${emailColDragCls}`} onClick={(e) => e.stopPropagation()}>
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

                              {/* Actions — always last, not draggable */}
                              <td className="px-3 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                                <AttachmentIcons
                                  message={msg}
                                  onOpenJob={setOpenJobId}
                                  onChanged={() => void fetchEmails(true)}
                                />
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Bottom pagination */}
                {!emailLoading && emailPagination.total > 0 && (
                  <div className="flex items-center justify-end px-4 py-2.5 border-t border-[var(--bg-300)] bg-[var(--bg-200)]/60">
                    <PaginationArrows page={emailPage} pages={emailPagination.pages} onChange={setEmailPage} />
                  </div>
                )}
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

          {/* ══════════════ AUDIT RESULTS TAB ══════════════ */}
          {workspaceTab === 'audit' && (
            <div className="space-y-4">
          {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}

          {/* Table card */}
          <div className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-md">

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/40 px-4 py-2.5">
              {/* Vendor search */}
              <div className="relative min-w-[180px] flex-1 max-w-xs">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--text-200)]">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" />
                  </svg>
                </span>
                <input type="text" value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search anything — vendor, SKU, invoice #, description…" className={`${inputClass} w-full pl-8 pr-8`} />
                {auditSearch && (
                  <button onClick={() => setAuditSearch('')} aria-label="Clear search"
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-200)] hover:text-[var(--text-100)] cursor-pointer">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Column settings + Export (grouped on the right) */}
              <button type="button" onClick={() => setShowColSettings(true)} title="Configure visible columns"
                className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--bg-300)] px-2.5 py-1.5 text-[11px] text-[var(--text-200)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Columns
                <span className="rounded-full bg-[var(--bg-300)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-200)]">
                  {visibleCols.length}
                </span>
              </button>

              {/* Export button */}
              {selectedJobIds.size > 0 ? (
                <button type="button" onClick={() => void exportToExcel('selection')} disabled={exporting}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60">
                  {exporting
                    ? <Spinner className="h-3.5 w-3.5" />
                    : <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  }
                  Export {selectedJobIds.size} selected
                </button>
              ) : (
                <button type="button" onClick={() => void exportToExcel('all')} disabled={exporting}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60">
                  {exporting
                    ? <Spinner className="h-3.5 w-3.5" />
                    : <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  }
                  Export all
                </button>
              )}
            </div>

            {/* Top pagination — rows-per-page + count + arrows (mirrors the Emails tab) */}
            {!loading && pagination.total > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-2 border-b border-[var(--bg-300)] bg-[var(--bg-200)]/60">
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-200)]">
                  <span>Rows per page:</span>
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
                    className="border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] cursor-pointer">
                    {AUDIT_PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {pagination.total > 0 && (
                    <span>{startItem}–{endItem} of {pagination.total.toLocaleString()}</span>
                  )}
                  {selectedJobIds.size > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[11px] text-[var(--accent-200)]">
                        {selectedJobIds.size} selected
                      </span>
                      <button onClick={() => setSelectedJobIds(new Set())}
                        className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer">
                        Clear
                      </button>
                    </span>
                  )}
                </div>
                {pagination.pages > 1 && (
                  <PaginationArrows page={page} pages={pagination.pages} onChange={setPage} />
                )}
              </div>
            )}

            {/* Table — horizontally scrollable, vertically unbounded */}
            <div className="overflow-x-auto">
              {error ? (
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-900/20">
                    <svg className="h-5 w-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-[var(--text-100)]">Failed to load data</p>
                  <button onClick={() => void fetchJobs()} className="text-sm text-[var(--accent-200)] hover:underline cursor-pointer">Try again</button>
                </div>
              ) : (
                <table className="w-full text-[11px] border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <Th className="w-8">
                        <input
                          ref={auditSelectAllRef}
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={toggleAllAuditPage}
                          disabled={jobs.length === 0}
                          aria-label={allPageSelected ? 'Deselect all on page' : 'Select all on page'}
                          className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-200)] disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </Th>
                      {visibleCols.map((col) => (
                        <DraggableTh
                          key={col.id}
                          label={col.label}
                          align={col.numeric ? 'right' : 'left'}
                          isDragging={auditDragSrc === col.id}
                          isDragTarget={auditDragTarget === col.id}
                          onDragStart={() => setAuditDragSrc(col.id)}
                          onDragOver={() => setAuditDragTarget(col.id)}
                          onDrop={() => {
                            if (auditDragSrc && auditDragSrc !== col.id) {
                              const newOrder = reorderCols(auditColOrderRef.current, auditDragSrc, col.id)
                              setAuditColOrder(newOrder)
                              saveColOrdersRef.current(newOrder, emailColOrderRef.current)
                            }
                          }}
                          onDragEnd={() => { setAuditDragSrc(null); setAuditDragTarget(null) }}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 12 }).map((_, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-[var(--bg-100)]' : 'bg-[var(--bg-200)]'}>
                          <td className="px-2.5 py-1"><div className="h-3.5 w-3.5 animate-pulse rounded bg-[var(--bg-300)]" /></td>
                          {visibleCols.map((col) => (
                            <td key={col.id} className="px-2.5 py-1">
                              <div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-300)]" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : jobs.length === 0 ? (
                      <tr>
                        <td colSpan={visibleCols.length + 1} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-200)]">
                              <svg className="h-6 w-6 text-[var(--text-200)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium text-[var(--text-100)]">
                                {debouncedAuditSearch ? 'No documents match this search' : 'No parsed documents in this workspace'}
                              </p>
                              <p className="mt-0.5 text-[11px] text-[var(--text-200)]">
                                {debouncedAuditSearch
                                  ? 'Try clearing the filter above.'
                                    : 'Open the Emails tab to parse documents, then results appear here.'}
                              </p>
                            </div>
                            {debouncedAuditSearch && (
                              <button onClick={() => setAuditSearch('')} className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer">
                                Clear filter
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      /* ── Flattened rows: one row per line item, alternating per row ── */
                      (() => {
                        let rowIdx = 0
                        return jobs.flatMap((job) => {
                          const json = job.jsonOutput ?? null
                          const lineItems = extractJsonArray(
                            json, 'line_items', 'items', 'products', 'line items', 'lineItems', 'order_items', 'orderItems'
                          )
                          const rowItems: (Record<string, unknown> | null)[] =
                            lineItems.length > 0 ? lineItems : [null]

                          return rowItems.map((item, itemIdx) => {
                            const isEven = rowIdx % 2 === 0
                            const isSelected = selectedJobIds.has(job._id)
                            rowIdx++
                            return (
                              <tr
                                key={`${job._id}-${itemIdx}`}
                                className={`transition-colors align-middle ${
                                  isSelected
                                    ? 'bg-[var(--primary-100)]/70 hover:bg-[var(--primary-100)]'
                                    : isEven ? 'bg-[var(--bg-100)] hover:bg-[var(--primary-100)]/50' : 'bg-[var(--bg-200)] hover:bg-[var(--primary-100)]/50'
                                }`}
                              >
                                {/* Checkbox — only shown on first line-item row of each job */}
                                <td className="px-2.5 py-1" onClick={(e) => e.stopPropagation()}>
                                  {itemIdx === 0 ? (
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleAuditJob(job._id)}
                                      aria-label={`Select ${job.filename}`}
                                      className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-200)]"
                                    />
                                  ) : null}
                                </td>
                                {visibleCols.map((col) => (
                                  <td
                                    key={col.id}
                                    className={[
                                      'px-2.5 py-1 text-[11px] whitespace-nowrap',
                                      col.numeric ? 'text-right tabular-nums' : '',
                                      col.mono ? 'font-mono' : '',
                                      // Column-level drag highlight
                                      auditDragSrc === col.id
                                        ? 'bg-sky-100/70 dark:bg-sky-500/15'
                                        : auditDragTarget === col.id
                                          ? 'bg-sky-50 dark:bg-sky-500/10 border-l-[3px] border-l-sky-400'
                                          : '',
                                    ].join(' ')}
                                  >
                                    {isLineItemCol(col.id)
                                      ? liCellFor(col.id, item)
                                      : docCellFor(col.id, job)}
                                  </td>
                                ))}
                              </tr>
                            )
                          })
                        })
                      })()
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* Bottom pagination — arrows only (rows-per-page moved to top bar) */}
            {pagination.pages > 1 && (
              <div className="flex items-center justify-end border-t border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-4 py-2.5">
                <PaginationArrows page={page} pages={pagination.pages} onChange={setPage} />
              </div>
            )}
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

      {/* ── Workspace editor ── */}
      {editTarget !== null && (
        <WorkspaceEditorDialog
          initial={editTarget === 'new' ? null : editTarget}
          onSave={handleWorkspaceSaved}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* ── Parse job reasoning panel (workspace emails tab) ── */}
      {openJobId && (
        <ParseJobPanel
          jobId={openJobId}
          workspaceId={activeWorkspace?._id}
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
    </div>
  )
}

/** Render a plain scalar doc-level cell, or a dash if empty. */
function cell(value: string): React.ReactNode {
  return value
    ? <span className="text-[var(--text-100)]">{value}</span>
    : <span className="text-[var(--text-200)]">—</span>
}

/**
 * Returns true when any value in the parse job matches the search term.
 * Checks top-level fields AND the full jsonOutput JSON string so that SKUs,
 * descriptions, amounts — anything rendered in the table — are searchable.
 * `term` must already be lower-cased by the caller.
 */
function jobMatchesSearch(job: ParseJobListItem, term: string): boolean {
  if (!term) return true
  if (job.vendorName?.toLowerCase().includes(term)) return true
  if (job.filename?.toLowerCase().includes(term)) return true
  if (job.requestedByName?.toLowerCase().includes(term)) return true
  if (job.jsonOutput) {
    try {
      if (JSON.stringify(job.jsonOutput).toLowerCase().includes(term)) return true
    } catch { /* ignore malformed output */ }
  }
  return false
}

/** Plain-string value for a document-level column (used by Excel export). */
function docFieldStr(colId: InvoiceAuditColumnId, job: ParseJobListItem): string {
  const json = job.jsonOutput ?? null
  switch (colId) {
    case 'vendorName':      return job.vendorName || extractJsonField(json, 'vendor_name', 'vendor', 'supplier', 'company', 'from')
    case 'documentType':    return extractJsonField(json, 'document_type', 'type', 'doc_type')
    case 'invoiceNumber':   return extractJsonField(json, 'invoice_number', 'invoice_no', 'invoice_num', 'inv_number', 'inv_no', 'invoice#', 'invoice')
    case 'poNumber':        return extractJsonField(json, 'po_number', 'purchase_order_number', 'po_no', 'po', 'purchase_order', 'order_number', 'order_no')
    case 'orderDate':       return extractJsonField(json, 'order_date', 'date_of_order', 'order date')
    case 'invoiceDate':     return extractJsonField(json, 'invoice_date', 'date', 'billing_date', 'bill_date', 'invoice date')
    case 'terms':           return extractJsonField(json, 'payment_terms', 'terms', 'net_terms', 'payment terms')
    case 'trackingNumber':  return extractJsonField(json, 'tracking_number', 'tracking', 'tracking_no', 'shipment_tracking', 'tracking number')
    case 'totalValue':      return formatTotal(extractJsonField(json, 'total', 'grand_total', 'total_amount', 'total_cost', 'total_value', 'invoice_total', 'amount_due', 'balance_due'))
    case 'filename':        return job.filename
    case 'parsedAt':        return job.completedAt ? new Date(job.completedAt).toLocaleString() : ''
    case 'requestedBy':     return job.requestedByName || ''
    default:                return ''
  }
}

/** Keys to try for a given line-item column id (for export). */
function liFieldKeys(colId: InvoiceAuditColumnId): string[] {
  switch (colId) {
    case 'liSku':             return ['sku', 'part_number', 'part_no', 'item_code', 'product_code', 'sku_number']
    case 'liModel':           return ['model', 'model_number', 'model_no', 'style', 'style_number', 'style_no']
    case 'liDescription':     return ['description', 'name', 'product', 'item', 'item_description', 'desc', 'product_name']
    case 'liQuantity':        return ['quantity', 'qty', 'units', 'ordered_quantity', 'order_qty', 'amount']
    case 'liUnitPrice':       return ['unit_price', 'price', 'rate', 'cost', 'unit_cost', 'item_cost', 'list_price']
    case 'liDiscountedPrice': return ['discounted_price', 'sale_price', 'net_price', 'after_discount', 'final_price', 'net_unit_price', 'your_price']
    case 'liDiscountPercent': return ['discount_percent', 'discount_pct', 'discount_rate', 'discount', 'disc_pct', 'disc']
    case 'liLineTotal':       return ['total', 'line_total', 'subtotal', 'extended_price', 'total_cost', 'extended_amount', 'ext_price', 'amount']
    case 'liUom':             return ['uom', 'unit', 'unit_of_measure', 'unit_measure']
    case 'liTaxAmount':       return ['tax', 'tax_amount', 'tax_value', 'vat', 'gst', 'hst']
    case 'liNotes':           return ['notes', 'note', 'remarks', 'comments', 'comment']
    default:                  return []
  }
}
