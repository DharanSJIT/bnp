import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { Break } from '../models/Break.js';
import { BreakInvestigation } from '../models/BreakInvestigation.js';
import { auth } from '../middleware/auth.js';
import { auditFor } from '../services/auditService.js';
import { aiCall } from '../services/aiClient.js';

const router = Router();
router.use(auth);

fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({ dest: config.uploadDir, limits: { fileSize: 50 * 1024 * 1024 } });

async function getBreak(req, res) {
  const b = await Break.findById(req.params.breakId);
  if (!b) return res.status(404).json({ error: 'Break not found' });
  return b;
}

// GET /api/breaks/:breakId — detail + investigations
router.get('/:breakId', async (req, res, next) => {
  try {
    const b = await getBreak(req, res);
    if (!b) return;
    const investigations = await BreakInvestigation.find({ breakId: b._id }).sort({ submittedAt: -1 }).lean();
    // historical frequency: same key/account in earlier runs of this workflow
    const history = await Break.aggregate([
      { $match: { workflowId: b.workflowId, key: b.key, _id: { $ne: b._id } } },
      { $group: { _id: '$runId', count: { $sum: 1 } } },
    ]);
    res.json({ break: b, investigations, historicalFrequency: { periodsBroken: history.length, totalBreaks: history.reduce((a, h) => a + h.count, 0) } });
  } catch (err) {
    next(err);
  }
});

// POST /api/breaks/:breakId/investigate — investigator submits cause → pending-approval
router.post('/:breakId/investigate', async (req, res, next) => {
  try {
    const b = await getBreak(req, res);
    if (!b) return;
    const { cause, overrideAiRootCause } = req.body || {};
    if (!cause || !String(cause).trim()) return res.status(400).json({ error: 'Cause/justification text required' });

    const before = { status: b.status, aiRootCause: b.aiRootCause };
    let investigation = await BreakInvestigation.findOne({ breakId: b._id, decision: null });
    if (!investigation) {
      investigation = await BreakInvestigation.create({ breakId: b._id, investigatorId: req.user._id });
    }
    investigation.investigatorId = req.user._id;
    investigation.cause = String(cause).trim();
    investigation.aiRootCauseOverridden = Boolean(overrideAiRootCause);
    investigation.submittedAt = new Date();
    investigation.approverId = null;
    investigation.decision = null;
    investigation.decisionComment = '';
    investigation.decidedAt = null;
    investigation.history.push(`submitted by ${req.user.name} (${req.user.role}) at ${new Date().toISOString()}`);
    await investigation.save();

    b.status = 'pending-approval';
    await b.save();
    await auditFor(req)({ workflowId: b.workflowId, action: 'break.investigated', entity: 'break', entityId: b._id.toString(), before, after: { status: b.status, cause: investigation.cause } });
    res.json({ break: b, investigation });
  } catch (err) {
    next(err);
  }
});

// POST /api/breaks/:breakId/decide — approver approves/rejects
router.post('/:breakId/decide', async (req, res, next) => {
  try {
    const b = await getBreak(req, res);
    if (!b) return;
    const { decision, decisionComment } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });

    const before = { status: b.status };
    let investigation = await BreakInvestigation.findOne({ breakId: b._id }).sort({ submittedAt: -1 });
    if (!investigation) {
      investigation = await BreakInvestigation.create({ breakId: b._id, investigatorId: req.user._id, cause: '(approved without investigation record)' });
    }
    investigation.approverId = req.user._id;
    investigation.decision = decision;
    investigation.decisionComment = String(decisionComment || '');
    investigation.decidedAt = new Date();
    investigation.history.push(`decided ${decision} by ${req.user.name} (${req.user.role}) at ${new Date().toISOString()}`);
    await investigation.save();

    b.status = decision;
    await b.save();
    await auditFor(req)({ workflowId: b.workflowId, action: `break.${decision}`, entity: 'break', entityId: b._id.toString(), before, after: { status: b.status, comment: decisionComment } });
    res.json({ break: b, investigation });
  } catch (err) {
    next(err);
  }
});

// POST /api/breaks/bulk-decide — bulk approve/reject
router.post('/bulk-decide', async (req, res, next) => {
  try {
    const { breakIds, decision, decisionComment } = req.body || {};
    if (!Array.isArray(breakIds) || !breakIds.length) return res.status(400).json({ error: 'breakIds array required' });
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });

    const breaks = await Break.find({ _id: { $in: breakIds } });
    let processed = 0;
    for (const b of breaks) {
      let inv = await BreakInvestigation.findOne({ breakId: b._id }).sort({ submittedAt: -1 });
      if (!inv) inv = await BreakInvestigation.create({ breakId: b._id, investigatorId: req.user._id, cause: '(bulk decision without investigation record)' });
      inv.approverId = req.user._id;
      inv.decision = decision;
      inv.decisionComment = String(decisionComment || '');
      inv.decidedAt = new Date();
      await inv.save();
      b.status = decision;
      await b.save();
      await auditFor(req)({ workflowId: b.workflowId, action: `break.${decision}`, entity: 'break', entityId: b._id.toString(), after: { status: decision, bulk: true } });
      processed += 1;
    }
    res.json({ processed });
  } catch (err) {
    next(err);
  }
});

function parseSimpleCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows = [];
  for (const line of lines) {
    const cells = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) {
        cells.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

// POST /api/breaks/bulk-decide/upload — CSV {break_id,decision,comment}
router.post('/bulk-decide/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const text = fs.readFileSync(req.file.path, 'utf-8');
    const rows = parseSimpleCsv(text);
    if (rows.length < 2) return res.status(422).json({ error: 'CSV must have a header row and at least one data row' });
    const header = rows[0].map((h) => h.toLowerCase().trim());
    const idx = { id: header.indexOf('break_id') >= 0 ? header.indexOf('break_id') : header.indexOf('id'), decision: header.indexOf('decision'), comment: header.indexOf('comment') };
    if (idx.id < 0 || idx.decision < 0) return res.status(422).json({ error: 'CSV must contain break_id and decision columns' });

    let processed = 0;
    const errors = [];
    for (const r of rows.slice(1)) {
      const id = r[idx.id];
      const decision = (r[idx.decision] || '').toLowerCase();
      const comment = idx.comment >= 0 ? r[idx.comment] || '' : '';
      if (!['approved', 'rejected'].includes(decision)) {
        errors.push(`row ${id}: invalid decision "${r[idx.decision]}"`);
        continue;
      }
      const b = await Break.findById(id);
      if (!b) {
        errors.push(`row ${id}: break not found`);
        continue;
      }
      let inv = await BreakInvestigation.findOne({ breakId: b._id }).sort({ submittedAt: -1 });
      if (!inv) inv = await BreakInvestigation.create({ breakId: b._id, investigatorId: req.user._id, cause: '(file-based decision without investigation record)' });
      inv.approverId = req.user._id;
      inv.decision = decision;
      inv.decisionComment = comment;
      inv.decidedAt = new Date();
      await inv.save();
      b.status = decision;
      await b.save();
      await auditFor(req)({ workflowId: b.workflowId, action: `break.${decision}`, entity: 'break', entityId: b._id.toString(), after: { status: decision, viaFile: true } });
      processed += 1;
    }
    res.json({ processed, errors });
  } catch (err) {
    next(err);
  }
});

// POST /api/breaks/:breakId/chat — grounded copilot question scoped to a break
router.post('/:breakId/chat', async (req, res, next) => {
  try {
    const b = await getBreak(req, res);
    if (!b) return;
    const { question } = req.body || {};
    if (!question) return res.status(400).json({ error: 'question required' });
    const answer = await aiCall('/ai/chat', { workflowId: b.workflowId.toString(), question, breakId: b._id.toString(), scope: 'break' });
    res.json(answer);
  } catch (err) {
    next(err);
  }
});

export default router;