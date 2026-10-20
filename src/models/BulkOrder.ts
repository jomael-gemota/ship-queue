import { Schema, model, Document } from 'mongoose';

export interface IBulkOrderLineItem {
  sku: string;
  /** Seller Central code from the upload, such as TG-804-3166_12-M-V2. Empty when the file only had a B2B SKU. */
  sellerSku: string;
  quantity: number;
  /** Catalog name plus color, captured when the line was last written. */
  name: string;
  price: number | null;
  currencyCode: string;
  imageResource: string;
  imageContentType: string;
  /** Product style, such as 514-4200. */
  styleCode: string;
  /** Size attribute, such as 5. */
  size: string;
  /** Width attribute, such as M. */
  width: string;
  /** Thumbnail bytes. Thorogood image URLs need the session cookie, so the file is kept here. */
  imageData?: Buffer;
}

export interface IBulkOrderShipment {
  customerPo: string;
  shipToCode: string;
  shipToLabel: string;
  catalogCode: string;
  catalogName: string;
  useDropShip: boolean;
  dropShipName: string;
  dropShipAddress: string;
  dropShipPostalCode: string;
  requestedShipDate: string;
  notes: string;
  /**
   * Catalog, customer, ship-to, and requested ship date the stored names, prices,
   * and images were loaded for. Empty until that snapshot exists.
   */
  itemsCatalogKey: string;
  /** SKUs last copied from this shipment on the Thorogood draft, plus their catalog snapshot. */
  items: IBulkOrderLineItem[];
}

export interface IBulkOrder extends Document {
  orderName: string;
  status: 'draft';
  soldToCode: string;
  soldToLabel: string;
  shipToCode: string;
  shipToLabel: string;
  portalOrderCode: string;
  shipments: IBulkOrderShipment[];
  createdByName: string;
  createdByEmail: string;
  createdByAvatar: string;
  createdAt: Date;
  updatedAt: Date;
}

const BulkOrderLineItemSchema = new Schema<IBulkOrderLineItem>(
  {
    sku: { type: String, required: true },
    sellerSku: { type: String, default: '' },
    quantity: { type: Number, required: true },
    name: { type: String, default: '' },
    price: { type: Number, default: null },
    currencyCode: { type: String, default: '' },
    imageResource: { type: String, default: '' },
    imageContentType: { type: String, default: '' },
    styleCode: { type: String, default: '' },
    size: { type: String, default: '' },
    width: { type: String, default: '' },
    imageData: { type: Buffer },
  },
  { _id: false },
);

const BulkOrderShipmentSchema = new Schema<IBulkOrderShipment>(
  {
    customerPo: { type: String, required: true },
    shipToCode: { type: String, required: true },
    shipToLabel: { type: String, default: '' },
    catalogCode: { type: String, required: true },
    catalogName: { type: String, required: true },
    useDropShip: { type: Boolean, default: false },
    dropShipName: { type: String, default: '' },
    dropShipAddress: { type: String, default: '' },
    dropShipPostalCode: { type: String, default: '' },
    requestedShipDate: { type: String, required: true },
    notes: { type: String, default: '' },
    itemsCatalogKey: { type: String, default: '' },
    items: { type: [BulkOrderLineItemSchema], default: [] },
  },
  { _id: false },
);

const BulkOrderSchema = new Schema<IBulkOrder>(
  {
    orderName: { type: String, required: true },
    status: { type: String, required: true, enum: ['draft'], default: 'draft' },
    soldToCode: { type: String, required: true },
    soldToLabel: { type: String, default: '' },
    shipToCode: { type: String, required: true },
    shipToLabel: { type: String, default: '' },
    portalOrderCode: { type: String, required: true, unique: true },
    shipments: { type: [BulkOrderShipmentSchema], required: true },
    createdByName: { type: String, default: '' },
    createdByEmail: { type: String, default: '' },
    createdByAvatar: { type: String, default: '' },
  },
  { timestamps: true },
);

BulkOrderSchema.index({ createdAt: -1 });

const BulkOrder = model<IBulkOrder>('BulkOrder', BulkOrderSchema);

export default BulkOrder;
