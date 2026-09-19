import { Router } from 'express';
import { ReconciliationRun } from '../models/ReconciliationRun.js';
import { Workflow } from '../models/Workflow.js';
import { Break } from '../models/Break.js';
import { Report } from '../models/Report.js';
import { auth } from '../middleware/auth.js';

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
    const flights = await ReconciliationRun.find().sort({ createdAt: -1 }).limit(300).lean();
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
        openBreakCount: await Break.countDocuments({ runId: r._id, status: { $in: ['open', 'investigating', 'pending-approval'] } }),
      }))
    );
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

// GET /api/runs/:runId — run summary
router.get('/:runId', async (req, res, next) => {
  try {
    const run = await getRun(req, res);
    if (!run) return;
    const breaks = await Break.countDocuments({ runId: run._id });
    const openBreaks = await Break.countDocuments({ runId: run._id, status: { $in: ['open', 'investigating', 'pending-approval'] } });
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

export default router;