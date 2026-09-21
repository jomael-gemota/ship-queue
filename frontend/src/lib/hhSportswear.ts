import { hhApiPath, type HHBrandId } from './hhBrand'
import { authApi } from './api'

function hhPath(brand: HHBrandId, rest = '') {
  return hhApiPath(brand, rest)
}

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

export function hhCartCanVerify(status: HHCartStatus): boolean {
  return status === 'draft' || status === 'ready' || status === 'review'
}

export function hhOrderVerifiedResult(
  order: Pick<HHChildOrder, 'cartStatus' | 'verifyIssues'>,
): 'match' | 'review' | null {
  if (order.cartStatus === 'ready') return 'match'
  if (order.cartStatus === 'review') return 'review'
  if (order.cartStatus === 'placed') {
    return (order.verifyIssues ?? []).length > 0 ? 'review' : 'match'
  }
  return null
}

export function hhHasSyncedDetails(orders: Array<Pick<HHChildOrder, 'detailsStatus'>>): boolean {
  return orders.some((order) => order.detailsStatus === 'synced')
}

export function hhHasCartDraft(orders: Array<Pick<HHChildOrder, 'cartStatus'>>): boolean {
  return orders.some((order) => order.cartStatus !== 'none')
}

export function hhOrderDetailsTitle(order: Pick<HHChildOrder, 'detailsStatus' | 'cartStatus'>): string {
  if (order.cartStatus === 'placed') return 'Placed orders cannot be re-synced'
  return order.detailsStatus === 'synced' ? 'Re-sync details for this order' : 'Sync details for this order'
}

export function hhGroupDetailsTitle(
  orders: Array<Pick<HHChildOrder, 'detailsStatus' | 'cartStatus'>>,
): string {
  if (orders.length > 0 && orders.every((order) => order.cartStatus === 'placed')) {
    return 'Placed orders cannot be re-synced'
  }
  return hhHasSyncedDetails(orders) ? 'Re-sync details for this batch' : 'Sync details for this batch'
}

export function hhOrderCanPlace(order: Pick<HHChildOrder, 'cartStatus'>): boolean {
  return order.cartStatus === 'ready'
}

export function hhOrderCanDraft(
  order: Pick<HHChildOrder, 'detailsStatus' | 'cartStatus' | 'items'>,
): boolean {
  if (order.cartStatus === 'placed') return false
  if (order.detailsStatus !== 'synced') return false
  return order.items.length > 0
}

export function hhOrderWaitingForCart(
  order: Pick<HHChildOrder, 'detailsStatus' | 'cartStatus' | 'items'>,
): boolean {
  return order.cartStatus === 'none' && hhOrderCanDraft(order)
}

export function hhWaitingForCartCount(
  orders: Array<Pick<HHChildOrder, 'detailsStatus' | 'cartStatus' | 'items'>>,
): number {
  return orders.filter(hhOrderWaitingForCart).length
}

export function hhDraftableOrders(
  orders: Array<Pick<HHChildOrder, 'detailsStatus' | 'cartStatus' | 'items'>>,
) {
  return orders.filter(hhOrderCanDraft)
}

export function hhOrderDraftTitle(order: Pick<HHChildOrder, 'detailsStatus' | 'cartStatus' | 'items'>): string {
  if (order.cartStatus === 'placed') return 'Placed orders cannot have their cart regenerated'
  if (!hhOrderCanDraft(order)) return 'Cart draft needs synced order details'
  return order.cartStatus === 'none' ? 'Draft B2B cart for this order' : 'Regenerate B2B draft for this order'
}

export function hhGroupDraftTitle(
  orders: Array<Pick<HHChildOrder, 'detailsStatus' | 'cartStatus' | 'items'>>,
): string {
  if (orders.length > 0 && orders.every((order) => order.cartStatus === 'placed')) {
    return 'Placed orders cannot have their cart regenerated'
  }
  if (hhDraftableOrders(orders).length === 0) return 'Cart draft needs synced order details'
  return hhHasCartDraft(orders) ? 'Regenerate B2B draft for this batch' : 'Draft B2B cart for this batch'
}

export function hhPlaceableOrders<T extends Pick<HHChildOrder, 'cartStatus'>>(orders: T[]): T[] {
  return orders.filter(hhOrderCanPlace)
}

export type HHPlaceSkipReason = Exclude<HHCartStatus, 'ready'>

export const HH_PLACE_SKIP_LABELS: Record<HHPlaceSkipReason, string> = {
  none: 'No cart',
  draft: 'Draft',
  review: 'Mismatch',
  placed: 'Already placed',
}

const HH_PLACE_SKIP_ORDER: HHPlaceSkipReason[] = ['review', 'draft', 'none', 'placed']

export function hhPlaceSkipReason(status: HHCartStatus): HHPlaceSkipReason | null {
  return status === 'ready' ? null : status
}

export function hhPlacePlan<T extends Pick<HHChildOrder, 'orderId' | 'cartStatus'>>(orders: T[]) {
  const placing = orders.filter(hhOrderCanPlace)
  const skipped = orders.flatMap((order) => {
    const reason = hhPlaceSkipReason(order.cartStatus)
    return reason ? [{ orderId: order.orderId, reason }] : []
  })
  const skipGroups = HH_PLACE_SKIP_ORDER.flatMap((reason) => {
    const ids = skipped.filter((row) => row.reason === reason).map((row) => row.orderId)
    return ids.length > 0 ? [{ reason, label: HH_PLACE_SKIP_LABELS[reason], ids }] : []
  })
  return {
    placing,
    placingIds: placing.map((order) => order.orderId),
    skipped,
    skipGroups,
    total: orders.length,
  }
}

export function hhPlaceActionTitle(enabled: boolean): string {
  return enabled
    ? 'Place matching orders on Helly Hansen'
    : 'Place Order is off in Configurations — re-checks the live cart only'
}

export function hhCartIsPlaced(status: HHCartStatus): boolean {
  return status === 'placed'
}

export function hhOrderIsLocked(order: Pick<HHChildOrder, 'cartStatus'>): boolean {
  return hhCartIsPlaced(order.cartStatus)
}

export function hhGroupHasPlaced(group: Pick<HHOrderGroup, 'children'>): boolean {
  return group.children.some((order) => hhCartIsPlaced(order.cartStatus))
}

export function hhGroupAllPlaced(group: Pick<HHOrderGroup, 'children'>): boolean {
  return group.children.length > 0 && group.children.every((order) => hhCartIsPlaced(order.cartStatus))
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

export interface HHVerifyIssue {
  field: string
  label: string
  expected: string
  actual: string
}

export interface HHCompareRow {
  field: string
  label: string
  expected: string
  actual: string
  match: boolean
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
  placeError: string
  verifyIssues: HHVerifyIssue[]
  verifyRows?: HHCompareRow[]
  verifiedAt: string | null
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

export const HH_DETAILS_COUNT_ORDER: HHDetailsStatus[] = ['synced', 'pending', 'failed']
export const HH_CART_COUNT_ORDER: HHCartStatus[] = ['placed', 'ready', 'review', 'draft', 'none']

export function hhDetailsCounts(orders: Array<Pick<HHChildOrder, 'detailsStatus'>>): Record<HHDetailsStatus, number> {
  const counts: Record<HHDetailsStatus, number> = { pending: 0, synced: 0, failed: 0 }
  for (const order of orders) counts[order.detailsStatus] += 1
  return counts
}

export function hhCartCounts(orders: Array<Pick<HHChildOrder, 'cartStatus'>>): Record<HHCartStatus, number> {
  const counts: Record<HHCartStatus, number> = { none: 0, draft: 0, ready: 0, review: 0, placed: 0 }
  for (const order of orders) counts[order.cartStatus] += 1
  return counts
}

export interface HHVerifySnapshot {
  name: string
  address1: string
  address2: string
  city: string
  state: string
  zip: string
  country: string
  po: string
  orderNumber: string
  items: Array<{ sku: string; quantity: number }>
}

export interface HHCartCompareOrder {
  id: string
  orderId: string
  cartStatus: HHCartStatus
  skipped?: string
  error?: string
  rows: HHCompareRow[]
  details: HHVerifySnapshot
  cart: HHVerifySnapshot | null
  canPlace: boolean
  verifiedAt: string | null
}

export function emptyHHVerifySnapshot(): HHVerifySnapshot {
  return {
    name: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    po: '',
    orderNumber: '',
    items: [],
  }
}

export function hhStoredCartCompare(order: HHChildOrder): HHCartCompareOrder {
  const verified = hhOrderVerifiedResult(order)
  const rows =
    order.verifyRows && order.verifyRows.length > 0
      ? order.verifyRows
      : (order.verifyIssues ?? []).map((issue) => ({ ...issue, match: false }))
  if (!verified) {
    return {
      id: order.id,
      orderId: order.orderId,
      cartStatus: order.cartStatus,
      skipped: order.cartStatus === 'none' ? 'No B2B cart' : 'Not checked yet',
      rows: [],
      details: emptyHHVerifySnapshot(),
      cart: null,
      canPlace: false,
      verifiedAt: order.verifiedAt,
    }
  }
  return {
    id: order.id,
    orderId: order.orderId,
    cartStatus: order.cartStatus,
    rows,
    details: emptyHHVerifySnapshot(),
    cart: null,
    canPlace: hhOrderCanPlace(order),
    verifiedAt: order.verifiedAt,
  }
}

export interface HHImportMeta {
  orderCount: number
  duplicateRowsSkipped: number
  incompleteRowsSkipped: number
}

export function listHHGroups(brand: HHBrandId) {
  return authApi.get<{ data: HHOrderGroup[] }>(hhPath(brand))
}

export interface HHCartDraftStatus {
  running: boolean
  currentGroupId: string | null
  currentOrderId: string | null
  queued: number
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  lastRun: { drafted: number; skipped: number; failed: number } | null
  pendingUndrafted: number
  verifying?: boolean
  placing?: boolean
  placeCurrentOrderId?: string | null
  placeQueued?: number
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
  placeOrderEnabled?: boolean
  cart?: HHCartDraftStatus
}

export function getHHScSyncStatus(brand: HHBrandId) {
  return authApi.get<{ data: HHScSyncStatus }>(hhPath(brand, '/sc-sync'))
}

export interface HHB2bConfig {
  baseUrl: string
  catalog: string
  accountId: string
  hasCookie: boolean
  cookieUpdatedAt: string | null
  placeOrderEnabled: boolean
  updatedAt: string
  updatedByName: string
}

export type HHB2bConfigPatch = Partial<{
  baseUrl: string
  catalog: string
  accountId: string
  cookie: string
  placeOrderEnabled: boolean
}>

export function getHHB2bConfig(brand: HHBrandId) {
  return authApi.get<{ data: HHB2bConfig }>(hhPath(brand, '/config'))
}

export function updateHHB2bConfig(brand: HHBrandId, patch: HHB2bConfigPatch) {
  return authApi.patch<{ data: HHB2bConfig }>(hhPath(brand, '/config'), patch)
}

export function importHHSpreadsheet(
  brand: HHBrandId,
  input: File | { text: string },
  options?: { fetchDetails?: boolean; draftCart?: boolean },
) {
  const body = new FormData()
  if (input instanceof File) body.append('file', input)
  else body.append('text', input.text)
  body.append('fetchDetails', options?.fetchDetails === false ? 'false' : 'true')
  body.append('draftCart', options?.draftCart === false ? 'false' : 'true')
  return authApi.postForm<{ data: HHOrderGroup; meta: HHImportMeta }>(hhPath(brand, '/import'), body)
}

export function rerunHHGroupScSync(brand: HHBrandId, groupId: string, options?: { draftCart?: boolean }) {
  return authApi.post<{ data: HHOrderGroup }>(hhPath(brand, `/${groupId}/sc-sync`), {
    draftCart: options?.draftCart !== false,
  })
}

export function rerunHHOrderScSync(
  brand: HHBrandId,
  groupId: string,
  orderId: string,
  options?: { draftCart?: boolean },
) {
  return authApi.post<{ data: HHOrderGroup }>(hhPath(brand, `/${groupId}/orders/${orderId}/sc-sync`), {
    draftCart: options?.draftCart !== false,
  })
}

export function rerunHHGroupCartDraft(brand: HHBrandId, groupId: string) {
  return authApi.post<{ data: HHOrderGroup }>(hhPath(brand, `/${groupId}/cart-draft`))
}

export function rerunHHOrderCartDraft(brand: HHBrandId, groupId: string, orderId: string) {
  return authApi.post<{ data: HHOrderGroup }>(hhPath(brand, `/${groupId}/orders/${orderId}/cart-draft`))
}

export function rerunHHGroupCartVerify(brand: HHBrandId, groupId: string) {
  return authApi.post<{ data: HHOrderGroup }>(hhPath(brand, `/${groupId}/cart-verify`))
}

export function rerunHHOrderCartVerify(brand: HHBrandId, groupId: string, orderId: string) {
  return authApi.post<{ data: HHOrderGroup }>(hhPath(brand, `/${groupId}/orders/${orderId}/cart-verify`))
}

export function compareHHCart(brand: HHBrandId, groupId: string, orderId?: string) {
  const path = orderId
    ? hhPath(brand, `/${groupId}/orders/${orderId}/cart-compare`)
    : hhPath(brand, `/${groupId}/cart-compare`)
  return authApi.post<{ data: HHOrderGroup; compare: HHCartCompareOrder[] }>(path)
}

export function placeHHGroup(brand: HHBrandId, groupId: string) {
  return authApi.post<{ data: HHOrderGroup }>(hhPath(brand, `/${groupId}/place`))
}

export function placeHHOrder(brand: HHBrandId, groupId: string, orderId: string) {
  return authApi.post<{ data: HHOrderGroup }>(hhPath(brand, `/${groupId}/orders/${orderId}/place`))
}

export function updateHHGroupNotes(brand: HHBrandId, id: string, notes: string) {
  return authApi.patch<{ data: HHOrderGroup }>(hhPath(brand, `/${id}`), { notes })
}

export function updateHHOrderNotes(brand: HHBrandId, groupId: string, orderId: string, notes: string) {
  return authApi.patch<{ data: HHOrderGroup }>(hhPath(brand, `/${groupId}/orders/${orderId}`), { notes })
}

export function deleteHHGroup(brand: HHBrandId, id: string) {
  return authApi.delete<{ data: { deleted: boolean } }>(hhPath(brand, `/${id}`))
}

export function deleteHHOrder(brand: HHBrandId, groupId: string, orderId: string) {
  return authApi.delete<{ data: { deleted: boolean } }>(hhPath(brand, `/${groupId}/orders/${orderId}`))
}

export function downloadHHImportTemplate(brand: HHBrandId) {
  const csv = 'PO Number,Order ID\n100001,111-0000000-0000000\n'
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${hhPath(brand).replace(/^\//, '')}-import-template.csv`
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
    includesQuery(hhCartStatusLabel(order.cartStatus), query) ||
    (order.verifyIssues ?? []).some(
      (issue) => includesQuery(issue.label, query) || includesQuery(issue.expected, query) || includesQuery(issue.actual, query),
    )
  ) {
    return true
  }
  return order.items.some((item) => hhItemMatchesQuery(item, rawQuery))
}

export function hhGroupMatchesQuery(group: HHOrderGroup, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  if (
    includesQuery(group.id, query) ||
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
