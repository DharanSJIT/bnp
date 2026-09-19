import { Router } from 'express';
import { config } from '../config/env.js';
import { Workflow } from '../models/Workflow.js';
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

// POST /api/workflows/:id/validate — run AI validation for one ingested load
router.post('/:id/validate', async (req, res, next) => {
  try {
    const workflow = await getWorkflow(req, res);
    if (!workflow) return;
    const { sourceId, loadId } = req.body || {};
    if (!sourceId || !loadId) return res.status(400).json({ error: 'sourceId and loadId required' });

    const rulesPath = workflow.rulesFile || config.defaultRulesFile;
    const result = await aiCall('/ai/validate', {
      workflowId: workflow._id.toString(),
      sourceId,
      loadId,
      rulesPath,
      period: workflow.period || '',
    });

    const results = (workflow.get('validationResults') || {});
    results[sourceId] = { loadId, at: new Date().toISOString(), ...result };
    workflow.set('validationResults', results);
    workflow.validationAcknowledged = false; // new load → gate re-armed
    await workflow.save();

    await auditFor(req)({ workflowId: workflow._id, action: 'validation.run', entity: 'source', entityId: sourceId, after: { warnings: result.warnings?.length, failures: result.ruleFailures?.length } });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/workflows/:id/acknowledge-validation — human "Go-Ahead" gate
router.post('/:id/acknowledge-validation', async (req, res, next) => {
  try {
    const workflow = await getWorkflow(req, res);
    if (!workflow) return;
    workflow.validationAcknowledged = true;
    workflow.set('validationAcknowledgedAt', new Date().toISOString());
    await workflow.save();
    await auditFor(req)({ workflowId: workflow._id, action: 'validation.acknowledged', entity: 'workflow', entityId: workflow._id.toString(), after: { acknowledged: true } });
    res.json({ acknowledged: true, workflow });
  } catch (err) {
    next(err);
  }
});

export default router;