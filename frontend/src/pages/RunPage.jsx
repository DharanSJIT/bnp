import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import api, { errMsg, downloadBlob } from '../lib/api';
import { clsx, fmtAmount, fmtDateTime, fmtMatchRate } from '../lib/format';
import { Button, Card, Chip, PageHeader, SkeletonRows, Spinner } from '../components/ui.jsx';
import { useWorkflow } from '../store/useWorkflow';
import { useToast } from '../store/useToast';

const STEP_LABELS = ['Ingesting', 'Mapping', 'Matching', 'Scoring breaks', 'Done'];

export default function RunPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { workflow, loading, refresh } = useWorkflow();
  const toast = useToast((s) => s.add);

  const [outbound, setOutbound] = useState({ api: '', filePdf: false, email: '' });
  const [outboundSaved, setOutboundSaved] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [result, setResult] = useState(null);
  const [runError, setRunError] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (workflow?.outboundConfig) {
      setOutbound({
        api: workflow.outboundConfig.api || '',
        filePdf: !!workflow.outboundConfig.filePdf,
        email: workflow.outboundConfig.email || '',
      });
    }
  }, [workflow?.outboundConfig]);

  useEffect(() => () => clearInterval(timer.current), []);

  const saveOutbound = async (next) => {
    setOutboundSaved(false);
    try {
      await api.put(`/workflows/${id}`, { outboundConfig: next });
      toast.info('Outbound config saved');
    } catch (err) {
      toast.error(errMsg(err, 'Could not save outbound config'));
    } finally {
      setOutboundSaved(true);
    }
  };

  const patchOutbound = (patch) => {
    const next = { ...outbound, ...patch };
    setOutbound(next);
    saveOutbound(next);
  };

  const runReconciliation = async () => {
    if (running) return;
    setRunning(true);
    setRunError(null);
    setResult(null);
    setActiveStep(0);
    let step = 0;
    timer.current = setInterval(() => {
      step = Math.min(STEP_LABELS.length - 2, step + 1);
      setActiveStep(step);
    }, 1900);
    try {
      const { data } = await api.post(`/workflows/${id}/run`);
      setResult(data);
      setActiveStep(STEP_LABELS.length - 1);
      toast.success('Reconciliation complete');
      refresh();
    } catch (err) {
      clearInterval(timer.current);
      setActiveStep(-1);
      setRunError(errMsg(err, 'Reconciliation run failed'));
      toast.error(errMsg(err, 'Reconciliation run failed'));
    } finally {
      clearInterval(timer.current);
      setRunning(false);
    }
  };

  const download = async (format = 'xlsx') => {
    const runId = result?.run?._id || (workflow?.recentRuns && workflow.recentRuns[0]?._id);
    if (!runId) {
      toast.info('No completed run to download');
      return;
    }
    try {
      const res = await api.get(`/reports/${runId}/export?format=${format}`, { responseType: 'blob' });
      downloadBlob(res, `onerecon-${runId}.${format}`);
      toast.success('Report downloaded');
    } catch (err) {
      toast.error(errMsg(err, 'Download failed'));
    }
  };

  if (loading && !workflow) return <Card className="p-5"><SkeletonRows rows={5} cols={3} /></Card>;

  const progress = activeStep >= 0 ? ((activeStep + 1) / STEP_LABELS.length) * 100 : 0;
  const counts = result?.run?.counts || {};
  const totals = result?.run?.totals || {};
  const bySource = counts.bySource || {};

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Run Reconciliation"
        subtitle={workflow ? `Execute “${workflow.name}” and export the outcome` : '…'}
        actions={
          <Link to={`/workflows/${id}/preview`}><Button variant="outline">↶ Preview</Button></Link>
        }
      />

      {/* Outbound config */}
      <Card className="mb-5 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-header-md font-semibold">Outbound configuration</h3>
          <Chip tone={outboundSaved ? 'match' : 'reconcile'} dot>{outboundSaved ? 'saved' : 'saving…'}</Chip>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Delivery API endpoint</label>
            <input
              className="input font-mono"
              placeholder="https://example.com/recon/outbound"
              value={outbound.api}
              onChange={(e) => setOutbound({ ...outbound, api: e.target.value })}
              onBlur={(e) => patchOutbound({ api: e.target.value })}
            />
            <p className="mt-1 text-small text-ledger-meta">Stored for this workflow (HTTP delivery not executed in this build).</p>
          </div>
          <div>
            <label className="label">Email report to</label>
            <input
              className="input"
              placeholder="recon-team@bank.com"
              type="email"
              value={outbound.email}
              onChange={(e) => setOutbound({ ...outbound, email: e.target.value })}
              onBlur={(e) => patchOutbound({ email: e.target.value })}
            />
            <p className="mt-1 text-small text-ledger-meta">The final report is emailed to this address after each successful run.</p>
          </div>
        </div>
        <div className="mt-3">
          <label className="label">Export format</label>
          <div className="inline-flex items-center gap-3">
            {['xlsx', 'pdf'].map((f) => {
              const on = f === 'xlsx' ? !outbound.filePdf : outbound.filePdf;
              return (
                <button
                  key={f}
                  onClick={() => patchOutbound({ filePdf: f === 'pdf' })}
                  className={clsx(
                    'rounded-lg border px-3.5 py-2 text-small font-medium transition-colors',
                    on ? 'border-ledger-accent bg-ledger-accent text-white' : 'border-ledger-line text-ledger-meta hover:border-ledger-accent'
                  )}
                >
                  {f.toUpperCase()} {on && '✓'}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Run control */}
      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-header-md font-semibold">Run engine</h3>
            <p className="mt-0.5 text-small text-ledger-meta">
              Full reconcile: ingest snapshot → mapped compare → break scoring. Takes ~5–20s.
            </p>
          </div>
          <Button size="lg" onClick={runReconciliation} loading={running} disabled={running}>
            {running ? <><Spinner className="h-4 w-4" /> Running…</> : '▶ Run Reconciliation'}
          </Button>
        </div>

        {/* step progress */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex flex-1 items-center">
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={clsx(
                      'flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors',
                      activeStep > i || (activeStep >= STEP_LABELS.length - 1 && i === STEP_LABELS.length - 1)
                        ? 'border-ledger-match bg-ledger-match text-white'
                        : activeStep === i && running
                        ? 'border-ledger-accent bg-ledger-accent text-white'
                        : 'border-ledger-line bg-white text-ledger-meta'
                    )}
                  >
                    {activeStep > i || (activeStep >= STEP_LABELS.length - 1 && i === STEP_LABELS.length - 1) ? '✓' : i + 1}
                  </span>
                  <span className={clsx('text-[11px] font-medium', activeStep >= i ? 'text-ledger-ink' : 'text-ledger-meta')}>{label}</span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <div className="mx-1 mb-4 h-0.5 flex-1 overflow-hidden rounded-full bg-ledger-skeleton">
                    <div
                      className="h-full rounded-full bg-ledger-accent transition-all duration-300"
                      style={{ width: running ? (activeStep > i ? '100%' : '12%') : '0%' }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ledger-skeleton">
            <motion.div
              className="h-full rounded-full bg-ledger-accent"
              animate={{ width: `${running ? progress : result ? 100 : 0}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
        </div>

        {runError && (
          <p className="mt-4 rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">
            {runError}
          </p>
        )}
      </Card>

      {/* Result */}
      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
          <Card className={clsx('mb-5 p-5', result.run.status === 'success' ? 'border-l-4 border-l-ledger-match' : 'border-l-4 border-l-ledger-brk')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{result.run.status === 'success' ? '✅' : '❌'}</span>
                <div>
                  <h3 className="text-header-lg font-bold">
                    Match rate{' '}
                    <span className="font-mono text-ledger-accent">{fmtMatchRate(result.run.matchRate)}</span>
                  </h3>
                  <p className="text-small text-ledger-meta">
                    run {result.run._id} · {result.run.status}
                  </p>
                </div>
              </div>
              <Button onClick={() => download('xlsx')}>⬇ Download Report (.xlsx)</Button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Matched', value: counts.matched, tone: 'text-ledger-match' },
                { label: 'Breaks', value: counts.breaks, tone: 'text-ledger-brk' },
                { label: 'Anomalies', value: counts.anomalies, tone: 'text-ledger-reconcile' },
                { label: 'Open breaks', value: counts.openBreaks ?? counts.breaks, tone: 'text-ledger-ink' },
                { label: 'Total records', value: totals.records ?? totals.matched, tone: 'text-ledger-ink' },
                { label: 'Total amount', value: totals.amount != null ? fmtAmount(totals.amount) : null, tone: 'text-ledger-ink' },
              ].filter((k) => k.value !== undefined && k.value !== null).map((k) => (
                <div key={k.label} className="rounded-lg border border-ledger-line bg-ledger-panel px-3 py-2.5">
                  <p className="text-small text-ledger-meta">{k.label}</p>
                  <p className={clsx('field-id mt-0.5 text-sm font-semibold', k.tone)}>
                    {typeof k.value === 'number' ? k.value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : k.value}
                  </p>
                </div>
              ))}
            </div>

            {Object.keys(bySource).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(bySource).map(([src, n]) => (
                  <Chip key={src} tone="accent" className="font-mono">{src}: {typeof n === 'object' ? JSON.stringify(n) : Number(n).toLocaleString()}</Chip>
                ))}
              </div>
            )}

            {result.summary && (
              <div className="mt-4 rounded-lg border border-ledger-line bg-white p-3 text-small text-ledger-meta">
                <span className="font-medium text-ledger-ink">Summary:</span>{' '}
                {Object.entries(result.summary)
                  .filter(([, v]) => v !== null && v !== undefined && v !== 0 && v !== '')
                  .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toLocaleString() : v}`)
                  .join(' · ')}
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {/* Previous runs */}
      {workflow?.recentRuns?.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-ledger-line bg-ledger-panel px-4 py-2.5 text-small font-medium text-ledger-ink">
            Recent runs
          </div>
          <table className="w-full text-table">
            <tbody>
              {workflow.recentRuns.slice(0, 6).map((r) => (
                <tr key={r._id} className="border-b border-ledger-line last:border-0">
                  <td className="px-4 py-2">
                    <span className={r.status === 'success' ? 'text-ledger-match' : r.status === 'failed' ? 'text-ledger-brk' : 'text-ledger-reconcile'}>
                      {r.status === 'success' ? '✅' : r.status === 'failed' ? '❌' : '⏳'} {r.status}
                    </span>
                  </td>
                  <td className="field-id px-4 py-2">{fmtMatchRate(r.matchRate)}</td>
                  <td className="field-id px-4 py-2">{r.breaks != null ? r.breaks : ''}</td>
                  <td className="px-4 py-2 text-ledger-meta">{fmtDateTime(r.startedAt || r.createdAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => navigate(`/workflows/${id}/breaks`)} className="text-small text-ledger-accent hover:underline">
                      view breaks
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}