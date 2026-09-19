import mongoose from 'mongoose';

// Staging collection — "initial data" per period/load. Raw parsed rows.
const rawTransactionSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
    sourceId: { type: String, required: true },
    loadId: { type: String, required: true },
    period: { type: String, default: '' },
    row: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

rawTransactionSchema.index({ workflowId: 1, sourceId: 1, loadId: 1 });
rawTransactionSchema.index({ 'row.TransactionID': 1 });
rawTransactionSchema.index({ 'row.gl_account_id': 1 });
rawTransactionSchema.index({ 'row.ma_customer_key': 1 });
rawTransactionSchema.index({ 'row.fa_key': 1 });

export const RawTransaction = mongoose.model('RawTransaction', rawTransactionSchema);