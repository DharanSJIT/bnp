import { Router } from 'express';
import mongoose from 'mongoose';
import { Workflow } from '../models/Workflow.js';
import { Break } from '../models/Break.js';
import { ReconciliationRun } from '../models/ReconciliationRun.js';
import { FieldMapping } from '../models/FieldMapping.js';
import { JoinMap } from '../models/JoinMap.js';
import { RawTransaction } from '../models/RawTransaction.js';
import { BreakInvestigation } from '../models/BreakInvestigation.js';
import { auth, roleGuard } from '../middleware/auth.js';
import { auditFor } from '../services/auditService.js';
import { aiCall } from '../services/aiClient.js';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';

const router = Router();
router.use(auth);

function ownsWorkflow(workflow, userId) {
  return workflow && workflow.createdBy.toString() === userId.toString();
}

async function getOwned(req, res, next) {
  const workflow = await Workflow.findById(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  if (!ownsWorkflow(workflow, req.user._id)) return res.status(403).json({ error: 'Not your workflow' });
  return workflow;
}

// GET /api/workflows — list with derived stats for the dashboard
router.get('/', async (req, res, next) => {
  try {
    const workflows = await Workflow.find({ createdBy: req.user._id }).sort({ updatedAt: -1 }).lean();
    const ids = workflows.map((w) => w._id);
    const breakCounts = await Break.aggregate([
      { $match: { workflowId: { $in: ids }, status: { $in: ['open', 'investigating', 'pending-approval'] } } },
      { $group: { _id: '$workflowId', openBreaks: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(breakCounts.map((b) => [b._id.toString(), b.openBreaks]));
    const result = workflows.map((w) => ({
      ...w,
      openBreaks: countMap[w._id.toString()] || 0,
    }));
    res.json({ workflows: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/workflows/:id
router.get('/:id', async (req, res, next) => {
  try {
    const workflow = await getOwned(req, res);
    if (!workflow) return;
    const [mapping, joinMap, runs] = await Promise.all([
      FieldMapping.findOne({ workflowId: workflow._id }).lean(),
      JoinMap.findOne({ workflowId: workflow._id, period: workflow.period }).lean(),
      ReconciliationRun.find({ workflowId: workflow._id }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    res.json({ workflow, mapping: mapping || null, joinMap: joinMap || null, recentRuns: runs });
  } catch (err) {
    next(err);
  }
});

// POST /api/workflows — register a new workflow (draft)
router.post('/', async (req, res, next) => {
  try {
    const kbPath = path.resolve(config.rootDir, '../chatbot/knowledge_base');
    if (fs.existsSync(kbPath)) {
      fs.rmSync(kbPath, { recursive: true, force: true });
    }
    fs.mkdirSync(kbPath, { recursive: true });

    const { name, period, sources } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Workflow name required' });
    if (!Array.isArray(sources) || sources.length < 2) {
      return res.status(400).json({ error: 'At least 2 data sources are required' });
    }
    for (const s of sources) {
      if (!['file', 'api', 'db'].includes(s.ingestionType)) {
        return res.status(400).json({ error: `Invalid ingestion type: ${s.ingestionType}` });
      }
    }
    const duplicate = await Workflow.findOne({ createdBy: req.user._id, name: String(name).trim() });
    if (duplicate) return res.status(409).json({ error: 'Workflow name already exists for this user' });

    const workflow = await Workflow.create({
      name: String(name).trim(),
      period: String(period || '').trim(),
      createdBy: req.user._id,
      sources: sources.map((s, i) => ({
        sourceId: s.sourceId || `src-${i + 1}`,
        displayName: s.displayName || `Source ${i + 1}`,
        ingestionType: s.ingestionType,
        config: s.config || {},
      })),
      rulesFile: '',
      validationAcknowledged: false,
      status: 'draft',
    });
    await auditFor(req)({ workflowId: workflow._id, action: 'workflow.created', entity: 'workflow', entityId: workflow._id.toString(), after: { name: workflow.name, period: workflow.period } });
    res.status(201).json({ workflow });
  } catch (err) {
    next(err);
  }
});

// PUT /api/workflows/:id
router.put('/:id', async (req, res, next) => {
  try {
    const workflow = await getOwned(req, res);
    if (!workflow) return;
    const before = workflow.toSafeJSON ? workflow.toSafeJSON() : { name: workflow.name, period: workflow.period, status: workflow.status };

    if (req.body.name !== undefined) workflow.name = String(req.body.name).trim();
    if (req.body.period !== undefined) workflow.period = String(req.body.period || '').trim();
    if (req.body.status !== undefined && ['draft', 'configured', 'ready', 'archived'].includes(req.body.status)) {
      workflow.status = req.body.status;
    }
    if (req.body.sources !== undefined && Array.isArray(req.body.sources)) {
      workflow.sources = req.body.sources.map((s) => ({
        sourceId: s.sourceId,
        displayName: s.displayName,
        ingestionType: s.ingestionType,
        config: s.config || {},
        ingestStatus: s.ingestStatus || workflow.sources.find((x) => x.sourceId === s.sourceId)?.ingestStatus || 'not-started',
        loadStats: s.loadStats || workflow.sources.find((x) => x.sourceId === s.sourceId)?.loadStats,
      }));
    }
    if (req.body.outboundConfig !== undefined) workflow.outboundConfig = req.body.outboundConfig;
    if (req.body.rulesFile !== undefined) workflow.rulesFile = req.body.rulesFile;

    await workflow.save();
    await auditFor(req)({ workflowId: workflow._id, action: 'workflow.updated', entity: 'workflow', entityId: workflow._id.toString(), before, after: { name: workflow.name, period: workflow.period, status: workflow.status } });
    res.json({ workflow });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/workflows/:id — cascade delete children
router.delete('/:id', async (req, res, next) => {
  try {
    const workflow = await getOwned(req, res);
    if (!workflow) return;
    const wfId = workflow._id;
    await Workflow.deleteOne({ _id: wfId });
    await RawTransaction.deleteMany({ workflowId: wfId });
    const runs = await ReconciliationRun.find({ workflowId: wfId }).select('_id').lean();
    const runIds = runs.map((r) => r._id);
    await ReconciliationRun.deleteMany({ workflowId: wfId });
    const breaks = await Break.find({ workflowId: wfId }).select('_id').lean();
    const breakIds = breaks.map((b) => b._id);
    await Break.deleteMany({ workflowId: wfId });
    await BreakInvestigation.deleteMany({ breakId: { $in: breakIds } });
    await FieldMapping.deleteMany({ workflowId: wfId });
    await JoinMap.deleteMany({ workflowId: wfId });
    await auditFor(req)({ workflowId: wfId, action: 'workflow.deleted', entity: 'workflow', entityId: wfId.toString(), before: { name: workflow.name } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/workflows/:id/run — orchestrate a reconciliation run
router.post('/:id/run', async (req, res, next) => {
  const workflow = await getOwned(req, res);
  if (!workflow) return;
  try {
    const ingested = workflow.sources.filter((s) => s.ingestStatus === 'ingested');
    if (ingested.length < 2) {
      return res.status(400).json({ error: 'At least 2 sources must be ingested before running' });
    }
    const existing = await ReconciliationRun.findOne({ workflowId: workflow._id, status: 'running' });
    if (existing) return res.status(409).json({ error: 'A run is already in progress' });

    const run = await ReconciliationRun.create({
      workflowId: workflow._id,
      period: workflow.period || '',
      status: 'running',
      startedAt: new Date(),
      runBy: req.user._id,
      approvalStatus: 'pending',
    });
    // snapshot the mapping in use for run-to-run comparison
    const fmSnapshot = await FieldMapping.findOne({ workflowId: workflow._id }).lean();
    run.mappingsSnapshot = fmSnapshot ? { mappings: fmSnapshot.mappings, updatedAt: fmSnapshot.updatedAt } : { mappings: [] };
    await run.save();
    await auditFor(req)({ workflowId: workflow._id, action: 'run.started', entity: 'reconciliation_run', entityId: run._id.toString() });

    try {
      const result = await aiCall('/ai/reconcile', {
        workflowId: workflow._id.toString(),
        runId: run._id.toString(),
        period: workflow.period || '',
      });

      run.status = 'success';
      run.completedAt = new Date();
      run.counts = result.counts || run.counts;
      run.matchRate = result.matchRate || 0;
      run.totals = result.totals || run.totals;
      if (result.error) run.error = result.error;
      await run.save();

      workflow.lastRunId = run._id;
      workflow.lastRunStatus = run.status;
      workflow.lastMatchRate = run.matchRate;
      workflow.lastRunAt = new Date();
      await workflow.save();

      await auditFor(req)({ workflowId: workflow._id, action: 'run.completed', entity: 'reconciliation_run', entityId: run._id.toString(), after: { status: run.status, matchRate: run.matchRate, breaks: run.counts.breaks } });
      res.json({ run, summary: result.summary || null });
    } catch (err) {
      run.status = 'failed';
      run.completedAt = new Date();
      run.error = err.response?.data?.detail || err.message;
      await run.save();
      workflow.lastRunId = run._id;
      workflow.lastRunStatus = 'failed';
      workflow.lastRunAt = new Date();
      await workflow.save();
      await auditFor(req)({ workflowId: workflow._id, action: 'run.failed', entity: 'reconciliation_run', entityId: run._id.toString(), after: { error: run.error } });
      res.status(502).json({ error: run.error || 'Reconciliation failed', run });
    }
  } catch (err) {
    next(err);
  }
});

export default router;