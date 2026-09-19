import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api, { errMsg, downloadBlob } from '../lib/api';
import { fmtAmount, fmtDateTime, fmtMatchRate, runGlyph, clsx } from '../lib/format';
import { Button, Card, Chip, ConfirmModal, EmptyState, PageHeader, Skeleton, AnimatedNumber, SkeletonRows } from '../components/ui.jsx';
import { useToast } from '../store/useToast';

const cardMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.15 },
};

export default function Dashboard() {
  const [workflows, setWorkflows] = useState(null);
  const [error, setError] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast((s) => s.add);
  const navigate = useNavigate();

  const load = async (silent = false) => {
    try {
      const { data } = await api.get('/workflows');
      setWorkflows(data.workflows);
      setError(null);
    } catch (err) {
      if (!silent) setError(errMsg(err));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const kpis = useMemo(() => {
    const list = workflows || [];
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const runThisMonth = list.filter((w) => w.lastRunAt && w.lastRunAt.startsWith(monthPrefix)).length;
    const matchRates = list
      .map((w) => w.lastMatchRate)
      .filter((v) => v !== null && v !== undefined && !Number.isNaN(Number(v)));
    const avgMatch = matchRates.length ? matchRates.reduce((a, b) => a + Number(b), 0) / matchRates.length : null;
    const openBreaks = list.reduce((a, w) => a + (w.openBreaks || 0), 0);
    return [
      { label: 'Total workflows', value: list.length, decimals: 0, fmt: (v) => v.toLocaleString() },
      { label: 'Run this month', value: runThisMonth, decimals: 0, fmt: (v) => v.toLocaleString() },
      { label: 'Avg match rate', value: avgMatch === null ? 0 : avgMatch * 100, decimals: 2, suffix: '%', fmt: (v) => v.toFixed(2) },
      { label: 'Open breaks', value: openBreaks, decimals: 0, fmt: (v) => v.toLocaleString() },
    ];
  }, [workflows]);

  const runWorkflow = async (w) => {
    setRunningId(w._id);
    try {
      await api.post(`/workflows/${w._id}/run`);
      toast.success(`Reconciliation finished for “${w.name}”`);
      await load(true);
    } catch (err) {
      toast.error(errMsg(err, 'Run failed'));
    } finally {
      setRunningId(null);
    }
  };

  const deleteWorkflow = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/workflows/${deleteTarget._id}`);
      toast.success('Workflow deleted');
      setDeleteTarget(null);
      await load(true);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setDeleting(false);
    }
  };

  const downloadReport = async (w) => {
    try {
      const { data: detail } = await api.get(`/workflows/${w._id}`);
      const run = detail.recentRuns?.[0];
      if (!run) {
        toast.info('No completed report for this workflow yet');
        return;
      }
      const res = await api.get(`/reports/${run._id}/export?format=xlsx`, { responseType: 'blob' });
      downloadBlob(res, `${w.name.replace(/\s+/g, '-').toLowerCase()}-report.xlsx`);
      toast.success('Report downloaded');
    } catch (err) {
      toast.error(errMsg(err, 'Download failed'));
    }
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Workflows, match rates and open breaks at a glance"
        actions={
          <Link to="/workflows/new">
            <Button className="!px-4">＋ Create New Workflow</Button>
          </Link>
        }
      />

      {/* KPI strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <motion.div key={k.label} {...cardMotion} transition={{ duration: 0.15, delay: i * 0.03 }}>
            <Card className="px-4 py-3.5">
              <p className="text-small font-medium text-ledger-meta">{k.label}</p>
              <p className="mt-1 text-header-md font-bold text-ledger-ink">
                <AnimatedNumber value={k.value} decimals={k.decimals} suffix={k.suffix || ''} />
              </p>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Workflows */}
      {error && (
        <p className="mb-4 rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">{error}</p>
      )}

      {workflows === null ? (
        <Card className="p-5"><SkeletonRows rows={6} cols={5} /></Card>
      ) : workflows.length === 0 ? (
        <EmptyState
          title="No workflows yet"
          message="Create your first reconciliation"
          action={<Link to="/workflows/new"><Button>＋ Create New Workflow</Button></Link>}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-table">
              <thead>
                <tr className="border-b border-ledger-line bg-ledger-panel text-left text-small text-ledger-meta">
                  {['Workflow', 'Sources', 'Period', 'Last run', 'Match rate', 'Open breaks', 'Actions'].map((h) => (
                    <th key={h} className="th-sticky px-4 py-2.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workflows.map((w) => {
                  const running = runningId === w._id;
                  return (
                    <tr key={w._id} className="border-b border-ledger-line transition-colors last:border-0 hover:bg-ledger-panel">
                      <td className="px-4 py-3">
                        <Link to={`/workflows/${w._id}/breaks`} className="font-medium text-ledger-ink hover:text-ledger-accent">
                          {w.name}
                        </Link>
                        <p className="text-small text-ledger-meta">{w.sources?.length} source{w.sources?.length !== 1 ? 's' : ''}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(w.sources || []).map((s) => (
                            <Chip key={s.sourceId} tone="neutral" className="!text-small">{s.sourceId}</Chip>
                          ))}
                        </div>
                      </td>
                      <td className="field-id px-4 py-3">{w.period || '—'}</td>
                      <td className="px-4 py-3">
                        <span title={w.lastRunStatus || 'never run'}>{runGlyph(w.lastRunStatus, running)}</span>{' '}
                        <span className="text-ledger-meta">{running ? 'running…' : fmtDateTime(w.lastRunAt)}</span>
                      </td>
                      <td className={clsx('field-id px-4 py-3 font-medium', (w.lastMatchRate ?? -1) >= 0.95 && w.lastMatchRate !== null ? 'text-ledger-match' : '')}>
                        {fmtMatchRate(w.lastMatchRate)}
                      </td>
                      <td className={clsx('field-id px-4 py-3', (w.openBreaks || 0) > 0 ? 'text-ledger-brk' : 'text-ledger-meta')}>
                        {w.openBreaks || 0}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => runWorkflow(w)} loading={running}>
                            {running ? 'Running…' : 'Run'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => downloadReport(w)}>Report</Button>
                          <Link to={`/workflows/${w._id}/breaks`}>
                            <Button size="sm" variant="ghost">View</Button>
                          </Link>
                          <Button size="sm" variant="ghost" className="!text-ledger-brk hover:!bg-[#FEF2F2]" onClick={() => setDeleteTarget(w)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete workflow"
        message={`Delete “${deleteTarget?.name}” and all its runs and breaks? This cannot be undone.`}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={deleteWorkflow}
      />
    </div>
  );
}