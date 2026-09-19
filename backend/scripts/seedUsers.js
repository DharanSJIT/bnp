/**
 * Seed default OneRecon users.
 *
 * The MAIN ADMIN credential is hardcoded here (admin@onerecon.io / Admin@123)
 * and is the guaranteed entry point — it is upserted and its password is
 * re-set on every run so a demo never gets locked out. All lower authorities
 * (investigator, monitor, accountant, cashier, manager, approver,
 * general-manager) receive well-known demo credentials too.
 *
 * Run: node scripts/seedUsers.js   (from backend/)
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ROLES } from '../src/models/User.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/onerecon';

const USERS = [
  { name: 'System Administrator', email: 'admin@onerecon.io', password: 'Admin@123', role: 'admin' },
  { name: 'General Manager', email: 'gm@onerecon.io', password: 'Manager@123', role: 'general-manager' },
  { name: 'Operations Manager', email: 'manager@onerecon.io', password: 'Manager@123', role: 'manager' },
  { name: 'Approver User', email: 'approver@onerecon.io', password: 'Approver@123', role: 'approver' },
  { name: 'Investigator User', email: 'investigator@onerecon.io', password: 'Invest@123', role: 'investigator' },
  { name: 'Reconciliation Monitor', email: 'monitor@onerecon.io', password: 'Monitor@123', role: 'monitor' },
  { name: 'Chief Accountant', email: 'accountant@onerecon.io', password: 'Account@123', role: 'accountant' },
  { name: 'Cashier User', email: 'cashier@onerecon.io', password: 'Cashier@123', role: 'cashier' },
];

async function main() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const { User } = await import('../src/models/User.js');

  // Validate the enum on the live model matches our seed set.
  for (const u of USERS) {
    if (!ROLES.includes(u.role)) throw new Error(`Unknown role ${u.role} for ${u.email}`);
  }

  // Ensure every seedable lower role has a representative account.
  for (const u of USERS) {
    const existing = await User.findOne({ email: u.email });
    if (existing) {
      existing.passwordHash = await bcrypt.hash(u.password, 10);
      existing.role = u.role;
      existing.active = true;
      existing.name = u.name;
      await existing.save();
      console.log(`[seed] updated ${u.email} (${u.role})`);
    } else {
      await User.create({ ...u, passwordHash: await bcrypt.hash(u.password, 10) });
      console.log(`[seed] created ${u.email} (${u.role})`);
    }
  }

  await mongoose.disconnect();
  console.log('[seed] done. Admin login: admin@onerecon.io / Admin@123');
}

main().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});