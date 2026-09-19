import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    originalFormat: { type: String, required: true },
    uploaderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploaderRole: { type: String, required: true },
    status: {
      type: String,
      enum: ['processing', 'ready', 'failed'],
      default: 'processing',
    },
    recordCount: { type: Number, default: 0 },
    error: { type: String },
    data: { type: mongoose.Schema.Types.Mixed, default: [] }, // Array of parsed JSON objects
  },
  { timestamps: true }
);

export const Document = mongoose.model('Document', documentSchema);
