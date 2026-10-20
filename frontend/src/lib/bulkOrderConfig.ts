import { authApi } from './api'

export interface BulkOrderSessionCheck {
  status: 'ok' | 'auth' | 'down' | null
  checkedAt: string | null
  latencyMs: number | null
  message: string
}

export interface BulkOrderLastAlert {
  at: string | null
  event: 'failed' | 'recovered' | 'test' | null
  error: string | null
}

export interface BulkOrderConfig {
  baseUrl: string
  catalog: string
  accountId: string
  defaultShipToCode: string
  dropShipName: string
  dropShipAddress: string
  dropShipPostalCode: string
  skuPrefixes: string[]
  skuSuffixes: string[]
  hasCookie: boolean
  cookieSource: 'env' | 'config' | 'jar' | 'jar-empty' | 'none'
  cookieUpdatedAt: string | null
  placeOrderEnabled: boolean
  alertWebhookUrl: string
  sessionCheckTimes: string[]
  sessionCheck: BulkOrderSessionCheck
  lastAlert: BulkOrderLastAlert
  updatedAt: string
  updatedByName: string
}

export type BulkOrderConfigPatch = Partial<{
  baseUrl: string
  catalog: string
  accountId: string
  defaultShipToCode: string
  dropShipName: string
  dropShipAddress: string
  dropShipPostalCode: string
  skuPrefixes: string[]
  skuSuffixes: string[]
  cookie: string
  placeOrderEnabled: boolean
  alertWebhookUrl: string
  sessionCheckTimes: string[]
}>

const CONFIG_PATH = '/bulk-order/thorogood/config'

export interface BulkOrderShipTo {
  code: string
  label: string
}

export function getBulkOrderConfig() {
  return authApi.get<{ data: BulkOrderConfig }>(CONFIG_PATH)
}

export interface BulkOrderCatalog {
  code: string
  name: string
}

export function getBulkOrderCatalogs() {
  return authApi.get<{ data: BulkOrderCatalog[]; source: 'portal' | 'fallback'; message?: string }>(
    '/bulk-order/thorogood/catalogs',
  )
}

export interface BulkOrderSoldTo {
  code: string
  name: string
  label: string
}

export function getBulkOrderSoldTos() {
  return authApi.get<{ data: BulkOrderSoldTo[]; source: 'portal' | 'fallback'; message?: string }>(
    '/bulk-order/thorogood/sold-tos',
  )
}

export function getBulkOrderShipTos(customer: string) {
  const params = new URLSearchParams()
  const code = customer.trim()
  if (code) params.set('customer', code)
  const query = params.toString()
  return authApi.get<{ data: BulkOrderShipTo[]; source: 'portal' | 'fallback'; message?: string }>(
    `/bulk-order/thorogood/ship-tos${query ? `?${query}` : ''}`,
  )
}

export function updateBulkOrderConfig(patch: BulkOrderConfigPatch) {
  return authApi.patch<{ data: BulkOrderConfig }>(CONFIG_PATH, patch)
}

export function checkBulkOrderSession() {
  return authApi.post<{ data: BulkOrderConfig }>(`${CONFIG_PATH}/session-check`)
}

export function testBulkOrderWebhook() {
  return authApi.post<{ data: BulkOrderConfig }>(`${CONFIG_PATH}/webhook-test`)
}
