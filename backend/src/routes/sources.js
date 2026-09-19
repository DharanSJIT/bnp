import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../config/env.js';
import { Workflow } from '../models/Workflow.js';
import { JoinMap } from '../models/JoinMap.js';
import { auth } from '../middleware/auth.js';
import { auditFor } from '../services/auditService.js';
import { stageRows } from '../services/stagingService.js';
import { aiCall } from '../services/aiClient.js';

const router = Router();
router.use(auth);

fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({ dest: config.uploadDir, limits: { fileSize: 200 * 1024 * 1024 } });

async function getWorkflow(req, res) {
  const wf = await Workflow.findById(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  if (wf.createdBy.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Not your workflow' });
  return wf;
}

function getSource(workflow, sourceId) {
  const src = workflow.sources.find((s) => s.sourceId === sourceId);
  if (!src) throw Object.assign(new Error(`Source ${sourceId} not found`), { status: 404 });
  return src;
}

// POST /api/workflows/:id/sources/:sourceId/upload — file ingestion (csv/xlsx/json/xml)
router.post('/:id/sources/:sourceId/upload', upload.single('file'), async (req, res, next) => {
  try {
    const workflow = await getWorkflow(req, res);
    if (!workflow) return;
    const source = getSource(workflow, req.params.sourceId);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: file)' });

    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const format = ['csv', 'xls', 'xlsx', 'json', 'xml'].includes(ext) ? ext : 'csv';
    if (!['csv', 'xlsx', 'json', 'xml'].includes(format)) {
      return res.status(400).json({ error: `Unsupported file format: ${ext}` });
    }

    const kbPath = path.resolve(config.rootDir, '../chatbot/knowledge_base');
    if (!fs.existsSync(kbPath)) {
      fs.mkdirSync(kbPath, { recursive: true });
    }
    const targetPath = path.join(kbPath, req.file.originalname);
    fs.copyFileSync(req.file.path, targetPath);

    const started = Date.now();
    const parsed = await aiCall('/ai/parse-file', {
      path: req.file.path,
      originalName: req.file.originalname,
      format,
    });
    if (!parsed.rows || !parsed.rows.length) {
      return res.status(422).json({ error: 'File parsed but contained no rows', detail: parsed });
    }

    source.ingestStatus = 'ingesting';
    await workflow.save();

    const { loadId, recordsLoaded } = await stageRows(workflow, source, parsed.rows, { method: 'file-upload' });
    source.ingestStatus = 'ingested';
    source.loadStats = { ...source.loadStats, recordsLoaded, method: `file-upload:${format}`, timeTakenMs: Date.now() - started, lastLoadId: loadId, ingestedAt: new Date() };
    await workflow.save();

    await auditFor(req)({ workflowId: workflow._id, action: 'source.ingested', entity: 'source', entityId: source.sourceId, after: { method: `file-upload:${format}`, recordsLoaded, loadId } });
    res.json({
      source,
      loadId,
      recordsLoaded,
      columns: parsed.columns || [],
      sample: parsed.sample || [],
      timeTakenMs: Date.now() - started,
      parseStats: parsed.stats,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/workflows/:id/sources/:sourceId/api-ingest — paginated REST pull
router.post('/:id/sources/:sourceId/api-ingest', async (req, res, next) => {
  try {
    const workflow = await getWorkflow(req, res);
    if (!workflow) return;
    const source = getSource(workflow, req.params.sourceId);
    const cfg = req.body || {};
    const baseUrl = cfg.baseUrl || config.maApiBaseUrl;

    const started = Date.now();
    const result = await aiCall('/ai/ingest-api', {
      baseUrl,
      perPage: cfg.perPage || 500,
      headers: cfg.headers || {},
      timeoutMs: cfg.timeoutMs || 30000,
    });
    if (!result.rows || !result.rows.length) {
      return res.status(422).json({ error: 'API pull returned no rows', detail: result });
    }

    source.ingestStatus = 'ingesting';
    await workflow.save();
    const { loadId, recordsLoaded } = await stageRows(workflow, source, result.rows, { method: 'api-pull' });
    source.ingestStatus = 'ingested';
    source.loadStats = { ...source.loadStats, recordsLoaded, method: 'api-pull', timeTakenMs: Date.now() - started, lastLoadId: loadId, ingestedAt: new Date() };
    await workflow.save();

    await auditFor(req)({ workflowId: workflow._id, action: 'source.ingested', entity: 'source', entityId: source.sourceId, after: { method: 'api-pull', recordsLoaded, pages: result.pages, loadId } });
    res.json({
      source,
      loadId,
      recordsLoaded,
      pages: result.pages,
      total: result.total,
      period: result.period,
      sample: result.sample || [],
      timeTakenMs: Date.now() - started,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/workflows/:id/sources/:sourceId/api-test — test API connection (health + summary)
router.post('/:id/sources/:sourceId/api-test', async (req, res, next) => {
  try {
    await getWorkflow(req, res);
    const cfg = req.body || {};
    const baseUrl = cfg.baseUrl || config.maApiBaseUrl;
    const result = await aiCall('/ai/ingest-api', { baseUrl, perPage: 5, testOnly: true, timeoutMs: cfg.timeoutMs || 15000 });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/workflows/:id/sources/:sourceId/db-ingest — beta stub
router.post('/:id/sources/:sourceId/db-ingest', async (req, res) => {
  res.status(501).json({ error: 'Database ingestion is a Phase 7 (beta) feature and is not enabled in this build.' });
});

// POST /api/workflows/:id/mappings/upload-join-map — join map file (csv/txt)
router.post('/:id/mappings/upload-join-map', upload.single('file'), async (req, res, next) => {
  try {
    const wf = await getWorkflow(req, res);
    if (!wf) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const parsed = await aiCall('/ai/parse-join-map', { path: req.file.path, originalName: req.file.originalname });

    const result = await JoinMap.findOneAndUpdate(
      { workflowId: wf._id, period: wf.period || '' },
      { workflowId: wf._id, period: wf.period || '', fileName: req.file.originalname, rows: parsed.rows },
      { upsert: true, new: true }
    );
    await auditFor(req)({ workflowId: wf._id, action: 'join_map.uploaded', entity: 'join_map', entityId: result._id.toString(), after: { period: wf.period, rows: parsed.rows.length } });
    res.json({ joinMap: result, rows: parsed.rows.length });
  } catch (err) {
    next(err);
  }
});

export default router;