import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { ReconciliationRun } from '../models/ReconciliationRun.js';
import { Workflow } from '../models/Workflow.js';
import { Break } from '../models/Break.js';
import { Report } from '../models/Report.js';
import { JoinMap } from '../models/JoinMap.js';
import { RawTransaction } from '../models/RawTransaction.js';
import { User } from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { auditFor } from '../services/auditService.js';
import { exportData } from '../services/exportService.js';
import { sendReportEmail } from '../services/emailService.js';

const router = Router();
router.use(auth);

const REPORT_FORMATS = ['csv', 'xlsx', 'json', 'pdf', 'xml', 'text'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getRun(req, res) {
  const run = await ReconciliationRun.findById(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  return run;
}

// GET /api/reports?workflowId=&runId= — list generated reports (history)
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.workflowId) filter.workflowId = req.query.workflowId;
    if (req.query.runId) filter.runId = req.query.runId;
    const reports = await Report.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:runId — dashboard payload for Reports screen
router.get('/:runId', async (req, res, next) => {
  try {
    const run = await getRun(req, res);
    if (!run) return;
    const [breaks, byType, byStatus, priorRuns, top10] = await Promise.all([
      Break.find({ runId: run._id }).sort({ priorityScore: -1 }).limit(500).lean(),
      Break.aggregate([{ $match: { runId: run._id } }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
      Break.aggregate([{ $match: { runId: run._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      ReconciliationRun.find({ workflowId: run.workflowId, status: 'success' }).sort({ startedAt: -1 }).limit(12).lean(),
      Break.find({ runId: run._id }).sort({ materiality: -1 }).limit(10).lean(),
    ]);
    const trend = await Promise.all(
      priorRuns.map(async (r) => ({
        runId: r._id,
        startedAt: r.startedAt,
        status: r.status,
        matchRate: r.matchRate,
        breaks: await Break.countDocuments({ runId: r._id }),
      }))
    );
    res.json({
      run,
      totalBreaks: breaks.length,
      byType: Object.fromEntries(byType.map((s) => [s._id, s.count])),
      byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
      trend,
      top10,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- email delivery ----------

// Users/roles who may act on a run's report: admins and the workflow owner.
async function canHandleRun(req, run) {
  if (req.user.role === 'admin') return true;
  const workflow = await Workflow.findById(run.workflowId).lean();
  return !!workflow && workflow.createdBy.toString() === req.user._id.toString();
}

// Suggested recipients for the current workflow/run: the outbound "notify email"
// configured for the workflow, the workflow owner, and the user who ran it.
async function resolveReportRecipients(workflow, run) {
  const defaults = [];
  if (workflow?.outboundConfig?.email) defaults.push(String(workflow.outboundConfig.email).trim());
  if (workflow?.createdBy) {
    const owner = await User.findById(workflow.createdBy).lean();
    if (owner) defaults.push(owner.email);
  }
  if (run.runBy) {
    const runner = await User.findById(run.runBy).lean();
    if (runner) defaults.push(runner.email);
  }
  const candidates = await User.find({ active: true }).select('name email role').sort({ name: 1 }).lean();
  const uniqueDefaults = [...new Set(defaults.map((e) => String(e).toLowerCase().trim()).filter(Boolean))];
  return { defaults: uniqueDefaults, candidates };
}

// Generate the report document, attach it to an email, record the delivery and audit it.
// Reused by the manual "email report" endpoint and by auto-delivery after a run completes.
export async function deliverReportByEmail({ req, run, workflow, to, format = 'xlsx', subject, message }) {
  const breaks = await Break.find({ runId: run._id }).sort({ priorityScore: -1 }).lean();
  const rows = breaks.map(flatBreak);
  const meta = {
    runId: run._id.toString(),
    workflowId: run.workflowId.toString(),
    period: run.period,
    status: run.status,
    matchRate: `${(run.matchRate * 100).toFixed(2)}%`,
    counts: run.counts,
    totals: run.totals,
    notes: 'Final decisions rest with authorized personnel.',
  };
  const filePath = await exportData({
    format,
    fileName: `run_${run._id}_break_report`,
    title: `OneRecon Break Report — Run ${run._id} (period ${run.period || 'n/a'})`,
    meta,
    rows,
    sheets: format === 'xlsx' ? { BreakSummary: rows } : undefined,
  });
  const fileName = filePath.split('/').pop();
  const info = await sendReportEmail({
    to,
    subject: subject || `OneRecon Break Report — ${workflow?.name || run._id}`,
    message,
    filePath,
    fileName,
  });
  await Report.create({
    workflowId: run.workflowId,
    runId: run._id,
    type: 'summary',
    format,
    fileName,
    filePath,
    meta: { delivery: 'email', sentTo: to, messageId: info?.messageId || '', count: rows.length },
  });
  await auditFor(req)({
    workflowId: run.workflowId,
    action: 'report.emailed',
    entity: 'report',
    entityId: run._id.toString(),
    after: { to, format, messageId: info?.messageId || '' },
  });
  return info;
}

// GET /api/reports/:runId/email-recipients — recipient suggestions + user directory for the email modal
router.get('/:runId/email-recipients', async (req, res, next) => {
  try {
    const run = await getRun(req, res);
    if (!run) return;
    if (!(await canHandleRun(req, run))) return res.status(403).json({ error: 'Not your workflow' });
    const workflow = await Workflow.findById(run.workflowId).lean();
    const { defaults, candidates } = await resolveReportRecipients(workflow, run);
    const visible = req.user.role === 'admin'
      ? candidates
      : candidates.filter((c) => defaults.includes(c.email));
    res.json({
      runId: run._id,
      workflowName: workflow?.name || '',
      period: run.period || workflow?.period || '',
      defaults,
      formats: REPORT_FORMATS,
      candidates: visible,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/:runId/email — send the report document to the given recipients
router.post('/:runId/email', async (req, res, next) => {
  try {
    const run = await getRun(req, res);
    if (!run) return;
    if (!(await canHandleRun(req, run))) return res.status(403).json({ error: 'Not your workflow' });
    if (run.status !== 'success') return res.status(400).json({ error: 'Only a completed run can be emailed' });

    const { to, format = 'xlsx', subject, message } = req.body || {};
    const toList = (Array.isArray(to) ? to : String(to || '').split(/[,\s;]+/))
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean);
    if (toList.length === 0) return res.status(400).json({ error: 'At least one recipient email is required' });
    const invalid = toList.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length) return res.status(400).json({ error: `Invalid email address(es): ${invalid.join(', ')}` });
    const fmt = REPORT_FORMATS.includes(format) ? format : 'xlsx';

    const workflow = await Workflow.findById(run.workflowId).lean();
    const emailSubject = subject || `OneRecon Break Report — ${workflow?.name || run._id}`;
    const info = await deliverReportByEmail({ req, run, workflow, to: toList, format: fmt, subject: emailSubject, message });

    res.json({ message: `Report (${fmt}) emailed to ${toList.join(', ')}`, to: toList, format: fmt, messageId: info?.messageId });
  } catch (err) {
    res.status(502).json({ error: `Email delivery failed: ${err.message}` });
  }
});

function flatBreak(b) {
  return {
    break_id: b._id.toString(),
    type: b.type,
    key: b.key,
    dimension: b.dimension || '',
    sources_involved: (b.sourcesInvolved || []).join('|'),
    expected: b.expected,
    actual: b.actual,
    variance: b.variance,
    materiality: b.materiality,
    priority_score: b.priorityScore,
    status: b.status,
    ai_root_cause: b.aiRootCause || '',
  };
}

// GET /api/reports/:runId/export?format=csv|xlsx|json|pdf
router.get('/:runId/export', async (req, res, next) => {
  try {
    const run = await getRun(req, res);
    if (!run) return;
    const format = ['csv', 'xlsx', 'json', 'pdf', 'xml', 'text'].includes(req.query.format) ? req.query.format : 'xlsx';
    const breaks = await Break.find({ runId: run._id }).sort({ priorityScore: -1 }).lean();
    const rows = breaks.map(flatBreak);

    const meta = {
      runId: run._id.toString(),
      workflowId: run.workflowId.toString(),
      period: run.period,
      status: run.status,
      matchRate: `${(run.matchRate * 100).toFixed(2)}%`,
      counts: run.counts,
      totals: run.totals,
      notes: 'Final decisions rest with authorized personnel.',
    };

    const filePath = await exportData({
      format,
      fileName: `run_${run._id}_break_report`,
      title: `OneRecon Break Report — Run ${run._id} (period ${run.period || 'n/a'})`,
      meta,
      rows,
      sheets: format === 'xlsx' ? { BreakSummary: rows } : undefined,
    });

    const report = await Report.create({
      workflowId: run.workflowId,
      runId: run._id,
      type: 'summary',
      format,
      fileName: filePath.split('/').pop(),
      filePath,
      meta: { count: rows.length },
    });
    await auditFor(req)({ workflowId: run.workflowId, action: 'report.exported', entity: 'report', entityId: report._id.toString(), after: { format, count: rows.length } });
    res.download(filePath);
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/compare — Comparison Module (cross-system & run-to-run)
router.post('/compare', async (req, res, next) => {
  try {
    const { workflowId, mode, a, b, groupBy, tolerance = 0 } = req.body || {};
    if (!workflowId || !mode || !a || !b) return res.status(400).json({ error: 'workflowId, mode, a, b required' });
    if (!['cross-system', 'run-to-run'].includes(mode)) return res.status(400).json({ error: 'mode must be cross-system or run-to-run' });

    if (mode === 'run-to-run') {
      const [runA, runB] = await Promise.all([ReconciliationRun.findById(a.runId), ReconciliationRun.findById(b.runId)]);
      if (!runA || !runB) return res.status(404).json({ error: 'One of the runs was not found' });
      const [breaksA, breaksB] = await Promise.all([Break.find({ runId: runA._id }).lean(), Break.find({ runId: runB._id }).lean()]);
      const keysA = new Set(breaksA.map((x) => x.key));
      const keysB = new Set(breaksB.map((x) => x.key));
      const newlyAppeared = breaksB.filter((x) => !keysA.has(x.key));
      const resolved = breaksA.filter((x) => !keysB.has(x.key));
      const mappingDiff = mappingSnapshotDiff(runA.mappingsSnapshot, runB.mappingsSnapshot);
      const payload = {
        mode: 'run-to-run',
        a: { runId: runA._id, startedAt: runA.startedAt, matchRate: runA.matchRate, breaks: breaksA.length, totals: runA.totals },
        b: { runId: runB._id, startedAt: runB.startedAt, matchRate: runB.matchRate, breaks: breaksB.length, totals: runB.totals },
        deltas: {
          matchRate: round6(runB.matchRate - runA.matchRate),
          breakCount: breaksB.length - breaksA.length,
          newlyAppeared: newlyAppeared.length,
          resolved: resolved.length,
        },
        newlyAppeared: newlyAppeared.slice(0, 50).map(flatBreak),
        resolved: resolved.slice(0, 50).map(flatBreak),
        mappingDiff,
      };
      await auditFor(req)({ workflowId, action: 'report.compare.run-to-run', entity: 'reconciliation_run', entityId: `${runA._id}..${runB._id}` });
      return res.json(payload);
    }

    // cross-system
    const workflow = await Workflow.findById(workflowId);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    const joinMap = await JoinMap.findOne({ workflowId, period: workflow.period || '' }).lean();
    const jm = buildJoinMapIndex(joinMap?.rows || []);

    const loadRow = async (sourceId) => {
      const src = workflow.sources.find((s) => s.sourceId === sourceId);
      const loadId = src?.loadStats?.lastLoadId;
      if (!src || !loadId) return null;
      return RawTransaction.find({ workflowId, sourceId, loadId }).lean();
    };

    const rowsA = await loadRow(a.sourceId);
    const rowsB = await loadRow(b.sourceId);
    if (!rowsA || !rowsB) return res.status(400).json({ error: `One of the sources (${a.sourceId}/${b.sourceId}) has no ingested load` });
    const srcA = workflow.sources.find((s) => s.sourceId === a.sourceId);
    const srcB = workflow.sources.find((s) => s.sourceId === b.sourceId);

    const dim = groupBy || 'gl_account_id';
    const sumsA = aggregateByDim(rowsA, srcA.sourceId, dim, jm);
    const sumsB = aggregateByDim(rowsB, srcB.sourceId, dim, jm);
    const allDims = new Set([...sumsA.keys(), ...sumsB.keys()]);
    const tol = Number(tolerance) || 0;

    const table = [...allDims]
      .map((key) => {
        const expected = round2(sumsA.get(key) || 0);
        const actual = round2(sumsB.get(key) || 0);
        const variance = round2(actual - expected);
        return {
          dimension: key,
          aTotal: expected,
          bTotal: actual,
          variance,
          variancePct: expected !== 0 ? round4((variance / expected) * 100) : (variance !== 0 ? 100 : 0),
          status: Math.abs(variance) <= tol ? 'matched' : 'break',
        };
      })
      .sort((x, y) => Math.abs(y.variance) - Math.abs(x.variance));

    const grandA = round2(table.reduce((s, r) => s + r.aTotal, 0));
    const grandB = round2(table.reduce((s, r) => s + r.bTotal, 0));
    const grandVariance = round2(grandB - grandA);
    const breakingRows = table.filter((r) => r.status === 'break');
    const topDrivers = breakingRows.slice(0, 3).map((r) => `${r.dimension} (±${Math.abs(r.variance).toLocaleString()})`).join(', ');
    const execSummary = `Report A (${srcA.displayName}) totals ${grandA.toLocaleString()} across ${sumsA.size} ${dim} groups; Report B (${srcB.displayName}) totals ${grandB.toLocaleString()} across ${sumsB.size}. Overall variance is ${grandVariance >= 0 ? '+' : ''}${grandVariance.toLocaleString()} (${table.length ? round4((grandVariance / (grandA || 1)) * 100) : 0}%). ${breakingRows.length} of ${table.length} groups break; the variance is primarily due to ${topDrivers || 'no material groups'}.`;

    const payload = {
      mode: 'cross-system',
      a: { sourceId: a.sourceId, displayName: srcA.displayName },
      b: { sourceId: b.sourceId, displayName: srcB.displayName },
      groupBy: dim,
      tolerance: tol,
      grand: { a: grandA, b: grandB, variance: grandVariance },
      table,
      breakingCount: breakingRows.length,
      execSummary,
    };
    await auditFor(req)({ workflowId, action: 'report.compare.cross-system', entity: 'workflow', entityId: workflowId, after: { a: srcA.displayName, b: srcB.displayName, groupBy: dim } });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:runId/compare-export?format=&mode=&a=&b=&groupBy=
router.get('/:runId/compare-export', async (req, res, next) => {
  try {
    const run = await getRun(req, res);
    if (!run) return;
    const format = ['csv', 'xlsx', 'json', 'pdf', 'xml', 'text'].includes(req.query.format) ? req.query.format : 'xlsx';
    const workflow = await Workflow.findById(run.workflowId);
    const body = {
      workflowId: run.workflowId.toString(),
      mode: req.query.mode || 'cross-system',
      a: { sourceId: req.query.aSource, runId: req.query.aRun },
      b: { sourceId: req.query.bSource, runId: req.query.bRun },
      groupBy: req.query.groupBy || 'gl_account_id',
      tolerance: Number(req.query.tolerance || 0),
    };
    let payload;
    try {
      payload = await buildComparison(null, body, workflow);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const rows = payload.table ? payload.table : [
      { metric: 'matchRate', a: payload.a.matchRate, b: payload.b.matchRate, delta: payload.deltas.matchRate },
      { metric: 'breakCount', a: payload.a.breaks, b: payload.b.breaks, delta: payload.deltas.breakCount },
    ];
    const filePath = await exportData({
      format,
      fileName: `comparison_${payload.mode}`,
      title: `OneRecon Comparison — ${payload.mode}`,
      meta: { ...payload, workflowId: workflow._id.toString(), note: 'Final decisions rest with authorized personnel.' },
      rows,
    });
    const report = await Report.create({ workflowId: run.workflowId, runId: run._id, type: 'comparison', format, fileName: filePath.split('/').pop(), filePath, meta: { mode: payload.mode } });
    await auditFor(req)({ workflowId: run.workflowId, action: 'report.compare.exported', entity: 'report', entityId: report._id.toString(), after: { mode: payload.mode, format } });
    res.download(filePath);
  } catch (err) {
    next(err);
  }
});

async function buildComparison(req, body, workflow) {
  const { mode, a, b, groupBy, tolerance = 0 } = body;
  if (mode === 'run-to-run') {
    const [runA, runB] = await Promise.all([ReconciliationRun.findById(a.runId), ReconciliationRun.findById(b.runId)]);
    if (!runA || !runB) throw new Error('One of the runs was not found');
    const [breaksA, breaksB] = await Promise.all([Break.find({ runId: runA._id }).lean(), Break.find({ runId: runB._id }).lean()]);
    const keysA = new Set(breaksA.map((x) => x.key));
    const keysB = new Set(breaksB.map((x) => x.key));
    return {
      mode: 'run-to-run',
      a: { runId: runA._id, startedAt: runA.startedAt, matchRate: runA.matchRate, breaks: breaksA.length },
      b: { runId: runB._id, startedAt: runB.startedAt, matchRate: runB.matchRate, breaks: breaksB.length },
      deltas: { matchRate: round6(runB.matchRate - runA.matchRate), breakCount: breaksB.length - breaksA.length, newlyAppeared: breaksB.filter((x) => !keysA.has(x.key)).length, resolved: breaksA.filter((x) => !keysB.has(x.key)).length },
      mappingDiff: mappingSnapshotDiff(runA.mappingsSnapshot, runB.mappingsSnapshot),
    };
  }
  const jm = buildJoinMapIndex((await JoinMap.findOne({ workflowId: workflow._id, period: workflow.period || '' }).lean())?.rows || []);
  const load = async (sid) => {
    const src = workflow.sources.find((s) => s.sourceId === sid);
    const loadId = src?.loadStats?.lastLoadId;
    if (!src || !loadId) return null;
    return RawTransaction.find({ workflowId: workflow._id, sourceId: sid, loadId }).lean();
  };
  const [rowsA, rowsB] = [await load(a.sourceId), await load(b.sourceId)];
  if (!rowsA || !rowsB) throw new Error('One of the sources has no ingested load');
  const srcA = workflow.sources.find((s) => s.sourceId === a.sourceId);
  const srcB = workflow.sources.find((s) => s.sourceId === b.sourceId);
  const dim = groupBy || 'gl_account_id';
  const sumsA = aggregateByDim(rowsA, srcA.sourceId, dim, jm);
  const sumsB = aggregateByDim(rowsB, srcB.sourceId, dim, jm);
  const tol = Number(tolerance) || 0;
  const allDims = new Set([...sumsA.keys(), ...sumsB.keys()]);
  const table = [...allDims].map((key) => {
    const expected = round2(sumsA.get(key) || 0);
    const actual = round2(sumsB.get(key) || 0);
    const variance = round2(actual - expected);
    return { dimension: key, aTotal: expected, bTotal: actual, variance, variancePct: expected !== 0 ? round4((variance / expected) * 100) : (variance !== 0 ? 100 : 0), status: Math.abs(variance) <= tol ? 'matched' : 'break' };
  }).sort((x, y) => Math.abs(y.variance) - Math.abs(x.variance));
  const grandA = round2(table.reduce((s, r) => s + r.aTotal, 0));
  const grandB = round2(table.reduce((s, r) => s + r.bTotal, 0));
  const breaking = table.filter((r) => r.status === 'break');
  return {
    mode: 'cross-system',
    a: { sourceId: a.sourceId, displayName: srcA.displayName },
    b: { sourceId: b.sourceId, displayName: srcB.displayName },
    groupBy: dim,
    tolerance: tol,
    grand: { a: grandA, b: grandB, variance: round2(grandB - grandA) },
    table,
    breakingCount: breaking.length,
    execSummary: `Report A (${srcA.displayName}) totals ${grandA.toLocaleString()}; Report B (${srcB.displayName}) totals ${grandB.toLocaleString()}; variance ${round2(grandB - grandA)}. ${breaking.length} breaking groups, primarily ${breaking.slice(0, 3).map((r) => r.dimension).join(', ') || 'none'}.`,
  };
}

// ---- helpers ----

function buildJoinMapIndex(rows) {
  const byGL = new Map();
  const byMA = new Map();
  const byFA = new Map();
  for (const r of rows) {
    if (r.gl_account_id) byGL.set(r.gl_account_id, r);
    if (r.ma_customer_key) byMA.set(r.ma_customer_key, r);
    if (r.fa_key) byFA.set(r.fa_key, r);
  }
  return { byGL, byMA, byFA };
}

function resolveDimension(row, sourceId, dim, jm) {
  if (dim === 'TransactionID') return row.TransactionID;
  if (row[dim] !== undefined && row[dim] !== null && row[dim] !== '') return row[dim];
  const keyField = sourceId === 'GL' ? 'gl_account_id' : sourceId === 'MA' ? 'ma_customer_key' : sourceId === 'FA' ? 'fa_key' : null;
  if (!keyField) return '';
  const val = row[keyField];
  if (!val) return '';
  const jmRow = jm.byGL.get(val) || jm.byMA.get(val) || jm.byFA.get(val);
  if (!jmRow) return `(unmapped:${val})`;
  return jmRow[dim] ?? jmRow[dim.toLowerCase()] ?? '';
}

function aggregateByDim(rows, sourceId, dim, jm) {
  const sums = new Map();
  for (const { row } of rows) {
    const key = resolveDimension(row, sourceId, dim, jm);
    const amt = Number(row.Amount || row.amount || 0);
    if (!key) continue;
    sums.set(key, round2((sums.get(key) || 0) + (Number.isFinite(amt) ? amt : 0)));
  }
  return sums;
}

function mappingSnapshotDiff(a, b) {
  if (!a || !b) return { changed: false, reason: 'one run lacks a mapping snapshot' };
  const normalize = (m) => JSON.stringify(m.mappings?.map((g) => ({ id: g.targetGroupId, fields: g.fields.map((f) => `${f.sourceId}:${f.fieldName}`).sort(), isReconcile: g.isReconcileField })).sort((x, y) => x.id.localeCompare(y.id)));
  if (normalize(a) === normalize(b)) return { changed: false };
  return { changed: true, diff: 'field mappings differ between the two runs — see mappings snapshot' };
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const round6 = (n) => Math.round((n + Number.EPSILON) * 1000000) / 1000000;

export default router;