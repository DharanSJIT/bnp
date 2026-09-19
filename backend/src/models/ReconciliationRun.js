import mongoose from 'mongoose';

const runSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
    period: { type: String, default: '' },
    status: { type: String, enum: ['running', 'success', 'failed'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    counts: {
      bySource: { type: mongoose.Schema.Types.Mixed, default: {} },
      matched: { type: Number, default: 0 },
      breaks: { type: Number, default: 0 },
      anomalies: { type: Number, default: 0 },
    },
    matchRate: { type: Number, default: 0 },
    totals: { type: mongoose.Schema.Types.Mixed, default: { bySource: {} } },
    mappingsSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

runSchema.index({ workflowId: 1, createdAt: -1 });

export const ReconciliationRun = mongoose.model('ReconciliationRun', runSchema);