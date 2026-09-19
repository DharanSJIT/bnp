import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import api, { errMsg } from '../lib/api';
import { clsx, fmtAmount } from '../lib/format';
import { Button, Card, Chip, EmptyState, PageHeader, SkeletonRows, Spinner } from '../components/ui.jsx';
import { useWorkflow } from '../store/useWorkflow';
import { useToast } from '../store/useToast';

/* ------------------------- shared bits ------------------------- */
function StepBar({ label, progress, note }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-small">
        <span className="font-medium text-ledger-ink">{label}</span>
        {note && <span className="font-mono text-ledger-meta">{note}</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ledger-skeleton">
        <div className="h-full rounded-full bg-ledger-accent transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
      </div>
    </div>
  );
}

function SampleTable({ columns, sample, recordsLoaded }) {
  if (!columns?.length) return null;
  const rows = sample?.slice(0, 5) || [];
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-ledger-line">
      <div className="flex items-center justify-between border-b border-ledger-line bg-ledger-panel px-3 py-2">
        <span className="text-small font-medium text-ledger-ink">Preview</span>
        <span className="font-mono text-small text-ledger-meta">{recordsLoaded} records</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-table">
          <thead>
            <tr className="border-b border-ledger-line bg-white text-left text-small text-ledger-meta">
              {columns.map((c) => (
                <th key={c} className="px-3 py-1.5 font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-ledger-line last:border-0">
                {columns.map((c) => (
                  <td key={c} className="field-id max-w-[180px] truncate px-3 py-1.5">{r[c] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ValidationPanel({ result, onReupload }) {
  const [expanded, setExpanded] = useState(true);
  if (!result) return null;
  const failures = result.ruleFailures || [];
  const nulls = result.nulls || {};
  const outliers = result.outliers || {};
  const drift = result.schemaDrift;
  const warnings = result.warnings || [];
  const summary = result.ruleSummary || {};
  const nullCount = Object.values(nulls).reduce((a, b) => a + b, 0);
  const outlierCount = Object.values(outliers).reduce((a, b) => a + b, 0);
  const hasIssues = nullCount > 0 || outlierCount > 0 || failures.length > 0 || !!drift || warnings.length > 0;

  return (
    <Card className={clsx('mt-3 p-4', hasIssues ? 'border-ledger-brk/40' : 'border-ledger-match/40')}>
      <button className="flex w-full items-center justify-between" onClick={() => setExpanded((e) => !e)}>
        <span className="flex items-center gap-2 text-small font-semibold">
          <span className={clsx('h-2 w-2 rounded-full', hasIssues ? 'bg-ledger-brk' : 'bg-ledger-match')} />
          {hasIssues ? 'AI validation found issues' : 'AI validation passed'} — {result.totals?.records?.toLocaleString() || 0} records · {result.totals?.columns || 0} columns
        </span>
        <span className="text-ledger-meta">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          {summary.total > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(summary).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-ledger-line bg-white px-3 py-2">
                  <p className="text-small text-ledger-meta">{k}</p>
                  <p className="field-id truncate text-sm">{Array.isArray(v) ? v.join(', ') || '—' : String(v ?? '—')}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <IssueBlock title="Nulls" count={nullCount} tone="brk">
              {Object.entries(nulls).length === 0 && <p className="text-small text-ledger-meta">No null fields detected</p>}
              {Object.entries(nulls).map(([f, c]) => (
                <div key={f} className="flex items-center justify-between text-small">
                  <span className="field-id">{f}</span>
                  <span className="font-mono text-ledger-meta">{c}</span>
                </div>
              ))}
            </IssueBlock>
            <IssueBlock title="Outliers" count={outlierCount} tone="reconcile">
              {Object.entries(outliers).length === 0 && <p className="text-small text-ledger-meta">No outliers detected</p>}
              {Object.entries(outliers).map(([f, c]) => (
                <div key={f} className="flex items-center justify-between text-small">
                  <span className="field-id">{f}</span>
                  <span className="font-mono text-ledger-meta">{c}</span>
                </div>
              ))}
            </IssueBlock>
          </div>

          {failures.length > 0 && (
            <div>
              <p className="mb-1.5 text-small font-semibold text-ledger-ink">Rule failures ({failures.length})</p>
              <div className="space-y-2">
                {failures.map((f) => (
                  <div key={`${f.ruleId}-${f.field}`} className="rounded-lg border border-ledger-line bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone="brk">{f.type}</Chip>
                      <span className="field-id">{f.field}</span>
                      <span className="text-small text-ledger-meta">{f.ruleId}</span>
                      <span className="ml-auto font-mono text-small text-ledger-brk">× {f.count}</span>
                    </div>
                    {f.params && Object.keys(f.params).length > 0 && (
                      <p className="mt-1 text-small text-ledger-meta">{JSON.stringify(f.params)}</p>
                    )}
                    {(f.sampleValues || []).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(f.sampleValues || []).map((v, i) => (
                          <span key={i} className="chip border-ledger-line font-mono text-small text-ledger-meta">{String(v)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {drift && (
            <div className="rounded-lg border border-ledger-reconcile/40 bg-white p-3">
              <p className="text-small font-semibold text-ledger-reconcile">Schema drift vs load {drift.previousLoadId}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(drift.newColumns || []).map((c) => <Chip key={c} tone="reconcile">new: {c}</Chip>)}
                {(drift.missingColumns || []).map((c) => <Chip key={c} tone="brk">missing: {c}</Chip>)}
              </div>
            </div>
          )}

          {warnings.length > 0 && (
            <ul className="space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className="text-small text-ledger-meta">• {w}</li>
              ))}
            </ul>
          )}

          <div>
            <Button variant="outline" size="sm" onClick={onReupload}>↺ Fix &amp; re-upload</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function IssueBlock({ title, count, tone, children }) {
  return (
    <div className="rounded-lg border border-ledger-line bg-white p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-small font-semibold">{title}</p>
        <span className={clsx('font-mono text-small', count > 0 ? (tone === 'brk' ? 'text-ledger-brk' : 'text-ledger-reconcile') : 'text-ledger-match')}>
          {count}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/* ------------------------- file panel ------------------------- */
function FilePanel({ workflowId, source, onRefresh, onValidation }) {
  const toast = useToast((s) => s.add);
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(null);
  const [validating, setValidating] = useState(false);
  const [file, setFile] = useState(null);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.xls', '.xlsx'], 'application/json': ['.json'], 'application/xml': ['.xml', '.txt'] },
    multiple: false,
    onDrop: (files) => setFile(files[0] || null),
  });

  const uploadedOk = uploaded || source.loadStats?.lastLoadId;

  const doUpload = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/workflows/${workflowId}/sources/${source.sourceId}/upload`, fd);
      setUploaded(data);
      toast.success(`${data.recordsLoaded?.toLocaleString?.() || 0} records loaded from ${file.name}`);
      onRefresh();
    } catch (err) {
      toast.error(errMsg(err, 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };

  const runValidation = async () => {
    const loadId = uploaded?.loadId || source.loadStats?.lastLoadId;
    if (!loadId) return;
    setValidating(true);
    try {
      const { data } = await api.post(`/workflows/${workflowId}/validate`, { sourceId: source.sourceId, loadId });
      onValidation(source.sourceId, data);
      toast.success('Validation complete');
    } catch (err) {
      toast.error(errMsg(err, 'Validation failed'));
    } finally {
      setValidating(false);
    }
  };

  const reupload = () => {
    setUploaded(null);
    setFile(null);
    onValidation(source.sourceId, null);
  };

  const cols = uploaded?.columns || [];
  const sample = uploaded?.sample || [];

  return (
    <div>
      {!uploadedOk ? (
        <>
          <div
            {...getRootProps()}
            className={clsx(
              'cursor-pointer rounded-lg border border-dashed p-7 text-center transition-colors',
              isDragActive ? 'border-ledger-accent bg-ledger-accent/5' : 'border-ledger-line bg-white hover:border-ledger-accent'
            )}
          >
            <input {...getInputProps()} />
            {file ? (
              <div>
                <p className="font-mono text-sm text-ledger-ink">{file.name}</p>
                <p className="mt-1 text-small text-ledger-meta">{(file.size / 1024).toFixed(1)} KB — click again to choose a different file</p>
                <Button size="sm" className="mt-3" onClick={(e) => { e.stopPropagation(); doUpload(); }} loading={busy}>
                  {busy ? 'Uploading…' : 'Upload'}
                </Button>
              </div>
            ) : (
              <div>
                <p className="text-base font-medium text-ledger-ink">Drop a file here, or click to browse</p>
                <p className="mt-1 text-small text-ledger-meta">.csv · .xls · .xlsx · .json · .xml</p>
              </div>
            )}
          </div>
        </>
      ) : uploaded || source.loadStats ? (
        <div>
          <div className="flex flex-wrap items-center gap-2 text-small">
            <Chip tone="match" dot>loaded {uploaded?.recordsLoaded ?? source.loadStats?.recordsLoaded} records in {(uploaded?.timeTakenMs ?? source.loadStats?.timeTakenMs ?? 0).toLocaleString()} ms</Chip>
            <span className="font-mono text-ledger-meta">load {uploaded?.loadId || source.loadStats?.lastLoadId}</span>
          </div>
          <SampleTable columns={cols.length ? cols : undefined} sample={sample} recordsLoaded={uploaded?.recordsLoaded} />
          <div className="mt-3 flex gap-2">
            <Button onClick={runValidation} loading={validating} disabled={!uploadedOk && !uploaded?.loadId && !source.loadStats?.lastLoadId}>
              {validating ? 'Running AI validation…' : 'Run AI Validation'}
            </Button>
            <Button variant="outline" onClick={reupload}>↺ Re-upload</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------- api panel ------------------------- */
function ApiPanel({ workflowId, source, onRefresh, onValidation }) {
  const toast = useToast((s) => s.add);
  const [baseUrl, setBaseUrl] = useState(source.config?.baseUrl || 'http://127.0.0.1:5001');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [ingesting, setIngesting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ingestResult, setIngestResult] = useState(null);
  const [validating, setValidating] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post(`/workflows/${workflowId}/sources/${source.sourceId}/api-test`, { baseUrl });
      setTestResult(data);
      if (data.ok) toast.success('Connection OK');
      else toast.error(data.health || 'Connection failed');
    } catch (err) {
      setTestResult({ ok: false, health: errMsg(err) });
      toast.error(errMsg(err, 'Connection failed'));
    } finally {
      setTesting(false);
    }
  };

  const ingest = async () => {
    if (ingesting) return;
    setIngesting(true);
    setProgress(4);
    timer.current = setInterval(() => setProgress((p) => Math.min(92, p + 4 + Math.random() * 6)), 420);
    try {
      const { data } = await api.post(`/workflows/${workflowId}/sources/${source.sourceId}/api-ingest`, { baseUrl });
      clearInterval(timer.current);
      setProgress(100);
      setIngestResult(data);
      toast.success(`${data.recordsLoaded?.toLocaleString?.() || 0} records pulled`);
      onRefresh();
    } catch (err) {
      clearInterval(timer.current);
      setProgress(0);
      toast.error(errMsg(err, 'Ingestion failed'));
    } finally {
      setIngesting(false);
    }
  };

  const reingest = () => {
    setIngestResult(null);
    setProgress(0);
    onValidation(source.sourceId, null);
  };

  const pagesNote = ingestResult ? `page ${ingestResult.pages || ingestResult.total || '?'} / ${ingestResult.total || '?'}` : null;

  return (
    <div>
      <div className="flex gap-2">
        <input
          className="input font-mono"
          value={baseUrl}
          onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null); }}
          placeholder="http://127.0.0.1:5001"
        />
        <Button variant="outline" onClick={testConnection} loading={testing}>Test Connection</Button>
      </div>

      {testResult && (
        <div className={clsx('mt-2 rounded-lg border px-3 py-2 text-small', testResult.ok ? 'border-ledger-match/50 text-ledger-match' : 'border-ledger-brk/50 text-ledger-brk')}>
          {testResult.ok ? `OK — ${testResult.summary || ''} ${testResult.period ? `· period ${testResult.period}` : ''}` : testResult.health}
        </div>
      )}

      {!ingestResult ? (
        <div className="mt-3">
          <Button onClick={ingest} loading={ingesting} disabled={!baseUrl.trim()}>
            {ingesting ? 'Ingesting all pages…' : 'Ingest All Pages'}
          </Button>
          {ingesting && <StepBar label="Pulling pages from API" progress={progress} />}
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2 text-small">
            <Chip tone="match" dot>loaded {ingestResult.recordsLoaded?.toLocaleString?.() || 0} records · {ingestResult.pages} pages / {ingestResult.total} total</Chip>
            <span className="font-mono text-ledger-meta">load {ingestResult.loadId}</span>
          </div>
          <StepBar label="Ingest progress" progress={100} note={pagesNote} />
          {ingestResult.sample && <SampleTable columns={ingestResult.sample[0] ? Object.keys(ingestResult.sample[0]) : undefined} sample={ingestResult.sample} recordsLoaded={ingestResult.recordsLoaded} />}
          <div className="mt-3 flex gap-2">
            <Button onClick={runValidationSafe} loading={validating}>
              {validating ? 'Running AI validation…' : 'Run AI Validation'}
            </Button>
            <Button variant="outline" onClick={reingest}>↺ Re-ingest</Button>
          </div>
        </div>
      )}
    </div>
  );

  async function runValidationSafe() {
    const loadId = ingestResult?.loadId || source.loadStats?.lastLoadId;
    if (!loadId) return;
    setValidating(true);
    try {
      const { data } = await api.post(`/workflows/${workflowId}/validate`, { sourceId: source.sourceId, loadId });
      onValidation(source.sourceId, data);
      toast.success('Validation complete');
    } catch (err) {
      toast.error(errMsg(err, 'Validation failed'));
    } finally {
      setValidating(false);
    }
  }
}

/* ------------------------- db panel ------------------------- */
function DbPanel() {
  return (
    <div className="rounded-lg border border-dashed border-ledger-line bg-white p-7 text-center">
      <p className="text-base font-medium text-ledger-meta">Database ingestion</p>
      <Chip tone="reconcile" className="mt-2">beta — coming soon</Chip>
      <p className="mt-2 text-small text-ledger-meta">Direct DB sources are not enabled in this build.</p>
    </div>
  );
}

/* ------------------------- page ------------------------- */
export default function Ingest() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { workflow, loading, refresh } = useWorkflow();
  const toast = useToast((s) => s.add);
  const [validations, setValidations] = useState({});
  const [acknowledging, setAcknowledging] = useState(false);

  const sources = workflow?.sources || [];

  const onValidation = (sourceId, result) => {
    setValidations((v) => ({ ...v, [sourceId]: result }));
  };

  const allIngested = sources.length > 0 && sources.every((s) => s.ingestStatus === 'ingested');
  const allValidated = sources.length > 0 && sources.every((s) => validations[s.sourceId]);
  const canGo = allIngested && allValidated;
  const missing = sources.filter((s) => s.ingestStatus !== 'ingested');

  const goAhead = async () => {
    if (!canGo || acknowledging) return;
    setAcknowledging(true);
    try {
      const { data } = await api.post(`/workflows/${id}/acknowledge-validation`, {});
      toast.success('Validation acknowledged — moving to mapping');
      if (data.workflow) await refresh();
      navigate(`/workflows/${id}/mapping`);
    } catch (err) {
      toast.error(errMsg(err, 'Acknowledge failed'));
    } finally {
      setAcknowledging(false);
    }
  };

  if (loading && !workflow) {
    return <Card className="p-5"><SkeletonRows rows={5} cols={3} /></Card>;
  }

  if (!workflow) {
    return (
      <EmptyState
        title="Workflow not found"
        message="It may have been deleted."
        action={<Link to="/dashboard"><Button variant="outline">Back to dashboard</Button></Link>}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Ingest & Validate"
        subtitle={`Load data for each source of “${workflow.name}”, then run AI validation before mapping`}
        actions={
          <Link to={`/workflows/${id}/mapping`}>
            <Button variant="outline" disabled={!canGo} title={canGo ? '' : 'Validate every source first'}>
              Validation gate{workflow.validationAcknowledged ? ' (re-armed)' : ''}
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {sources.map((s, i) => (
          <motion.div key={s.sourceId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15, delay: i * 0.04 }}>
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-header-md font-semibold">{s.displayName}</h3>
                  <Chip tone="accent" className="font-mono">{s.sourceId}</Chip>
                  <Chip tone={s.ingestStatus === 'ingested' ? 'match' : s.ingestStatus === 'ingesting' ? 'reconcile' : 'neutral'} dot>
                    {s.ingestStatus || 'not-started'}
                  </Chip>
                </div>
                <Chip tone="neutral">{s.ingestionType}</Chip>
              </div>

              {s.ingestionType === 'file' && (
                <FilePanel
                  workflowId={id}
                  source={s}
                  onRefresh={refresh}
                  onValidation={onValidation}
                />
              )}
              {s.ingestionType === 'api' && (
                <ApiPanel
                  workflowId={id}
                  source={s}
                  onRefresh={refresh}
                  onValidation={onValidation}
                />
              )}
              {s.ingestionType === 'db' && <DbPanel />}

              {validations[s.sourceId] && (
                <ValidationPanel result={validations[s.sourceId]} onReupload={() => onValidation(s.sourceId, null)} />
              )}
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Gate footer */}
      <div className="mt-6 rounded-panel border border-ledger-line bg-ledger-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-small text-ledger-meta">
            {missing.length > 0 && (
              <p>ⓘ Waiting on ingestion: {missing.map((m) => m.sourceId).join(', ')}</p>
            )}
            {missing.length === 0 && !allValidated && <p>ⓘ Run AI validation on every ingested source ({sources.filter((s) => !validations[s.sourceId]).map((s) => s.sourceId).join(', ') || 'all done'}) to unlock the gate.</p>}
            {canGo && <p>✓ All sources ingested and validated — proceed to field mapping.</p>}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={goAhead}
              disabled={!canGo}
              loading={acknowledging}
              size="lg"
            >
              {acknowledging ? 'Acknowledging…' : 'Go-Ahead → Mapping'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}