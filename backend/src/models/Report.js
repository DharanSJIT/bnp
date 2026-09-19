import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReconciliationRun', required: true },
    type: { type: String, enum: ['summary', 'comparison', 'audit'], default: 'summary' },
    format: { type: String, enum: ['csv', 'xlsx', 'json', 'pdf'], default: 'json' },
    fileName: { type: String, default: '' },
    filePath: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const Report = mongoose.model('Report', reportSchema);