import { useEffect, useState } from 'react'
import { BulkItemFileField } from './BulkItemFileField'
import { getBulkOrderCatalogs, getBulkOrderConfig, getBulkOrderShipTos } from '../../lib/bulkOrderConfig'
import type { BulkOrderCatalog, BulkOrderShipTo } from '../../lib/bulkOrderConfig'
import { bulkShipmentPayload, importBulkOrderItems, notifyBulkOrdersChanged, updateBulkOrder } from '../../lib/bulkOrders'
import type { BulkOrderRow, BulkOrderShipment } from '../../lib/bulkOrders'

const MAX_PO = 20
const DEFAULT_CATALOG = 'Thorogood Boots'
const DEFAULT_DROP_SHIP = {
  name: 'OUTDOOR EQUIPPED',
  address: '312 Raleigh Street Suite 4',
  postalCode: '28412',
}

const inputClass =
  'w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] disabled:cursor-default disabled:opacity-80 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]'
const labelClass = 'block text-sm font-medium text-slate-700 dark:text-[var(--text-100)]'
const hintClass = 'block text-xs text-slate-500 dark:text-[var(--text-200)]'

function todayDate(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function Choice({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const known = options.some((option) => option.value === value)
  const choices = known || !value ? options : [{ value, label: value }, ...options]
  return (
    <select id={id} className={`${inputClass} cursor-pointer`} value={value} onChange={(event) => onChange(event.target.value)}>
      {choices.map((option) => (
        <option key={`${option.value}-${option.label}`} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function BulkShipmentDialog({
  order,
  shipment,
  shipmentIndex,
  onClose,
  onSaved,
}: {
  order: BulkOrderRow
  shipment: BulkOrderShipment | null
  shipmentIndex: number | null
  onClose: () => void
  onSaved: (order: BulkOrderRow) => void
}) {
  const adding = shipment == null
  const [customerPo, setCustomerPo] = useState(shipment?.customerPo ?? order.orderName)
  const [useOrderName, setUseOrderName] = useState(
    shipment ? shipment.customerPo.trim() === order.orderName.trim() : true,
  )
  const [catalog, setCatalog] = useState(shipment?.catalogName || DEFAULT_CATALOG)
  const [shipTo, setShipTo] = useState(shipment?.shipToLabel || order.shipToLabel)
  const [useDropShip, setUseDropShip] = useState(shipment ? shipment.useDropShip : true)
  const [dropShip, setDropShip] = useState(
    shipment
      ? {
          name: shipment.dropShipName,
          address: shipment.dropShipAddress,
          postalCode: shipment.dropShipPostalCode,
        }
      : { ...DEFAULT_DROP_SHIP },
  )
  const [requestedShipDate, setRequestedShipDate] = useState(shipment?.requestedShipDate || todayDate())
  const [notes, setNotes] = useState(shipment?.notes ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [shipmentSaved, setShipmentSaved] = useState(false)
  const [catalogs, setCatalogs] = useState<BulkOrderCatalog[]>([])
  const [shipTos, setShipTos] = useState<BulkOrderShipTo[]>([])
  const [catalogNote, setCatalogNote] = useState<string | null>(null)
  const [shipToNote, setShipToNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!adding) return
    let cancelled = false
    getBulkOrderConfig()
      .then((res) => {
        if (cancelled) return
        const nextCatalog = res.data.catalog.trim() || DEFAULT_CATALOG
        setCatalog((current) => (current === DEFAULT_CATALOG ? nextCatalog : current))
        setDropShip((current) =>
          current.name === DEFAULT_DROP_SHIP.name &&
          current.address === DEFAULT_DROP_SHIP.address &&
          current.postalCode === DEFAULT_DROP_SHIP.postalCode
            ? {
                name: res.data.dropShipName?.trim() || DEFAULT_DROP_SHIP.name,
                address: res.data.dropShipAddress?.trim() || DEFAULT_DROP_SHIP.address,
                postalCode: res.data.dropShipPostalCode?.trim() || DEFAULT_DROP_SHIP.postalCode,
              }
            : current,
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [adding])

  useEffect(() => {
    let cancelled = false
    getBulkOrderCatalogs()
      .then((res) => {
        if (cancelled) return
        setCatalogs(res.data)
        setCatalogNote(res.source === 'fallback' ? res.message || 'Showing Thorogood Boots only.' : null)
      })
      .catch(() => {
        if (!cancelled) setCatalogNote('Could not load catalogs. Showing the saved catalog only.')
      })
    getBulkOrderShipTos(order.soldToCode)
      .then((res) => {
        if (cancelled) return
        setShipTos(res.data)
        setShipToNote(res.source === 'fallback' ? res.message || 'Showing the warehouse address only.' : null)
      })
      .catch(() => {
        if (!cancelled) setShipToNote('Could not load ship-to addresses.')
      })
    return () => {
      cancelled = true
    }
  }, [order.soldToCode])

  const po = (useOrderName ? order.orderName : customerPo).trim()
  const shipToCode =
    shipTos.find((option) => option.label === shipTo.trim())?.code ||
    (shipTo.trim() === order.shipToLabel ? order.shipToCode : '') ||
    (shipment && shipTo.trim() === shipment.shipToLabel ? shipment.shipToCode : '')
  const catalogCode =
    catalogs.find((option) => option.name === catalog.trim())?.code ||
    (shipment && catalog.trim() === shipment.catalogName ? shipment.catalogCode : '')
  const missing = !po
    ? 'Enter a customer PO.'
    : po.length > MAX_PO
      ? `Customer PO cannot be longer than ${MAX_PO} characters.`
      : !shipTo.trim() || !shipToCode
        ? 'Choose a ship to from the list.'
        : !catalog.trim()
          ? 'Choose a catalog.'
          : !requestedShipDate
            ? 'Choose a requested ship date.'
            : useDropShip && (!dropShip.name.trim() || !dropShip.address.trim() || !dropShip.postalCode.trim())
              ? 'Enter a drop ship name, address, and zip / postal code.'
              : notes.trim().length > 500
                ? 'Notes cannot be longer than 500 characters.'
                : adding && fileError
                  ? fileError
                  : null

  const save = async () => {
    if (shipmentSaved) {
      onClose()
      return
    }
    if (missing || saving) return
    setSaving(true)
    setImporting(false)
    setError(null)
    const next = order.shipments.map((row) => bulkShipmentPayload(row))
    const payload = {
      customerPo: po,
      shipToCode,
      catalogName: catalog.trim(),
      catalogCode,
      useDropShip,
      dropShip: useDropShip ? { ...dropShip } : undefined,
      requestedShipDate,
      notes: notes.trim(),
    }
    if (shipmentIndex == null) next.push(payload)
    else next[shipmentIndex] = payload
    try {
      const res = await updateBulkOrder(order.id, {
        orderName: order.orderName,
        soldToCode: order.soldToCode,
        shipToCode: order.shipToCode,
        shipments: next,
      })
      notifyBulkOrdersChanged(res.warning || '')
      onSaved(res.data)
      if (adding && file) {
        setImporting(true)
        try {
          await importBulkOrderItems(order.id, order.shipments.length, file)
        } catch (err) {
          setShipmentSaved(true)
          const message = err instanceof Error ? err.message : 'Could not import items.'
          setError(`Shipment added. ${message}`)
          return
        }
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the shipment.')
    } finally {
      setSaving(false)
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={() => { if (!saving) onClose() }} />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-shipment-title"
        className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--accent-200)] bg-[var(--accent-200)] px-6 text-white dark:border-[var(--accent-100)] dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]">
          <h3 id="bulk-shipment-title" className="truncate text-base font-semibold">
            {adding ? 'Add shipment' : `Shipment ${(shipmentIndex ?? 0) + 1}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed dark:text-[var(--text-100)]/80 dark:hover:bg-white/10"
            aria-label="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className={labelClass} htmlFor="bulk-shipment-po">
                  Customer PO
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-[var(--text-200)]">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[var(--accent-200)]"
                    checked={useOrderName}
                    onChange={(event) => {
                      const next = event.target.checked
                      setUseOrderName(next)
                      if (next) setCustomerPo(order.orderName)
                    }}
                  />
                  Use Order Name
                </label>
              </div>
              <span className={useOrderName ? 'block cursor-not-allowed' : 'block'} title={useOrderName ? 'Uncheck to edit.' : undefined}>
                <input
                  id="bulk-shipment-po"
                  className={`${inputClass} disabled:!cursor-not-allowed`}
                  value={useOrderName ? order.orderName : customerPo}
                  maxLength={MAX_PO}
                  disabled={useOrderName}
                  onChange={(event) => {
                    setUseOrderName(false)
                    setCustomerPo(event.target.value)
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
              </span>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass} htmlFor="bulk-shipment-catalog">
                Catalog
              </label>
              <Choice
                id="bulk-shipment-catalog"
                value={catalog}
                options={catalogs.map((option) => ({ value: option.name, label: option.name }))}
                onChange={setCatalog}
              />
              {catalogNote ? <p className={hintClass}>{catalogNote}</p> : null}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className={labelClass} htmlFor="bulk-shipment-ship-to">
                Ship To
              </label>
              <Choice
                id="bulk-shipment-ship-to"
                value={shipTo}
                options={shipTos.map((option) => ({ value: option.label, label: option.label }))}
                onChange={setShipTo}
              />
              {shipToNote ? <p className={hintClass}>{shipToNote}</p> : null}
            </div>
          </div>
          <div className="border-t border-[var(--accent-200)] pt-4 dark:border-[var(--accent-100)]">
            <div className="flex items-center justify-between gap-2">
              <p className={labelClass}>Drop Ship Address</p>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-[var(--text-200)]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[var(--accent-200)]"
                  checked={useDropShip}
                  onChange={(event) => setUseDropShip(event.target.checked)}
                />
                Use Drop Ship Address
              </label>
            </div>
            <p className={`${hintClass} mt-3`}>Drop ship is available for North America only.</p>
            {useDropShip ? (
              <div className="grid gap-4 pt-3 sm:grid-cols-9">
                <div className="space-y-1.5 sm:col-span-3">
                  <label className={labelClass} htmlFor="bulk-shipment-drop-name">
                    Name
                  </label>
                  <input
                    id="bulk-shipment-drop-name"
                    className={inputClass}
                    value={dropShip.name}
                    onChange={(event) => setDropShip((current) => ({ ...current, name: event.target.value }))}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-4">
                  <label className={labelClass} htmlFor="bulk-shipment-drop-address">
                    Address
                  </label>
                  <input
                    id="bulk-shipment-drop-address"
                    className={inputClass}
                    value={dropShip.address}
                    onChange={(event) => setDropShip((current) => ({ ...current, address: event.target.value }))}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className={labelClass} htmlFor="bulk-shipment-drop-zip">
                    Zip / Postal Code
                  </label>
                  <input
                    id="bulk-shipment-drop-zip"
                    className={inputClass}
                    value={dropShip.postalCode}
                    onChange={(event) => setDropShip((current) => ({ ...current, postalCode: event.target.value }))}
                    autoComplete="off"
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className={labelClass} htmlFor="bulk-shipment-date">
                Requested Ship Date
              </label>
              <input
                id="bulk-shipment-date"
                type="date"
                className={`${inputClass} cursor-pointer dark:[color-scheme:dark]`}
                value={requestedShipDate}
                onChange={(event) => setRequestedShipDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className={labelClass} htmlFor="bulk-shipment-notes">
                Notes
              </label>
              <input
                id="bulk-shipment-notes"
                className={inputClass}
                value={notes}
                maxLength={500}
                placeholder="This message is viewable and editable by all users."
                onChange={(event) => setNotes(event.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          {adding ? (
            <BulkItemFileField
              inputId="bulk-shipment-file"
              file={file}
              error={fileError}
              onFile={(nextFile, nextError) => {
                setFile(nextFile)
                setFileError(nextError)
                setError(null)
              }}
            />
          ) : null}
        </div>
        <div className="shrink-0 space-y-2 border-t border-[var(--accent-200)] px-6 py-4 dark:border-[var(--accent-100)]">
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          <button
            type="submit"
            disabled={!shipmentSaved && (missing != null || saving)}
            title={shipmentSaved ? undefined : missing ?? undefined}
            className="inline-flex w-full cursor-pointer items-center justify-center rounded-lg bg-[var(--accent-200)] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
          >
            {shipmentSaved ? 'Close' : saving ? (importing ? 'Importing items…' : 'Saving draft…') : adding ? 'Add shipment' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
