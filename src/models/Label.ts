import { Schema, model, Document, Types } from 'mongoose';

export type LabelStatus = 'drafted' | 'created' | 'failed';

interface ILabelWeight {
  value?: number;
  units?: string;
}

interface ILabelDimensions {
  length?: number;
  width?: number;
  height?: number;
  units?: string;
}

interface ILabelSku {
  sku?: string;
  quantity?: number;
}

interface ILabelAddress {
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
}

export interface ILabel extends Document {
  batchId?: Types.ObjectId;
  poNumber: string;
  orderNumber: string;
  orderId?: number;
  status: LabelStatus;

  // Reviewable shipping snapshot resolved from the order at draft time
  found?: boolean;
  customerName?: string;
  qty?: number;
  skus?: ILabelSku[];
  shipFrom?: ILabelAddress;
  shipTo?: ILabelAddress;
  insuranceProvider?: string;

  // Resolved request inputs (what we sent to ShipStation)
  carrierCode?: string;
  serviceCode?: string;
  packageCode?: string;
  shipDate?: string;
  propertyType?: 'residential' | 'commercial';
  // Operator-set override of the address type. When present it takes precedence
  // over the order's residential flag, so the derived serviceCode survives
  // re-resolution at label-purchase time. Used to correct ShipStation/Seller
  // Central mismatches that otherwise pick the wrong FedEx service.
  propertyOverride?: 'residential' | 'commercial';
  weight?: ILabelWeight;
  dimensions?: ILabelDimensions;
  requestPayload?: Record<string, unknown>;

  // ShipStation createlabel response
  shipmentId?: number;
  shipmentCost?: number;
  insuranceCost?: number;
  trackingNumber?: string;
  labelData?: string; // base64-encoded PDF
  formData?: unknown;

  // Google Drive
  driveFileId?: string;
  driveFileName?: string;
  driveFileLink?: string;

  error?: string;
  createdBy?: string; // user email
  createdByUserId?: string;

  createdAt: Date;
  updatedAt: Date;
}

const LabelSchema = new Schema<ILabel>(
  {
    batchId: { type: Schema.Types.ObjectId, ref: 'LabelBatch', index: true },
    poNumber: { type: String, required: true, trim: true, index: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    orderId: { type: Number, index: true },
    status: { type: String, enum: ['drafted', 'created', 'failed'], required: true, default: 'created' },

    found: Boolean,
    customerName: String,
    qty: Number,
    skus: [{ sku: String, quantity: Number, _id: false }],
    shipFrom: {
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
    },
    shipTo: {
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
    },
    insuranceProvider: String,

    carrierCode: String,
    serviceCode: String,
    packageCode: String,
    shipDate: String,
    propertyType: { type: String, enum: ['residential', 'commercial'] },
    propertyOverride: { type: String, enum: ['residential', 'commercial'] },
    weight: { value: Number, units: String },
    dimensions: { length: Number, width: Number, height: Number, units: String },
    requestPayload: { type: Schema.Types.Mixed },

    shipmentId: Number,
    shipmentCost: Number,
    insuranceCost: Number,
    trackingNumber: { type: String, index: true },
    // base64 PDF can be large — excluded from default queries (list views)
    labelData: { type: String, select: false },
    formData: { type: Schema.Types.Mixed },

    driveFileId: String,
    driveFileName: String,
    driveFileLink: String,

    error: String,
    createdBy: String,
    createdByUserId: String,
  },
  { timestamps: true }
);

export default model<ILabel>('Label', LabelSchema);
