/**
 * Backfill: retype AI anomaly flags and recompute run counts so the ledger
 * matches the new contract (breaks = data breaks only; anomalies and
 * join-map coverage gaps are advisory and separate).
 *
 * Run:  node scripts/backfillRunCounts.js
 * Safe to re-run (idempotent).
 */
import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { Break } from '../src/models/Break.js';
import { ReconciliationRun } from '../src/models/ReconciliationRun.js';

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log(`connected: ${config.mongoUri}`);

  // 1) Every ledger row carrying the anomaly evidence is an AI anomaly flag.
  const retyped = await Break.updateMany(
    { 'evidence.is_anomaly': true, type: { $ne: 'anomaly' } },
    { $set: { type: 'anomaly', dimension: 'anomaly_flag' } }
  );
  console.log(`retyped anomaly flags: ${retyped.modifiedCount}`);

  // 2) Recompute counts for every run from the actual ledger.
  const runs = await ReconciliationRun.find({ counts: { $exists: true } }).lean();
  let updated = 0;
  for (const run of runs) {
    const total = await Break.countDocuments({ runId: run._id });
    const anomalies = await Break.countDocuments({ runId: run._id, type: 'anomaly' });
    const coverage = await Break.findOne({ runId: run._id, key: '(unmapped)' }).lean();
    const coverageGaps = coverage ? 1 : 0;
    const unmappedRows = coverage?.evidence?.unmapped_dimensional?.count || 0;
    const breaks = Math.max(total - anomalies - coverageGaps, 0);

    const counts = {
      ...(run.counts || {}),
      breaks,
      anomalies,
      coverageGaps,
      unmappedRows,
    };
    if (counts.totalTransactions == null && counts.total != null) counts.totalTransactions = counts.total;
    if (counts.totalTransactions == null) delete counts.totalTransactions;
    for (const k of Object.keys(counts)) {
      if (counts[k] == null) delete counts[k]; // keep the stored counts clean
    }

    await ReconciliationRun.updateOne({ _id: run._id }, { $set: { counts } });
    updated += 1;
    console.log(
      `run ${run._id} -> matched=${counts.matched} breaks=${breaks} anomalies=${anomalies} coverage=${coverageGaps} unmapped=${unmappedRows}`
    );
  }
  console.log(`updated counts for ${updated} runs`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});