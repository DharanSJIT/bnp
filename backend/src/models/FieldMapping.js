import mongoose from 'mongoose';

const fieldRefSchema = new mongoose.Schema(
  { sourceId: { type: String, required: true }, fieldName: { type: String, required: true } },
  { _id: false }
);

const mappingGroupSchema = new mongoose.Schema(
  {
    targetGroupId: { type: String, required: true },
    fields: { type: [fieldRefSchema], default: [] },
    status: { type: String, enum: ['common', 'potential', 'uncommon'], default: 'uncommon' },
    confidence: { type: Number, default: 0 },
    isReconcileField: { type: Boolean, default: false },
    overriddenByUser: { type: Boolean, default: false },
  },
  { _id: false }
);

const fieldMappingSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
    mappings: { type: [mappingGroupSchema], default: [] },
    joinMapFileId: { type: String, default: '' },
  },
  { timestamps: true }
);

fieldMappingSchema.index({ workflowId: 1 }, { unique: true });

export const FieldMapping = mongoose.model('FieldMapping', fieldMappingSchema);