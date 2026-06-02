import { Schema, model, Document } from 'mongoose';

export type LabelBatchStatus = 'drafted' | 'created' | 'partial' | 'failed';

export interface ILabelBatch extends Document {
  status: LabelBatchStatus;
  fileName?: string;
  itemCount: number;

  createdBy?: string; // user email
  createdByUserId?: string;

  createdAt: Date;
  updatedAt: Date;
}

const LabelBatchSchema = new Schema<ILabelBatch>(
  {
    status: {
      type: String,
      enum: ['drafted', 'created', 'partial', 'failed'],
      required: true,
      default: 'drafted',
      index: true,
    },
    fileName: String,
    itemCount: { type: Number, default: 0 },

    createdBy: String,
    createdByUserId: String,
  },
  { timestamps: true }
);

export default model<ILabelBatch>('LabelBatch', LabelBatchSchema);
