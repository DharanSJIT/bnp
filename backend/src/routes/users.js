import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User, ROLES, SELF_REGISTER_ROLES } from '../models/User.js';
import { auth, roleGuard } from '../middleware/auth.js';
import { auditFor } from '../services/auditService.js';

const router = Router();
router.use(auth, roleGuard('admin'));

// GET /api/users
router.get('/', async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: 1 }).lean();
    res.json({ users: users.map((u) => ({ ...u, passwordHash: undefined })) });
  } catch (err) {
    next(err);
  }
});

// POST /api/users — create user
router.post('/', async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      passwordHash: await bcrypt.hash(password, 10),
      role: SELF_REGISTER_ROLES.includes(role) ? role : 'investigator',
    });
    await auditFor(req)({ action: 'user.created', entity: 'user', entityId: user._id.toString(), after: user.toSafeJSON() });
    res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id — update role / active / reset password
router.put('/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const before = user.toSafeJSON();
    if (req.body.role !== undefined && ROLES.includes(req.body.role) && req.body.role !== 'admin') user.role = req.body.role;
    if (req.body.active !== undefined) user.active = Boolean(req.body.active);
    if (req.body.password) user.passwordHash = await bcrypt.hash(req.body.password, 10);
    if (req.body.name !== undefined) user.name = String(req.body.name).trim();
    await user.save();
    await auditFor(req)({ action: 'user.updated', entity: 'user', entityId: user._id.toString(), before, after: user.toSafeJSON() });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

export default router;