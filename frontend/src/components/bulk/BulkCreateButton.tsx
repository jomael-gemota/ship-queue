import { useEffect, useRef, useState } from 'react'
import type { AnimationEvent, ReactNode, TransitionEvent } from 'react'
import { BulkItemFileField } from './BulkItemFileField'
import { prefersReducedMotion } from '../../lib/hhNav'
import { getBulkOrderCatalogs, getBulkOrderConfig, getBulkOrderShipTos, getBulkOrderSoldTos } from '../../lib/bulkOrderConfig'
import { bulkShipmentPayload, createBulkOrder, importBulkOrderItems, notifyBulkOrdersChanged, subscribeBulkOrderEdit, updateBulkOrder } from '../../lib/bulkOrders'
import type { BulkOrderCreateShipment, BulkOrderRow, BulkOrderShipment } from '../../lib/bulkOrders'
import type { BulkOrderCatalog, BulkOrderShipTo, BulkOrderSoldTo } from '../../lib/bulkOrderConfig'

const MAX_ORDER_NAME = 20
const DEFAULT_SOLD_TO = '23550'
const DEFAULT_SHIP_TO = '312 RALEIGH STREET STE 4, WILMINGTON, NC 28412'
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

interface DropShipAddress {
  name: string
  address: string
  postalCode: string
}

interface ShipmentDraft {
  id: string
  customerPo: string
  useOrderName: boolean
  shipTo: string
  catalog: string
  useDropShip: boolean
  dropShip: DropShipAddress
  requestedShipDate: string
  notes: string
  file: File | null
  fileError: string | null
}

function todayDate(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

let shipmentSeq = 0

function blankShipment(
  catalog: string,
  orderName = '',
  shipTo = DEFAULT_SHIP_TO,
  dropShip: DropShipAddress = DEFAULT_DROP_SHIP,
): ShipmentDraft {
  shipmentSeq += 1
  return {
    id: `shipment-${shipmentSeq}`,
    customerPo: orderName,
    useOrderName: true,
    shipTo,
    catalog,
    useDropShip: true,
    dropShip: { ...dropShip },
    requestedShipDate: todayDate(),
    notes: '',
    file: null,
    fileError: null,
  }
}

function shipmentSummary(shipment: ShipmentDraft): string {
  const shipTo = shipment.shipTo.trim() || 'No ship to'
  const name = shipment.useDropShip !== false ? shipment.dropShip.name.trim() || 'No drop ship name' : 'No drop ship'
  const extra = [shipment.customerPo.trim(), shipment.file?.name].filter(Boolean)
  return [shipTo, name, ...extra].join(' · ')
}

function shipmentFromOrder(shipment: BulkOrderShipment, orderName: string): ShipmentDraft {
  shipmentSeq += 1
  return {
    id: `shipment-${shipmentSeq}`,
    customerPo: shipment.customerPo,
    useOrderName: shipment.customerPo.trim() === orderName.trim(),
    shipTo: shipment.shipToLabel,
    catalog: shipment.catalogName,
    useDropShip: shipment.useDropShip,
    dropShip: {
      name: shipment.dropShipName,
      address: shipment.dropShipAddress,
      postalCode: shipment.dropShipPostalCode,
    },
    requestedShipDate: shipment.requestedShipDate || todayDate(),
    notes: shipment.notes,
    file: null,
    fileError: null,
  }
}

function sameDropShip(address: DropShipAddress, expected: DropShipAddress = DEFAULT_DROP_SHIP): boolean {
  return (
    address.name.trim() === expected.name.trim() &&
    address.address.trim() === expected.address.trim() &&
    address.postalCode.trim() === expected.postalCode.trim()
  )
}

const FALLBACK_SHIP_TOS: BulkOrderShipTo[] = [{ code: 'NCWH', label: DEFAULT_SHIP_TO }]
const FALLBACK_CATALOGS: BulkOrderCatalog[] = [{ code: 'thorogood-boots', name: DEFAULT_CATALOG }]
const FALLBACK_SOLD_TOS: BulkOrderSoldTo[] = [
  { code: DEFAULT_SOLD_TO, name: 'OUTDOOR EQUIPPED', label: `${DEFAULT_SOLD_TO} - OUTDOOR EQUIPPED` },
]

function ShipToSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: string
  options: BulkOrderShipTo[]
  onChange: (value: string) => void
}) {
  const known = options.some((option) => option.label === value)
  const choices = known || !value ? options : [{ code: 'current', label: value }, ...options]
  return (
    <select
      id={id}
      className={`${inputClass} cursor-pointer`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {choices.map((option) => (
        <option key={`${option.code}-${option.label}`} value={option.label}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function CatalogSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: string
  options: BulkOrderCatalog[]
  onChange: (value: string) => void
}) {
  const known = options.some((option) => option.name === value)
  const choices = known || !value ? options : [{ code: 'current', name: value }, ...options]
  return (
    <select
      id={id}
      className={`${inputClass} cursor-pointer`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {choices.map((option) => (
        <option key={`${option.code}-${option.name}`} value={option.name}>
          {option.name}
        </option>
      ))}
    </select>
  )
}

function SlidingPanel({ open, children }: { open: boolean; children: ReactNode }) {
  const [revealed, setRevealed] = useState(open)
  if (!open && revealed) setRevealed(false)
  const clip = !open || (!prefersReducedMotion() && !revealed)

  const onTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'grid-template-rows') return
    if (open) setRevealed(true)
  }

  return (
    <div
      className={`grid transition-[grid-template-rows] duration-[240ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
      inert={open ? undefined : true}
      aria-hidden={open ? undefined : true}
      onTransitionEnd={onTransitionEnd}
    >
      <div className={clip ? 'min-h-0 overflow-hidden' : 'min-h-0'}>{children}</div>
    </div>
  )
}

function SoldToSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: string
  options: BulkOrderSoldTo[]
  onChange: (value: string) => void
}) {
  const known = options.some((option) => option.code === value)
  const choices = known || !value ? options : [{ code: value, name: '', label: value }, ...options]
  return (
    <select
      id={id}
      className={`${inputClass} cursor-pointer`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {choices.map((option) => (
        <option key={option.code} value={option.code}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function BulkCreateButton() {
  const [open, setOpen] = useState(false)
  const [orderName, setOrderName] = useState('')
  const [soldTo, setSoldTo] = useState(DEFAULT_SOLD_TO)
  const [soldToOptions, setSoldToOptions] = useState<BulkOrderSoldTo[]>(FALLBACK_SOLD_TOS)
  const [soldToNote, setSoldToNote] = useState<string | null>(null)
  const [shipTo, setShipTo] = useState(DEFAULT_SHIP_TO)
  const [shipToDefault, setShipToDefault] = useState(DEFAULT_SHIP_TO)
  const [shipToOptions, setShipToOptions] = useState<BulkOrderShipTo[]>(FALLBACK_SHIP_TOS)
  const [shipToNote, setShipToNote] = useState<string | null>(null)
  const [catalogOptions, setCatalogOptions] = useState<BulkOrderCatalog[]>(FALLBACK_CATALOGS)
  const [catalogNote, setCatalogNote] = useState<string | null>(null)
  const [shipments, setShipments] = useState<ShipmentDraft[]>(() => [blankShipment(DEFAULT_CATALOG)])
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null)
  const [slide, setSlide] = useState<{ direction: 'forward' | 'back'; shipmentId: string } | null>(null)
  const [defaults, setDefaults] = useState({
    soldTo: DEFAULT_SOLD_TO,
    catalog: DEFAULT_CATALOG,
    shipToCode: 'NCWH',
    dropShip: { ...DEFAULT_DROP_SHIP },
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null)
  const [savedShipments, setSavedShipments] = useState<BulkOrderCreateShipment[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const editingIdRef = useRef<string | null>(null)

  const resetForm = () => {
    editingIdRef.current = null
    setEditingOrderId(null)
    setSavedShipments(null)
    setDirty(false)
    setOrderName('')
    setSoldTo(defaults.soldTo)
    setShipTo(shipToDefault)
    setShipments([blankShipment(defaults.catalog, '', shipToDefault, defaults.dropShip)])
    setEditingShipmentId(null)
    setSlide(null)
    setFormError(null)
  }

  const openForEdit = (order: BulkOrderRow) => {
    const rows = order.shipments.length > 0 ? order.shipments.map((shipment) => shipmentFromOrder(shipment, order.orderName)) : [blankShipment(defaults.catalog)]
    editingIdRef.current = order.id
    setEditingOrderId(order.id)
    setSavedShipments(order.shipments.map((shipment) => bulkShipmentPayload(shipment)))
    setOrderName(order.orderName)
    setSoldTo(order.soldToCode)
    setShipTo(order.shipToLabel)
    setShipments(rows)
    setEditingShipmentId(null)
    setSlide(null)
    setFormError(null)
    setDirty(false)
    setOpen(true)
  }

  const discard = () => {
    setOpen(false)
    resetForm()
  }

  const requestClose = () => {
    if (submitting) return
    if (dirty && !window.confirm('Discard this order and close?')) return
    discard()
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (submitting) return
      if (dirty && !window.confirm('Discard this order and close?')) return
      setOpen(false)
      editingIdRef.current = null
      setEditingOrderId(null)
      setSavedShipments(null)
      setDirty(false)
      setOrderName('')
      setSoldTo(defaults.soldTo)
      setShipTo(shipToDefault)
      setShipments([blankShipment(defaults.catalog, '', shipToDefault, defaults.dropShip)])
      setEditingShipmentId(null)
      setSlide(null)
      setFormError(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, dirty, submitting, defaults.soldTo, defaults.catalog, defaults.dropShip, shipToDefault])

  const openForEditRef = useRef<(order: BulkOrderRow) => void>(() => {})
  useEffect(() => {
    openForEditRef.current = (order) => {
      if (submitting) return
      if (open && dirty && !window.confirm('Discard this order and edit the selected one?')) return
      openForEdit(order)
    }
  }, [open, dirty, submitting, defaults, openForEdit])

  useEffect(() => subscribeBulkOrderEdit((order) => openForEditRef.current(order)), [])

  const goToShipment = (id: string) => {
    if (editingShipmentId == null && !prefersReducedMotion()) setSlide({ direction: 'forward', shipmentId: id })
    else setSlide(null)
    setEditingShipmentId(id)
    setFormError(null)
  }

  const leaveShipment = () => {
    if (editingShipmentId != null && !prefersReducedMotion()) {
      setSlide({ direction: 'back', shipmentId: editingShipmentId })
    } else {
      setSlide(null)
    }
    setEditingShipmentId(null)
    setFormError(null)
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getBulkOrderConfig()
      .then((res) => {
        if (cancelled) return
        const next = {
          soldTo: res.data.accountId.trim() || DEFAULT_SOLD_TO,
          catalog: res.data.catalog.trim() || DEFAULT_CATALOG,
          shipToCode: res.data.defaultShipToCode?.trim() || 'NCWH',
          dropShip: {
            name: res.data.dropShipName?.trim() || DEFAULT_DROP_SHIP.name,
            address: res.data.dropShipAddress?.trim() || DEFAULT_DROP_SHIP.address,
            postalCode: res.data.dropShipPostalCode?.trim() || DEFAULT_DROP_SHIP.postalCode,
          },
        }
        setDefaults(next)
        if (editingIdRef.current) return
        setSoldTo((current) => (current === DEFAULT_SOLD_TO ? next.soldTo : current))
        setShipments((current) =>
          current.map((shipment) => ({
            ...shipment,
            catalog:
              shipment.catalog === DEFAULT_CATALOG || shipment.catalog.trim() === '' ? next.catalog : shipment.catalog,
            dropShip: sameDropShip(shipment.dropShip) ? { ...next.dropShip } : shipment.dropShip,
          })),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getBulkOrderSoldTos()
      .then((res) => {
        if (cancelled) return
        const options = res.data.length > 0 ? res.data : FALLBACK_SOLD_TOS
        const preferred =
          options.find((option) => option.code === defaults.soldTo) ??
          options.find((option) => option.code === DEFAULT_SOLD_TO) ??
          options[0]
        setSoldToOptions(options)
        setSoldToNote(res.source === 'fallback' ? res.message || 'Showing 23550 - OUTDOOR EQUIPPED only.' : null)
        if (editingIdRef.current) return
        setSoldTo((current) => {
          const code = current.trim()
          const listed = options.some((option) => option.code === code)
          const stillDefault = code === '' || code === DEFAULT_SOLD_TO || code === defaults.soldTo
          if (listed && !stillDefault) return current
          return preferred.code
        })
      })
      .catch(() => {
        if (cancelled) return
        setSoldToOptions(FALLBACK_SOLD_TOS)
        setSoldToNote('Could not load customers. Showing 23550 - OUTDOOR EQUIPPED only.')
      })
    return () => {
      cancelled = true
    }
  }, [open, defaults.soldTo])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getBulkOrderCatalogs()
      .then((res) => {
        if (cancelled) return
        const options = res.data.length > 0 ? res.data : FALLBACK_CATALOGS
        const wanted = defaults.catalog.trim() || DEFAULT_CATALOG
        const preferred =
          options.find((option) => option.name.toLowerCase() === wanted.toLowerCase()) ??
          options.find((option) => option.name.toLowerCase() === DEFAULT_CATALOG.toLowerCase()) ??
          options[0]
        setCatalogOptions(options)
        setCatalogNote(res.source === 'fallback' ? res.message || 'Showing Thorogood Boots only.' : null)
        if (editingIdRef.current) return
        setShipments((current) =>
          current.map((shipment) => {
            const name = shipment.catalog.trim()
            const listed = options.some((option) => option.name === name)
            const stillDefault =
              name === '' ||
              name.toLowerCase() === DEFAULT_CATALOG.toLowerCase() ||
              name.toLowerCase() === defaults.catalog.trim().toLowerCase()
            if (listed && !stillDefault) return shipment
            return name === preferred.name ? shipment : { ...shipment, catalog: preferred.name }
          }),
        )
      })
      .catch(() => {
        if (cancelled) return
        setCatalogOptions(FALLBACK_CATALOGS)
        setCatalogNote('Could not load catalogs. Showing Thorogood Boots only.')
      })
    return () => {
      cancelled = true
    }
  }, [open, defaults.catalog])

  useEffect(() => {
    if (!open) return
    const customer = soldTo.trim()
    if (!/^\d{4,}$/.test(customer)) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      getBulkOrderShipTos(customer)
        .then((res) => {
          if (cancelled) return
          const options = res.data.length > 0 ? res.data : FALLBACK_SHIP_TOS
          const preferred =
            options.find((option) => option.code === defaults.shipToCode) ??
            options.find((option) => option.code === 'NCWH') ??
            options[0]
          setShipToOptions(options)
          setShipToNote(res.source === 'fallback' ? res.message || 'Showing the warehouse address only.' : null)
          setShipToDefault(preferred.label)
          if (editingIdRef.current) return
          const keepLabel = (label: string) => {
            const listed = options.some((option) => option.label === label)
            const untouched = label === DEFAULT_SHIP_TO || label === shipToDefault
            return listed && !untouched
          }
          setShipTo((current) => (keepLabel(current) ? current : preferred.label))
          setShipments((current) =>
            current.map((shipment) =>
              keepLabel(shipment.shipTo) || shipment.shipTo === preferred.label
                ? shipment
                : { ...shipment, shipTo: preferred.label },
            ),
          )
        })
        .catch(() => {
          if (cancelled) return
          setShipToOptions(FALLBACK_SHIP_TOS)
          setShipToNote('Could not load ship-to addresses. Showing the warehouse address.')
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, soldTo, defaults.shipToCode, shipToDefault])

  const updateShipment = (
    id: string,
    patch: Partial<Pick<ShipmentDraft, 'customerPo' | 'useOrderName' | 'shipTo' | 'catalog' | 'useDropShip' | 'requestedShipDate' | 'notes'>>,
  ) => {
    setDirty(true)
    setShipments((current) => current.map((shipment) => (shipment.id === id ? { ...shipment, ...patch } : shipment)))
    setFormError(null)
  }

  const updateDropShip = (id: string, patch: Partial<DropShipAddress>) => {
    setDirty(true)
    setShipments((current) =>
      current.map((shipment) =>
        shipment.id === id ? { ...shipment, dropShip: { ...shipment.dropShip, ...patch } } : shipment,
      ),
    )
    setFormError(null)
  }

  const setShipmentFile = (id: string, file: File | null, fileError: string | null) => {
    setDirty(true)
    setShipments((current) =>
      current.map((shipment) => (shipment.id === id ? { ...shipment, file, fileError } : shipment)),
    )
    setFormError(null)
  }

  const validate = (): { message: string; shipmentId?: string } | null => {
    const name = orderName.trim()
    if (!name) return { message: 'Enter an order name.' }
    if (name.length > MAX_ORDER_NAME) {
      return { message: `Order name cannot be longer than ${MAX_ORDER_NAME} characters.` }
    }
    if (!soldTo.trim()) return { message: 'Enter a sold to.' }
    if (!shipTo.trim()) return { message: 'Enter a ship to.' }
    if (!shipToOptions.some((option) => option.label === shipTo.trim())) return { message: 'Choose a ship to from the list.' }
    if (editingOrderId) return null
    for (let index = 0; index < shipments.length; index += 1) {
      const shipment = shipments[index]
      const label = shipments.length === 1 ? 'Shipment' : `Shipment ${index + 1}`
      const fail = (message: string) => ({ message, shipmentId: shipment.id })
      const customerPo = shipment.useOrderName ? orderName.trim() : shipment.customerPo.trim()
      if (!customerPo) return fail(`${label} needs a customer PO.`)
      if (customerPo.length > MAX_ORDER_NAME) {
        return fail(`${label} customer PO cannot be longer than ${MAX_ORDER_NAME} characters.`)
      }
      if (!shipment.shipTo.trim() || !shipToOptions.some((option) => option.label === shipment.shipTo.trim())) {
        return fail(`${label} needs a ship to from the list.`)
      }
      if (!shipment.catalog.trim()) return fail(`${label} needs a catalog.`)
      if (!shipment.requestedShipDate) return fail(`${label} needs a requested ship date.`)
      if (
        shipment.useDropShip !== false &&
        (!shipment.dropShip.name.trim() || !shipment.dropShip.address.trim() || !shipment.dropShip.postalCode.trim())
      ) {
        return fail(`${label} needs a drop ship name, address, and zip / postal code.`)
      }
      if (shipment.notes.trim().length > 500) return fail(`${label} notes cannot be longer than 500 characters.`)
      if (shipment.fileError) return fail(`${label}: ${shipment.fileError}`)
    }
    return null
  }

  const codeForShipTo = (label: string) => shipToOptions.find((option) => option.label === label.trim())?.code ?? ''
  const codeForCatalog = (name: string) => catalogOptions.find((option) => option.name === name.trim())?.code ?? ''

  const submitOrder = async () => {
    const error = validate()
    if (error) {
      if (error.shipmentId) goToShipment(error.shipmentId)
      setFormError(error.message)
      return
    }
    if (editingShipmentId) {
      leaveShipment()
      return
    }
    if (submitting) return
    setSubmitting(true)
    setImporting(false)
    setFormError(null)
    const body = {
      orderName: orderName.trim(),
      soldToCode: soldTo.trim(),
      shipToCode: codeForShipTo(shipTo),
      shipments: editingOrderId && savedShipments
        ? savedShipments
        : shipments.map((shipment) => ({
        customerPo: (shipment.useOrderName ? orderName : shipment.customerPo).trim(),
        shipToCode: codeForShipTo(shipment.shipTo),
        catalogName: shipment.catalog.trim(),
        catalogCode: codeForCatalog(shipment.catalog),
        useDropShip: shipment.useDropShip !== false,
        dropShip: shipment.useDropShip !== false ? { ...shipment.dropShip } : undefined,
        requestedShipDate: shipment.requestedShipDate,
        notes: shipment.notes.trim(),
      })),
    }
    try {
      const res = editingOrderId ? await updateBulkOrder(editingOrderId, body) : await createBulkOrder(body)
      const importNotes: string[] = []
      if (!editingOrderId) {
        const attached = shipments.some((shipment) => shipment.file)
        if (attached) setImporting(true)
        for (let index = 0; index < shipments.length; index += 1) {
          const file = shipments[index].file
          if (!file) continue
          const label = shipments.length === 1 ? 'Shipment' : `Shipment ${index + 1}`
          try {
            await importBulkOrderItems(res.data.id, index, file)
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Could not import items.'
            importNotes.push(`${label}: ${message}`)
          }
        }
      }
      const notice = [res.warning, importNotes.length ? `Draft created. ${importNotes.join(' ')}` : '']
        .filter(Boolean)
        .join(' ')
      notifyBulkOrdersChanged(notice)
      discard()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create the draft.')
    } finally {
      setSubmitting(false)
      setImporting(false)
    }
  }

  const missing = validate()
  const editingIndex = shipments.findIndex((shipment) => shipment.id === editingShipmentId)
  const editingShipment = editingIndex >= 0 ? shipments[editingIndex] : undefined
  const visibleShipmentId = editingShipmentId ?? (slide?.direction === 'back' ? slide.shipmentId : null)
  const visibleIndex = shipments.findIndex((shipment) => shipment.id === visibleShipmentId)
  const visibleShipment = visibleIndex >= 0 ? shipments[visibleIndex] : undefined
  const showOrder = slide != null || editingShipment == null
  const showShipment = visibleShipment != null && (slide != null || editingShipment != null)
  const frameShipment = visibleShipment ?? shipments[0]

  const endSlide = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    setSlide(null)
  }

  const orderFrame = editingOrderId
    ? 'flex flex-col bg-[var(--bg-100)]'
    : 'hh-drilldown-page absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-[var(--bg-100)]'
  const orderPageClass =
    slide?.direction === 'forward'
      ? `${orderFrame} hh-drilldown-page--exit-forward`
      : slide?.direction === 'back'
        ? `${orderFrame} hh-drilldown-page--enter-back`
        : orderFrame
  const shipmentFrame = `hh-drilldown-page flex flex-col bg-[var(--bg-100)]${showShipment ? '' : ' invisible pointer-events-none'}`
  const shipmentPageClass =
    slide?.direction === 'forward'
      ? `${shipmentFrame} hh-drilldown-page--enter-forward`
      : slide?.direction === 'back'
        ? `${shipmentFrame} hh-drilldown-page--exit-back`
        : shipmentFrame
  const pageButtonClass =
    'inline-flex w-full cursor-pointer items-center justify-center rounded-lg bg-[var(--accent-200)] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]'

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetForm()
          setOpen(true)
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Create
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={requestClose} />
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-create-title"
            className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl"
            onSubmit={(event) => {
              event.preventDefault()
              void submitOrder()
            }}
          >
            <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--accent-200)] bg-[var(--accent-200)] px-6 text-white dark:border-[var(--accent-100)] dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]">
              <nav aria-label="Create order" className="min-w-0">
                <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                  {editingShipment ? (
                    <li className="inline-flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={leaveShipment}
                        className="cursor-pointer truncate text-white/80 hover:text-white hover:underline dark:text-[var(--text-100)]/80 dark:hover:text-[var(--text-100)]"
                      >
                        Order
                      </button>
                      <svg className="h-3.5 w-3.5 shrink-0 text-white/70 dark:text-[var(--text-100)]/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </li>
                  ) : null}
                  <li className="min-w-0">
                    <h3
                      id="bulk-create-title"
                      className="truncate text-base font-semibold text-white dark:text-[var(--text-100)]"
                      aria-current={editingShipment ? 'page' : undefined}
                    >
                      {editingShipment ? `Shipment ${editingIndex + 1}` : editingOrderId ? 'Edit order' : 'Create order'}
                    </h3>
                  </li>
                </ol>
              </nav>
              <button
                type="button"
                onClick={requestClose}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white dark:text-[var(--text-100)]/80 dark:hover:bg-white/10 dark:hover:text-[var(--text-100)]"
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

            <div className="hh-drilldown-viewport relative min-h-0" style={{ gridTemplateRows: 'auto' }}>
              {showOrder ? (
              <div
                className={orderPageClass}
                onAnimationEnd={slide?.direction === 'forward' ? endSlide : undefined}
              >
              <div className="shrink-0 px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={labelClass} htmlFor="bulk-order-name">
                    Order Name
                  </label>
                  <input
                    id="bulk-order-name"
                    className={inputClass}
                    value={orderName}
                    maxLength={MAX_ORDER_NAME}
                    onChange={(event) => {
                      const next = event.target.value
                      setDirty(true)
                      setOrderName(next)
                      if (!editingOrderId) {
                        setShipments((current) =>
                          current.map((shipment) =>
                            shipment.useOrderName ? { ...shipment, customerPo: next } : shipment,
                          ),
                        )
                      }
                      setFormError(null)
                    }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className={hintClass}>Up to {MAX_ORDER_NAME} characters.</p>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass} htmlFor="bulk-sold-to">
                    Sold To
                  </label>
                  <SoldToSelect
                    id="bulk-sold-to"
                    value={soldTo}
                    options={soldToOptions}
                    onChange={(value) => {
                      setDirty(true)
                      setSoldTo(value)
                      setFormError(null)
                    }}
                  />
                  {soldToNote ? <p className={hintClass}>{soldToNote}</p> : null}
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className={labelClass} htmlFor="bulk-ship-to">
                    Ship To
                  </label>
                  <ShipToSelect
                    id="bulk-ship-to"
                    value={shipTo}
                    options={shipToOptions}
                    onChange={(value) => {
                      setDirty(true)
                      setShipTo(value)
                      setFormError(null)
                    }}
                  />
                  {shipToNote ? <p className={hintClass}>{shipToNote}</p> : null}
                </div>
              </div>
              {editingOrderId ? (
                <p className={`${hintClass} mt-4`}>
                  Shipments stay as they are. Add or change them from this order’s Shipments table.
                </p>
              ) : null}
              </div>

              {editingOrderId ? null : (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto border-t border-[var(--accent-200)] px-6 py-5 dark:border-[var(--accent-100)]">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-[var(--text-100)]">Shipments</h4>
                {shipments.map((shipment, index) => (
                  <div key={shipment.id} className="flex items-center gap-2 rounded-xl border border-[var(--bg-300)] pr-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-200)]"
                      onClick={() => goToShipment(shipment.id)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-700 dark:text-[var(--text-100)]">
                          Shipment {index + 1}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-[var(--text-200)]">
                          {shipmentSummary(shipment)}
                        </span>
                      </span>
                      <svg
                        className="h-4 w-4 shrink-0 text-slate-400 dark:text-[var(--text-200)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    {shipments.length > 1 ? (
                      <button
                        type="button"
                        className="cursor-pointer text-xs font-medium text-slate-500 hover:text-red-600 dark:text-[var(--text-200)] dark:hover:text-red-400"
                        onClick={() => {
                          setDirty(true)
                          setShipments((current) => current.filter((row) => row.id !== shipment.id))
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-[var(--bg-300)] px-4 py-3 text-left text-sm font-medium text-slate-500 transition-colors hover:border-[var(--accent-200)] hover:text-[var(--accent-200)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-200)] dark:text-[var(--text-200)] dark:hover:border-[var(--accent-100)] dark:hover:text-[var(--accent-200)]"
                  onClick={() => {
                    const next = blankShipment(defaults.catalog, orderName, shipToDefault, defaults.dropShip)
                    setDirty(true)
                    setShipments((current) => [...current, next])
                    goToShipment(next.id)
                  }}
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add shipment
                </button>
              </div>
              )}
              <div className="shrink-0 space-y-2 border-t border-[var(--accent-200)] dark:border-[var(--accent-100)] px-6 py-4">
                {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}
                <button
                  type="submit"
                  disabled={missing != null || submitting}
                  title={missing?.message}
                  className={pageButtonClass}
                >
                  {submitting ? (editingOrderId ? 'Saving draft…' : importing ? 'Importing items…' : 'Creating draft…') : editingOrderId ? 'Save' : 'Create'}
                </button>
              </div>
              </div>
              ) : null}
              {!editingOrderId && frameShipment ? (
              <div
                className={shipmentPageClass}
                aria-hidden={showShipment ? undefined : true}
                inert={showShipment ? undefined : true}
                onAnimationEnd={slide?.direction === 'back' ? endSlide : undefined}
              >
              <div className="space-y-4 px-6 py-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <label className={labelClass} htmlFor={`${frameShipment.id}-po`}>
                            Customer PO
                          </label>
                          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-[var(--text-200)]">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-[var(--accent-200)]"
                              checked={frameShipment.useOrderName}
                              onChange={(event) => {
                                const useOrderName = event.target.checked
                                updateShipment(frameShipment.id, {
                                  useOrderName,
                                  customerPo: useOrderName ? orderName : frameShipment.customerPo,
                                })
                              }}
                            />
                            Use Order Name
                          </label>
                        </div>
                        <span
                          className={frameShipment.useOrderName ? 'block cursor-not-allowed' : 'block'}
                          title={frameShipment.useOrderName ? 'Uncheck to edit.' : undefined}
                        >
                          <input
                            id={`${frameShipment.id}-po`}
                            className={`${inputClass} disabled:!cursor-not-allowed`}
                            value={frameShipment.useOrderName ? orderName : frameShipment.customerPo}
                            maxLength={MAX_ORDER_NAME}
                            disabled={frameShipment.useOrderName}
                            onChange={(event) =>
                              updateShipment(frameShipment.id, { customerPo: event.target.value, useOrderName: false })
                            }
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        <label className={labelClass} htmlFor={`${frameShipment.id}-catalog`}>
                          Catalog
                        </label>
                        <CatalogSelect
                          id={`${frameShipment.id}-catalog`}
                          value={frameShipment.catalog}
                          options={catalogOptions}
                          onChange={(value) => updateShipment(frameShipment.id, { catalog: value })}
                        />
                        {catalogNote ? <p className={hintClass}>{catalogNote}</p> : null}
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className={labelClass} htmlFor={`${frameShipment.id}-ship-to`}>
                          Ship To
                        </label>
                        <ShipToSelect
                          id={`${frameShipment.id}-ship-to`}
                          value={frameShipment.shipTo}
                          options={shipToOptions}
                          onChange={(value) => updateShipment(frameShipment.id, { shipTo: value })}
                        />
                      </div>
                    </div>
                    <div className="border-t border-[var(--accent-200)] dark:border-[var(--accent-100)] pt-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className={labelClass}>Drop Ship Address</p>
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-[var(--text-200)]">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-[var(--accent-200)]"
                            checked={frameShipment.useDropShip !== false}
                            onChange={(event) => updateShipment(frameShipment.id, { useDropShip: event.target.checked })}
                          />
                          Use Drop Ship Address
                        </label>
                      </div>
                      <p className={`${hintClass} mt-3`}>Drop ship is available for North America only.</p>
                      <SlidingPanel open={frameShipment.useDropShip !== false}>
                          <div className="grid gap-4 pt-3 sm:grid-cols-9">
                            <div className="space-y-1.5 sm:col-span-3">
                              <label className={labelClass} htmlFor={`${frameShipment.id}-drop-name`}>
                                Name
                              </label>
                              <input
                                id={`${frameShipment.id}-drop-name`}
                                className={inputClass}
                                value={frameShipment.dropShip.name}
                                onChange={(event) => updateDropShip(frameShipment.id, { name: event.target.value })}
                                autoComplete="off"
                              />
                            </div>
                            <div className="space-y-1.5 sm:col-span-4">
                              <label className={labelClass} htmlFor={`${frameShipment.id}-drop-address`}>
                                Address
                              </label>
                              <input
                                id={`${frameShipment.id}-drop-address`}
                                className={inputClass}
                                value={frameShipment.dropShip.address}
                                onChange={(event) => updateDropShip(frameShipment.id, { address: event.target.value })}
                                autoComplete="off"
                              />
                            </div>
                            <div className="space-y-1.5 sm:col-span-2">
                              <label className={labelClass} htmlFor={`${frameShipment.id}-drop-postal`}>
                                Zip / Postal Code
                              </label>
                              <input
                                id={`${frameShipment.id}-drop-postal`}
                                className={inputClass}
                                value={frameShipment.dropShip.postalCode}
                                onChange={(event) => updateDropShip(frameShipment.id, { postalCode: event.target.value })}
                                autoComplete="off"
                                spellCheck={false}
                              />
                            </div>
                          </div>
                      </SlidingPanel>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <label className={labelClass} htmlFor={`${frameShipment.id}-ship-date`}>
                          Requested Ship Date
                        </label>
                        <input
                          id={`${frameShipment.id}-ship-date`}
                          type="date"
                          className={`${inputClass} cursor-pointer dark:[color-scheme:dark]`}
                          value={frameShipment.requestedShipDate}
                          onChange={(event) => updateShipment(frameShipment.id, { requestedShipDate: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className={labelClass} htmlFor={`${frameShipment.id}-notes`}>
                          Notes
                        </label>
                        <input
                          id={`${frameShipment.id}-notes`}
                          className={inputClass}
                          value={frameShipment.notes}
                          maxLength={500}
                          placeholder="This message is viewable and editable by all users."
                          onChange={(event) => updateShipment(frameShipment.id, { notes: event.target.value })}
                          autoComplete="off"
                        />
                      </div>
                    </div>
                    <BulkItemFileField
                      inputId={`${frameShipment.id}-file`}
                      file={frameShipment.file}
                      error={frameShipment.fileError}
                      onFile={(file, fileError) => setShipmentFile(frameShipment.id, file, fileError)}
                    />
                    {shipments.length > 1 ? (
                      <button
                        type="button"
                        className="cursor-pointer text-xs font-medium text-slate-500 hover:text-red-600 dark:text-[var(--text-200)] dark:hover:text-red-400"
                        onClick={() => {
                          setDirty(true)
                          setShipments((current) => current.filter((row) => row.id !== frameShipment.id))
                          setSlide(null)
                          setEditingShipmentId(null)
                        }}
                      >
                        Remove shipment
                      </button>
                    ) : null}
              </div>
              <div className="shrink-0 space-y-2 border-t border-[var(--accent-200)] dark:border-[var(--accent-100)] px-6 py-4">
                {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}
                <button type="button" onClick={leaveShipment} className={pageButtonClass}>
                  {editingOrderId ? '🡨 Back to Edit Order' : '🡨 Back to Create Order'}
                </button>
              </div>
              </div>
              ) : null}
            </div>
          </form>
        </div>
      )}
    </>
  )
}
