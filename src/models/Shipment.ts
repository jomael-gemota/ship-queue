import { Schema, model, Document } from 'mongoose';

export type ShipmentStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'failed';

export interface IShipment extends Document {
  orderId: string;
  trackingNumber?: string;
  carrier?: string;
  status: ShipmentStatus;
  recipient: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  weight?: number;
  labelUrl?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ShipmentSchema = new Schema<IShipment>(
  {
    orderId: { type: String, required: true, unique: true, trim: true },
    trackingNumber: { type: String, trim: true },
    carrier: { type: String, trim: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'failed'],
      default: 'pending',
    },
    recipient: {
      name: { type: String, required: true },
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      zip: { type: String, required: true },
      country: { type: String, required: true, default: 'US' },
    },
    weight: { type: Number },
    labelUrl: { type: String },
    notes: { type: String },
  },
  { timestamps: true }
);

export default model<IShipment>('Shipment', ShipmentSchema);
