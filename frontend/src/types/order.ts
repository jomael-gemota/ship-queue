export type OrderStatus =
  | 'awaiting_payment'
  | 'awaiting_shipment'
  | 'pending_fulfillment'
  | 'shipped'
  | 'on_hold'
  | 'cancelled'
  | 'rejected_fulfillment'

export const ORDER_STATUSES: OrderStatus[] = [
  'awaiting_payment',
  'awaiting_shipment',
  'pending_fulfillment',
  'shipped',
  'on_hold',
  'cancelled',
  'rejected_fulfillment',
]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: 'Awaiting Payment',
  awaiting_shipment: 'Awaiting Shipment',
  pending_fulfillment: 'Pending Fulfillment',
  shipped: 'Shipped',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
  rejected_fulfillment: 'Rejected Fulfillment',
}

export interface OrderAddress {
  name?: string
  company?: string
  street1?: string
  street2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  phone?: string
  residential?: boolean
  addressVerified?: string
}

export interface OrderItem {
  orderItemId?: number
  lineItemKey?: string
  sku?: string
  name?: string
  imageUrl?: string
  quantity?: number
  unitPrice?: number
  taxAmount?: number
  upc?: string
  weight?: { value?: number; units?: string }
  productId?: number
}

export interface Order {
  _id: string
  orderId: number
  orderNumber: string
  orderKey?: string
  orderDate: string
  createDate?: string
  modifyDate?: string
  paymentDate?: string
  shipByDate?: string
  orderStatus: OrderStatus
  customerId?: number
  customerUsername?: string
  customerEmail?: string
  billTo?: OrderAddress
  shipTo?: OrderAddress
  items?: OrderItem[]
  itemCount?: number
  orderTotal?: number
  amountPaid?: number
  taxAmount?: number
  shippingAmount?: number
  customerNotes?: string
  internalNotes?: string
  gift?: boolean
  paymentMethod?: string
  requestedShippingService?: string
  carrierCode?: string
  serviceCode?: string
  shipDate?: string
  storeId?: number
  source?: string
  lastSyncedAt?: string
}

export interface OrdersResponse {
  data: Order[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pages: number
  }
}

export interface OrderItemsResponse {
  data: OrderItem[]
}

export interface SyncProgress {
  page: number
  totalPages: number
  synced: number
  total: number
}

export interface SyncState {
  running: boolean
  startedAt: string | null
  completedAt: string | null
  progress: SyncProgress
  error: string | null
  result: {
    fetched: number
    inserted: number
    updated: number
    total: number
    pages: number
    isIncremental: boolean
  } | null
  lastSyncedAt?: string | null
}

export interface SyncStatusResponse {
  data: SyncState & { lastSyncedAt: string | null }
}

/** Global background order-sync configuration (admin-managed). */
export interface SyncConfig {
  enabled: boolean
  intervalMs: number
}

export interface SyncConfigResponse {
  data: SyncConfig
}

export interface SyncResponse {
  message: string
  data: SyncState
}
