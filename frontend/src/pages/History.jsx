import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg, downloadBlob } from '../lib/api.js';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Chip, EmptyState, PageHeader, SkeletonRows, Modal } from '../components/ui.jsx';
import { useToast } from '../store/useToast';
import { useAuth } from '../store/useAuth';

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
  const user = useAuth((s) => s.user);
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  
  // Admin Approval State
  const [approvalTarget, setApprovalTarget] = useState(null); // { runId, action: 'approve' | 'reject' }
  const [approvalComment, setApprovalComment] = useState('');
  const [submittingApproval, setSubmittingApproval] = useState(false);

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

  const handleApproval = async () => {
    if (!approvalTarget) return;
    setSubmittingApproval(true);
    try {
      await api.post(`/runs/${approvalTarget.runId}/${approvalTarget.action}`, { comment: approvalComment });
      toast.success(`Run ${approvalTarget.action}d successfully`);
      setApprovalTarget(null);
      setApprovalComment('');
      load();
    } catch (err) {
      toast.error(errMsg(err, `Failed to ${approvalTarget.action} run`));
    } finally {
      setSubmittingApproval(false);
    }
  };

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
                  {['Workflow', 'Period', 'Status', 'Match rate', 'Breaks', 'Open', 'Approval', 'Started', 'Report'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                  ))}
                  {user?.role === 'admin' && <th className="px-4 py-2.5 font-medium">Actions</th>}
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
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-1">
                        <Chip tone={r.approvalStatus === 'approved' ? 'match' : r.approvalStatus === 'rejected' ? 'brk' : 'potential'} dot>
                          {r.approvalStatus || 'pending'}
                        </Chip>
                        {r.approvalComment && (
                          <span className="text-[10px] text-ledger-meta italic max-w-[150px] truncate" title={r.approvalComment}>
                            "{r.approvalComment}"
                          </span>
                        )}
                      </div>
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
                    {user?.role === 'admin' && (
                      <td className="px-4 py-2.5">
                        {r.approvalStatus === 'pending' || !r.approvalStatus ? (
                          <div className="flex items-center gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => setApprovalTarget({ runId: r._id, action: 'approve' })}>Approve</Button>
                            <Button size="sm" variant="ghost" className="!text-ledger-brk hover:!bg-[#FEF2F2]" onClick={() => setApprovalTarget({ runId: r._id, action: 'reject' })}>Reject</Button>
                          </div>
                        ) : (
                          <span className="text-small text-ledger-meta">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={!!approvalTarget} onClose={() => setApprovalTarget(null)} title={`Confirm ${approvalTarget?.action}`}>
        <div className="space-y-4">
          <p className="text-small text-ledger-meta">
            You are about to <strong>{approvalTarget?.action}</strong> this reconciliation run.
            Optionally, provide a comment for the investigator.
          </p>
          <div>
            <label className="label">Description / Comment</label>
            <textarea
              className="input min-h-[100px] resize-y"
              placeholder="E.g., Looks good, proceed with exceptions handling."
              value={approvalComment}
              onChange={(e) => setApprovalComment(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-ledger-line pt-4">
            <Button variant="ghost" onClick={() => setApprovalTarget(null)}>Cancel</Button>
            <Button 
              className={approvalTarget?.action === 'reject' ? 'bg-ledger-brk hover:bg-red-700 text-white' : ''} 
              loading={submittingApproval} 
              onClick={handleApproval}
            >
              Confirm {approvalTarget?.action}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}