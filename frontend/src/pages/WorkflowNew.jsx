import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api, { errMsg } from '../lib/api';
import { Button, Card, Chip, PageHeader, Spinner } from '../components/ui.jsx';
import { useToast } from '../store/useToast';

const INGESTION_TYPES = [
  { value: 'file', label: 'File upload', hint: '.csv / .xlsx / .json / .xml' },
  { value: 'api', label: 'REST API', hint: 'pull pages from a base URL' },
  { value: 'db', label: 'Database', hint: 'beta' },
];

function slugId(displayName, index) {
  const slug = String(displayName || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 10);
  if (!slug) return `src-${index}`;
  return slug;
}

function SourceBlock({ index, source, onChange, onRemove, canRemove }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-small font-semibold text-ledger-meta">
          Source {index + 1}
          <Chip tone="accent" className="font-mono">{source.sourceId || `src-${index + 1}`}</Chip>
        </span>
        {canRemove && (
          <button onClick={onRemove} className="text-small text-ledger-brk hover:underline">Remove</button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Display name</label>
          <input
            className="input"
            placeholder="e.g. General Ledger"
            value={source.displayName}
            onChange={(e) => onChange({ ...source, displayName: e.target.value, sourceId: slugId(e.target.value, index + 1) })}
          />
        </div>
        <div>
          <label className="label">Ingestion type</label>
          <div className="grid grid-cols-3 gap-1.5">
            {INGESTION_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => onChange({ ...source, ingestionType: t.value, config: t.value === 'api' ? { baseUrl: 'http://127.0.0.1:5001' } : {} })}
                className={`rounded-lg border px-2 py-2 text-center text-small transition-colors ${
                  source.ingestionType === t.value
                    ? 'border-ledger-accent bg-ledger-accent text-white'
                    : 'border-ledger-line bg-white text-ledger-meta hover:border-ledger-accent'
                }`}
              >
                {t.label}
                {t.value === 'db' && <span className="ml-1 text-[10px] uppercase opacity-80">beta</span>}
              </button>
            ))}
          </div>
        </div>
        {source.ingestionType === 'api' && (
          <div className="sm:col-span-2">
            <label className="label">Base URL</label>
            <input
              className="input font-mono"
              placeholder="http://127.0.0.1:5001"
              value={source.config.baseUrl || ''}
              onChange={(e) => onChange({ ...source, config: { ...source.config, baseUrl: e.target.value } })}
            />
          </div>
        )}
        {source.ingestionType === 'file' && (
          <div className="sm:col-span-2">
            <label className="label">Upload Document (Optional)</label>
            <input
              type="file"
              className="input"
              accept=".csv,.xlsx,.xls,.json,.xml,.txt"
              onChange={(e) => onChange({ ...source, file: e.target.files[0] || null })}
            />
          </div>
        )}
        {source.ingestionType === 'db' && (
          <p className="text-small text-ledger-meta sm:col-span-2">
            Database ingestion is in <Chip tone="reconcile">beta</Chip> — this source panel will be disabled on the ingest screen.
          </p>
        )}
      </div>
    </Card>
  );
}

export default function WorkflowNew() {
  const navigate = useNavigate();
  const toast = useToast((s) => s.add);
  const [name, setName] = useState('');
  const [period, setPeriod] = useState('');
  const [sources, setSources] = useState([
    { sourceId: 'SRC1', displayName: '', ingestionType: 'file', config: {}, file: null },
    { sourceId: 'SRC2', displayName: '', ingestionType: 'file', config: {}, file: null },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const addSource = () =>
    setSources((s) => [
      ...s,
      { sourceId: `SRC${s.length + 1}`, displayName: '', ingestionType: 'file', config: {}, file: null },
    ]);

  const updateSource = (i, val) =>
    setSources((s) => s.map((x, idx) => (idx === i ? val : x)));

  const removeSource = (i) => setSources((s) => s.filter((_, idx) => idx !== i));

  const complete = sources.every((s) => s.displayName.trim());
  const valid = name.trim() && sources.length >= 2 && complete;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post('/workflows', {
        name: name.trim(),
        period: period.trim(),
        sources: sources.map((s, i) => ({
          sourceId: slugId(s.displayName, i + 1),
          displayName: s.displayName.trim(),
          ingestionType: s.ingestionType,
          config: s.config || {},
        })),
      });

      const workflowId = data.workflow._id;
      let uploadCount = 0;

      // Upload files for each file source
      for (const [i, s] of sources.entries()) {
        if (s.ingestionType === 'file' && s.file) {
          const sourceId = slugId(s.displayName, i + 1);
          const fd = new FormData();
          fd.append('file', s.file);
          try {
            await api.post(`/workflows/${workflowId}/sources/${sourceId}/upload`, fd);
            toast.success(`Uploaded ${s.file.name} for ${s.displayName}`);
            uploadCount++;
          } catch (uploadErr) {
            toast.error(errMsg(uploadErr, `Failed to upload ${s.file.name}`));
          }
        }
      }

      toast.success(`Workflow “${data.workflow.name}” created${uploadCount > 0 ? ` with ${uploadCount} files` : ''}`);
      navigate(`/workflows/${workflowId}/ingest`);
    } catch (err) {
      setError(errMsg(err, 'Could not create workflow'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New Workflow"
        subtitle="Give it a name and connect at least two data sources"
        actions={<button onClick={() => navigate('/dashboard')} className="btn btn-ghost">Cancel</button>}
      />

      <form onSubmit={submit} className="space-y-4">
        <Card className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="label">Workflow name *</label>
              <input
                className="input"
                placeholder="e.g. Aug 2026 GL–MA–FA Recon"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Period</label>
              <input
                className="input font-mono"
                placeholder="202608"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
          </div>
        </Card>

        <div className="space-y-3">
          {sources.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 15, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.4, delay: i * 0.1, ease: [0.25, 1, 0.5, 1] }}
            >
              <SourceBlock
                index={i}
                source={s}
                onChange={(v) => updateSource(i, v)}
                onRemove={() => removeSource(i)}
                canRemove={sources.length > 2}
              />
            </motion.div>
          ))}
          <Button variant="outline" onClick={addSource}>＋ Add source</Button>
        </div>

        {error && (
          <p className="rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-ledger-line pt-4">
          <Button variant="ghost" onClick={() => navigate('/dashboard')}>Cancel</Button>
          <Button type="submit" size="lg" disabled={!valid} loading={submitting}>
            {submitting ? <><Spinner className="h-4 w-4" /> Creating…</> : 'Create workflow'}
          </Button>
        </div>
      </form>
    </div>
  );
}