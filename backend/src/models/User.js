import mongoose from 'mongoose';

export const ROLES = [
  'admin',
  'general-manager',
  'manager',
  'approver',
  'investigator',
  'monitor',
  'accountant',
  'cashier',
];

// Roles a self-registered (or admin-created) user may hold. Admins are never
// granted via registration — the hardcoded seeded admin is the single entry point.
export const SELF_REGISTER_ROLES = ROLES.filter((r) => r !== 'admin');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: 'investigator' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    active: this.active,
  };
};

export const User = mongoose.model('User', userSchema);