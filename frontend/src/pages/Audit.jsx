import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api, { errMsg } from '../lib/api';
import { clsx, fmtDateTime } from '../lib/format';
import { Button, Card, Chip, EmptyState, PageHeader, SkeletonRows } from '../components/ui.jsx';
import { useWorkflow } from '../store/useWorkflow';
import { useToast } from '../store/useToast';

const PAGE_SIZE = 20;

function prettyJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function DiffRow({ entry }) {
  const [open, setOpen] = useState(false);
  const hasBefore = entry.before && Object.keys(entry.before).length > 0;
  const hasAfter = entry.after && Object.keys(entry.after).length > 0;

  return (
    <div className="border-b border-ledger-line last:border-0">
      <div
        className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5 transition-colors hover:bg-ledger-panel"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="w-3 text-ledger-meta">{open ? '▾' : '▸'}</span>
        <Chip tone={entry.role === 'admin' ? 'match' : entry.role === 'approver' ? 'reconcile' : 'accent'} dot>{entry.role || '—'}</Chip>
        <span className="text-small font-medium text-ledger-ink">{entry.actorName || 'unknown'}</span>
        <span className="field-id text-small text-ledger-accent">{entry.action}</span>
        <span className="text-small text-ledger-meta">{entry.entity}{entry.entityId ? ` · ${entry.entityId}` : ''}</span>
        <span className="ml-auto font-mono text-small text-ledger-meta">{fmtDateTime(entry.createdAt)}</span>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="grid gap-3 border-t border-ledger-line bg-ledger-panel px-4 py-3 lg:grid-cols-2">
              {hasBefore && (
                <div className="overflow-hidden rounded-lg border border-ledger-line">
                  <p className="border-b border-ledger-line bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ledger-meta">Before</p>
                  <pre className="max-h-64 overflow-auto bg-white p-2.5 font-mono text-[11px] leading-relaxed text-ledger-ink">{prettyJson(entry.before)}</pre>
                </div>
              )}
              {hasAfter && (
                <div className="overflow-hidden rounded-lg border border-ledger-line">
                  <p className="border-b border-ledger-line bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ledger-accent">After</p>
                  <pre className="max-h-64 overflow-auto bg-white p-2.5 font-mono text-[11px] leading-relaxed text-ledger-ink">{prettyJson(entry.after)}</pre>
                </div>
              )}
              {!hasBefore && !hasAfter && (
                <div className="rounded-lg border border-dashed border-ledger-line bg-white px-4 py-8 text-center text-small text-ledger-meta lg:col-span-2">
                  No before/after payload captured for this entry.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const ACTION_OPTIONS = [
  'workflow.created',
  'workflow.updated',
  'workflow.deleted',
  'source.uploaded',
  'source.api_ingested',
  'validation.run',
  'validation.acknowledged',
  'mappings.saved',
  'join_map.uploaded',
  'reconcile.run',
  'break.investigated',
  'break.decided',
  'break.bulk_decided',
  'report.exported',
  'report.compare.exported',
].sort();

export default function Audit() {
  const { id } = useParams();
  const { workflow, loading } = useWorkflow();
  const toast = useToast((s) => s.add);

  const [filters, setFilters] = useState({ page: 1, entity: '', action: '' });
  const [data, setData] = useState(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingLogs(true);
    const params = new URLSearchParams();
    if (filters.entity) params.set('entity', filters.entity);
    if (filters.action) params.set('action', filters.action);
    params.set('page', String(filters.page));
    params.set('limit', String(PAGE_SIZE));
    api
      .get(`/audit/${id}?${params.toString()}`)
      .then(({ data: d }) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errMsg(err, 'Could not load audit log'));
      })
      .finally(() => {
        if (!cancelled) setLoadingLogs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, filters]);

  if (loading && !workflow) return <Card className="p-5"><SkeletonRows rows={6} cols={4} /></Card>;

  const logs = data?.logs || [];
  const pages = data?.pages || 1;

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle={workflow ? `Every mutation on “${workflow.name}” — the backend records these automatically` : '…'} />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input !w-auto !py-1.5 text-small"
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value, page: 1 }))}
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            className="input !w-auto !py-1.5 text-small"
            value={filters.entity}
            onChange={(e) => setFilters((f) => ({ ...f, entity: e.target.value, page: 1 }))}
          >
            <option value="">All entities</option>
            {['workflow', 'field_mappings', 'join_map', 'source', 'run', 'break', 'report'].map((en) => (
              <option key={en} value={en}>{en}</option>
            ))}
          </select>
          <span className="ml-auto text-small text-ledger-meta">{data?.total ?? 0} entries</span>
        </div>
      </Card>

      {error && (
        <p className="mb-4 rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">{error}</p>
      )}

      {loadingLogs && !data ? (
        <Card className="p-5"><SkeletonRows rows={12} cols={5} /></Card>
      ) : logs.length === 0 ? (
        <EmptyState title="No audit entries" message={filters.action || filters.entity ? 'Try clearing the filters.' : 'Mutations on this workflow will appear here.'} />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-ledger-line">
            {logs.map((entry) => (
              <DiffRow key={entry._id} entry={entry} />
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-ledger-line bg-ledger-panel px-4 py-2.5">
            <span className="text-small text-ledger-meta">Page {data?.page} of {pages}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>← Prev</Button>
              <Button size="sm" variant="outline" disabled={filters.page >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next →</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}