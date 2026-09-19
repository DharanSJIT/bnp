import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { errMsg } from '../lib/api';
import { clsx } from '../lib/format';
import { Button, Card, Chip, EmptyState, PageHeader, SkeletonRows } from '../components/ui.jsx';
import { useWorkflow } from '../store/useWorkflow';
import { useToast } from '../store/useToast';

const STATUS_TONE = { common: 'match', potential: 'potential', uncommon: 'brk' };

export default function Preview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { workflow, loading } = useWorkflow();
  const toast = useToast((s) => s.add);

  const [data, setData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingPreview(true);
    api
      .get(`/workflows/${id}/preview`)
      .then(({ data: d }) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errMsg(err, 'Could not load preview'));
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading && !workflow) return <Card className="p-5"><SkeletonRows rows={5} cols={4} /></Card>;

  const aligned = data?.aligned || [];
  const sourceIds = data?.sourceIds || (workflow?.sources || []).map((s) => s.sourceId);
  const warnings = data?.warnings || [];
  const blocking = warnings.filter((w) => w.type === 'duplicate-mapping');
  const hasBlocking = blocking.length > 0;

  return (
    <div>
      <PageHeader
        title="Preview"
        subtitle={workflow ? `Aligned sample for “${workflow.name}”` : '…'}
        actions={
          <>
            <Link to={`/workflows/${id}/mapping`}><Button variant="outline">↶ Back to Mapping</Button></Link>
            <Button disabled={hasBlocking || aligned.length === 0} onClick={() => navigate(`/workflows/${id}/run`)}>
              Proceed to Run →
            </Button>
          </>
        }
      />

      {error && (
        <EmptyState
          title="Preview unavailable"
          message={error}
          action={<Link to={`/workflows/${id}/mapping`}><Button variant="outline">Back to Mapping</Button></Link>}
        />
      )}

      {!error && loadingPreview && <Card className="p-5"><SkeletonRows rows={8} cols={sourceIds.length + 1} /></Card>}

      {!error && !loadingPreview && (
        <>
          {/* warnings */}
          {warnings.length > 0 && (
            <div className="mb-4 space-y-1.5">
              {warnings.map((w, i) => (
                <div
                  key={i}
                  className={clsx(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-small',
                    w.type === 'duplicate-mapping' ? 'border-ledger-brk bg-[#FEF2F2] text-ledger-brk' : 'border-ledger-reconcile/50 bg-ledger-panel text-ledger-reconcile'
                  )}
                >
                  <span>{w.type === 'duplicate-mapping' ? '⛔' : '⚠'}</span>
                  <span className="flex-1">{w.message}</span>
                  <Chip tone={w.type === 'duplicate-mapping' ? 'brk' : 'reconcile'}>{w.type}</Chip>
                </div>
              ))}
              {hasBlocking ? (
                <p className="text-small text-ledger-meta">Fix duplicate mappings before running — a field may only be used once.</p>
              ) : (
                <p className="text-small text-ledger-meta">Only non-blocking warnings — you can proceed to Run.</p>
              )}
            </div>
          )}
          {warnings.length === 0 && aligned.length > 0 && (
            <p className="mb-4 rounded-lg border border-ledger-match/50 bg-ledger-panel px-3 py-2 text-small text-ledger-match">
              ✓ No warnings — alignment is clean.
            </p>
          )}

          {aligned.length === 0 ? (
            <EmptyState
              title="No aligned rows"
              message="Save a mapping first, then preview the alignment."
              action={<Link to={`/workflows/${id}/mapping`}><Button>Back to Mapping</Button></Link>}
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-table">
                  <thead>
                    <tr className="border-b border-ledger-line bg-ledger-panel text-left text-small text-ledger-meta">
                      <th className="th-sticky px-4 py-2.5 font-medium">Field group</th>
                      {sourceIds.map((s) => (
                        <th key={s} className="th-sticky px-4 py-2.5 font-medium">
                          <span className="font-mono normal-case">{s}</span>
                        </th>
                      ))}
                      <th className="th-sticky px-4 py-2.5 font-medium">Match</th>
                      <th className="th-sticky px-4 py-2.5 font-medium">Reconcile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aligned.slice(0, 40).map((row) => (
                      <tr key={row.targetGroupId} className="border-b border-ledger-line last:border-0">
                        <td className="px-4 py-2">
                          <span className="field-id font-medium">{row.targetGroupId}</span>
                        </td>
                        {sourceIds.map((s) => (
                          <td key={s} className="field-id max-w-[200px] truncate px-4 py-2">
                            {row.rows?.[0]?.[s] !== undefined && row.rows[0][s] !== null ? String(row.rows[0][s]) : <span className="text-ledger-meta">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-2">
                          <Chip tone={STATUS_TONE[row.status] || 'neutral'} dot>
                            {row.status} {row.confidence != null ? `${Math.round(row.confidence * 100)}%` : ''}
                          </Chip>
                        </td>
                        <td className="px-4 py-2">
                          {row.isReconcileField ? <Chip tone="reconcile">amount</Chip> : <span className="text-ledger-meta">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {aligned.length > 40 && (
                <p className="border-t border-ledger-line bg-ledger-panel px-4 py-2 text-small text-ledger-meta">
                  Showing 40 of {aligned.length} mapping groups.
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}