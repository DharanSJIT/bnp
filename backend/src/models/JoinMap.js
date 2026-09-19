import mongoose from 'mongoose';

const joinRowSchema = new mongoose.Schema(
  {
    gl_account_id: { type: String, default: '' },
    ma_customer_key: { type: String, default: '' },
    fa_key: { type: String, default: '' },
    entity: { type: String, default: 'Global' },
    effective_from: { type: String, default: '' },
    effective_to: { type: String, default: '' },
  },
  { _id: false }
);

const joinMapSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
    period: { type: String, required: true },
    fileName: { type: String, default: '' },
    rows: { type: [joinRowSchema], default: [] },
  },
  { timestamps: true }
);

joinMapSchema.index({ workflowId: 1, period: 1 }, { unique: true });

export const JoinMap = mongoose.model('JoinMap', joinMapSchema);