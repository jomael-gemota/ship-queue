export interface LabelWeight {
  value?: number
  units?: string
}

export interface LabelDimensions {
  length?: number
  width?: number
  height?: number
  units?: string
}

export interface LabelAddress {
  name?: string
  company?: string
  street1?: string
  street2?: string
  street3?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  phone?: string
  residential?: boolean
}

/** A single order line item: SKU + quantity ordered. */
export interface LabelSku {
  sku?: string
  quantity?: number
}

/** @deprecated Use LabelAddress */
export type LabelShipTo = LabelAddress

/** A row imported from the CSV (PO# + Order#). */
export interface ImportRow {
  poNumber: string
  orderNumber: string
}

/** Process 1 — reviewable label details resolved from an order. */
export interface PreparedRow {
  poNumber: string
  orderNumber: string
  found: boolean
  orderId?: number
  customerName?: string
  qty?: number
  skus?: LabelSku[]
  shipFromSummary?: string
  shipFrom?: LabelAddress
  shipToSummary?: string
  shipTo?: LabelAddress
  propertyType?: 'residential' | 'commercial'
  carrierCode?: string
  serviceCode?: string
  packageCode?: string
  insuranceProvider?: string
  shipDate?: string
  weight?: LabelWeight
  dimensions?: LabelDimensions
  error?: string
}

/** Process 2 — per-row result of creating a label. */
export interface CreateLabelResult {
  labelId: string
  poNumber: string
  orderNumber: string
  status: 'created' | 'failed'
  shipmentId?: number
  shipmentCost?: number
  insuranceCost?: number
  trackingNumber?: string
  driveFileLink?: string
  driveFileName?: string
  driveError?: string
  error?: string
}

/** A persisted label record (an item within a batch). */
export interface LabelRecord {
  _id: string
  batchId?: string
  poNumber: string
  orderNumber: string
  orderId?: number
  status: 'drafted' | 'created' | 'failed'
  found?: boolean
  customerName?: string
  qty?: number
  skus?: LabelSku[]
  shipFrom?: LabelAddress
  shipTo?: LabelAddress
  insuranceProvider?: string
  carrierCode?: string
  serviceCode?: string
  packageCode?: string
  shipDate?: string
  /** Operator override of the ship date (YYYY-MM-DD); used when (re)creating. */
  shipDateOverride?: string
  propertyType?: 'residential' | 'commercial'
  /** Operator override of the address type; when set, drives the service. */
  propertyOverride?: 'residential' | 'commercial'
  weight?: LabelWeight
  dimensions?: LabelDimensions
  shipmentId?: number
  shipmentCost?: number
  insuranceCost?: number
  trackingNumber?: string
  driveFileId?: string
  driveFileName?: string
  driveFileLink?: string
  error?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export type LabelBatchStatus = 'drafted' | 'created' | 'partial' | 'failed'

/** A batch of imported rows (one row per uploaded file in the Labels table). */
export interface LabelBatch {
  _id: string
  status: LabelBatchStatus
  fileName?: string
  itemCount: number
  createdBy?: string
  /** Uploader's display name, resolved from their account by email. */
  createdByName?: string
  /** Uploader's avatar URL, resolved from their account by email. */
  createdByAvatar?: string
  createdAt: string
  updatedAt: string
}

export interface DraftBatchResponse {
  data: LabelBatch
}

export interface BatchesListResponse {
  data: LabelBatch[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pages: number
  }
}

export interface BatchItemsResponse {
  data: {
    batch: LabelBatch
    items: LabelRecord[]
  }
}

export interface RefreshBatchItemsResponse {
  data: {
    batch: LabelBatch
    items: LabelRecord[]
    /** How many "Not found" items were re-checked. */
    checked: number
    /** How many of the re-checked items now resolve to an order. */
    resolved: number
  }
}

/** Response from applying a ship date to all not-yet-created items in a batch. */
export interface UpdateBatchShipDateResponse {
  data: {
    batch: LabelBatch
    items: LabelRecord[]
    /** The applied ship date (YYYY-MM-DD). */
    shipDate: string
    /** How many items were updated. */
    updated: number
  }
}

export interface CreateBatchLabelsResponse {
  data: {
    batch: LabelBatch
    results: CreateLabelResult[]
  }
}

/** Response from editing a single item's Property (and re-derived Service). */
export interface UpdateLabelItemResponse {
  data: {
    item: LabelRecord
  }
}

/** Response from re-attempting a single failed item. */
export interface RecreateLabelItemResponse {
  data: {
    item: LabelRecord
    result: CreateLabelResult
  }
}

export interface PrepareResponse {
  data: PreparedRow[]
}

export interface CreateLabelsResponse {
  data: CreateLabelResult[]
}

export interface LabelsListResponse {
  data: LabelRecord[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pages: number
  }
}

/** A single row in the pre-submit preflight (live order vs enforced values). */
export interface PreflightItem {
  labelId: string
  poNumber: string
  orderNumber: string
  customerName?: string
  found: boolean
  orderId?: number
  expectedWarehouseId?: number
  expectedWarehouseName?: string
  expectedInsuranceProvider: string
  liveWarehouseId?: number
  liveWarehouseName?: string
  liveInsuranceProvider?: string
  liveInsuredValue?: number
  willCorrectWarehouse: boolean
  willCorrectInsurance: boolean
  status: 'ok' | 'will_correct' | 'not_found' | 'error'
  error?: string
}

export interface PreflightSummary {
  total: number
  creatable: number
  notFound: number
  willCorrect: number
  errors: number
  expectedWarehouseId?: number
  expectedWarehouseName?: string
  expectedShipFrom: LabelAddress
  expectedInsuranceProvider: string
}

export interface PreflightResponse {
  data: {
    batch: LabelBatch
    summary: PreflightSummary
    items: PreflightItem[]
  }
}

/** Single-item preflight (for the Recreate confirmation modal). */
export interface PreflightItemResponse {
  data: {
    summary: PreflightSummary
    items: PreflightItem[]
  }
}

export interface AppSettings {
  driveConnected: boolean
  driveConnectedAt: string | null
  driveAccountEmail: string | null
  driveAccountName: string | null
  driveAccountAvatar: string | null
  driveFolderId: string | null
  driveFolderName: string | null
  dropboxConnected: boolean
  dropboxConnectedAt: string | null
  dropboxAccountEmail: string | null
  dropboxAccountName: string | null
  dropboxPrefs: DropboxPrefs | null
}

export interface DropboxPrefs {
  folderPath: string
  crumbs: { path: string; name: string }[]
  fileType: string
  recursive: boolean
}

export interface DropboxFolder {
  id: string
  name: string
  path: string
}

export interface DropboxFileLink {
  name: string
  path: string
  url: string
  size?: number
}

export interface DropboxLinksResult {
  links: DropboxFileLink[]
  scanned: number
  failures: { name: string; path: string }[]
}

export interface SettingsResponse {
  data: AppSettings
}

export type { SyncConfig, SyncConfigResponse } from './order'

export interface DriveFolder {
  id: string
  name: string
  isSharedDrive?: boolean
}
