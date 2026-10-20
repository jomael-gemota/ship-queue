import { authApi } from './api'

export interface BulkOrderShipment {
  customerPo: string
  shipToCode: string
  shipToLabel: string
  catalogCode: string
  catalogName: string
  useDropShip: boolean
  dropShipName: string
  dropShipAddress: string
  dropShipPostalCode: string
  requestedShipDate: string
  notes: string
  /** SKUs last copied from the Thorogood draft. */
  items?: BulkOrderLineItem[]
}

export interface BulkOrderRow {
  id: string
  orderName: string
  status: 'draft'
  soldToCode: string
  soldToLabel: string
  shipToCode: string
  shipToLabel: string
  portalOrderCode: string
  shipments: BulkOrderShipment[]
  createdAt: string
  createdByName: string
  createdByEmail: string
  createdByAvatar: string
}

export interface BulkOrderCreateShipment {
  customerPo: string
  shipToCode: string
  catalogName: string
  catalogCode?: string
  useDropShip: boolean
  dropShip?: { name: string; address: string; postalCode: string }
  requestedShipDate: string
  notes: string
  /** Portal shipment to keep line items from when this row moves. */
  sourceIndex?: number
}

export function bulkShipmentPayload(shipment: BulkOrderShipment, sourceIndex?: number): BulkOrderCreateShipment {
  return {
    customerPo: shipment.customerPo,
    shipToCode: shipment.shipToCode,
    catalogName: shipment.catalogName,
    catalogCode: shipment.catalogCode,
    useDropShip: shipment.useDropShip,
    dropShip: shipment.useDropShip
      ? {
          name: shipment.dropShipName,
          address: shipment.dropShipAddress,
          postalCode: shipment.dropShipPostalCode,
        }
      : undefined,
    requestedShipDate: shipment.requestedShipDate,
    notes: shipment.notes,
    ...(sourceIndex == null ? {} : { sourceIndex }),
  }
}

export interface BulkOrderCreateBody {
  orderName: string
  soldToCode: string
  shipToCode: string
  shipments: BulkOrderCreateShipment[]
}

const ORDERS_PATH = '/bulk-order/thorogood/orders'
const CREATED_EVENT = 'sq-bulk-order-created'
const EDIT_EVENT = 'sq-bulk-order-edit'

export interface BulkOrderLineItem {
  sku: string
  /** Seller Central code from the upload. Empty when the file only had a B2B SKU. */
  sellerSku?: string
  quantity: number
  name?: string
  price?: number | null
  currencyCode?: string
  imageResource?: string
  /** Saved thumbnail. Present when the image was stored with the order. */
  imageDataUrl?: string
  styleCode?: string
  size?: string
  width?: string
}

export interface BulkOrderItems {
  orderName: string
  shipmentIndex: number
  shipment: BulkOrderShipment
  items: BulkOrderLineItem[]
  message?: string
}

export function listBulkOrders() {
  return authApi.get<{ data: BulkOrderRow[] }>(ORDERS_PATH)
}

export function getBulkOrder(id: string) {
  return authApi.get<{ data: BulkOrderRow }>(`${ORDERS_PATH}/${id}`)
}

export function getBulkOrderItems(orderId: string, shipmentIndex: number) {
  return authApi.get<{ data: BulkOrderItems }>(`${ORDERS_PATH}/${orderId}/shipments/${shipmentIndex}/items`)
}

export interface BulkImportReadyLine {
  sellerSku: string
  portalSku: string
  quantity: number
}

export interface BulkImportIssue {
  sellerSku: string
  portalSku: string
  quantity: number
  tried: string[]
  message: string
}

export function importBulkOrderItems(orderId: string, shipmentIndex: number, file: File) {
  const body = new FormData()
  body.append('file', file)
  return authApi.postForm<{ data: BulkOrderItems }>(`${ORDERS_PATH}/${orderId}/shipments/${shipmentIndex}/items`, body)
}

export function previewBulkOrderItems(orderId: string, shipmentIndex: number, file: File) {
  const body = new FormData()
  body.append('file', file)
  return authApi.postForm<{ data: { ready: BulkImportReadyLine[]; issues: BulkImportIssue[] } }>(
    `${ORDERS_PATH}/${orderId}/shipments/${shipmentIndex}/items/preview`,
    body,
  )
}

export function checkBulkOrderItem(orderId: string, shipmentIndex: number, portalSku: string) {
  return authApi.post<{ data: { portalSku: string } }>(`${ORDERS_PATH}/${orderId}/shipments/${shipmentIndex}/items/check`, {
    portalSku,
  })
}

export function commitBulkOrderItems(orderId: string, shipmentIndex: number, items: BulkImportReadyLine[]) {
  return authApi.post<{ data: BulkOrderItems }>(`${ORDERS_PATH}/${orderId}/shipments/${shipmentIndex}/items/commit`, {
    items,
  })
}

export function createBulkOrder(body: BulkOrderCreateBody) {
  return authApi.post<{ data: BulkOrderRow; warning?: string }>(ORDERS_PATH, body)
}

export function updateBulkOrder(id: string, body: BulkOrderCreateBody) {
  return authApi.patch<{ data: BulkOrderRow; warning?: string }>(`${ORDERS_PATH}/${id}`, body)
}

export function deleteBulkOrder(id: string) {
  return authApi.delete<{ data: { deleted: boolean } }>(`${ORDERS_PATH}/${id}`)
}

export function requestBulkOrderEdit(order: BulkOrderRow) {
  window.dispatchEvent(new CustomEvent(EDIT_EVENT, { detail: order }))
}

export function subscribeBulkOrderEdit(listener: (order: BulkOrderRow) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<BulkOrderRow>).detail
    if (detail?.id) listener(detail)
  }
  window.addEventListener(EDIT_EVENT, handler)
  return () => window.removeEventListener(EDIT_EVENT, handler)
}

export function notifyBulkOrdersChanged(notice = '') {
  window.dispatchEvent(new CustomEvent(CREATED_EVENT, { detail: { notice } }))
}

export function subscribeBulkOrdersChanged(listener: (notice: string) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ notice?: string }>).detail
    listener(detail?.notice ?? '')
  }
  window.addEventListener(CREATED_EVENT, handler)
  return () => window.removeEventListener(CREATED_EVENT, handler)
}
