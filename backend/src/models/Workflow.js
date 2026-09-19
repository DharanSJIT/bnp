import mongoose from 'mongoose';

const sourceSchema = new mongoose.Schema(
  {
    sourceId: { type: String, required: true },
    displayName: { type: String, required: true },
    ingestionType: { type: String, enum: ['file', 'api', 'db'], required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    ingestStatus: {
      type: String,
      enum: ['not-started', 'ingesting', 'ingested', 'failed'],
      default: 'not-started',
    },
    loadStats: {
      recordsLoaded: Number,
      timeTakenMs: Number,
      method: String,
      lastLoadId: String,
      ingestedAt: Date,
    },
  },
  { _id: false }
);

const workflowSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    period: { type: String, default: '' }, // e.g. "202608"
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sources: { type: [sourceSchema], default: [] },
    status: {
      type: String,
      enum: ['draft', 'configured', 'ready', 'archived'],
      default: 'draft',
    },
    rulesFile: { type: String, default: '' }, // path to uploaded business_rules.txt
    validationAcknowledged: { type: Boolean, default: false },
    validationAcknowledgedAt: { type: Date, default: null },
    validationResults: { type: mongoose.Schema.Types.Mixed, default: {} },
    outboundConfig: {
      api: { type: mongoose.Schema.Types.Mixed, default: null },
      filePdf: { type: Boolean, default: false },
      email: { type: mongoose.Schema.Types.Mixed, default: null },
      dbWrite: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    lastRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReconciliationRun' },
    lastRunStatus: { type: String, default: '' },
    lastMatchRate: { type: Number, default: null },
    lastRunAt: { type: Date, default: null },
  },
  { timestamps: true }
);

workflowSchema.index({ createdBy: 1, name: 1 }, { unique: true });

export const Workflow = mongoose.model('Workflow', workflowSchema);