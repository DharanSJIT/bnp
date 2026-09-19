import mongoose from 'mongoose';

const investigationSchema = new mongoose.Schema(
  {
    breakId: { type: mongoose.Schema.Types.ObjectId, ref: 'Break', required: true },
    investigatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    cause: { type: String, required: true },
    aiRootCauseOverridden: { type: Boolean, default: false },
    submittedAt: { type: Date, default: Date.now },
    approverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decision: { type: String, enum: ['approved', 'rejected', null], default: null },
    decisionComment: { type: String, default: '' },
    decidedAt: { type: Date, default: null },
    history: { type: [String], default: [] },
  },
  { timestamps: true }
);

investigationSchema.index({ breakId: 1 }, { unique: false });

export const BreakInvestigation = mongoose.model('BreakInvestigation', investigationSchema);