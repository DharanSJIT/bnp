import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { errMsg } from '../lib/api';
import { clsx, fmtAmount, fmtDateTime, fmtSignedAmount } from '../lib/format';
import { Button, Card, Chip, EmptyState, PageHeader, SkeletonRows, Spinner } from '../components/ui.jsx';
import { Drawer } from '../components/Drawer.jsx';
import { useWorkflow } from '../store/useWorkflow';
import { useAuth } from '../store/useAuth';
import { useToast } from '../store/useToast';

const STATUS_TONE = {
  open: 'brk',
  investigating: 'reconcile',
  'pending-approval': 'reconcile',
  approved: 'match',
  rejected: 'brk',
};
const TYPE_TONE = { transactional: 'accent', dimensional: 'potential' };
const PAGE_SIZE = 25;

function statusName(s) {
  return String(s || '').replace(/-/g, ' ');
}

export default function Breaks() {
  const { id } = useParams();
  const { workflow, recentRuns, loading } = useWorkflow();
  const user = useAuth((s) => s.user);
  const toast = useToast((s) => s.add);

  const runId = recentRuns?.[0]?._id || null;

  const [filters, setFilters] = useState({ type: '', status: '', source: '', search: '', sort: '-priorityScore', page: 1 });
  const [data, setData] = useState(null);
  const [loadingBreaks, setLoadingBreaks] = useState(false);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkFileInput = React.useRef(null);

  const [drawerBreak, setDrawerBreak] = useState(null); // breakId
  const [breakDetail, setBreakDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [investigating, setInvestigating] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [chatMsg, setChatMsg] = useState(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [cause, setCause] = useState('');
  const [override, setOverride] = useState(false);
  const [comment, setComment] = useState('');

  const sources = (workflow?.sources || []).map((s) => s.sourceId);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoadingBreaks(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== '' && v !== undefined && v !== null) params.set(k, v);
      });
      params.set('limit', String(PAGE_SIZE));
      const { data: d } = await api.get(`/runs/${runId}/breaks?${params.toString()}`);
      setData(d);
    } catch (err) {
      setError(errMsg(err, 'Could not load breaks'));
    } finally {
      setLoadingBreaks(false);
    }
  }, [runId, filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelected({});
  }, [filters.page, filters.type, filters.status, filters.source]);

  // drawer detail
  const openBreak = async (b) => {
    setDrawerBreak(b);
    setBreakDetail(null);
    setChatHistory([]);
    setCause('');
    setOverride(false);
    setComment('');
    setDetailLoading(true);
    try {
      const { data: d } = await api.get(`/breaks/${b._id}`);
      setBreakDetail(d);
    } catch (err) {
      toast.error(errMsg(err, 'Could not load break detail'));
    } finally {
      setDetailLoading(false);
    }
  };

  const investigate = async (causeText, overrideAi) => {
    const b = drawerBreak;
    if (!b || investigating) return;
    setInvestigating(true);
    try {
      await api.post(`/breaks/${b._id}/investigate`, { cause: causeText, overrideAiRootCause: overrideAi });
      toast.success('Investigation submitted for approval');
      setDrawerBreak(null);
      load();
    } catch (err) {
      toast.error(errMsg(err, 'Could not submit investigation'));
    } finally {
      setInvestigating(false);
    }
  };

  const decide = async (decision, comment = '') => {
    const b = drawerBreak;
    if (!b || deciding) return;
    setDeciding(true);
    try {
      await api.post(`/breaks/${b._id}/decide`, { decision, decisionComment: comment });
      toast.success(`Break ${decision}`);
      setDrawerBreak(null);
      load();
    } catch (err) {
      toast.error(errMsg(err, 'Could not record decision'));
    } finally {
      setDeciding(false);
    }
  };

  const bulkDecide = async (decision) => {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const { data } = await api.post('/breaks/bulk-decide', { breakIds: ids, decision });
      toast.success(`Processed ${data.processed} break${data.processed !== 1 ? 's' : ''} (${decision})`);
      setSelected({});
      load();
    } catch (err) {
      toast.error(errMsg(err, 'Bulk decision failed'));
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkUpload = async (file) => {
    if (!file) return;
    setBulkBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/breaks/bulk-decide/upload', fd);
      toast.success(`Processed ${data.processed} breaks from file${data.errors?.length ? ` · ${data.errors.length} errors` : ''}`);
      if (data.errors?.length) {
        data.errors.slice(0, 5).forEach((e) => toast.error(typeof e === 'string' ? e : JSON.stringify(e)));
      }
      load();
    } catch (err) {
      toast.error(errMsg(err, 'Bulk upload failed'));
    } finally {
      setBulkBusy(false);
    }
  };

  const askCopilot = async () => {
    if (!chatMsg || chatBusy) return;
    setChatBusy(true);
    try {
      const { data } = await api.post(`/breaks/${drawerBreak._id}/chat`, { question: chatMsg });
      setChatHistory((h) => [...h, { q: chatMsg, a: data.answer, evidence: data.evidence || [] }]);
      setChatMsg('');
    } catch (err) {
      toast.error(errMsg(err, 'Copilot request failed'));
    } finally {
      setChatBusy(false);
    }
  };

  const breaks = data?.breaks || [];
  const stats = data?.stats || {};
  const byStatus = stats.byStatus || {};
  const byType = stats.byType || {};
  const total = data?.total || 0;
  const pages = data?.pages || 1;
  const selectedCount = Object.values(selected).filter(Boolean).length;

  const isApprover = user?.role === 'approver';

  const drawerBreakStatus = breakDetail?.break?.status || drawerBreak?.status;
  const decided = drawerBreakStatus === 'approved' || drawerBreakStatus === 'rejected';
  const ev = breakDetail?.break?.evidence || drawerBreak?.evidence || {};
  const historical = breakDetail?.historicalFrequency;

  const filtersBar = (
    <Card className="mb-4 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input !w-auto !py-1.5 text-small" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value, page: 1 }))}>
          <option value="">All types</option>
          <option value="transactional">Transactional</option>
          <option value="dimensional">Dimensional</option>
        </select>
        <select className="input !w-auto !py-1.5 text-small" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}>
          <option value="">All statuses</option>
          {['open', 'investigating', 'pending-approval', 'approved', 'rejected'].map((s) => (
            <option key={s} value={s}>{statusName(s)}</option>
          ))}
        </select>
        <select className="input !w-auto !py-1.5 text-small" value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value, page: 1 }))}>
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="input !w-auto !py-1.5 text-small" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>
          <option value="-priorityScore">Sort: priority ↓</option>
          <option value="priorityScore">Sort: priority ↑</option>
          <option value="-variance">Sort: variance ↓</option>
          <option value="-materiality">Sort: materiality ↓</option>
          <option value="-createdAt">Sort: newest</option>
        </select>
        <input
          className="input !w-52 !py-1.5 text-small"
          placeholder="Search key / root cause…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-small text-ledger-meta">
            {total} break{total !== 1 ? 's' : ''}
          </span>
          {Object.keys(byType).length > 0 && (
            <span className="flex gap-1.5">
              {Object.entries(byType).map(([t, n]) => (
                <Chip key={t} tone={TYPE_TONE[t] || 'neutral'}>{t} {n}</Chip>
              ))}
            </span>
          )}
        </div>
      </div>
      {Object.keys(byStatus).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(byStatus).map(([s, n]) => (
            <Chip key={s} tone={STATUS_TONE[s] || 'neutral'} dot>{statusName(s)} · {n}</Chip>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Breaks"
        subtitle={workflow ? `Break ledger for “${workflow.name}”` : '…'}
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loadingBreaks}>↻ Refresh</Button>
            <Link to={`/workflows/${id}/reports`}><Button variant="outline">Reports ↗</Button></Link>
          </>
        }
      />

      {!runId && !loading ? (
        <EmptyState
          title="No reconciliation run yet"
          message="Run the reconciliation first — breaks appear here after matching."
          action={<Link to={`/workflows/${id}/run`}><Button>▶ Go to Run</Button></Link>}
        />
      ) : (
        <>
          {filtersBar}

          {error && (
            <p className="mb-4 rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">{error}</p>
          )}

          {loadingBreaks && !data ? (
            <Card className="p-5"><SkeletonRows rows={10} cols={8} /></Card>
          ) : breaks.length === 0 ? (
            <EmptyState
              title="No breaks match"
              message={filters.search || filters.type || filters.status || filters.source ? 'Try relaxing the filters above.' : 'This run came out clean — no breaks to report.'}
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] border-collapse text-table">
                  <thead>
                    <tr className="border-b border-ledger-line bg-ledger-panel text-left text-small text-ledger-meta">
                      <th className="th-sticky w-8 px-3 py-2.5">
                        <input
                          type="checkbox"
                          className="accent-ledger-accent"
                          checked={selectedCount === breaks.length && breaks.length > 0}
                          onChange={(e) =>
                            setSelected(Object.fromEntries(breaks.map((b) => [b._id, e.target.checked])))
                          }
                        />
                      </th>
                      {['Type', 'Key', 'Dimension', 'Sources', 'Expected', 'Actual', 'Variance', 'Mat.', 'Pri.', 'Status', 'AI root cause'].map((h) => (
                        <th key={h} className="th-sticky px-3 py-2.5 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {breaks.map((b) => (
                      <tr
                        key={b._id}
                        className="cursor-pointer border-b border-ledger-line transition-colors last:border-0 hover:bg-ledger-panel"
                        onClick={() => openBreak(b)}
                      >
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="accent-ledger-accent"
                            checked={!!selected[b._id]}
                            onChange={(e) => setSelected((s) => ({ ...s, [b._id]: e.target.checked }))}
                          />
                        </td>
                        <td className="px-3 py-2.5"><Chip tone={TYPE_TONE[b.type] || 'neutral'}>{b.type}</Chip></td>
                        <td className="field-id max-w-[160px] truncate px-3 py-2.5 font-medium">{b.key}</td>
                        <td className="field-id max-w-[140px] truncate px-3 py-2.5 text-ledger-meta">{b.dimension || '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className="flex flex-wrap gap-1">{(b.sourcesInvolved || []).map((s) => <Chip key={s} tone="neutral" className="font-mono">{s}</Chip>)}</span>
                        </td>
                        <td className="field-id px-3 py-2.5">{fmtAmount(b.expected)}</td>
                        <td className="field-id px-3 py-2.5">{fmtAmount(b.actual)}</td>
                        <td className={clsx('field-id px-3 py-2.5 font-medium', Math.abs(b.variance || 0) > 0.005 ? 'text-ledger-brk' : 'text-ledger-ink')}>
                          {fmtSignedAmount(b.variance)}
                        </td>
                        <td className="field-id px-3 py-2.5">{(b.materiality ?? 0) >= 0.01 ? `${(b.materiality * 100).toFixed(2)}%` : ((b.materiality ?? 0) * 100).toFixed(2) + '%'}</td>
                        <td className="field-id px-3 py-2.5 font-semibold">{Math.round(b.priorityScore ?? 0)}</td>
                        <td className="px-3 py-2.5"><Chip tone={STATUS_TONE[b.status] || 'neutral'} dot>{statusName(b.status)}</Chip></td>
                        <td className="max-w-[260px] truncate px-3 py-2.5 text-ledger-meta" title={b.aiRootCause}>
                          {b.aiRootCause || <span className="text-ledger-meta/60">no root cause</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* pagination */}
              <div className="flex items-center justify-between border-t border-ledger-line bg-ledger-panel px-4 py-2.5">
                <span className="text-small text-ledger-meta">Page {data?.page} of {pages}</span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>← Prev</Button>
                  <Button size="sm" variant="outline" disabled={filters.page >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next →</Button>
                </div>
              </div>
            </Card>
          )}

          {/* bulk action bar */}
          {selectedCount > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-panel border border-ledger-accent bg-ledger-panel px-4 py-3">
              <span className="text-small font-medium text-ledger-ink">{selectedCount} selected</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <input
                  ref={bulkFileInput}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={(e) => e.target.files[0] && bulkUpload(e.target.files[0])}
                />
                <Button size="sm" variant="outline" loading={bulkBusy} onClick={() => bulkFileInput.current?.click()}>
                  Upload decision CSV
                </Button>
                <Button size="sm" variant="outline" loading={bulkBusy} onClick={() => bulkDecide('approved')}>Approve selected</Button>
                <Button size="sm" variant="danger" loading={bulkBusy} onClick={() => bulkDecide('rejected')}>Reject selected</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected({})}>Clear</Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ---------- detail drawer ---------- */}
      <Drawer
        open={!!drawerBreak}
        onClose={() => setDrawerBreak(null)}
        title={drawerBreak ? <span className="field-id">{drawerBreak.key}</span> : ''}
        subtitle={drawerBreak ? `run evidence · ${drawerBreak.type}` : ''}
        width="max-w-2xl"
        footer={
          drawerBreak && !decided ? (
            <div className="flex items-center gap-2">
              {isApprover ? (
                <>
                  <Button variant="outline" className="flex-1" loading={deciding} onClick={() => decide('rejected', comment.trim())}>Reject</Button>
                  <Button className="flex-1" loading={deciding} onClick={() => decide('approved', comment.trim())}>✓ Approve</Button>
                </>
              ) : (
                <>
                  <Button className="flex-1" loading={investigating} onClick={() => investigate(cause.trim(), override)} disabled={!cause.trim()}>
                    Submit investigation
                  </Button>
                  <Button variant="outline" loading={deciding} onClick={() => decide('approved', comment.trim())}>Approve</Button>
                  <Button variant="danger" loading={deciding} onClick={() => decide('rejected', comment.trim())}>Reject</Button>
                </>
              )}
            </div>
          ) : null
        }
      >
        {detailLoading && <SkeletonRows rows={8} cols={2} />}

        {drawerBreak && !detailLoading && (
          <div className="space-y-4">
            {/* status line */}
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={TYPE_TONE[drawerBreak.type]}>{drawerBreak.type}</Chip>
              <Chip tone={STATUS_TONE[drawerBreakStatus] || 'neutral'} dot>{statusName(drawerBreakStatus)}</Chip>
              <Chip tone="neutral">priority {Math.round(drawerBreak.priorityScore ?? 0)}</Chip>
              <Chip tone="neutral">materiality {(drawerBreak.materiality ?? 0) * 100 >= 0.01 ? `${((drawerBreak.materiality ?? 0) * 100).toFixed(2)}%` : '<0.01%'}</Chip>
              {historical && (
                <Chip tone="reconcile">historical: {historical.periodsBroken}/{historical.totalBreaks} periods broken</Chip>
              )}
              {ev.root_cause_confidence && <Chip tone="accent">confidence {ev.root_cause_confidence}</Chip>}
            </div>

            {/* field diff */}
            <div>
              <p className="mb-1.5 text-small font-semibold text-ledger-ink">Field diff from evidence</p>
              <div className="grid gap-2 lg:grid-cols-2">
                <div className="rounded-lg border border-ledger-line bg-ledger-panel p-3">
                  <p className="mb-1 text-small text-ledger-match">Present sources</p>
                  <div className="flex flex-wrap gap-1">
                    {(ev.present_sources || []).length ? (ev.present_sources).map((s) => <Chip key={s} tone="match" className="font-mono">{s}</Chip>) : <span className="text-small text-ledger-meta">—</span>}
                  </div>
                </div>
                <div className="rounded-lg border border-ledger-line bg-ledger-panel p-3">
                  <p className="mb-1 text-small text-ledger-brk">Missing sources</p>
                  <div className="flex flex-wrap gap-1">
                    {(ev.missing_sources || []).length ? (ev.missing_sources).map((s) => <Chip key={s} tone="brk" className="font-mono">{s}</Chip>) : <span className="text-small text-ledger-meta">—</span>}
                  </div>
                </div>
              </div>

              <div className="mt-2 grid gap-2 lg:grid-cols-3">
                <div className="rounded-lg border border-ledger-line bg-ledger-panel p-3">
                  <p className="mb-1 text-small text-ledger-meta">Expected</p>
                  <p className="field-id text-sm font-medium">{fmtAmount(drawerBreak.expected)}</p>
                </div>
                <div className="rounded-lg border border-ledger-line bg-ledger-panel p-3">
                  <p className="mb-1 text-small text-ledger-meta">Actual</p>
                  <p className="field-id text-sm font-medium">{fmtAmount(drawerBreak.actual)}</p>
                </div>
                <div className="rounded-lg border border-ledger-line bg-ledger-panel p-3">
                  <p className="mb-1 text-small text-ledger-meta">Variance</p>
                  <p className={clsx('field-id text-sm font-semibold', Math.abs(drawerBreak.variance || 0) > 0.005 ? 'text-ledger-brk' : '')}>
                    {fmtSignedAmount(drawerBreak.variance)}
                  </p>
                </div>
              </div>

              {ev.per_source_amounts && Object.keys(ev.per_source_amounts).length > 0 && (
                <div className="mt-2 overflow-hidden rounded-lg border border-ledger-line">
                  <p className="border-b border-ledger-line bg-ledger-panel px-3 py-1.5 text-small font-medium">Per-source amounts</p>
                  <table className="w-full text-table">
                    <tbody>
                      {Object.entries(ev.per_source_amounts).map(([s, amt]) => (
                        <tr key={s} className="border-b border-ledger-line last:border-0">
                          <td className="field-id px-3 py-1.5">{s}</td>
                          <td className="field-id px-3 py-1.5 text-right">{fmtAmount(amt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(() => {
                const rendered = new Set(['present_sources', 'missing_sources', 'per_source_amounts', 'historical_frequency', 'explainers', 'root_cause_confidence', 'period']);
                const extra = Object.entries(ev).filter(([k]) => !rendered.has(k) && ![null, undefined, ''].includes(ev[k]) && !(Array.isArray(ev[k]) && ev[k].length === 0));
                if (extra.length === 0) return null;
                return (
                  <div className="mt-2 rounded-lg border border-ledger-line bg-white p-3">
                    <p className="mb-1.5 text-small font-semibold text-ledger-ink">Additional evidence</p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {extra.map(([k, v]) => (
                        <div key={k} className="rounded border border-ledger-line bg-ledger-panel px-2.5 py-1.5">
                          <p className="text-[11px] font-medium text-ledger-meta">{k}</p>
                          <p className="truncate font-mono text-[11px] text-ledger-ink" title={typeof v === 'object' ? JSON.stringify(v) : String(v)}>
                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* AI root cause */}
            <div className="rounded-lg border border-ledger-line bg-ledger-panel p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-small font-semibold text-ledger-ink">AI root cause</p>
                <Chip tone="accent" dot>auto-generated</Chip>
              </div>
              <p className="text-base text-ledger-ink">{breakDetail?.break?.aiRootCause || drawerBreak.aiRootCause || 'No AI root cause available.'}</p>
              {(ev.explainers || []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {(ev.explainers).map((ex, i) => (
                    <li key={i} className="text-small text-ledger-meta">— {ex}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* investigations / maker-checker */}
            <div className="rounded-lg border border-ledger-line p-3">
              <p className="mb-2 text-small font-semibold text-ledger-ink">Investigation &amp; decision</p>

              {breakDetail?.investigations?.length > 0 && (
                <div className="mb-3 space-y-2">
                  {breakDetail.investigations.map((inv) => (
                    <div key={inv._id} className="rounded-lg border border-ledger-line bg-ledger-panel p-3 text-small">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone="accent">investigator {inv.investigatorId}</Chip>
                        {inv.submittedAt && <span className="text-ledger-meta">{fmtDateTime(inv.submittedAt)}</span>}
                        {inv.aiRootCauseOverridden && <Chip tone="reconcile">root cause overridden</Chip>}
                      </div>
                      {inv.cause && <p className="mt-1.5 text-ledger-ink">{inv.cause}</p>}
                      {inv.decision && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <Chip tone={inv.decision === 'approved' ? 'match' : 'brk'}>{inv.decision}</Chip>
                          {inv.decisionComment && <span className="text-ledger-meta">“{inv.decisionComment}”</span>}
                          {inv.decidedAt && <span className="text-ledger-meta">{fmtDateTime(inv.decidedAt)}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {decided ? (
                <p className="text-small text-ledger-meta">This break is closed ({drawerBreakStatus}).</p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (cause.trim()) investigate(cause.trim(), override);
                  }}
                  className="space-y-2.5"
                >
                  <textarea
                    id="investigate-cause"
                    rows={2}
                    className="input resize-none"
                    placeholder="Describe the investigation finding… (maker note in the maker–checker flow)"
                    value={cause}
                    onChange={(e) => setCause(e.target.value)}
                  />
                  <label className="flex items-center gap-2 text-small text-ledger-meta">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="accent-ledger-accent" />
                    Override AI root cause with my finding
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit" loading={investigating} disabled={!cause.trim()}>
                      {isApprover ? 'Record investigation' : 'Submit for approval'}
                    </Button>
                    <span className="mx-1 text-small text-ledger-meta">checker:</span>
                    <input
                      className="input !w-44 !py-1.5 text-small"
                      placeholder="Decision comment…"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <Button variant="outline" type="button" loading={deciding} onClick={() => decide('approved', comment.trim())}>Approve</Button>
                    <Button variant="danger" type="button" loading={deciding} onClick={() => decide('rejected', comment.trim())}>Reject</Button>
                  </div>
                </form>
              )}
            </div>

            {/* copilot */}
            <div className="rounded-lg border border-ledger-line p-3">
              <p className="mb-2 text-small font-semibold text-ledger-ink">Ask assistant about this break</p>
              <div className="space-y-2">
                {chatHistory.map((c, i) => (
                  <div key={i} className="rounded-lg border border-ledger-line bg-ledger-panel p-2.5">
                    <p className="text-small font-medium text-ledger-accent">{c.q}</p>
                    <p className="mt-1 text-small text-ledger-ink">{c.a}</p>
                    {c.evidence?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.evidence.map((e, j) => <Chip key={j} tone="neutral" className="font-mono">{String(e)}</Chip>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="e.g. Is this a recurring break? What drives it?"
                  value={chatMsg || ''}
                  onChange={(e) => setChatMsg(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && askCopilot()}
                />
                <Button onClick={askCopilot} loading={chatBusy} disabled={!chatMsg}>Ask</Button>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}