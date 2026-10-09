import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { BulkItemImportDialog } from '../components/bulk/BulkItemImportDialog'
import { BoxIcon, HeaderLabel, QtyIcon } from '../components/labels/labelUi'
import { prefersReducedMotion } from '../lib/hhNav'
import { getBulkOrderItems } from '../lib/bulkOrders'
import type { BulkOrderItems as BulkOrderItemsData, BulkOrderLineItem } from '../lib/bulkOrders'

const TOKEN_KEY = 'sq_token'

function textOrDash(value?: string): string {
  const text = (value || '').trim()
  return text || '—'
}

function formatItemPrice(price?: number | null, currencyCode?: string): string {
  if (price == null || !Number.isFinite(price)) return '—'
  const currency = currencyCode || 'USD'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price)
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price)
  }
}

function formatAmount(amount: number | null, currencyCode?: string): string {
  if (amount == null || !Number.isFinite(amount)) return '—'
  return formatItemPrice(amount, currencyCode)
}

function lineAmount(item: BulkOrderLineItem): number | null {
  if (item.price == null || !Number.isFinite(item.price)) return null
  return Math.round(item.price * item.quantity * 100) / 100
}

type ItemView = 'item' | 'style'
type ItemRow = BulkOrderLineItem & { total: number | null }

function rowsForView(items: BulkOrderLineItem[], view: ItemView): ItemRow[] {
  if (view === 'item') return items.map((item) => ({ ...item, total: lineAmount(item) }))
  const groups = new Map<string, BulkOrderLineItem[]>()
  for (const item of items) {
    const key = (item.styleCode || '').trim() || item.sku
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return [...groups.entries()].map(([key, group]) => {
    const named = group.find((item) => (item.name || '').trim()) ?? group[0]
    const pictured = group.find((item) => item.imageDataUrl || item.imageResource) ?? named
    const quantity = group.reduce((sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0), 0)
    let total = 0
    let priced = false
    let currencyCode = ''
    for (const item of group) {
      const amount = lineAmount(item)
      if (amount == null) continue
      priced = true
      total = Math.round((total + amount) * 100) / 100
      if (!currencyCode && item.currencyCode) currencyCode = item.currencyCode
    }
    return {
      ...pictured,
      name: named.name || '',
      sku: key,
      sellerSku: '',
      styleCode: (named.styleCode || '').trim() || key,
      size: '',
      width: '',
      quantity,
      price: null,
      currencyCode,
      total: priced ? total : null,
    }
  })
}

type ItemSortKey = 'seller' | 'b2b' | 'quantity'
type ItemSortDir = 'asc' | 'desc'

function SortIndicator({ direction }: { direction: ItemSortDir | null }) {
  const up = direction === 'asc' ? 'opacity-100' : 'opacity-40'
  const down = direction === 'desc' ? 'opacity-100' : 'opacity-40'
  return (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
      <path className={up} fill="currentColor" d="M8 2.8 4.4 7h7.2L8 2.8z" />
      <path className={down} fill="currentColor" d="M8 13.2 11.6 9H4.4L8 13.2z" />
    </svg>
  )
}

function SortableHeader({
  text,
  icon,
  centered = false,
  direction,
  onSort,
}: {
  text: string
  icon: React.ReactNode
  centered?: boolean
  direction: ItemSortDir | null
  onSort: () => void
}) {
  const align = centered ? 'justify-center' : ''
  const label =
    direction === 'asc' ? `Sort ${text} descending` : direction === 'desc' ? `Sort ${text} ascending` : `Sort by ${text}`
  return (
    <button
      type="button"
      onClick={onSort}
      aria-label={label}
      className={`${centered ? 'flex w-full' : 'inline-flex'} cursor-pointer items-center gap-1.5 bg-transparent p-0 text-xs font-medium uppercase tracking-wide text-inherit ${align}`}
    >
      <HeaderLabel className={align} icon={icon} text={text} />
      <SortIndicator direction={direction} />
    </button>
  )
}

function sortedItems(
  items: ItemRow[],
  sort: { key: ItemSortKey; dir: ItemSortDir } | null,
  view: ItemView,
): ItemRow[] {
  if (!sort) return items
  const direction = sort.dir === 'asc' ? 1 : -1
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const sellerSort = sort.key === 'seller' && view === 'item'
      const result = sort.key === 'quantity'
        ? left.item.quantity - right.item.quantity
        : sellerSort
          ? (left.item.sellerSku || '').localeCompare(right.item.sellerSku || '', undefined, {
              numeric: true,
              sensitivity: 'base',
            })
          : left.item.sku.localeCompare(right.item.sku, undefined, { numeric: true, sensitivity: 'base' })
      if (result !== 0) return result * direction
      return left.index - right.index
    })
    .map((row) => row.item)
}

function ImageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm3 10l2.5-3 2 2.5L15 11l5 6"
      />
    </svg>
  )
}

function NameIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h13" />
    </svg>
  )
}

function PriceIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .672-3 1.5S10.343 11 12 11s3 .672 3 1.5S13.657 14 12 14m0-6V6m0 8v2m0-12a9 9 0 110 18 9 9 0 010-18z"
      />
    </svg>
  )
}

const DOOR_SLIDE_MS = 420
const DOOR_FADE_MS = 160

type DoorPhase = 'closed' | 'opening' | 'open' | 'fading' | 'shutting'

function SheetCell({
  children,
  detail = false,
  shown = true,
  align = 'start',
  clip = false,
  strong = false,
  head = false,
  dataCol,
}: {
  children: ReactNode
  detail?: boolean
  shown?: boolean
  align?: 'start' | 'center' | 'end'
  clip?: boolean
  strong?: boolean
  head?: boolean
  dataCol?: string
}) {
  const alignClass = align === 'center' ? ' is-center' : align === 'end' ? ' is-end' : ''
  const hidden = detail && !shown
  return (
    <div
      role={head ? 'columnheader' : 'cell'}
      data-col={dataCol}
      aria-hidden={hidden ? true : undefined}
      inert={hidden ? true : undefined}
      className={`bulk-sheet-cell${detail ? ' bulk-sheet-detail' : ''}${alignClass}${clip ? ' is-clip' : ''}${strong ? ' is-strong' : ''}`}
    >
      {detail ? <div className="bulk-sheet-detail-inner">{children}</div> : children}
    </div>
  )
}

function DetailColumnsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? 'Hide style, size, and width' : 'Show style, size, and width'}
      onClick={onToggle}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--bg-300)] px-3 py-1.5 text-sm font-medium transition-colors ${
        open
          ? 'bg-white text-slate-900 shadow-sm dark:bg-[var(--bg-300)] dark:text-[var(--text-100)]'
          : 'bg-[var(--bg-200)] text-slate-500 hover:text-slate-800 dark:text-[var(--text-200)] dark:hover:text-[var(--text-100)]'
      }`}
    >
      Details
      <svg
        className={`h-3.5 w-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}

function ItemViewToggle({ view, onChange }: { view: ItemView; onChange: (view: ItemView) => void }) {
  const next = view === 'item' ? 'style' : 'item'
  const labelClass = (active: boolean) =>
    `relative z-10 px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? 'text-slate-900 dark:text-[var(--text-100)]' : 'text-slate-500 dark:text-[var(--text-200)]'
    }`
  return (
    <button
      type="button"
      aria-pressed={view === 'style'}
      aria-label={view === 'item' ? 'By item. Switch to By style' : 'By style. Switch to By item'}
      onClick={() => onChange(next)}
      className="relative grid cursor-pointer grid-cols-2 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-0.5"
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 w-[calc(50%-2px)] rounded-md bg-white shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none dark:bg-[var(--bg-300)] ${
          view === 'style' ? 'translate-x-full' : 'translate-x-0'
        }`}
      />
      <span className={labelClass(view === 'item')}>By item</span>
      <span className={labelClass(view === 'style')}>By style</span>
    </button>
  )
}

function ItemImage({ item }: { item: BulkOrderLineItem }) {
  const embedded = item.imageDataUrl || ''
  const resource = embedded ? '' : item.imageResource || ''
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!resource) return
    let cancelled = false
    let objectUrl = ''
    const token = localStorage.getItem(TOKEN_KEY)
    fetch(`/api/bulk-order/thorogood/resources/${encodeURIComponent(resource)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob) return
        const next = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(next)
          return
        }
        objectUrl = next
        setSrc(next)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [resource])

  const shown = embedded || src
  if (!shown) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-[var(--bg-300)] bg-[var(--bg-200)] text-[10px] text-slate-400 dark:text-[var(--text-200)]">
        —
      </div>
    )
  }
  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-[var(--bg-300)] bg-white dark:bg-[var(--bg-200)]">
      <img src={shown} alt={item.name || item.sku} className="h-full w-full object-contain" />
    </div>
  )
}

export default function BulkOrderItems() {
  const { orderId, shipmentIndex } = useParams<{ orderId: string; shipmentIndex: string }>()
  const [data, setData] = useState<BulkOrderItemsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [sort, setSort] = useState<{ key: ItemSortKey; dir: ItemSortDir } | null>(null)
  const [view, setView] = useState<ItemView>('item')
  const [door, setDoor] = useState<DoorPhase>('closed')
  const [swap, setSwap] = useState<{ from: ItemView; direction: 'forward' | 'back' } | null>(null)
  const index = /^\d+$/.test(shipmentIndex ?? '') ? Number(shipmentIndex) : -1

  function changeView(next: ItemView) {
    if (next === view) return
    if (prefersReducedMotion()) {
      setSwap(null)
    } else {
      setSwap({ from: view, direction: next === 'style' ? 'forward' : 'back' })
    }
    setView(next)
  }

  useEffect(() => {
    if (!swap) return
    const timer = window.setTimeout(() => setSwap(null), 260)
    return () => window.clearTimeout(timer)
  }, [swap])

  function toggleDetails() {
    if (prefersReducedMotion()) {
      setDoor((current) => (current === 'open' ? 'closed' : 'open'))
      return
    }
    setDoor((current) => (current === 'opening' || current === 'open' ? 'fading' : 'opening'))
  }

  useEffect(() => {
    if (door === 'opening') {
      const timer = window.setTimeout(() => setDoor('open'), DOOR_SLIDE_MS)
      return () => window.clearTimeout(timer)
    }
    if (door === 'fading') {
      const timer = window.setTimeout(() => setDoor('shutting'), DOOR_FADE_MS)
      return () => window.clearTimeout(timer)
    }
    if (door === 'shutting') {
      const timer = window.setTimeout(() => setDoor('closed'), DOOR_SLIDE_MS)
      return () => window.clearTimeout(timer)
    }
  }, [door])

  function toggleSort(key: ItemSortKey) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: 'asc' }
      return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    })
  }

  useEffect(() => {
    if (!orderId || index < 0) return
    let cancelled = false
    getBulkOrderItems(orderId, index)
      .then((res) => {
        if (cancelled) return
        setData(res.data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load items.')
      })
    return () => {
      cancelled = true
    }
  }, [orderId, index])

  const shipment = data?.shipment
  const items = data?.items ?? []
  const rowsByView = useMemo(
    () => ({
      item: sortedItems(rowsForView(data?.items ?? [], 'item'), sort, 'item'),
      style: sortedItems(rowsForView(data?.items ?? [], 'style'), sort, 'style'),
    }),
    [data?.items, sort],
  )

  function itemsTable(tableView: ItemView) {
    const byStyle = tableView === 'style'
    const rows = rowsByView[tableView]
    const doorWide = door === 'opening' || door === 'open' || door === 'fading'
    const doorShown = door === 'open'
    const message =
      index < 0
        ? 'Shipment not found.'
        : error
          ? error
          : !data
            ? 'Loading items…'
            : items.length === 0
              ? data.message || 'No items yet. Import a file to add SKUs.'
              : null
    return (
      <div className="hh-table-scroll bulk-items-scroll">
        <div
          role="table"
          className={`bulk-sheet text-[13px] text-slate-700 dark:text-[var(--text-100)]${byStyle ? ' is-style' : ''}${doorWide ? ' is-wide' : ''}${doorShown ? ' is-shown' : ''}`}
        >
          <div
            role="row"
            className="bulk-sheet-head text-xs uppercase tracking-wide text-slate-500 dark:text-[var(--text-200)]"
          >
            <SheetCell head dataCol="image">
              <HeaderLabel icon={<ImageIcon className="h-3.5 w-3.5" />} text="Image" />
            </SheetCell>
            {byStyle ? null : (
              <SheetCell head dataCol="sku">
                <SortableHeader
                  text="SKU"
                  icon={<BoxIcon className="h-3.5 w-3.5" />}
                  direction={sort?.key === 'seller' ? sort.dir : null}
                  onSort={() => toggleSort('seller')}
                />
              </SheetCell>
            )}
            {byStyle ? null : (
              <SheetCell head dataCol="b2b">
                <SortableHeader
                  text="B2B SKU"
                  icon={<BoxIcon className="h-3.5 w-3.5" />}
                  direction={sort?.key === 'b2b' ? sort.dir : null}
                  onSort={() => toggleSort('b2b')}
                />
              </SheetCell>
            )}
            <SheetCell head dataCol="name">
              <HeaderLabel icon={<NameIcon className="h-3.5 w-3.5" />} text="Product Name" />
            </SheetCell>
            <SheetCell head detail shown={doorShown} align="center" dataCol="style">
              {byStyle ? (
                <SortableHeader
                  text="Style Code"
                  icon={<BoxIcon className="h-3.5 w-3.5" />}
                  centered
                  direction={sort?.key === 'b2b' ? sort.dir : null}
                  onSort={() => toggleSort('b2b')}
                />
              ) : (
                <HeaderLabel className="justify-center" icon={<BoxIcon className="h-3.5 w-3.5" />} text="Style Code" />
              )}
            </SheetCell>
            {byStyle ? null : (
              <SheetCell head detail shown={doorShown} align="center" dataCol="size">
                <HeaderLabel className="justify-center" icon={<BoxIcon className="h-3.5 w-3.5" />} text="Size" />
              </SheetCell>
            )}
            {byStyle ? null : (
              <SheetCell head detail shown={doorShown} align="center" dataCol="width">
                <HeaderLabel className="justify-center" icon={<BoxIcon className="h-3.5 w-3.5" />} text="Width" />
              </SheetCell>
            )}
            <SheetCell head align="center" dataCol="qty">
              <SortableHeader
                text="Quantity"
                icon={<QtyIcon className="h-3.5 w-3.5" />}
                centered
                direction={sort?.key === 'quantity' ? sort.dir : null}
                onSort={() => toggleSort('quantity')}
              />
            </SheetCell>
            {byStyle ? null : (
              <SheetCell head align="end" dataCol="price">
                <HeaderLabel className="justify-end" icon={<PriceIcon className="h-3.5 w-3.5" />} text="Price" />
              </SheetCell>
            )}
            <SheetCell head align="end" dataCol="total">
              <HeaderLabel className="justify-end" icon={<PriceIcon className="h-3.5 w-3.5" />} text="Total" />
            </SheetCell>
          </div>
          {message ? (
            <div role="row" className="bulk-sheet-row is-message">
              <div
                role="cell"
                className={`bulk-sheet-message${error ? ' text-red-600 dark:text-red-400' : ' text-slate-400 dark:text-[var(--text-200)]'}`}
              >
                {message}
              </div>
            </div>
          ) : (
            rows.map((item, rowIndex) => (
              <div
                key={`${item.sku}-${rowIndex}`}
                role="row"
                className={`bulk-sheet-row${rowIndex % 2 === 1 ? ' is-alt' : ''}`}
              >
                <SheetCell dataCol="image">
                  <ItemImage key={item.imageResource || item.sku} item={item} />
                </SheetCell>
                {byStyle ? null : (
                  <SheetCell clip strong dataCol="sku">
                    <span>{textOrDash(item.sellerSku)}</span>
                  </SheetCell>
                )}
                {byStyle ? null : (
                  <SheetCell clip strong dataCol="b2b">
                    <span>{item.sku}</span>
                  </SheetCell>
                )}
                <SheetCell dataCol="name">
                  <span className="min-w-0 break-words" title={item.name || undefined}>
                    {item.name || '—'}
                  </span>
                </SheetCell>
                <SheetCell detail shown={doorShown} align="center" dataCol="style">
                  {textOrDash(item.styleCode)}
                </SheetCell>
                {byStyle ? null : (
                  <SheetCell detail shown={doorShown} align="center" dataCol="size">
                    {textOrDash(item.size)}
                  </SheetCell>
                )}
                {byStyle ? null : (
                  <SheetCell detail shown={doorShown} align="center" dataCol="width">
                    {textOrDash(item.width)}
                  </SheetCell>
                )}
                <SheetCell align="center" dataCol="qty">
                  <span className="tabular-nums">{item.quantity}</span>
                </SheetCell>
                {byStyle ? null : (
                  <SheetCell align="end" dataCol="price">
                    <span className="tabular-nums">{formatItemPrice(item.price, item.currencyCode)}</span>
                  </SheetCell>
                )}
                <SheetCell align="end" dataCol="total">
                  <span className="tabular-nums">{formatAmount(item.total, item.currencyCode)}</span>
                </SheetCell>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--bg-300)] px-4 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
            {index >= 0 ? `Shipment ${index + 1}` : 'Items'}
          </h2>
          {shipment ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
              {data?.orderName ? `${data.orderName} · ` : ''}
              PO {shipment.customerPo} · {shipment.catalogName}
            </p>
          ) : null}
          {data?.message && items.length > 0 ? (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{data.message}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DetailColumnsButton open={door !== 'closed'} onToggle={toggleDetails} />
          <ItemViewToggle view={view} onChange={changeView} />
          <button
            type="button"
            disabled={!orderId || index < 0 || !data}
            onClick={() => setImportOpen(true)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5 5 5M12 5v10" />
            </svg>
            Import
          </button>
        </div>
      </div>
      <div className="bulk-items-swap">
        {swap ? (
          <div key={`${swap.from}-leave`} className={`bulk-items-pane bulk-items-pane--exit-${swap.direction}`} aria-hidden="true">
            {itemsTable(swap.from)}
          </div>
        ) : null}
        <div key={view} className={swap ? `bulk-items-pane bulk-items-pane--enter-${swap.direction}` : 'bulk-items-pane'}>
          {itemsTable(view)}
        </div>
      </div>
      {importOpen && orderId && index >= 0 ? (
        <BulkItemImportDialog
          orderId={orderId}
          shipmentIndex={index}
          onClose={() => setImportOpen(false)}
          onImported={(next) => {
            setData(next)
            setError(null)
            setImportOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}
