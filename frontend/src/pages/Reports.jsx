import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip as ChartTooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import api, { errMsg, downloadBlob } from '../lib/api';
import { clsx, fmtAmount, fmtMatchRate, fmtPct, fmtDateTime, fmtSignedAmount } from '../lib/format';
import { Button, Card, Chip, EmptyState, Modal, PageHeader, SkeletonRows, Tabs } from '../components/ui.jsx';
import { Copilot } from '../components/Copilot.jsx';
import { useWorkflow } from '../store/useWorkflow';
import { useToast } from '../store/useToast';

const COLORS = { match: '#00915a', potential: '#22c55e', brk: '#DC2626', reconcile: '#CA8A04', accent: '#00915a', meta: '#4B5563' };
const GROUP_BY_OPTIONS = ['gl_account_id', 'entity', 'currency', 'TransactionID'];
const EXPORT_FORMATS = ['csv', 'xlsx', 'json', 'pdf', 'xml', 'text'];

export default function Reports() {
  const { id } = useParams();
  const { workflow, recentRuns, loading } = useWorkflow();
  const toast = useToast((s) => s.add);

  const runId = recentRuns?.[0]?._id || null;

  const [tab, setTab] = useState('summary');
  const [report, setReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState(null);

  // compare state
  const [mode, setMode] = useState('cross-system');
  const [csA, setCsA] = useState('');
  const [csB, setCsB] = useState('');
  const [groupBy, setGroupBy] = useState('gl_account_id');
  const [tolerance, setTolerance] = useState('');
  const [runA, setRunA] = useState('');
  const [runB, setRunB] = useState('');
  const [compare, setCompare] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState(null);
  const [drillRow, setDrillRow] = useState(null);
  const [drillBreaks, setDrillBreaks] = useState(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  const sources = (workflow?.sources || []).map((s) => ({ sourceId: s.sourceId, displayName: s.displayName }));
  const runs = recentRuns || [];

  const loadReport = async (silent = false) => {
    if (!runId) return;
    if (!silent) setLoadingReport(true);
    setReportError(null);
    try {
      const { data } = await api.get(`/reports/${runId}`);
      setReport(data);
    } catch (err) {
      setReportError(errMsg(err, 'Could not load report'));
    } finally {
      setLoadingReport(false);
    }
  };

  useEffect(() => {
    setTab(report ? 'summary' : 'summary');
    if (runId) loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    if (sources.length >= 2 && !csA) setCsA(sources[0].sourceId);
    if (sources.length >= 2 && !csB) setCsB(sources[1].sourceId);
    if (runs.length >= 2 && !runA) setRunA(runs[0]._id);
    if (runs.length >= 2 && !runB) setRunB(runs[1]._id);
  }, [sources, runs, csA, csB, runA, runB]);

  const runCompare = async () => {
    setComparing(true);
    setCompareError(null);
    try {
      const body =
        mode === 'cross-system'
          ? { workflowId: id, mode, a: { sourceId: csA }, b: { sourceId: csB }, groupBy, tolerance: tolerance ? Number(tolerance) : 0 }
          : { workflowId: id, mode, a: { runId: runA }, b: { runId: runB } };
      const { data } = await api.post('/reports/compare', body);
      setCompare(data);
    } catch (err) {
      setCompareError(errMsg(err, 'Comparison failed'));
    } finally {
      setComparing(false);
    }
  };

  const exportReport = async (format) => {
    if (!runId) return;
    try {
      const res = await api.get(`/reports/${runId}/export?format=${format}`, { responseType: 'blob' });
      downloadBlob(res, `onerecon-report-${runId}.${format === 'xlsx' ? 'xlsx' : format}`);
      toast.success(`Report exported as ${format.toUpperCase()}`);
    } catch (err) {
      toast.error(errMsg(err, 'Export failed'));
    }
  };

  const exportComparison = async (format = 'xlsx') => {
    if (!compare || !runId) return;
    try {
      const qs = new URLSearchParams({
        format,
        mode: compare.mode,
        groupBy: compare.groupBy || groupBy || 'gl_account_id',
        aSource: compare.a?.sourceId || '',
        bSource: compare.b?.sourceId || '',
        aRun: compare.a?.runId || runA,
        bRun: compare.b?.runId || runB,
        tolerance: compare.tolerance != null ? String(compare.tolerance) : '0',
      });
      const res = await api.get(`/reports/${runId}/compare-export?${qs.toString()}`, { responseType: 'blob' });
      downloadBlob(res, `onerecon-comparison.${format === 'xlsx' ? 'xlsx' : format}`);
      toast.success(`Comparison exported as ${format.toUpperCase()}`);
    } catch (err) {
      toast.error(errMsg(err, 'Comparison export failed'));
    }
  };

  const openDrilldown = async (row) => {
    setDrillRow(row);
    setDrillBreaks(null);
    try {
      const { data } = await api.get(`/runs/${runId}/breaks?search=${encodeURIComponent(row.dimension || '')}&limit=8`);
      setDrillBreaks(data.breaks || []);
    } catch {
      setDrillBreaks([]);
    }
  };

  if (loading && !workflow) return <Card className="p-5"><SkeletonRows rows={5} cols={4} /></Card>;

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={workflow ? `Outcomes and comparisons for “${workflow.name}”` : '…'}
        actions={
          <>
            <Button variant="outline" onClick={() => setCopilotOpen(true)}>✦ Ask Assistant</Button>
            <Link to={`/workflows/${id}/breaks`}><Button variant="outline">Breaks ⟵</Button></Link>
          </>
        }
      />

      <Tabs
        className="mb-5"
        tabs={[
          { value: 'summary', label: 'Summary' },
          { value: 'compare', label: 'Compare' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {!runId ? (
        <EmptyState
          title="No report yet"
          message="Run a reconciliation to generate the summary and comparison reports."
          action={<Link to={`/workflows/${id}/run`}><Button>▶ Go to Run</Button></Link>}
        />
      ) : tab === 'summary' ? (
        <SummaryTab
          report={report}
          loading={loadingReport}
          error={reportError}
          onExport={exportReport}
          onEmail={() => setEmailOpen(true)}
          onRun={() => loadReport()}
        />
      ) : (
        <CompareTab
          mode={mode}
          setMode={setMode}
          sources={sources}
          csA={csA} setCsA={setCsA}
          csB={csB} setCsB={setCsB}
          groupBy={groupBy} setGroupBy={setGroupBy}
          tolerance={tolerance} setTolerance={setTolerance}
          runs={runs}
          runA={runA} setRunA={setRunA}
          runB={runB} setRunB={setRunB}
          compare={compare}
          comparing={comparing}
          error={compareError}
          onCompare={runCompare}
          onExport={exportComparison}
          onDrill={openDrilldown}
          fmtMatchRate={fmtMatchRate}
        />
      )}

      {/* drill-down modal */}
      <Modal open={!!drillRow} onClose={() => setDrillRow(null)} title={`Drill-down — ${drillRow?.dimension}`}>
        {drillRow && (
          <div>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Report A', value: fmtAmount(drillRow.aTotal) },
                { label: 'Report B', value: fmtAmount(drillRow.bTotal) },
                { label: 'Variance', value: fmtSignedAmount(drillRow.variance) },
                { label: 'Variance %', value: drillRow.variancePct != null ? (Number(drillRow.variancePct) * 100).toFixed(2) + '%' : '—' },
              ].map((k) => (
                <div key={k.label} className="rounded-lg border border-ledger-line bg-ledger-panel px-3 py-2">
                  <p className="text-small text-ledger-meta">{k.label}</p>
                  <p className={clsx('field-id text-sm font-medium', k.label === 'Variance' && Math.abs(Number(drillRow.variance || 0)) > 0.005 ? 'text-ledger-brk' : '')}>{k.value}</p>
                </div>
              ))}
            </div>
            <p className="text-small text-ledger-meta">
              Underlying break rows for this dimension (from the latest run, searched by key):
            </p>
            {drillBreaks === null ? (
              <SkeletonRows rows={3} cols={4} />
            ) : drillBreaks.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-ledger-line px-3 py-4 text-center text-small text-ledger-meta">
                No matching break rows found in the break ledger.
              </p>
            ) : (
              <table className="mt-2 w-full text-table">
                <thead>
                  <tr className="border-b border-ledger-line text-left text-small text-ledger-meta">
                    <th className="py-1.5 font-medium">Key</th>
                    <th className="py-1.5 font-medium">Type</th>
                    <th className="py-1.5 font-medium">Variance</th>
                    <th className="py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {drillBreaks.slice(0, 8).map((b) => (
                    <tr key={b._id} className="border-b border-ledger-line last:border-0">
                      <td className="field-id py-1.5">{b.key}</td>
                      <td className="py-1.5"><Chip tone={b.type === 'transactional' ? 'accent' : 'potential'}>{b.type}</Chip></td>
                      <td className="field-id py-1.5">{fmtSignedAmount(b.variance)}</td>
                      <td className="py-1.5 text-ledger-meta">{b.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Modal>

      <EmailReportModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        runId={runId}
        workflowName={workflow?.name}
      />

      <Copilot open={copilotOpen} onClose={() => setCopilotOpen(false)} workflowId={id} />
    </div>
  );
}

/* --------------------------------- summary --------------------------------- */
function SummaryTab({ report, loading, error, onExport, onEmail, onRun }) {
  if (error && !report) {
    return (
      <EmptyState
        title="Report unavailable"
        message={error}
        action={<Button variant="outline" onClick={onRun}>↻ Retry</Button>}
      />
    );
  }
  if (loading && !report) return <Card className="p-5"><SkeletonRows rows={10} cols={4} /></Card>;

  const byStatus = report?.byStatus || {};
  const byType = report?.byType || {};
  const trend = report?.trend || [];
  const top10 = report?.top10 || [];

  const pieData = [
    { name: 'Common', value: report?.run?.counts?.matched ?? report?.totalBreaks ?? 0, color: COLORS.match },
    { name: 'Potential Match', value: (report?.run?.counts?.total ?? 0) * 0.05, color: COLORS.potential },
    { name: 'Uncommon / Unmatched', value: byType.transactional ?? 0, color: COLORS.brk },
    { name: 'Reconciliation Field', value: byType.dimensional ?? 0, color: COLORS.reconcile },
    { name: 'AI anomaly flags (advisory)', value: byType.anomaly ?? 0, color: COLORS.meta },
  ].filter((d) => d.value > 0);

  const trendData = trend.map((t) => ({
    name: `${new Date(t.startedAt || t.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`,
    matchRate: t.matchRate != null ? Math.round(Number(t.matchRate) * 100 * 100) / 100 : null,
    breaks: t.breaks ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(byStatus).map(([s, n]) => (
            <Chip key={s} tone={s === 'approved' ? 'match' : s === 'rejected' ? 'brk' : s === 'open' ? 'brk' : 'reconcile'} dot>
              {s.replace(/-/g, ' ')} · {n}
            </Chip>
          ))}
        </div>
        <div className="flex gap-1.5">
          {EXPORT_FORMATS.map((f) => (
            <Button key={f} size="sm" variant="outline" onClick={() => onExport(f)}>⬇ {f.toUpperCase()}</Button>
          ))}
          <Button size="sm" variant="outline" onClick={onEmail}>✉ EMAIL</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-2 text-header-md font-semibold">Break composition</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2} strokeWidth={0}>
                  {pieData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <ChartTooltip formatter={(v, n) => [`${Number(v).toLocaleString()}`, n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            {pieData.map((d) => (
              <span key={d.name} className="flex items-center gap-1.5 text-small text-ledger-meta">
                <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                {d.name} · <span className="font-mono text-ledger-ink">{Number(d.value).toLocaleString()}</span>
              </span>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-header-md font-semibold">Break trend across runs</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#4B5563' }} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} />
                <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#4B5563' }} tickLine={false} axisLine={false} width={34} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#4B5563' }} tickLine={false} axisLine={false} width={36} domain={[0, 100]} />
                <ChartTooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="l" type="monotone" dataKey="breaks" stroke={COLORS.brk} strokeWidth={2} dot={{ r: 3, fill: COLORS.brk }} name="Breaks" />
                <Line yAxisId="r" type="monotone" dataKey="matchRate" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3, fill: COLORS.accent }} name="Match rate %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-ledger-line bg-ledger-panel px-4 py-2.5">
          <span className="text-small font-medium text-ledger-ink">Top 10 by materiality</span>
          <span className="font-mono text-small text-ledger-meta">{fmtMatchRate(report?.run?.matchRate)} match rate</span>
        </div>
        {top10.length === 0 ? (
          <p className="px-4 py-8 text-center text-small text-ledger-meta">No material breaks in this run.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-table">
              <thead>
                <tr className="border-b border-ledger-line text-left text-small text-ledger-meta">
                  {['Key', 'Type', 'Dimension', 'Variance', 'Materiality', 'Priority', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {top10.map((b) => (
                  <tr key={b._id} className="border-b border-ledger-line last:border-0">
                    <td className="field-id px-4 py-2 font-medium">{b.key}</td>
                    <td className="px-4 py-2"><Chip tone={b.type === 'transactional' ? 'accent' : 'potential'}>{b.type}</Chip></td>
                    <td className="field-id px-4 py-2 text-ledger-meta">{b.dimension || '—'}</td>
                    <td className="field-id px-4 py-2 text-ledger-brk">{fmtSignedAmount(b.variance)}</td>
                    <td className="field-id px-4 py-2">{fmtPct(b.materiality)}</td>
                    <td className="field-id px-4 py-2 font-semibold">{Math.round(b.priorityScore ?? 0)}</td>
                    <td className="px-4 py-2"><Chip tone={b.status === 'approved' ? 'match' : b.status === 'rejected' ? 'brk' : 'reconcile'} dot>{b.status}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* --------------------------------- compare --------------------------------- */
function CompareTab({ mode, setMode, sources, csA, setCsA, csB, setCsB, groupBy, setGroupBy, tolerance, setTolerance, runs, runA, setRunA, runB, setRunB, compare, comparing, error, onCompare, onExport, onDrill }) {
  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { value: 'cross-system', label: 'Cross-system (A vs B source)' },
          { value: 'run-to-run', label: 'Run-to-run (A vs B run)' },
        ]}
        active={mode}
        onChange={setMode}
      />

      <Card className="p-4">
        {mode === 'cross-system' ? (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Report A source</label>
              <select className="input !w-auto" value={csA} onChange={(e) => setCsA(e.target.value)}>
                {sources.map((s) => <option key={s.sourceId} value={s.sourceId}>{s.displayName} ({s.sourceId})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Report B source</label>
              <select className="input !w-auto" value={csB} onChange={(e) => setCsB(e.target.value)}>
                {sources.map((s) => <option key={s.sourceId} value={s.sourceId}>{s.displayName} ({s.sourceId})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Group by</label>
              <select className="input !w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                {GROUP_BY_OPTIONS.map((g) => <option key={g} value={g} className="font-mono">{g}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Tolerance %</label>
              <input
                className="input !w-24 font-mono"
                placeholder="0"
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value.replace(/[^0-9.]/g, ''))}
              />
            </div>
            <Button onClick={onCompare} loading={comparing} disabled={!csA || !csB || csA === csB}>Compare</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Report A run</label>
              <select className="input !w-64" value={runA} onChange={(e) => setRunA(e.target.value)}>
                {runs.map((r) => (
                  <option key={r._id} value={r._id}>
                    {fmtDateTime(r.startedAt || r.createdAt)} · {fmtMatchRate(r.matchRate)} · {r.breaks ?? 0} breaks
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Report B run</label>
              <select className="input !w-64" value={runB} onChange={(e) => setRunB(e.target.value)}>
                {runs.map((r) => (
                  <option key={r._id} value={r._id}>
                    {fmtDateTime(r.startedAt || r.createdAt)} · {fmtMatchRate(r.matchRate)} · {r.breaks ?? 0} breaks
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={onCompare} loading={comparing} disabled={!runA || !runB || runA === runB}>Compare</Button>
          </div>
        )}
        {error && <p className="mt-3 rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">{error}</p>}
      </Card>

      {compare && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Chip tone="accent" dot>{compare.mode} comparison</Chip>
            <Button variant="outline" size="sm" onClick={() => onExport('xlsx')}>⬇ Export comparison (.xlsx)</Button>
          </div>

          {compare.mode === 'cross-system' ? (
            <CrossSystemResult compare={compare} onDrill={onDrill} />
          ) : (
            <RunToRunResult compare={compare} onDrill={onDrill} />
          )}
        </div>
      )}

      {!compare && !comparing && (
        <p className="py-10 text-center text-small text-ledger-meta">
          Choose the two reports and run a comparison — results render below.
        </p>
      )}
    </div>
  );
}

function CrossSystemResult({ compare, onDrill }) {
  const grand = compare.grand || {};
  const variance = Number(grand.variance || 0);
  const bannerTone = Math.abs(variance) <= 0.005 ? 'text-ledger-match' : 'text-ledger-brk';
  const table = compare.table || [];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-small text-ledger-meta">Report A total ({compare.a?.displayName || compare.a?.sourceId})</p>
          <p className="field-id mt-1 text-header-md font-bold">{fmtAmount(grand.a)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-small text-ledger-meta">Report B total ({compare.b?.displayName || compare.b?.sourceId})</p>
          <p className="field-id mt-1 text-header-md font-bold">{fmtAmount(grand.b)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-small text-ledger-meta">Variance</p>
          <p className={clsx('field-id mt-1 text-header-md font-bold', bannerTone)}>{fmtSignedAmount(variance)}</p>
        </Card>
      </div>

      {compare.execSummary && (
        <p className="rounded-lg border border-ledger-line bg-ledger-panel px-3 py-2 text-small text-ledger-meta">{compare.execSummary}</p>
      )}

      {table.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-ledger-line bg-ledger-panel px-4 py-2.5">
            <span className="text-small font-medium text-ledger-ink">Comparison by {compare.groupBy}</span>
            <span className={clsx('font-mono text-small', compare.breakingCount > 0 ? 'text-ledger-brk' : 'text-ledger-match')}>
              {compare.breakingCount} breaking dimension{compare.breakingCount !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-table">
              <thead>
                <tr className="border-b border-ledger-line text-left text-small text-ledger-meta">
                  {['Dimension', 'Report A total', 'Report B total', 'Variance', 'Variance %', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.map((row) => (
                  <tr
                    key={row.dimension}
                    className="cursor-pointer border-b border-ledger-line last:border-0 hover:bg-ledger-panel"
                    onClick={() => onDrill(row)}
                    title="Click to drill down"
                  >
                    <td className="field-id px-4 py-2 font-medium">{row.dimension}</td>
                    <td className="field-id px-4 py-2">{fmtAmount(row.aTotal)}</td>
                    <td className="field-id px-4 py-2">{fmtAmount(row.bTotal)}</td>
                    <td className={clsx('field-id px-4 py-2', Math.abs(Number(row.variance || 0)) > 0.005 ? 'text-ledger-brk' : 'text-ledger-ink')}>
                      {fmtSignedAmount(row.variance)}
                    </td>
                    <td className="field-id px-4 py-2">{fmtPct(row.variancePct)}</td>
                    <td className="px-4 py-2">
                      <Chip tone={row.status === 'matched' ? 'match' : 'brk'} dot>{row.status}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function RunToRunResult({ compare }) {
  const a = compare.a || {};
  const b = compare.b || {};
  const d = compare.deltas || {};
  const md = compare.mappingDiff || {};
  const cards = [
    { label: 'Run A', matchRate: a.matchRate, breaks: a.breaks, startedAt: a.startedAt },
    { label: 'Run B', matchRate: b.matchRate, breaks: b.breaks, startedAt: b.startedAt },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <p className="text-small text-ledger-meta">{c.label}</p>
            <p className="field-id mt-1 text-header-md font-bold">{fmtMatchRate(c.matchRate)}</p>
            <p className="mt-0.5 text-small text-ledger-meta">{c.breaks ?? 0} breaks · {fmtDateTime(c.startedAt)}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Δ match rate', value: fmtSignedAmount(d.matchRate), tone: Number(d.matchRate) >= 0 ? 'text-ledger-match' : 'text-ledger-brk' },
          { label: 'Δ break count', value: fmtSignedAmount(d.breakCount), tone: Number(d.breakCount) <= 0 ? 'text-ledger-match' : 'text-ledger-brk' },
          { label: 'Newly appeared', value: d.newlyAppeared ?? 0, tone: Number(d.newlyAppeared) > 0 ? 'text-ledger-brk' : 'text-ledger-match' },
          { label: 'Resolved', value: d.resolved ?? 0, tone: 'text-ledger-match' },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-small text-ledger-meta">{k.label}</p>
            <p className={clsx('field-id mt-1 text-header-md font-bold', k.tone)}>{k.value}</p>
          </Card>
        ))}
      </div>

      {md.changed && (
        <p className="rounded-lg border border-ledger-reconcile/50 bg-ledger-panel px-3 py-2 text-small text-ledger-reconcile">
          ⚠ Mapping changed between the two runs — the diff may explain the break delta.
        </p>
      )}

      {(compare.newlyAppeared || []).length > 0 && (
        <FlatList title="Newly appeared breaks" items={compare.newlyAppeared} />
      )}
      {(compare.resolved || []).length > 0 && (
        <FlatList title="Resolved breaks" items={compare.resolved} tone="match" />
      )}
    </>
  );
}

function FlatList({ title, items, tone = 'brk' }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-ledger-line bg-ledger-panel px-4 py-2.5 text-small font-medium text-ledger-ink">{title} ({items.length})</div>
      <div className="overflow-x-auto">
        <table className="w-full text-table">
          <tbody>
            {items.map((b, i) => (
              <tr key={i} className="border-b border-ledger-line last:border-0">
                <td className="field-id px-4 py-2">{b.key}</td>
                <td className="px-4 py-2"><Chip tone={b.type === 'transactional' ? 'accent' : 'potential'}>{b.type}</Chip></td>
                <td className="field-id px-4 py-2">dim: {b.dimension || '—'}</td>
                <td className={clsx('field-id px-4 py-2 text-right', tone === 'brk' ? 'text-ledger-brk' : 'text-ledger-match')}>
                  {fmtSignedAmount(b.variance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* --------------------------------- email report --------------------------------- */
function EmailReportModal({ open, onClose, runId, workflowName }) {
  const toast = useToast((s) => s.add);

  const [meta, setMeta] = useState(null);       // { workflowName, period, defaults, formats, candidates }
  const [toText, setToText] = useState('');
  const [format, setFormat] = useState('xlsx');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || !runId) return;
    let cancelled = false;
    setLoaded(false);
    setSending(false);
    api
      .get(`/reports/${runId}/email-recipients`)
      .then((res) => {
        if (cancelled) return;
        const m = res.data || {};
        setMeta(m);
        setToText((m.defaults || []).join(', '));
        setFormat('xlsx');
        setSubject(`OneRecon Break Report — ${m.workflowName || workflowName || 'Reconciliation'}`);
        setMessage(`Please find the final reconciliation report attached.\n\nWorkflow: ${m.workflowName || workflowName || '—'}\nPeriod: ${m.period || '—'}\n\nThis is an automated delivery from OneRecon.`);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(errMsg(err, 'Could not load email recipients'));
        onClose();
      });
    return () => { cancelled = true; };
  }, [open, runId, workflowName]); // eslint-disable-line react-hooks/exhaustive-deps

  const parseRecipients = () =>
    toText
      .split(/[,\s;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

  const toggleCandidate = (email) => {
    const list = parseRecipients();
    const next = list.includes(email) ? list.filter((e) => e !== email) : [...list, email];
    setToText(next.join(', '));
  };

  const send = async () => {
    const to = parseRecipients();
    if (to.length === 0) {
      toast.error('Add at least one recipient email');
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post(`/reports/${runId}/email`, { to, format, subject: subject.trim(), message: message.trim() });
      toast.success(data.message || 'Report emailed');
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Email failed'));
    } finally {
      setSending(false);
    }
  };

  const candidates = meta?.candidates || [];

  return (
    <Modal open={open} onClose={onClose} title="Email report" width="lg">
      <div className="space-y-4">
        <div>
          <label className="label">Recipients ({parseRecipients().length})</label>
          <textarea
            rows={2}
            className="input w-full font-mono"
            placeholder="recon-team@bank.com, approver@onerecon.io"
            value={toText}
            onChange={(e) => setToText(e.target.value)}
          />
          {candidates.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {candidates.map((c) => {
                const on = parseRecipients().includes(c.email);
                return (
                  <button
                    key={c._id}
                    type="button"
                    onClick={() => toggleCandidate(c.email)}
                    className={clsx(
                      'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                      on
                        ? 'border-ledger-accent bg-ledger-accent text-white'
                        : 'border-ledger-line text-ledger-meta hover:border-ledger-accent hover:text-ledger-ink'
                    )}
                  >
                    {c.name} · {c.role} {on && '✓'}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Format</label>
            <select className="input w-full" value={format} onChange={(e) => setFormat(e.target.value)}>
              {(meta?.formats || ['csv', 'xlsx', 'json', 'pdf', 'xml', 'text']).map((f) => (
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Subject</label>
            <input className="input w-full" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Message</label>
          <textarea rows={4} className="input w-full" value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={send} loading={sending} disabled={!loaded}>
            {sending ? 'Sending…' : '✉ Send report'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}