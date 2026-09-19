import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { config } from '../config/env.js';
import { auth } from '../middleware/auth.js';
import { auditFor } from '../services/auditService.js';
import { sendMail } from '../services/emailService.js';

const otpStore = new Map();

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

router.post('/send-otp', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });
    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(normalizedEmail, { otp, expires: Date.now() + 10 * 60 * 1000 });

    await sendMail({
      to: normalizedEmail,
      subject: 'OneRecon Registration OTP',
      text: `Your OTP for OneRecon registration is: ${otp}. It expires in 10 minutes.`,
      html: `<b>Your OTP for OneRecon registration is:</b> <h2>${otp}</h2><p>It expires in 10 minutes.</p>`
    });

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    next(err);
  }
});

// Public self-registration for standard report users. Clients do not pick a
// role — every self-registered account is created as a regular 'investigator'
// so nobody can self-assign an admin/approver/manager role. Higher roles are
// granted only by an admin via /api/users (or the seeded admin).
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, otp } = req.body || {};
    if (!name || !email || !password || !otp) return res.status(400).json({ error: 'name, email, password, and otp required' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const storedData = otpStore.get(normalizedEmail);
    if (!storedData) return res.status(400).json({ error: 'No OTP requested for this email' });
    if (Date.now() > storedData.expires) return res.status(400).json({ error: 'OTP expired, request a new one' });
    if (storedData.otp !== String(otp)) return res.status(400).json({ error: 'Invalid OTP' });
    otpStore.delete(normalizedEmail);

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      passwordHash,
      role: 'investigator',
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