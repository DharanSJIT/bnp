import mongoose from 'mongoose';

const runSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
    period: { type: String, default: '' },
    status: { type: String, enum: ['running', 'success', 'failed'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    // Fully dynamic — the engine derives counts, so new advisory metrics
    // (coverageGaps, unmappedRows, …) are preserved verbatim.
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    matchRate: { type: Number, default: 0 },
    totals: { type: mongoose.Schema.Types.Mixed, default: { bySource: {} } },
    mappingsSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: '' },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approvalComment: { type: String, default: '' },
    approvalBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    runBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

runSchema.index({ workflowId: 1, createdAt: -1 });

export const ReconciliationRun = mongoose.model('ReconciliationRun', runSchema);