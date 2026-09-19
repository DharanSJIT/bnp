import { Router } from 'express';
import { Workflow } from '../models/Workflow.js';
import { FieldMapping } from '../models/FieldMapping.js';
import { RawTransaction } from '../models/RawTransaction.js';
import { auth } from '../middleware/auth.js';

const router = Router();
router.use(auth);

async function getWorkflow(req, res) {
  const wf = await Workflow.findById(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  if (wf.createdBy.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Not your workflow' });
  return wf;
}

// GET /api/workflows/:id/preview — aligned sample rows + dtype/duplicate warnings
router.get('/:id/preview', async (req, res, next) => {
  try {
    const workflow = await getWorkflow(req, res);
    if (!workflow) return;
    const mappingDoc = await FieldMapping.findOne({ workflowId: workflow._id });
    if (!mappingDoc || !mappingDoc.mappings.length) {
      return res.status(400).json({ error: 'No mapping saved yet — go to Field Mapping first' });
    }

    const groups = mappingDoc.mappings.filter((m) => m.fields.length);
    const sourceIds = workflow.sources.map((s) => s.sourceId);
    const samples = {};
    for (const s of sourceIds) {
      const loadId = workflow.sources.find((x) => x.sourceId === s)?.loadStats?.lastLoadId;
      if (!loadId) continue;
      samples[s] = await RawTransaction.find({ workflowId: workflow._id, sourceId: s, loadId }).limit(5).lean();
    }

    // aligned table: for each group, take row i from each source that has the field
    const aligned = [];
    const warnings = [];
    const seenTargets = new Map(); // fieldName -> groupId (duplicate mapping detection)

    for (const group of groups) {
      const bySource = {};
      let maxRows = 5;
      for (const ref of group.fields) {
        const srcRows = samples[ref.sourceId] || [];
        bySource[ref.sourceId] = srcRows.slice(0, 5).map((t) => t.row[ref.fieldName]);
        maxRows = Math.min(maxRows, srcRows.length);
      }
      // duplicate mapping warnings (same source+field used in >1 group)
      for (const ref of group.fields) {
        const key = `${ref.sourceId}:${ref.fieldName}`;
        if (seenTargets.has(key)) {
          warnings.push({ type: 'duplicate-mapping', message: `Field "${ref.fieldName}" of ${ref.sourceId} is mapped to both "${seenTargets.get(key)}" and "${group.targetGroupId}"` });
        } else {
          seenTargets.set(key, group.targetGroupId);
        }
      }
      // dtype warnings across sources in this group
      const dtypes = group.fields.map((ref) => {
        const srcRows = samples[ref.sourceId] || [];
        const vals = srcRows.slice(0, 20).map((t) => t.row[ref.fieldName]).filter((v) => v !== null && v !== '' && v !== undefined);
        const numeric = vals.filter((v) => !Number.isNaN(Number(v)));
        return { sourceId: ref.sourceId, fieldName: ref.fieldName, dtype: vals.length && numeric.length / vals.length > 0.9 ? 'numeric' : 'string' };
      });
      const uniqueDtypes = new Set(dtypes.map((d) => d.dtype));
      if (uniqueDtypes.size > 1) {
        warnings.push({ type: 'dtype-mismatch', message: `Mapped group "${group.targetGroupId}" mixes ${[...uniqueDtypes].join(' / ')} types across sources: ${dtypes.map((d) => `${d.sourceId}:${d.fieldName}=${d.dtype}`).join(', ')}` });
      }
      aligned.push({
        targetGroupId: group.targetGroupId,
        status: group.status,
        isReconcileField: group.isReconcileField,
        confidence: group.confidence,
        rows: Array.from({ length: maxRows }, (_, i) => {
          const cells = {};
          for (const [sid, arr] of Object.entries(bySource)) cells[sid] = arr[i];
          return cells;
        }),
      });
    }

    res.json({ aligned, warnings, sourceIds });
  } catch (err) {
    next(err);
  }
});

export default router;