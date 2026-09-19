import { RawTransaction } from '../models/RawTransaction.js';
import { Workflow } from '../models/Workflow.js';

const CHUNK = 2000;

/**
 * Stage parsed rows into raw_transactions under a single loadId and refresh
 * the source's loadStats on its workflow. Resilient: inserts in chunks so a
 * bad chunk cannot lose an entire load.
 */
export async function stageRows(workflow, source, rows, { method = 'bulk' } = {}) {
  const loadId = `${Date.now()}-${source.sourceId}`;
  const period = workflow.period || '';

  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((row) => ({
      workflowId: workflow._id,
      sourceId: source.sourceId,
      loadId,
      period,
      row,
    }));
    const res = await RawTransaction.insertMany(chunk, { ordered: false });
    inserted += res.length;
  }

  const stats = {
    recordsLoaded: inserted,
    method,
    lastLoadId: loadId,
    ingestedAt: new Date(),
  };
  const src = workflow.sources.find((s) => s.sourceId === source.sourceId);
  if (src) {
    src.ingestStatus = inserted > 0 ? 'ingested' : 'failed';
    src.loadStats = stats;
    await workflow.save();
  }
  return { loadId, recordsLoaded: inserted };
}