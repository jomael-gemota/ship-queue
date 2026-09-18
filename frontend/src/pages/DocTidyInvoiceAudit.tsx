import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authApi } from '../lib/api'
import {
  Banner,
  DocTidyTabs,
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
import { formatDate, formatDateTime } from '../lib/format'
import {
  INVOICE_AUDIT_COLUMNS,
  PAGE_SIZE_OPTIONS,
  loadAuditColumnVisibility,
  saveAuditColumnVisibility,
  extractJsonField,
  extractJsonArray,
  type DocTidyEvent,
  type DocTidyMessage,
  type DocTidyMessagesResponse,
  type DocTidyWorkspace,
  type InvoiceAuditColumnId,
  type ParseJobListItem,
  type ParseJobsResponse,
} from '../types/docTidy'

/** Strip common currency prefixes/symbols for cleaner display. */
function formatTotal(raw: string): string {
  return raw.trim()
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
      className="group flex flex-col rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] cursor-pointer transition-all hover:border-[var(--accent-200)] hover:shadow-md">
      {/* Body */}
      <div className="flex-1 px-5 pt-5 pb-4">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-100)] text-[var(--accent-200)]">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-[var(--text-100)] group-hover:text-[var(--accent-200)] transition-colors line-clamp-2">
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
              <button onClick={() => setConfirmDelete(false)} className="cursor-pointer rounded px-2 py-1 text-[11px] text-[var(--text-200)] hover:bg-[var(--bg-200)]">No</button>
            </div>
          ) : (
            <>
              <button onClick={onEdit} className="cursor-pointer rounded px-2 py-1 text-[11px] text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)]">Edit</button>
              <button onClick={() => setConfirmDelete(true)} className="cursor-pointer rounded px-2 py-1 text-[11px] text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-rose-500">Delete</button>
              <button onClick={onOpen} className="cursor-pointer rounded-lg bg-[var(--primary-100)] px-3 py-1 text-[11px] font-medium text-[var(--accent-200)] hover:opacity-80 transition-opacity">Open →</button>
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
const AUDIT_PAGE_SIZES = [50, 100, 200, 500]

export default function DocTidyInvoiceAudit() {
  /* ── View state ── */
  type View = 'workspaces' | 'audit'
  const [view, setView] = useState<View>('workspaces')
  const [activeWorkspace, setActiveWorkspace] = useState<DocTidyWorkspace | null>(null)
  /** Which sub-tab is active inside a workspace detail page. */
  type WorkspaceTab = 'emails' | 'rules' | 'audit'
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('emails')

  /* ── Workspaces ── */
  const [workspaces, setWorkspaces] = useState<DocTidyWorkspace[]>([])
  const [wsLoading, setWsLoading] = useState(true)
  const [wsError, setWsError] = useState<string | null>(null)

  /* ── Workspace editor ── */
  const [editTarget, setEditTarget] = useState<DocTidyWorkspace | 'new' | null>(null)

  /* ── Audit table ── */
  const [jobs, setJobs] = useState<ParseJobListItem[]>([])
  const [pagination, setPagination] = useState({ total: 0, pages: 1 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [vendorSearch, setVendorSearch] = useState('')
  const [debouncedVendor, setDebouncedVendor] = useState('')
  const [colVisibility, setColVisibility] = useState<Record<InvoiceAuditColumnId, boolean>>(loadAuditColumnVisibility)
  const [showColSettings, setShowColSettings] = useState(false)

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


  /* ── Email search debounce ── */
  useEffect(() => {
    const t = setTimeout(() => setEmailDebouncedSearch(emailSearch.trim()), 350)
    return () => clearTimeout(t)
  }, [emailSearch])

  /* Reset email page when filters change */
  useEffect(() => { setEmailPage(1); setSelectedEmailIds(new Set()) }, [emailDebouncedSearch, emailDateFrom, emailDateTo, emailPageSize])

  /* ── Fetch workspace emails (with parse jobs) ── */
  const fetchEmails = useCallback(async () => {
    if (!activeWorkspace) return
    setEmailLoading(true)
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
      setEmailLoading(false)
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
        if (event.type === 'parse_status' || event.type === 'imported') {
          void fetchEmailsRef.current()
        }
      },
      () => {} // silent disconnect — no live badge needed here
    )
  }, [workspaceTab, activeWorkspace])

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

  /* ── Vendor search debounce ── */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedVendor(vendorSearch.trim()), 350)
    return () => clearTimeout(t)
  }, [vendorSearch])

  useEffect(() => { setPage(1) }, [debouncedVendor, pageSize])

  /* ── Fetch parse jobs ── */
  const fetchJobs = useCallback(async () => {
    if (!activeWorkspace) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        status: 'completed',
        page: String(page),
        pageSize: String(pageSize),
        workspaceId: activeWorkspace._id,
      })
      if (debouncedVendor) params.set('vendorName', debouncedVendor)
      const res = await authApi.get<ParseJobsResponse>(`/doc-tidy/parse-jobs?${params.toString()}`)
      setJobs(res.data)
      setPagination({ total: res.pagination.total, pages: Math.max(1, res.pagination.pages) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoice data')
    } finally {
      setLoading(false)
    }
  }, [activeWorkspace, page, pageSize, debouncedVendor])

  useEffect(() => { void fetchJobs() }, [fetchJobs])

  /* ── Workspace navigation ── */
  const enterWorkspace = (ws: DocTidyWorkspace) => {
    setActiveWorkspace(ws)
    setView('audit')
    setWorkspaceTab('emails')
    setPage(1)
    setVendorSearch('')
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
    setWorkspaceTab('emails')
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
    () => INVOICE_AUDIT_COLUMNS.filter((c) => colVisibility[c.id]),
    [colVisibility]
  )

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
      case 'invoiceNumber':   return cell(extractJsonField(json, 'invoice_number', 'invoice_no', 'invoice_num', 'inv_number', 'inv_no', 'invoice#', 'invoice'))
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
      {/* ── Tab bar ── */}
      <div className="flex items-end justify-between border-b border-[var(--bg-300)]">
        <DocTidyTabs />
      </div>

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
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
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
                className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90">
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
              ['emails',  'Emails',        'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'],
              ['rules',   'Rules',         'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z'],
              ['audit',   'Audit Results', 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'],
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
                        <Th label="Received" iconPath="M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z" />
                        <Th label="From" iconPath="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                        <Th label="Subject" iconPath="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        <Th label="Document type" iconPath="M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        <Th label="Rule" iconPath="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
                        <Th label="Actions" align="center" />
                      </tr>
                    </thead>
                    <tbody>
                      {emailLoading ? (
                        Array.from({ length: 8 }).map((_, i) => (
                          <tr key={i} className="border-b border-[var(--bg-300)]">
                            <td className="px-3 py-1"><div className="h-3.5 w-3.5 animate-pulse rounded bg-[var(--bg-300)]" /></td>
                            <td className="px-3 py-1"><div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-300)]" /></td>
                            <td className="px-3 py-1">
                              <div className="flex items-center gap-2">
                                <div className="h-6 w-6 animate-pulse rounded-full bg-[var(--bg-300)]" />
                                <div className="space-y-1.5">
                                  <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-300)]" />
                                  <div className="h-2.5 w-32 animate-pulse rounded bg-[var(--bg-300)]" />
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-1"><div className="h-3 w-48 animate-pulse rounded bg-[var(--bg-300)]" /></td>
                            <td className="px-3 py-1"><div className="h-5 w-28 animate-pulse rounded-full bg-[var(--bg-300)]" /></td>
                            <td className="px-3 py-1"><div className="h-5 w-20 animate-pulse rounded-full bg-[var(--bg-300)]" /></td>
                            <td className="px-3 py-1"><div className="flex justify-center gap-1.5"><div className="h-7 w-7 animate-pulse rounded-md bg-[var(--bg-300)]" /></div></td>
                          </tr>
                        ))
                      ) : emailMessages.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-16 text-center">
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
                              {/* Checkbox */}
                              <td className="px-3 py-1" onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" checked={isSelected} onChange={() => toggleEmailRow(msg._id)}
                                  aria-label={`Select ${msg.subject || 'message'}`}
                                  className={emailCheckboxClass} />
                              </td>
                              {/* Date */}
                              <td className="px-3 py-1 whitespace-nowrap text-[var(--text-200)]" title={formatDateTime(msg.sentAt)}>
                                {formatDate(msg.sentAt)}
                              </td>
                              {/* From */}
                              <td className="px-3 py-1 min-w-0">
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
                              {/* Subject */}
                              <td className="px-3 py-1 min-w-0">
                                <div className="truncate text-[var(--text-100)]" title={msg.subject}>
                                  {msg.subject || <span className="italic text-[var(--text-200)]">(no subject)</span>}
                                </div>
                              </td>
                              {/* Document type */}
                              <td className="px-3 py-1 whitespace-nowrap">
                                <DocumentTypeBadge value={msg.documentType} />
                              </td>
                              {/* Rule chip */}
                              <td className="px-3 py-1">
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
                              {/* Actions — parse icons; stop propagation so they don't open the drawer */}
                              <td className="px-3 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                                <AttachmentIcons
                                  message={msg}
                                  onOpenJob={setOpenJobId}
                                  onChanged={() => void fetchEmails()}
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
                <input type="text" value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)}
                  placeholder="Filter by vendor…" className={`${inputClass} w-full pl-8 pr-8`} />
                {vendorSearch && (
                  <button onClick={() => setVendorSearch('')} aria-label="Clear search"
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-200)] hover:text-[var(--text-100)] cursor-pointer">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Column settings */}
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
            </div>

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
                      {visibleCols.map((col) => (
                        <Th
                          key={col.id}
                          label={col.label}
                          align={col.numeric ? 'right' : 'left'}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 12 }).map((_, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-[var(--bg-100)]' : 'bg-[var(--bg-200)]'}>
                          {visibleCols.map((col) => (
                            <td key={col.id} className="px-2.5 py-1">
                              <div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-300)]" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : jobs.length === 0 ? (
                      <tr>
                        <td colSpan={visibleCols.length} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-200)]">
                              <svg className="h-6 w-6 text-[var(--text-200)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium text-[var(--text-100)]">
                                {debouncedVendor ? 'No documents match this vendor filter' : 'No parsed documents in this workspace'}
                              </p>
                              <p className="mt-0.5 text-[11px] text-[var(--text-200)]">
                                {debouncedVendor
                                  ? 'Try clearing the filter above.'
                                  : 'Open the Emails tab above to parse documents in this workspace.'}
                              </p>
                            </div>
                            {debouncedVendor && (
                              <button onClick={() => setVendorSearch('')} className="text-[11px] text-[var(--accent-200)] hover:underline cursor-pointer">
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
                            rowIdx++
                            return (
                              <tr
                                key={`${job._id}-${itemIdx}`}
                                className={`${isEven ? 'bg-[var(--bg-100)]' : 'bg-[var(--bg-200)]'} hover:bg-[var(--primary-100)]/50 transition-colors align-middle`}
                              >
                                {visibleCols.map((col) => (
                                  <td
                                    key={col.id}
                                    className={`px-2.5 py-1 text-[11px] whitespace-nowrap ${col.numeric ? 'text-right tabular-nums' : ''} ${col.mono ? 'font-mono' : ''}`}
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

            {/* Bottom pagination — rows-per-page + count + arrows */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--bg-300)] bg-[var(--bg-200)]/60 px-4 py-2.5">
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-200)]">
                <span>Rows per page:</span>
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
                  className="border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] cursor-pointer">
                  {AUDIT_PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {pagination.total > 0 && (
                  <span>{startItem}–{endItem} of {pagination.total.toLocaleString()}</span>
                )}
              </div>
              {pagination.pages > 1 && (
                <PaginationArrows page={page} pages={pagination.pages} onChange={setPage} />
              )}
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
          onClose={() => setOpenJobId(null)}
          onChanged={() => void fetchEmails()}
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
