import { authApi } from './api'

export type HHDetailsStatus = 'pending' | 'synced' | 'failed'
export type HHCartStatus = 'none' | 'draft' | 'ready' | 'review' | 'placed'

export const HH_DETAILS_STATUSES: HHDetailsStatus[] = ['pending', 'synced', 'failed']
export const HH_CART_STATUSES: HHCartStatus[] = ['none', 'draft', 'ready', 'review', 'placed']

export const HH_DETAILS_STATUS_LABELS: Record<HHDetailsStatus, string> = {
  pending: 'Pending',
  synced: 'Synced',
  failed: 'Failed',
}

export const HH_CART_STATUS_LABELS: Record<HHCartStatus, string> = {
  none: 'None',
  draft: 'Draft',
  ready: 'Ready',
  review: 'Review',
  placed: 'Placed',
}

export function hhDetailsStatusLabel(status: string): string {
  return HH_DETAILS_STATUS_LABELS[status as HHDetailsStatus] ?? status
}

export function hhCartStatusLabel(status: string): string {
  if (status === 'none') return '—'
  return HH_CART_STATUS_LABELS[status as HHCartStatus] ?? status
}

export function hhFilterSummary(detailsStatus: HHDetailsStatus | '', cartStatus: HHCartStatus | ''): string {
  const parts: string[] = []
  if (detailsStatus) parts.push(`details "${HH_DETAILS_STATUS_LABELS[detailsStatus]}"`)
  if (cartStatus) parts.push(`cart "${HH_CART_STATUS_LABELS[cartStatus]}"`)
  return parts.join(' and ')
}

export interface HHLineItem {
  id: string
  title: string
  sku: string
  asin: string
  imageUrl: string
  quantity: number
  unitPrice: number
  tax: number
}

export interface HHChildOrder {
  id: string
  orderId: string
  po: string
  referenceNumber: string
  customerName: string
  customerEmail: string
  customerPhone: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  notes: string
  detailsStatus: HHDetailsStatus
  cartStatus: HHCartStatus
  items: HHLineItem[]
}

export interface HHOrderGroup {
  id: string
  createdAt: string
  createdByName: string
  createdByEmail: string
  notes: string
  sourceFileName: string
  detailsStatus: HHDetailsStatus
  cartStatus: HHCartStatus
  children: HHChildOrder[]
}

export interface HHImportMeta {
  orderCount: number
  duplicateRowsSkipped: number
  incompleteRowsSkipped: number
}

export function listHHGroups() {
  return authApi.get<{ data: HHOrderGroup[] }>('/hh-sportswear')
}

export interface HHScSyncStatus {
  running: boolean
  currentGroupId: string | null
  currentOrderId: string | null
  queuedGroups: number
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  lastRun: { synced: number; flagged: number; failed: number } | null
  pendingUnsynced: number
}

export function getHHScSyncStatus() {
  return authApi.get<{ data: HHScSyncStatus }>('/hh-sportswear/sc-sync')
}

export function importHHSpreadsheet(input: File | { text: string }) {
  const body = new FormData()
  if (input instanceof File) body.append('file', input)
  else body.append('text', input.text)
  return authApi.postForm<{ data: HHOrderGroup; meta: HHImportMeta }>('/hh-sportswear/import', body)
}

export function rerunHHGroupScSync(groupId: string) {
  return authApi.post<{ data: HHOrderGroup }>(`/hh-sportswear/${groupId}/sc-sync`)
}

export function rerunHHOrderScSync(groupId: string, orderId: string) {
  return authApi.post<{ data: HHOrderGroup }>(`/hh-sportswear/${groupId}/orders/${orderId}/sc-sync`)
}

export function updateHHGroupNotes(id: string, notes: string) {
  return authApi.patch<{ data: HHOrderGroup }>(`/hh-sportswear/${id}`, { notes })
}

export function updateHHOrderNotes(groupId: string, orderId: string, notes: string) {
  return authApi.patch<{ data: HHOrderGroup }>(`/hh-sportswear/${groupId}/orders/${orderId}`, { notes })
}

export function deleteHHGroup(id: string) {
  return authApi.delete<{ data: { deleted: boolean } }>(`/hh-sportswear/${id}`)
}

export function deleteHHOrder(groupId: string, orderId: string) {
  return authApi.delete<{ data: { deleted: boolean } }>(`/hh-sportswear/${groupId}/orders/${orderId}`)
}

export function downloadHHImportTemplate() {
  const csv = 'PO Number,Order ID\n100001,111-0000000-0000000\n'
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'hh-sportswear-import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

export const HH_MISSING = '-'

export function hhOrDash(value: string | null | undefined): string {
  if (value == null) return HH_MISSING
  const trimmed = String(value).trim()
  return trimmed || HH_MISSING
}

export function composeCityStatePostal(city: string, state: string, postalCode: string): string {
  const cityState = [city, state].filter(Boolean).join(', ')
  return [cityState, postalCode].filter(Boolean).join(' ')
}

export function formatHhLocalityLine(
  city: string | null | undefined,
  state: string | null | undefined,
  postalCode: string | null | undefined,
): string {
  const cityText = (city ?? '').trim()
  const stateText = (state ?? '').trim()
  const postalText = (postalCode ?? '').trim()
  if (!cityText && !stateText && !postalText) return HH_MISSING
  return `${hhOrDash(cityText)}, ${hhOrDash(stateText)} ${hhOrDash(postalText)}`
}

export function formatHhAddressLines(order: Pick<
  HHChildOrder,
  'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode' | 'country'
>): string[] {
  const lines: string[] = []
  if (order.addressLine1) lines.push(order.addressLine1)
  if (order.addressLine2) lines.push(order.addressLine2)
  const locality = composeCityStatePostal(order.city, order.state, order.postalCode)
  const alreadyShown = lines.some((line) => line.replace(/\s+/g, ' ') === locality)
  if (locality && !alreadyShown) lines.push(locality)
  if (order.country) lines.push(order.country)
  return lines
}

export function hhItemSubtotal(item: Pick<HHLineItem, 'quantity' | 'unitPrice'>): number {
  return item.quantity * item.unitPrice
}

export function hhItemTax(item: Pick<HHLineItem, 'tax'>): number {
  return item.tax ?? 0
}

export function hhItemTotal(item: Pick<HHLineItem, 'quantity' | 'unitPrice' | 'tax'>): number {
  return hhItemSubtotal(item) + hhItemTax(item)
}

export function hhOrderHasAddress(order: Pick<
  HHChildOrder,
  'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode'
>): boolean {
  return Boolean(order.addressLine1 || order.addressLine2 || order.city || order.state || order.postalCode)
}

export function formatHhCompactAddress(order: Pick<
  HHChildOrder,
  'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode' | 'country'
>): string {
  const lines = formatHhAddressLines(order)
  const withoutDefaultCountry = order.country === 'US' ? lines.filter((line) => line !== order.country) : lines
  return withoutDefaultCountry.join(', ')
}

export function isAmazonMarketplaceEmail(email: string): boolean {
  return /@marketplace\.amazon\./i.test(email.trim())
}

export function hhBuyerContact(
  order: Pick<HHChildOrder, 'customerEmail' | 'customerPhone'>,
): string {
  const email = order.customerEmail.trim()
  if (email && !isAmazonMarketplaceEmail(email)) return email
  return order.customerPhone.trim()
}

export function formatHhBuyerInfo(
  order: Pick<HHChildOrder, 'customerName' | 'addressLine1' | 'city' | 'state' | 'postalCode'>,
): { name: string; line1: string; locality: string } {
  const locality = formatHhLocalityLine(order.city, order.state, order.postalCode)
  const rawLine1 = (order.addressLine1 ?? '').trim()
  const compactLocality = composeCityStatePostal(
    (order.city ?? '').trim(),
    (order.state ?? '').trim(),
    (order.postalCode ?? '').trim(),
  )
  const line1LooksLikeLocality =
    Boolean(compactLocality) && rawLine1.replace(/\s+/g, ' ') === compactLocality
  return {
    name: hhOrDash(order.customerName),
    line1: !rawLine1 || line1LooksLikeLocality ? HH_MISSING : rawLine1,
    locality,
  }
}

function includesQuery(value: string | number | undefined, query: string): boolean {
  return String(value ?? '').toLowerCase().includes(query)
}

export function hhItemMatchesQuery(item: HHLineItem, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true
  return (
    includesQuery(item.title, query) ||
    includesQuery(item.sku, query) ||
    includesQuery(item.asin, query) ||
    includesQuery(item.quantity, query) ||
    includesQuery(item.unitPrice, query) ||
    includesQuery(item.tax, query)
  )
}

export function hhOrderMatchesQuery(order: HHChildOrder, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true
  if (
    includesQuery(order.orderId, query) ||
    includesQuery(order.po, query) ||
    includesQuery(order.referenceNumber, query) ||
    includesQuery(order.customerName, query) ||
    includesQuery(order.customerEmail, query) ||
    includesQuery(order.customerPhone, query) ||
    includesQuery(order.addressLine1, query) ||
    includesQuery(order.addressLine2, query) ||
    includesQuery(order.city, query) ||
    includesQuery(order.state, query) ||
    includesQuery(order.postalCode, query) ||
    includesQuery(order.country, query) ||
    includesQuery(order.notes, query) ||
    includesQuery(hhDetailsStatusLabel(order.detailsStatus), query) ||
    includesQuery(hhCartStatusLabel(order.cartStatus), query)
  ) {
    return true
  }
  return order.items.some((item) => hhItemMatchesQuery(item, rawQuery))
}

export function hhGroupMatchesQuery(group: HHOrderGroup, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  if (
    includesQuery(group.createdByName, query) ||
    includesQuery(group.createdByEmail, query) ||
    includesQuery(group.notes, query) ||
    includesQuery(group.sourceFileName, query) ||
    includesQuery(hhDetailsStatusLabel(group.detailsStatus), query) ||
    includesQuery(hhCartStatusLabel(group.cartStatus), query) ||
    includesQuery(formatCreatedAt(group.createdAt), query)
  ) {
    return true
  }

  return group.children.some((order) => hhOrderMatchesQuery(order, rawQuery))
}
