import { Router } from 'express';
import mongoose from 'mongoose';
import { ReconciliationRun } from '../models/ReconciliationRun.js';
import { Workflow } from '../models/Workflow.js';
import { Break } from '../models/Break.js';
import { Report } from '../models/Report.js';
import { auth, roleGuard } from '../middleware/auth.js';

const router = Router();
router.use(auth);

async function getRun(req, res) {
  const run = await ReconciliationRun.findById(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  return run;
}

// GET /api/runs — global processed-history (all runs across workflows).
// Every authenticated user can view the full history and download reports.
router.get('/', async (req, res, next) => {
  try {
    let flights;
    if (req.user.role === 'admin') {
      flights = await ReconciliationRun.find().sort({ createdAt: -1 }).limit(300).lean();
    } else {
      const userWorkflows = await Workflow.find({ createdBy: req.user._id }).select('_id').lean();
      const userWorkflowIds = userWorkflows.map(w => w._id);
      flights = await ReconciliationRun.find({ workflowId: { $in: userWorkflowIds } }).sort({ createdAt: -1 }).limit(300).lean();
    }

    const workflowIds = [...new Set(flights.map((r) => r.workflowId))];
    const workflows = await Workflow.find({ _id: { $in: workflowIds } }).select('name period createdBy').lean();
    const wfMap = Object.fromEntries(workflows.map((w) => [w._id.toString(), w]));
    const runIds = flights.map((r) => r._id);
    const reportStats = await Report.aggregate([
      { $match: { runId: { $in: runIds } } },
      { $group: { _id: '$runId', count: { $sum: 1 }, formats: { $addToSet: '$format' } } },
    ]);
    const reportMap = Object.fromEntries(reportStats.map((s) => [s._id.toString(), { count: s.count, formats: s.formats }]));

    const runs = await Promise.all(
      flights.map(async (r) => ({
        ...r,
        workflow: wfMap[r.workflowId.toString()]
          ? { name: wfMap[r.workflowId.toString()].name, period: wfMap[r.workflowId.toString()].period }
          : null,
        reportCount: reportMap[r._id.toString()]?.count || 0,
        reportFormats: reportMap[r._id.toString()]?.formats || [],
        openBreakCount: await Break.countDocuments({ runId: r._id, type: { $ne: 'anomaly' }, status: { $in: ['open', 'investigating', 'pending-approval'] } }),
      }))
    );
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

// GET /api/runs/analytics — analytics dashboard built from the *actual* processed runs.
// Optional ?workflowId= scopes the dashboard to one workflow (admins may scope to any
// workflow, everyone else only to their own). Without it, returns global analytics
// across every workflow the user is allowed to see. Nothing here is fabricated:
// every KPI and chart series is computed from the reconciled runs, break ledger and
// per-source load stats.
router.get('/analytics', async (req, res, next) => {
  try {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthKey = (d) => `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;

    // 1. Workflows this user may analyze (admins: all, others: their own).
    const workflows = req.user.role === 'admin'
      ? await Workflow.find().lean()
      : await Workflow.find({ createdBy: req.user._id }).lean();

    // 2. Optional workflow scope with ownership check.
    let scopeWorkflow = null;
    if (req.query.workflowId) {
      scopeWorkflow = workflows.find((w) => w._id.toString() === String(req.query.workflowId));
      if (!scopeWorkflow) return res.status(403).json({ error: 'Workflow not found or not accessible' });
    }
    const scopeWorkflowIds = (scopeWorkflow ? [scopeWorkflow] : workflows).map((w) => w._id);
    const runFilter = { workflowId: { $in: scopeWorkflowIds } };

    const runs = await ReconciliationRun.find(runFilter).sort({ startedAt: 1 }).lean();
    const buildSummary = () => {
      const latest = runs[runs.length - 1] || null;
      const latestRecords = latest ? Object.values(latest.counts?.bySource || {}).reduce((s, n) => s + (Number(n) || 0), 0) : 0;
      return {
        workflowId: scopeWorkflow?._id || null,
        workflowName: scopeWorkflow?.name || (req.user.role === 'admin' ? 'All workflows' : 'My workflows'),
        period: scopeWorkflow?.period || latest?.period || '',
        runCount: runs.length,
        latestRun: latest
          ? {
              id: latest._id,
              startedAt: latest.startedAt,
              status: latest.status,
              matchRate: latest.matchRate,
              records: latestRecords,
              breaks: latest.counts?.breaks || 0,
            }
          : null,
        generatedAt: new Date().toISOString(),
      };
    };
    if (runs.length === 0) {
      return res.json({ summary: buildSummary(), kpi: [], trend: [], rootCause: [], aging: [], systemVolume: [] });
    }

    // 3. Aggregate the real run metrics (per-month for trend + KPI deltas).
    const byMonth = new Map();
    const perSourceRecords = new Map(); // sourceId -> total records processed
    const perSourceAmounts = new Map();  // sourceId -> total value processed
    let totalRecords = 0;
    let totalMatched = 0;
    let totalBreaks = 0;
    let totalVolume = 0;
    for (const r of runs) {
      const counts = r.counts || {};
      const totals = r.totals || {};
      const records = Object.values(counts.bySource || {}).reduce((s, n) => s + (Number(n) || 0), 0);
      const matched = Number(counts.matched) || 0;
      const breaks = Number(counts.breaks) || 0;
      const volume = Number(totals.periodTotal) || Object.values(totals.bySource || {}).reduce((s, n) => s + (Number(n) || 0), 0);
      totalRecords += records;
      totalMatched += matched;
      totalBreaks += breaks;
      totalVolume += volume;
      for (const [sid, n] of Object.entries(counts.bySource || {})) perSourceRecords.set(sid, (perSourceRecords.get(sid) || 0) + (Number(n) || 0));
      for (const [sid, amt] of Object.entries(totals.bySource || {})) perSourceAmounts.set(sid, (perSourceAmounts.get(sid) || 0) + (Number(amt) || 0));
      const k = monthKey(new Date(r.startedAt || r.createdAt));
      if (!byMonth.has(k)) byMonth.set(k, { name: k, matched: 0, exceptions: 0, records: 0, volume: 0 });
      const m = byMonth.get(k);
      m.matched += matched;
      m.exceptions += breaks;
      m.records += records;
      m.volume += volume;
    }
    const months = [...byMonth.values()];
    const trendData = months.slice(-6);
    const current = months[months.length - 1];
    const previous = months[months.length - 2];

    // 4. Break-ledger state for the runs in scope. AI anomaly flags are
    // advisory outliers, not breaks — they are excluded from every break KPI.
    const runIds = runs.map((r) => r._id);
    const breakRunFilter = { runId: { $in: runIds }, type: { $ne: 'anomaly' } };
    const openBreakFilter = { ...breakRunFilter, status: { $in: ['open', 'investigating', 'pending-approval'] } };
    const [totalBreakDocs, openBreakDocs] = await Promise.all([
      Break.countDocuments(breakRunFilter),
      Break.countDocuments(openBreakFilter),
    ]);
    const resolvedBreaks = Math.max(totalBreakDocs - openBreakDocs, 0);
    const resolutionRate = totalBreakDocs > 0 ? (resolvedBreaks / totalBreakDocs) * 100 : 0;

    // 5. Root-cause categories derived from the actual break evidence (never dummy splits).
    const rootCauseData = await buildRootCauseData(breakRunFilter);

    // 6. Aging of open breaks bucketed from real createdAt timestamps.
    const agingData = await buildAgingData(openBreakFilter);

    // 7. Per-source processing volume from the real run counts.
    const systemVolumeData = buildSystemVolume(workflows, perSourceRecords, perSourceAmounts);

    const overallMatchRate = totalRecords > 0 ? (totalMatched / totalRecords) * 100 : 0;
    const openShare = totalBreakDocs > 0 ? (openBreakDocs / totalBreakDocs) * 100 : 0;

    // The "current books" position comes from the latest run; cumulative totals
    // (volume/records) count every processed run so re-runs are labelled as such.
    const latestRun = runs[runs.length - 1];
    const latestCounts = latestRun.counts || {};
    const latestRecords = Object.values(latestCounts.bySource || {}).reduce((s, n) => s + (Number(n) || 0), 0);
    const latestMatchRate = latestRun.matchRate != null ? Number(latestRun.matchRate) * 100 : overallMatchRate;

    const kpi = [
      {
        label: 'Total Processed Volume',
        value: `$${(totalVolume / 1e6).toFixed(1)}M`,
        secondary: `${totalRecords.toLocaleString()} records`,
        trend: `Across ${runs.length} processed run${runs.length === 1 ? '' : 's'}`,
        trendUp: true,
      },
      {
        label: 'Overall Match Rate',
        value: `${latestMatchRate.toFixed(1)}%`,
        secondary: `Latest run · ${latestRecords.toLocaleString()} records`,
        trend: matchRateTrend(previous, current),
        trendUp: latestMatchRate >= 95,
      },
      {
        label: 'Unresolved Breaks',
        value: openBreakDocs.toLocaleString(),
        secondary: 'Pending manual review',
        trend: totalBreakDocs > 0 ? `${openShare.toFixed(0)}% of all breaks` : 'No breaks',
        trendUp: totalBreakDocs === 0 || openShare < 50,
      },
      {
        label: 'Break Resolution Rate',
        value: `${resolutionRate.toFixed(1)}%`,
        secondary: `${resolvedBreaks.toLocaleString()} resolved`,
        trend: totalBreakDocs > 0 ? 'Approved / closed of total' : 'No breaks yet',
        trendUp: resolutionRate >= 50,
      },
    ];

    res.json({
      summary: buildSummary(),
      kpi,
      trend: trendData,
      rootCause: rootCauseData,
      aging: agingData,
      systemVolume: systemVolumeData,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/runs/:runId — run summary
router.get('/:runId', async (req, res, next) => {
  try {
    const run = await getRun(req, res);
    if (!run) return;
    const breaks = await Break.countDocuments({ runId: run._id, type: { $ne: 'anomaly' } });
    const openBreaks = await Break.countDocuments({ runId: run._id, type: { $ne: 'anomaly' }, status: { $in: ['open', 'investigating', 'pending-approval'] } });
    res.json({ run, counts: { ...run.counts, openBreaks }, breakCountTotal: breaks });
  } catch (err) {
    next(err);
  }
});

// GET /api/runs/:runId/breaks — filterable break list
router.get('/:runId/breaks', async (req, res, next) => {
  try {
    const run = await getRun(req, res);
    if (!run) return;
    const { type, status, source, search, page = 1, limit = 50, sort = '-priorityScore' } = req.query;

    const filter = { runId: run._id };
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (source) filter.sourcesInvolved = source;
    if (search) filter.$or = [
      { key: new RegExp(String(search), 'i') },
      { aiRootCause: new RegExp(String(search), 'i') },
    ];
    const sortMap = {
      '-priorityScore': { priorityScore: -1 },
      priorityScore: { priorityScore: 1 },
      '-materiality': { materiality: -1 },
      variance: { variance: 1 },
      '-variance': { variance: -1 },
      '-createdAt': { createdAt: -1 },
    };

    const [breaks, total] = await Promise.all([
      Break.find(filter).sort(sortMap[sort] || { priorityScore: -1 }).skip((page - 1) * limit).limit(Number(limit)).lean(),
      Break.countDocuments(filter),
    ]);
    const stats = await Break.aggregate([
      { $match: { runId: run._id } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    const statusStats = await Break.aggregate([
      { $match: { runId: run._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    res.json({
      breaks,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      stats: {
        byType: Object.fromEntries(stats.map((s) => [s._id, s.count])),
        byStatus: Object.fromEntries(statusStats.map((s) => [s._id, s.count])),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/runs/:runId/approve
router.post('/:runId/approve', roleGuard('admin'), async (req, res, next) => {
  try {
    const run = await getRun(req, res);
    if (!run) return;
    run.approvalStatus = 'approved';
    run.approvalComment = req.body.comment || '';
    run.approvalBy = req.user._id;
    await run.save();
    res.json({ success: true, run });
  } catch (err) {
    next(err);
  }
});

// POST /api/runs/:runId/reject
router.post('/:runId/reject', roleGuard('admin'), async (req, res, next) => {
  try {
    const run = await getRun(req, res);
    if (!run) return;
    run.approvalStatus = 'rejected';
    run.approvalComment = req.body.comment || '';
    run.approvalBy = req.user._id;
    await run.save();
    res.json({ success: true, run });
  } catch (err) {
    next(err);
  }
});

// ------------------- analytics helpers -------------------

// Root-cause categories derived from the *actual* break ledger of the runs in scope.
// Order of precedence matters (an anomaly can also be a presence/value break):
//   1. AI anomaly flag        2. duplicate txn     3. missing txn (presence)
//   4. amount mismatch        5. dimensional variance       6. unclassified
async function buildRootCauseData(filter) {
  const rows = await Break.aggregate([
    { $match: filter },
    {
      $project: {
        category: {
          $switch: {
            branches: [
              { case: { $eq: [{ $ifNull: ['$evidence.is_anomaly', false] }, true] }, then: 'AI Anomaly Flag' },
              { case: { $eq: [{ $ifNull: ['$evidence.is_duplicate', false] }, true] }, then: 'Duplicate Transaction' },
              { case: { $gt: [{ $size: { $ifNull: ['$evidence.missing_sources', []] } }, 0] }, then: 'Missing Transaction (Presence)' },
              { case: { $gt: [{ $size: { $ifNull: ['$evidence.value_diff_sources', []] } }, 0] }, then: 'Amount Mismatch' },
              { case: { $eq: ['$type', 'dimensional'] }, then: 'Dimensional Variance' },
            ],
            default: 'Unclassified',
          },
        },
      },
    },
    { $group: { _id: '$category', value: { $sum: 1 } } },
    { $sort: { value: -1 } },
    { $limit: 6 },
  ]);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return rows.map((r) => ({
    name: r._id,
    value: r.value,
    pct: total > 0 ? Math.round((r.value / total) * 1000) / 10 : 0,
  }));
}

// Aging of open breaks — bucketed from each break's real createdAt timestamp.
async function buildAgingData(filter) {
  const now = new Date(); // literal Date — Mongo compares against the stored createdAt
  const buckets = await Break.aggregate([
    { $match: filter },
    {
      $project: {
        days: { $floor: { $divide: [{ $subtract: [now, '$createdAt'] }, 86400000] } },
      },
    },
    {
      $bucket: {
        groupBy: '$days',
        boundaries: [-1, 3, 7, 15, Number.MAX_SAFE_INTEGER],
        default: '15+ days',
        output: { volume: { $sum: 1 } },
      },
    },
  ]);
  const labels = { '-1': '0-3 days', '3': '4-7 days', '7': '8-15 days', '15': '15+ days', '15+ days': '15+ days' };
  return buckets.map((b) => ({
    age: labels[String(b._id)] || '15+ days',
    volume: b.volume,
  }));
}

// Per-source processing volume (records + value) summed from actual run counts,
// with user-friendly display names taken from the workflows' source definitions.
function buildSystemVolume(workflows, perSourceRecords, perSourceAmounts) {
  const displayMap = new Map();
  for (const w of workflows) {
    for (const s of w.sources || []) {
      if (!displayMap.has(s.sourceId)) displayMap.set(s.sourceId, s.displayName || s.sourceId);
    }
  }
  return [...perSourceRecords.entries()]
    .map(([sourceId, records]) => ({
      system: displayMap.get(sourceId) || sourceId,
      sourceId,
      volume: records,
      amount: perSourceAmounts.get(sourceId) || 0,
    }))
    .sort((a, b) => b.volume - a.volume);
}

function matchRateTrend(previous, current) {
  if (!previous || !current) return 'Based on processed runs';
  const cr = current.records > 0 ? (current.matched / current.records) * 100 : 0;
  const pr = previous.records > 0 ? (previous.matched / previous.records) * 100 : 0;
  const delta = cr - pr;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts vs prev month`;
}

export default router;