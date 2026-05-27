export type ShipmentStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'failed'

export interface Recipient {
  name: string
  address: string
  city: string
  state: string
  zip: string
  country: string
}

export interface Shipment {
  _id: string
  orderId: string
  trackingNumber?: string
  carrier?: string
  status: ShipmentStatus
  recipient: Recipient
  weight?: number
  labelUrl?: string
  notes?: string
  createdAt: string
  updatedAt: string
}
