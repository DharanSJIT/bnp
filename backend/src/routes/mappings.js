import { Router } from 'express';
import { Workflow } from '../models/Workflow.js';
import { FieldMapping } from '../models/FieldMapping.js';
import { RawTransaction } from '../models/RawTransaction.js';
import { auth } from '../middleware/auth.js';
import { auditFor } from '../services/auditService.js';
import { aiCall } from '../services/aiClient.js';

const router = Router();
router.use(auth);

async function getWorkflow(req, res) {
  const wf = await Workflow.findById(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  if (wf.createdBy.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Not your workflow' });
  return wf;
}

/**
 * Build a schema profile per source from the current load:
 * field name → { dtype, top5 sample values by frequency }
 */
async function sourceProfiles(workflow) {
  const profiles = [];
  for (const source of workflow.sources) {
    const loadId = source.loadStats?.lastLoadId;
    if (!loadId) continue;
    const rows = await RawTransaction.find({ workflowId: workflow._id, sourceId: source.sourceId, loadId }).limit(4000).lean();
    const fieldMap = {};
    for (const { row } of rows) {
      for (const [k, v] of Object.entries(row)) {
        if (!fieldMap[k]) fieldMap[k] = { values: [] };
        fieldMap[k].values.push(v);
      }
    }
    const fields = Object.entries(fieldMap)
      .filter(([, f]) => f.values.length > 0)
      .map(([name, f]) => {
        const nonNull = f.values.filter((v) => v !== null && v !== '' && v !== undefined);
        const freqs = new Map();
        for (const v of nonNull) freqs.set(String(v), (freqs.get(String(v)) || 0) + 1);
        const top5 = [...freqs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v]) => v);
        return {
          name,
          dtype: inferDtype(nonNull),
          sampleValues: top5,
          cardinality: freqs.size,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    profiles.push({ sourceId: source.sourceId, displayName: source.displayName, fields });
  }
  return profiles;
}

function inferDtype(values) {
  if (!values.length) return 'null';
  const numeric = values.filter((v) => !Number.isNaN(Number(v)));
  if (numeric.length / values.length > 0.9) return 'numeric';
  const dateLike = values.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(String(v)));
  if (dateLike.length / values.length > 0.9) return 'date';
  return 'string';
}

// GET /api/workflows/:id/mapping-suggestions — AI-suggested cross-source field mapping
router.get('/:id/mapping-suggestions', async (req, res, next) => {
  try {
    const workflow = await getWorkflow(req, res);
    if (!workflow) return;
    const profiles = await sourceProfiles(workflow);
    if (profiles.length < 2) return res.status(400).json({ error: 'At least 2 ingested sources are required for mapping' });

    const suggestions = await aiCall('/ai/map-fields', { sources: profiles });
    res.json(suggestions);
  } catch (err) {
    next(err);
  }
});

// PUT /api/workflows/:id/mappings — save user-confirmed mapping + reconcile targets
router.put('/:id/mappings', async (req, res, next) => {
  try {
    const workflow = await getWorkflow(req, res);
    if (!workflow) return;
    const { mappings, joinMapFileId } = req.body || {};
    if (!Array.isArray(mappings)) return res.status(400).json({ error: 'mappings array required' });

    const doc = await FieldMapping.findOneAndUpdate(
      { workflowId: workflow._id },
      { workflowId: workflow._id, mappings, joinMapFileId: joinMapFileId || '' },
      { upsert: true, new: true }
    );
    const reconcileFields = mappings.filter((m) => m.isReconcileField);
    await auditFor(req)({ workflowId: workflow._id, action: 'mappings.saved', entity: 'field_mappings', entityId: doc._id.toString(), after: { groups: mappings.length, reconcileFields: reconcileFields.map((m) => m.targetGroupId) } });
    res.json({ mapping: doc });
  } catch (err) {
    next(err);
  }
});

// POST /api/workflows/:id/mappings/upload-uncommon-map — 2-column lookup join file (csv)
router.post('/:id/mappings/upload-uncommon-map', (req, res) => {
  res.status(501).json({ error: 'Uncommon-but-linked lookup joins are handled via the join map; direct endpoint reserved for Phase 7.' });
});

export default router;