import { Router } from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { auth, roleGuard } from '../middleware/auth.js';

const router = Router();
router.use(auth);

// GET /api/audit?workflowId=&entity=&action=&page=&limit=
router.get('/', async (req, res, next) => {
  try {
    const { workflowId, entity, action, actor, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (workflowId) filter.workflowId = workflowId;
    if (entity) filter.entity = entity;
    if (action) filter.action = new RegExp(String(action), 'i');
    if (actor) filter.actorName = new RegExp(String(actor), 'i');

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ logs: logs.map((l) => ({ ...l, at: l.createdAt })), total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/:workflowId — convenience route
router.get('/:workflowId', async (req, res, next) => {
  try {
    const { page = 1, limit = 30, entity, action } = req.query;
    const filter = { workflowId: req.params.workflowId };
    if (entity) filter.entity = entity;
    if (action) filter.action = new RegExp(String(action), 'i');
    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ logs, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

export default router;