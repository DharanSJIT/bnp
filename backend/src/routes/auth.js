import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, SELF_REGISTER_ROLES, ROLES } from '../models/User.js';
import { config } from '../config/env.js';
import { auth } from '../middleware/auth.js';
import { auditFor } from '../services/auditService.js';

const router = Router();

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.active) return res.status(403).json({ error: 'Account deactivated' });

    await auditFor(req)({ action: 'login', entity: 'user', entityId: user._id.toString(), after: { email: user.email } });
    res.json({ token: signToken(user), user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

// Public self-registration. New users may pick any lower-authority role
// (never 'admin' — admins are created by the seeded admin or via /api/users).
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const chosenRole = SELF_REGISTER_ROLES.includes(role) ? role : 'investigator';
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      passwordHash,
      role: chosenRole,
    });
    // register also signs the user in so they can start working immediately
    const token = signToken(user);
    await auditFor(req)({ action: 'user.registered', entity: 'user', entityId: user._id.toString(), after: { email: user.email, role: user.role } });
    res.status(201).json({ token, user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

router.get('/me', auth, (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
});

export default router;