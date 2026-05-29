import { Schema, model, Document } from 'mongoose';

export type LabelStatus = 'created' | 'failed';

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

export interface ILabel extends Document {
  poNumber: string;
  orderNumber: string;
  orderId?: number;
  status: LabelStatus;

  // Resolved request inputs (what we sent to ShipStation)
  carrierCode?: string;
  serviceCode?: string;
  packageCode?: string;
  shipDate?: string;
  propertyType?: 'residential' | 'commercial';
  weight?: ILabelWeight;
  dimensions?: ILabelDimensions;
  testLabel?: boolean;
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
    poNumber: { type: String, required: true, trim: true, index: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    orderId: { type: Number, index: true },
    status: { type: String, enum: ['created', 'failed'], required: true, default: 'created' },

    carrierCode: String,
    serviceCode: String,
    packageCode: String,
    shipDate: String,
    propertyType: { type: String, enum: ['residential', 'commercial'] },
    weight: { value: Number, units: String },
    dimensions: { length: Number, width: Number, height: Number, units: String },
    testLabel: Boolean,
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
