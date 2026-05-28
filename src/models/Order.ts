import { Schema, model, Document } from 'mongoose';

export type OrderStatus =
  | 'awaiting_payment'
  | 'awaiting_shipment'
  | 'pending_fulfillment'
  | 'shipped'
  | 'on_hold'
  | 'cancelled'
  | 'rejected_fulfillment';

export const ORDER_STATUSES: OrderStatus[] = [
  'awaiting_payment',
  'awaiting_shipment',
  'pending_fulfillment',
  'shipped',
  'on_hold',
  'cancelled',
  'rejected_fulfillment',
];

interface IOrderAddress {
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  street3?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  residential?: boolean;
  addressVerified?: string;
}

interface IOrderItemWeight {
  value?: number;
  units?: string;
}

interface IOrderItemOption {
  name: string;
  value: string;
}

interface IOrderItem {
  orderItemId?: number;
  lineItemKey?: string;
  sku?: string;
  name?: string;
  imageUrl?: string;
  weight?: IOrderItemWeight;
  quantity?: number;
  unitPrice?: number;
  taxAmount?: number;
  shippingAmount?: number;
  warehouseLocation?: string;
  options?: IOrderItemOption[];
  productId?: number;
  fulfillmentSku?: string;
  adjustment?: boolean;
  upc?: string;
  createDate?: Date;
  modifyDate?: Date;
}

interface IWeight {
  value?: number;
  units?: string;
}

export interface IOrder extends Document {
  orderId: number;
  orderNumber: string;
  orderKey?: string;
  orderDate: Date;
  createDate?: Date;
  modifyDate?: Date;
  paymentDate?: Date;
  shipByDate?: Date;
  orderStatus: OrderStatus;
  customerId?: number;
  customerUsername?: string;
  customerEmail?: string;
  billTo?: IOrderAddress;
  shipTo?: IOrderAddress;
  items?: IOrderItem[];
  orderTotal?: number;
  amountPaid?: number;
  taxAmount?: number;
  shippingAmount?: number;
  customerNotes?: string;
  internalNotes?: string;
  gift?: boolean;
  giftMessage?: string;
  paymentMethod?: string;
  requestedShippingService?: string;
  carrierCode?: string;
  serviceCode?: string;
  packageCode?: string;
  confirmation?: string;
  shipDate?: Date;
  holdUntilDate?: Date;
  weight?: IWeight;
  storeId?: number;
  source?: string;
  externallyFulfilled?: boolean;
  externallyFulfilledBy?: string;
  externallyFulfilledByName?: string;
  lastSyncedAt: Date;
}

const AddressSchema = new Schema<IOrderAddress>(
  {
    name: String,
    company: String,
    street1: String,
    street2: String,
    street3: String,
    city: String,
    state: String,
    postalCode: String,
    country: String,
    phone: String,
    residential: Boolean,
    addressVerified: String,
  },
  { _id: false }
);

const OrderItemSchema = new Schema<IOrderItem>(
  {
    orderItemId: Number,
    lineItemKey: String,
    sku: String,
    name: String,
    imageUrl: String,
    weight: {
      value: Number,
      units: String,
    },
    quantity: Number,
    unitPrice: Number,
    taxAmount: Number,
    shippingAmount: Number,
    warehouseLocation: String,
    options: [{ name: String, value: String, _id: false }],
    productId: Number,
    fulfillmentSku: String,
    adjustment: Boolean,
    upc: String,
    createDate: Date,
    modifyDate: Date,
  },
  { _id: false }
);

const OrderSchema = new Schema<IOrder>(
  {
    orderId: { type: Number, required: true, unique: true, index: true },
    orderNumber: { type: String, required: true, trim: true },
    orderKey: { type: String, trim: true },
    orderDate: { type: Date, required: true, index: true },
    createDate: Date,
    modifyDate: Date,
    paymentDate: Date,
    shipByDate: Date,
    orderStatus: {
      type: String,
      enum: ORDER_STATUSES,
      required: true,
      index: true,
    },
    customerId: Number,
    customerUsername: { type: String, trim: true },
    customerEmail: { type: String, trim: true, lowercase: true },
    billTo: AddressSchema,
    shipTo: AddressSchema,
    items: [OrderItemSchema],
    orderTotal: Number,
    amountPaid: Number,
    taxAmount: Number,
    shippingAmount: Number,
    customerNotes: String,
    internalNotes: String,
    gift: Boolean,
    giftMessage: String,
    paymentMethod: String,
    requestedShippingService: String,
    carrierCode: String,
    serviceCode: String,
    packageCode: String,
    confirmation: String,
    shipDate: Date,
    holdUntilDate: Date,
    weight: {
      value: Number,
      units: String,
    },
    storeId: Number,
    source: String,
    externallyFulfilled: Boolean,
    externallyFulfilledBy: String,
    externallyFulfilledByName: String,
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default model<IOrder>('Order', OrderSchema);
