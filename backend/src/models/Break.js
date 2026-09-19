import mongoose from 'mongoose';

const breakSchema = new mongoose.Schema(
  {
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReconciliationRun', required: true },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
    period: { type: String, default: '' },
    type: { type: String, enum: ['transactional', 'dimensional'], required: true },
    key: { type: String, required: true }, // TransactionID or canonical account key
    dimension: { type: String, default: '' }, // e.g. gl_account_id for dimensional breaks
    sourcesInvolved: { type: [String], default: [] },
    expected: { type: Number, default: 0 },
    actual: { type: Number, default: 0 },
    variance: { type: Number, default: 0 },
    materiality: { type: Number, default: 0 },
    priorityScore: { type: Number, default: 0 },
    aiRootCause: { type: String, default: '' },
    evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['open', 'investigating', 'pending-approval', 'approved', 'rejected'],
      default: 'open',
    },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

breakSchema.index({ runId: 1 });
breakSchema.index({ workflowId: 1, status: 1 });

export const Break = mongoose.model('Break', breakSchema);