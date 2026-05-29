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

/** A persisted label record (Labels table). */
export interface LabelRecord {
  _id: string
  poNumber: string
  orderNumber: string
  orderId?: number
  status: 'created' | 'failed'
  carrierCode?: string
  serviceCode?: string
  packageCode?: string
  shipDate?: string
  propertyType?: 'residential' | 'commercial'
  weight?: LabelWeight
  dimensions?: LabelDimensions
  testLabel?: boolean
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

export interface AppSettings {
  driveConnected: boolean
  driveFolderId: string | null
  driveFolderName: string | null
}

export interface SettingsResponse {
  data: AppSettings
}

export interface DriveFolder {
  id: string
  name: string
}
