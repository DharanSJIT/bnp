import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg, downloadBlob } from '../lib/api.js';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Chip, EmptyState, PageHeader, SkeletonRows } from '../components/ui.jsx';
import { useToast } from '../store/useToast';

const FORMAT_TONE = { xlsx: 'match', pdf: 'brk', csv: 'accent', json: 'neutral' };

function RunDownload({ run, format }) {
  const toast = useToast((s) => s.add);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const res = await api.get(`/reports/${run._id}/export`, { params: { format }, responseType: 'blob' });
      downloadBlob(res, `run_${run._id}_${format}.${format === 'xlsx' ? 'xlsx' : format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'pdf'}`);
      toast.success(`${format.toUpperCase()} report downloaded`);
    } catch (err) {
      toast.error(errMsg(err, 'Download failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" loading={busy} onClick={download} className="font-mono">
      {format.toUpperCase()}
    </Button>
  );
}

export default function History() {
  const toast = useToast((s) => s.add);
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/runs');
      setRuns(data.runs);
      setError(null);
    } catch (err) {
      setError(errMsg(err, 'Could not load processing history'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Processing History"
        subtitle="Every reconciliation run across all workflows — stored and downloadable for all users"
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />

      {error && (
        <p className="mb-4 rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">{error}</p>
      )}

      {runs === null ? (
        <Card className="p-5"><SkeletonRows rows={8} cols={7} /></Card>
      ) : runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          message="Run a reconciliation to see its history here. Every completed run stays stored and downloadable."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-table">
              <thead>
                <tr className="border-b border-ledger-line bg-ledger-panel text-left text-small text-ledger-meta">
                  {['Workflow', 'Period', 'Status', 'Match rate', 'Breaks', 'Open', 'Started', 'Report'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r._id} className="border-b border-ledger-line last:border-0 hover:bg-ledger-panel">
                    <td className="px-4 py-2.5">
                      {r.workflow ? (
                        <Link to={`/workflows/${r.workflowId}/reports`} className="font-medium text-ledger-ink hover:text-ledger-accent">
                          {r.workflow.name}
                        </Link>
                      ) : (
                        <span className="text-ledger-meta">(deleted workflow)</span>
                      )}
                    </td>
                    <td className="font-mono px-4 py-2.5">{r.period || '—'}</td>
                    <td className="px-4 py-2.5">
                      <Chip tone={r.status === 'success' ? 'match' : r.status === 'failed' ? 'brk' : 'reconcile'} dot>
                        {r.status}
                      </Chip>
                    </td>
                    <td className="font-mono px-4 py-2.5">
                      {r.status === 'success' ? `${(r.matchRate * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="font-mono px-4 py-2.5">{r.counts?.breaks ?? '—'}</td>
                    <td className="font-mono px-4 py-2.5">
                      {r.openBreakCount > 0 ? (
                        <span className="text-ledger-brk">{r.openBreakCount}</span>
                      ) : (
                        <span className="text-ledger-meta">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ledger-meta">{fmtDateTime(r.startedAt)}</td>
                    <td className="px-4 py-2.5">
                      {r.status === 'success' ? (
                        <div className="flex flex-wrap gap-1">
                          {['csv', 'xlsx', 'pdf', 'json'].map((f) => <RunDownload key={f} run={r} format={f} />)}
                        </div>
                      ) : (
                        <span className="text-small text-ledger-meta">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}