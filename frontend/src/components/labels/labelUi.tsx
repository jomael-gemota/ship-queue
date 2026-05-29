import { useState } from 'react'
import type { LabelRecord, LabelAddress, LabelBatchStatus } from '../../types/label'

const TOKEN_KEY = 'sq_token'

export function formatCurrency(amount?: number | null): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatWeight(w?: { value?: number; units?: string }): string {
  if (!w?.value) return '—'
  return `${w.value} ${w.units || ''}`.trim()
}

/** Short, human-friendly identifier derived from the batch's ObjectId. */
export function shortBatchId(id: string): string {
  return `B-${id.slice(-6).toUpperCase()}`
}

/** Flattens an address into a single-line, human-readable string for CSV. */
function addressToLine(addr?: LabelAddress): string {
  if (!addr) return ''
  return [
    addr.name,
    addr.company,
    addr.street1,
    addr.street2,
    addr.street3,
    [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', '),
    addr.country,
    addr.phone,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Escapes a value for inclusion in a CSV cell. */
function csvCell(value: unknown): string {
  if (value == null) return ''
  const str = String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// All columns from both the Shipping Details and Tracking & Labels sections,
// flattened into a single row per order (no per-section grouping).
const CSV_COLUMNS: { header: string; value: (l: LabelRecord) => unknown }[] = [
  { header: 'PO #', value: (l) => l.poNumber },
  { header: 'Order #', value: (l) => l.orderNumber },
  { header: 'Customer', value: (l) => l.customerName },
  { header: 'Ship From', value: (l) => addressToLine(l.shipFrom) },
  { header: 'Ship To', value: (l) => addressToLine(l.shipTo) },
  { header: 'Property', value: (l) => l.propertyType },
  { header: 'Package', value: (l) => l.packageCode },
  { header: 'Service', value: (l) => l.serviceCode },
  { header: 'Ship Date', value: (l) => l.shipDate },
  { header: 'Qty', value: (l) => l.qty },
  {
    header: 'Weight',
    value: (l) => (l.weight?.value ? `${l.weight.value} ${l.weight.units || ''}`.trim() : ''),
  },
  {
    header: 'Dimensions',
    value: (l) =>
      l.dimensions
        ? `${l.dimensions.length}x${l.dimensions.width}x${l.dimensions.height} ${l.dimensions.units || ''}`.trim()
        : '',
  },
  { header: 'Insurance', value: (l) => l.insuranceProvider },
  { header: 'Status', value: (l) => l.status },
  { header: 'Tracking', value: (l) => l.trackingNumber },
  { header: 'Shipment ID', value: (l) => l.shipmentId },
  { header: 'Cost', value: (l) => (l.shipmentCost != null ? l.shipmentCost : '') },
  { header: 'Insurance Cost', value: (l) => (l.insuranceCost != null ? l.insuranceCost : '') },
  { header: 'PDF Link', value: (l) => l.driveFileLink },
]

/** Builds a CSV string for the given batch items (all columns, one row per order). */
export function buildBatchItemsCsv(items: LabelRecord[]): string {
  const headerLine = CSV_COLUMNS.map((c) => csvCell(c.header)).join(',')
  const rows = items.map((l) => CSV_COLUMNS.map((c) => csvCell(c.value(l))).join(','))
  return [headerLine, ...rows].join('\r\n')
}

/** Generates and downloads a CSV file of the batch items. */
export function exportBatchItemsCsv(items: LabelRecord[], fileName: string): void {
  const csv = buildBatchItemsCsv(items)
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/** Loads a label PDF and sends it to the printer via a hidden iframe. */
export async function printLabelPdf(labelId: string): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`/api/labels/${labelId}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) return
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.src = url
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch {
      /* ignore — popup/print blocked */
    }
  }
  document.body.appendChild(iframe)
}

interface BatchItemsTableProps {
  items: LabelRecord[]
  loading: boolean
  downloadingId: string | null
  onDownloadPdf: (label: LabelRecord) => void
}

type ItemsTab = 'shipping' | 'tracking'

// Fixed (frozen) leftmost columns. Both share the same 150px width so the
// second column's sticky left offset lines up exactly with the first column's
// edge. Class strings are written literally so Tailwind's JIT picks them up.
const PO_STICKY = 'sticky left-0 w-[150px] min-w-[150px] max-w-[150px]'
const ORDER_STICKY = 'sticky left-[150px] w-[200px] min-w-[150px] max-w-[200px] border-r border-[var(--bg-300)] dark:border-[var(--bg-300)]'

/**
 * Item table for a batch. PO#/Order# lead each row while the rest of the fields
 * are split across two tabs (Shipping Details / Tracking & Labels).
 *
 * - Shipping Details uses a fixed, width-filling layout (`table-fixed`) so all
 *   columns fit on screen at once and cell contents wrap instead of forcing a
 *   horizontal scroll.
 * - Tracking & Labels keeps PO#/Order# frozen on the left and scrolls
 *   horizontally if needed.
 */
/** Returns a flat lowercase string of all searchable fields for an item. */
function itemSearchText(l: LabelRecord): string {
  const addrText = (a?: LabelAddress) =>
    a ? [a.name, a.company, a.street1, a.street2, a.street3, a.city, a.state, a.postalCode, a.country, a.phone].filter(Boolean).join(' ') : ''
  return [
    l.poNumber,
    l.orderNumber,
    l.customerName,
    addrText(l.shipFrom),
    addrText(l.shipTo),
    l.propertyType,
    l.packageCode,
    l.serviceCode,
    l.shipDate,
    l.qty != null ? String(l.qty) : '',
    l.weight?.value != null ? `${l.weight.value} ${l.weight.units ?? ''}` : '',
    l.dimensions ? `${l.dimensions.length} ${l.dimensions.width} ${l.dimensions.height} ${l.dimensions.units ?? ''}` : '',
    l.insuranceProvider,
    l.status,
    l.trackingNumber,
    l.shipmentId,
    l.shipmentCost != null ? String(l.shipmentCost) : '',
    l.insuranceCost != null ? String(l.insuranceCost) : '',
    l.driveFileLink,
    l.error,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function BatchItemsTable({ items, loading, downloadingId, onDownloadPdf }: BatchItemsTableProps) {
  const [tab, setTab] = useState<ItemsTab>('shipping')
  const [search, setSearch] = useState('')
  const isShipping = tab === 'shipping'

  const query = search.trim().toLowerCase()
  const filteredItems = query ? items.filter((l) => itemSearchText(l).includes(query)) : items

  // 2 lead columns + the active tab's columns (12 shipping, 5 tracking).
  const colCount = 2 + (isShipping ? 12 : 5)

  // Items missing shipping details because their order wasn't found in the
  // (un-synced) orders table.
  const unsyncedCount = items.filter((l) => l.found === false).length

  return (
    <div>
      {/* Unsynced-orders warning — items with no shipping details. */}
      {!loading && unsyncedCount > 0 && (
        <div className="flex items-start gap-2 border-b border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-5 py-3 text-sm text-amber-800 dark:text-amber-300">
          <WarningIcon className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold">{unsyncedCount}</span> of {items.length} item
            {items.length === 1 ? '' : 's'} {unsyncedCount === 1 ? 'has' : 'have'} no shipping
            details because the order{unsyncedCount === 1 ? ' was' : 's were'} not found in the
            orders table. Sync the orders table to populate {unsyncedCount === 1 ? 'it' : 'them'}.
          </span>
        </div>
      )}

      {/* Toolbar: tab switcher + search bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--bg-300)] dark:border-[var(--bg-300)] px-5 py-3">
        <div className="inline-flex rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-200)] dark:bg-[var(--bg-200)] p-0.5">
          <TabButton active={isShipping} onClick={() => setTab('shipping')} icon={<BoxIcon className="h-3.5 w-3.5" />}>
            Shipping Details
          </TabButton>
          <TabButton active={!isShipping} onClick={() => setTab('tracking')} icon={<TrackingIcon className="h-3.5 w-3.5" />}>
            Tracking &amp; Labels
          </TabButton>
        </div>

        <div className="relative">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-[var(--text-200)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all fields…"
            className="h-8 w-100 rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] pl-8 pr-3 text-xs text-slate-700 dark:text-[var(--text-200)] placeholder-slate-400 dark:placeholder-[var(--primary-200)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] focus:border-[var(--accent-200)] transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-[var(--text-100)] cursor-pointer"
              aria-label="Clear search"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="overflow-auto max-h-[70vh]">
        <table className={`w-full ${isShipping ? 'table-fixed' : 'text-[13px]'}`}>
          {isShipping && (
            <colgroup>
              <col className="w-[7%]" />
              <col className="w-[13%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[11%]" />
              <col className="w-[9%]" />
              <col className="w-[7%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[4%]" />
              <col className="w-[6%]" />
              <col className="w-[7%]" />
              <col className="w-[6%]" />
              <col className="w-[7%]" />
            </colgroup>
          )}
          <thead className="sticky top-0 z-20 bg-[var(--bg-200)] dark:bg-[var(--bg-200)] text-slate-500 dark:text-[var(--text-200)]">
            <tr className="text-left border-b border-[var(--bg-300)] dark:border-[var(--bg-300)]">
              {isShipping ? (
                <>
                  <ThWrap><HeaderLabel icon={<BoxIcon className="h-3.5 w-3.5" />} text="PO #" /></ThWrap>
                  <ThWrap className="border-r border-[var(--bg-300)] dark:border-[var(--bg-300)]"><HeaderLabel icon={<ClipboardIcon className="h-3.5 w-3.5" />} text="Order #" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<UserIcon className="h-3.5 w-3.5" />} text="Customer" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<StoreIcon className="h-3.5 w-3.5" />} text="Ship From" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<PinIcon className="h-3.5 w-3.5" />} text="Ship To" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<HomeIcon className="h-3.5 w-3.5" />} text="Property" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<BoxIcon className="h-3.5 w-3.5" />} text="Package" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<TruckIcon className="h-3.5 w-3.5" />} text="Service" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<CalendarIcon className="h-3.5 w-3.5" />} text="Ship Date" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<QtyIcon className="h-3.5 w-3.5" />} text="Qty" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<ScaleIcon className="h-3.5 w-3.5" />} text="Weight" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<RulerIcon className="h-3.5 w-3.5" />} text="Dimensions" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<ShieldIcon className="h-3.5 w-3.5" />} text="Insurance" /></ThWrap>
                  <ThWrap><HeaderLabel icon={<StatusIcon className="h-3.5 w-3.5" />} text="Status" /></ThWrap>
                </>
              ) : (
                <>
                  <Th className={`${PO_STICKY} z-30 bg-[var(--bg-200)] dark:bg-[var(--bg-200)]`}>
                    <HeaderLabel icon={<BoxIcon className="h-3.5 w-5" />} text="PO #" />
                  </Th>
                  <Th className={`${ORDER_STICKY} z-30 bg-[var(--bg-200)] dark:bg-[var(--bg-200)]`}>
                    <HeaderLabel icon={<ClipboardIcon className="h-3.5 w-5" />} text="Order #" />
                  </Th>
                  <Th><HeaderLabel icon={<TrackingIcon className="h-3.5 w-3.5" />} text="Tracking" /></Th>
                  <Th><HeaderLabel icon={<IdIcon className="h-3.5 w-3.5" />} text="Shipment ID" /></Th>
                  <Th><HeaderLabel icon={<DollarIcon className="h-3.5 w-3.5" />} text="Cost" /></Th>
                  <Th><HeaderLabel icon={<ShieldIcon className="h-3.5 w-3.5" />} text="Insurance Cost" /></Th>
                  <Th><HeaderLabel icon={<DocumentIcon className="h-3.5 w-3.5" />} text="PDF" /></Th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--bg-300)] dark:divide-[var(--bg-300)]">
            {loading ? (
              <tr><Td className="text-slate-400" colSpan={colCount}>Loading…</Td></tr>
            ) : items.length === 0 ? (
              <tr><Td className="text-slate-400" colSpan={colCount}>No items in this batch.</Td></tr>
            ) : filteredItems.length === 0 ? (
              <tr>
                <Td className="text-slate-400" colSpan={colCount}>
                  No items match <span className="font-medium text-slate-600 dark:text-[var(--text-200)]">"{search}"</span>.
                </Td>
              </tr>
            ) : (
              filteredItems.map((l, idx) => {
                const failed = l.status === 'failed' || l.found === false
                const zebra = idx % 2 === 1
                // Alternating row colors with failed rows highlighted in red.
                const rowBg = failed
                  ? 'bg-red-50/70 dark:bg-red-900/10'
                  : zebra
                    ? 'bg-[var(--primary-100)] dark:bg-[var(--bg-200)]'
                    : 'bg-[var(--bg-100)] dark:bg-[var(--bg-100)]'
                // Sticky lead cells need an opaque background matching the row.
                const stickyBg = failed
                  ? 'bg-red-50 dark:bg-red-900/20'
                  : zebra
                    ? 'bg-[var(--primary-100)] dark:bg-[var(--bg-200)]'
                    : 'bg-[var(--bg-100)] dark:bg-[var(--bg-100)]'

                if (isShipping) {
                  return (
                    <tr key={l._id} className={`align-top ${rowBg}`}>
                      <TdWrap className="font-medium text-slate-800 dark:text-[var(--text-100)]">
                        <span className="inline-flex items-start gap-1.5">
                          <BoxIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-[var(--text-200)]" />
                          <span className="break-words">{l.poNumber}</span>
                        </span>
                      </TdWrap>
                      <TdWrap className="break-words border-r border-[var(--bg-300)] dark:border-[var(--bg-300)]">{l.orderNumber}</TdWrap>
                      <TdWrap className="break-words">{l.customerName || '—'}</TdWrap>
                      <TdWrap><AddressCell addr={l.shipFrom} /></TdWrap>
                      <TdWrap><AddressCell addr={l.shipTo} /></TdWrap>
                      <TdWrap>{l.propertyType ? <PropertyBadge type={l.propertyType} /> : '—'}</TdWrap>
                      <TdWrap className="font-mono break-words">{l.packageCode || '—'}</TdWrap>
                      <TdWrap className="font-mono break-words">{l.serviceCode || '—'}</TdWrap>
                      <TdWrap className="break-words">{l.shipDate || '—'}</TdWrap>
                      <TdWrap>{l.qty != null ? l.qty : '—'}</TdWrap>
                      <TdWrap className="break-words">{formatWeight(l.weight)}</TdWrap>
                      <TdWrap className="break-words">
                        {l.dimensions ? `${l.dimensions.length}×${l.dimensions.width}×${l.dimensions.height} ${l.dimensions.units}` : '—'}
                      </TdWrap>
                      <TdWrap className="capitalize break-words">{l.insuranceProvider || '—'}</TdWrap>
                      <TdWrap><ItemStatusBadge status={l.status} testLabel={l.testLabel} error={l.error} found={l.found} /></TdWrap>
                    </tr>
                  )
                }

                return (
                  <tr key={l._id} className={rowBg}>
                    {/* Frozen lead columns */}
                    <Td className={`${PO_STICKY} z-10 ${stickyBg} font-medium text-slate-800 dark:text-[var(--text-100)]`}>
                      <span className="inline-flex items-center gap-1.5">
                        <BoxIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-[var(--text-200)]" />
                        <span>{l.poNumber}</span>
                      </span>
                    </Td>
                    <Td className={`${ORDER_STICKY} z-10 ${stickyBg}`}>{l.orderNumber}</Td>
                    <Td className="font-mono text-[13px]">{l.trackingNumber || '—'}</Td>
                    <Td>{l.shipmentId ?? '—'}</Td>
                    <Td>{formatCurrency(l.shipmentCost)}</Td>
                    <Td>{formatCurrency(l.insuranceCost)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        {l.status === 'created' && (
                          <button
                            onClick={() => onDownloadPdf(l)}
                            disabled={downloadingId === l._id}
                            className="text-[var(--accent-100)] dark:text-[var(--accent-200)] hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            {downloadingId === l._id ? '…' : 'Download'}
                          </button>
                        )}
                        {l.driveFileLink && (
                          <a href={l.driveFileLink} target="_blank" rel="noreferrer" className="text-slate-500 dark:text-[var(--text-200)] hover:underline">Drive</a>
                        )}
                        {l.status !== 'created' && !l.driveFileLink && <span className="text-slate-400">—</span>}
                      </div>
                    </Td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Search result count hint */}
      {query && filteredItems.length > 0 && (
        <div className="border-t border-[var(--bg-300)] dark:border-[var(--bg-300)] px-5 py-2 text-xs text-slate-400 dark:text-[var(--text-200)] bg-[var(--bg-200)] dark:bg-transparent">
          {filteredItems.length} of {items.length} item{items.length === 1 ? '' : 's'} match
        </div>
      )}
    </div>
  )
}

/** Wrapping header cell used by the width-filling Shipping Details tab. */
function ThWrap({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 align-bottom text-left text-xs font-medium uppercase tracking-wide ${className}`}>{children}</th>
}

/** Wrapping body cell used by the width-filling Shipping Details tab. */
function TdWrap({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-top text-[13px] text-slate-700 dark:text-[var(--text-200)] ${className}`}>{children}</td>
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
        active
          ? 'bg-[var(--bg-100)] dark:bg-[var(--bg-100)] text-slate-900 dark:text-[var(--text-100)] shadow-sm'
          : 'text-slate-500 dark:text-[var(--text-200)] hover:text-slate-700 dark:hover:text-[var(--text-100)]'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

export function CreatePrintButton({ busy, done, onClick, size = 'md' }: { busy: boolean; done: boolean; onClick: () => void; size?: 'sm' | 'md' }) {
  const sizing = size === 'sm' ? 'gap-1.5 px-2.5 py-1.5 text-xs' : 'gap-2 px-3 py-2 text-sm'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center rounded-lg bg-emerald-600 font-medium text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap ${sizing}`}
    >
      {busy ? <Spinner className={iconSize} /> : <PrinterIcon className={iconSize} />}
      {busy ? 'Working…' : done ? 'Reprint Labels' : 'Create + Print Labels'}
    </button>
  )
}

export function ExportCsvButton({ busy, onClick, size = 'md' }: { busy?: boolean; onClick: () => void; size?: 'sm' | 'md' }) {
  const sizing = size === 'sm' ? 'p-1.5' : 'p-2'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Export as CSV"
      className={`inline-flex items-center justify-center rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-slate-700 dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer ${sizing}`}
    >
      {busy ? <Spinner className={iconSize} /> : <CsvIcon className={iconSize} />}
    </button>
  )
}

export function DeleteBatchButton({ busy, onClick, size = 'md' }: { busy?: boolean; onClick: () => void; size?: 'sm' | 'md' }) {
  const sizing = size === 'sm' ? 'p-1.5' : 'p-2'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Delete batch"
      className={`inline-flex items-center justify-center rounded-lg border border-red-300 dark:border-red-800 bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer ${sizing}`}
    >
      {busy ? <Spinner className={iconSize} /> : <TrashIcon className={iconSize} />}
    </button>
  )
}

export function CsvIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
  )
}

export function BatchStatusBadge({ status, testLabel }: { status: LabelBatchStatus; testLabel?: boolean }) {
  const suffix = testLabel ? ' (test)' : ''
  switch (status) {
    case 'created':
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <SuccessIcon className="h-3.5 w-3.5 shrink-0" /> Labels Created{suffix}
        </span>
      )
    case 'partial':
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          <StatusIcon className="h-3.5 w-3.5 shrink-0" /> Partially Created
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-red-100 dark:bg-red-900/30 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
          <ErrorIcon className="h-3.5 w-3.5 shrink-0" /> Failed
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--primary-100)] dark:bg-[var(--bg-300)] px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:text-[var(--text-200)]">
          <ClockIcon className="h-3.5 w-3.5 shrink-0" /> Drafted for Review
        </span>
      )
  }
}

export function ItemStatusBadge({ status, testLabel, error, found }: { status: LabelRecord['status']; testLabel?: boolean; error?: string; found?: boolean }) {
  if (status === 'created') {
    return (
      <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 text-xs font-medium">
        <SuccessIcon className="h-3.5 w-3.5" /> Created{testLabel ? ' (test)' : ''}
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-xs" title={error}>
        <ErrorIcon className="h-3.5 w-3.5" />
        <span>Failed</span>
      </span>
    )
  }
  if (found === false) {
    return (
      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-xs" title={error}>
        <ErrorIcon className="h-3.5 w-3.5" />
        <span>{error || 'Not found'}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-slate-500 dark:text-[var(--text-200)] text-xs font-medium">
      <ClockIcon className="h-3.5 w-3.5" /> Drafted
    </span>
  )
}

export function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-medium whitespace-nowrap text-xs uppercase tracking-wide ${className}`}>{children}</th>
}

export function HeaderLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-slate-400 dark:text-[var(--text-200)]">{icon}</span>
      <span>{text}</span>
    </span>
  )
}

export function Td({ children, className = '', colSpan, compact }: { children: React.ReactNode; className?: string; colSpan?: number; compact?: boolean }) {
  return <td colSpan={colSpan} className={`px-4 ${compact ? 'py-2' : 'py-3'} text-slate-700 dark:text-[var(--text-200)] ${className}`}>{children}</td>
}

export function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-200)] dark:bg-[var(--accent-100)] text-xs font-semibold text-white">{n}</span>
  )
}

export function AddressCell({ addr }: { addr?: LabelAddress }) {
  if (!addr) return <span className="text-slate-500">—</span>
  const lines = [
    addr.name,
    addr.company,
    addr.street1,
    addr.street2,
    addr.street3,
    [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', '),
    addr.country,
    addr.phone,
  ].filter(Boolean) as string[]
  if (lines.length === 0) return <span className="text-slate-500">—</span>
  return (
    <div className="text-[13px] leading-snug space-y-0.5 text-slate-700 dark:text-[var(--text-200)]">
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  )
}

export function PropertyBadge({ type }: { type: 'residential' | 'commercial' }) {
  return type === 'residential' ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
      <HomeIcon className="h-3 w-3" />
      <span>Residential</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400">
      <CommercialIcon className="h-3 w-3" />
      <span>Commercial</span>
    </span>
  )
}

export function HomeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10l9-7 9 7v10a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V10z" />
    </svg>
  )
}

export function CommercialIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M5 21V7a1 1 0 011-1h5a1 1 0 011 1v14m0 0h7V4a1 1 0 00-1-1h-5a1 1 0 00-1 1m-4 4h2m-2 4h2m6-6h2m-2 4h2" />
    </svg>
  )
}

export function StoreIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9l1.5-4.5A2 2 0 016.4 3h11.2a2 2 0 011.9 1.5L21 9m-1 0v10a2 2 0 01-2 2h-2V11H8v10H6a2 2 0 01-2-2V9m0 0h16" />
    </svg>
  )
}

export function PinIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

export function BoxIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8 4-8-4m16 0l-8-4-8 4m16 0v10l-8 4m-8-14v10l8 4m0-10v10" />
    </svg>
  )
}

export function TruckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17H6a2 2 0 01-2-2V7a2 2 0 012-2h8a2 2 0 012 2v2h2.5L21 12v3a2 2 0 01-2 2h-1m-9 0a2 2 0 104 0m-4 0a2 2 0 114 0m5 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
    </svg>
  )
}

export function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

export function QtyIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h10M7 16h10M5 8h.01M5 12h.01M5 16h.01" />
    </svg>
  )
}

export function ScaleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v3m0 0l6 10a3 3 0 11-6 0m0-10L6 16a3 3 0 11-6 0m12 5v-2m0 2h7m-7 0H5" />
    </svg>
  )
}

export function RulerIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7l13 13m-10-3l-2 2m5-5l-2 2m5-5l-2 2m5-5l-2 2M15 4l5 5a2 2 0 010 2.828l-8.172 8.172a2 2 0 01-2.828 0l-5-5a2 2 0 010-2.828L12.172 4A2 2 0 0115 4z" />
    </svg>
  )
}

export function LabelsTableIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h10m-10 5h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  )
}

export function RowItemIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V7a2 2 0 00-2-2h-3m-6 0H6a2 2 0 00-2 2v6m16 0v4a2 2 0 01-2 2h-3m-6 0H6a2 2 0 01-2-2v-4m16 0h-3m-10 0H4m13-8V4m0 4h-2m-6 12v-2m0 2H7m3-2h2" />
    </svg>
  )
}

export function SuccessIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

export function WarningIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
    </svg>
  )
}

export function ErrorIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

export function TagIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M3 11l8.59 8.59a2 2 0 002.82 0L21 13.01a2 2 0 000-2.83L12.41 1.6A2 2 0 0011 1H5a2 2 0 00-2 2v8a2 2 0 00.59 1.41z" />
    </svg>
  )
}

export function ClipboardIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
    </svg>
  )
}

export function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

export function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
    </svg>
  )
}

export function StatusIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

export function TrackingIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 01.553-.894L9 2m0 18l6-3m-6 3V2m6 15l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 2" />
    </svg>
  )
}

export function IdIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8M8 12h8M8 17h5M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  )
}

export function DollarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m4-13a4 4 0 00-4-2 4 4 0 00-4 2c0 1.5 1 2.5 4 3s4 1.5 4 3a4 4 0 01-4 2 4 4 0 01-4-2" />
    </svg>
  )
}

export function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

export function DocumentIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6M8 3h7l5 5v13a1 1 0 01-1 1H8a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  )
}

export function EyeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

export function PrinterIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
    </svg>
  )
}

export function BackIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  )
}

export function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}
