import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { errMsg } from '../lib/api';
import { clsx } from '../lib/format';
import { Button, Card, Chip, EmptyState, PageHeader, SkeletonRows } from '../components/ui.jsx';
import { useWorkflow } from '../store/useWorkflow';
import { useToast } from '../store/useToast';

const key = (sourceId, name) => `${sourceId}|${name}`;
const STATUS_TONE = { common: 'match', potential: 'potential', uncommon: 'brk' };
const CHIP_TONE_BORDER = {
  match: 'border-ledger-match text-ledger-match',
  potential: 'border-ledger-potential text-[#4D7C0F]',
  brk: 'border-ledger-brk text-ledger-brk',
};
const AMOUNT_NAMES = ['amount', 'value', 'total', 'balance'];

function nameSim(a, b) {
  const na = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nb = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return na.includes(nb) || nb.includes(na) ? 0.82 : 0.5;
}

function newGroupConfidence(a, b) {
  const s = nameSim(a, b);
  if (s >= 1) return 0.97;
  if (s >= 0.8) return 0.8;
  return 0.58;
}

function FieldChip({ fieldKey, meta, tone, selected, dragging, onSelect, onDragStart, onRemove, onDropConnect }) {
  const [hover, setHover] = useState(false);
  const [, name] = fieldKey.split('|');
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', fieldKey);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(fieldKey);
      }}
      onDragEnd={() => onDragStart(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const k = e.dataTransfer.getData('text/plain');
        if (k && k !== fieldKey) onDropConnect(k, fieldKey);
      }}
      onClick={() => onSelect(fieldKey)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={clsx(
        'chip relative cursor-pointer border bg-white transition-all hover:shadow-hover',
        dragging && 'opacity-40',
        selected ? 'border-ledger-accent bg-ledger-accent text-white' : CHIP_TONE_BORDER[tone]
      )}
    >
      {meta && meta.dtype === 'numeric' && (
        <span className={clsx('h-1 w-1 rounded-full', selected ? 'bg-white' : 'bg-ledger-meta')} />
      )}
      {name}
      {onRemove && !selected && (
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full px-1 text-[10px] hover:bg-ledger-brk hover:text-white"
          title="Remove from group"
        >
          ×
        </span>
      )}
      {hover && meta && (
        <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 w-56 -translate-x-1/2 rounded-lg border border-ledger-line bg-white p-2 shadow-hover">
          <span className="flex items-center gap-1.5">
            <Chip tone={meta.dtype === 'numeric' ? 'reconcile' : 'accent'}>{meta.dtype}</Chip>
            <span className="text-[10px] text-ledger-meta">cardinality {meta.cardinality}</span>
          </span>
          <span className="mt-1 block text-[10px] font-medium text-ledger-meta">Top samples</span>
          <span className="mt-0.5 block space-y-0.5">
            {(meta.sampleValues || []).slice(0, 5).map((v, i) => (
              <span key={i} className="block truncate font-mono text-[10px] text-ledger-ink">{String(v)}</span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

function SourcePanel({ source, groups, unassigned, query, onQuery, selectedKey, onSelect, onDropConnect, onToggleReconcile, onRemoveField, draggingKey, onDragStart, fieldMeta }) {
  const q = query.toLowerCase();
  const memberKeysFor = (g) => g.fields.filter((f) => f.sourceId === source.sourceId).map((f) => key(f.sourceId, f.fieldName));
  const visibleGroups = groups.filter((g) => memberKeysFor(g).length > 0);
  const unassignedHere = unassigned.filter(
    (f) => f.sourceId === source.sourceId && (!q || String(f.name).toLowerCase().includes(q))
  );

  return (
    <Card className="flex h-full min-w-[270px] max-w-[330px] flex-col">
      <div className="border-b border-ledger-line px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-small font-semibold">{source.displayName}</h4>
          <Chip tone="accent" className="font-mono">{source.sourceId}</Chip>
        </div>
        <input
          className="input mt-2 !py-1.5 text-small"
          placeholder={`Search ${source.sourceId} fields…`}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>

      <div
        className="flex-1 space-y-2.5 overflow-y-auto p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onDragStart(null);
        }}
      >
        {visibleGroups.map((g) => {
          const members = memberKeysFor(g).filter((k) => !q || k.toLowerCase().includes(q));
          if (members.length === 0) return null;
          return (
            <div key={g.targetGroupId} className="rounded-lg border border-ledger-line bg-white p-2">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                {g.isReconcileField && <span className="h-1.5 w-1.5 rounded-full bg-ledger-reconcile" title="reconcile target" />}
                <span className="field-id text-small font-medium">{g.targetGroupId}</span>
                <Chip tone={STATUS_TONE[g.status] || 'neutral'} dot>{g.status}</Chip>
                <span className="font-mono text-[11px] text-ledger-meta">{Math.round((g.confidence || 0) * 100)}%</span>
                <button
                  onClick={() => onToggleReconcile(g)}
                  title="Toggle reconcile field"
                  className={clsx(
                    'ml-auto rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors',
                    g.isReconcileField
                      ? 'border-ledger-reconcile bg-ledger-reconcile text-white'
                      : 'border-ledger-line text-ledger-meta hover:border-ledger-reconcile hover:text-ledger-reconcile'
                  )}
                >
                  reconcile
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {members.map((k) => (
                  <FieldChip
                    key={k}
                    fieldKey={k}
                    meta={fieldMeta.get(k)}
                    tone={STATUS_TONE[g.status] || 'neutral'}
                    selected={selectedKey === k}
                    dragging={draggingKey === k}
                    onSelect={onSelect}
                    onDragStart={onDragStart}
                    onRemove={() => onRemoveField(k)}
                    onDropConnect={onDropConnect}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {unassignedHere.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ledger-meta">Unmatched</p>
            <div className="flex flex-wrap gap-1">
              {unassignedHere.map((f) => {
                const k = key(f.sourceId, f.name);
                return (
                  <FieldChip
                    key={k}
                    fieldKey={k}
                    meta={fieldMeta.get(k)}
                    tone="brk"
                    selected={selectedKey === k}
                    dragging={draggingKey === k}
                    onSelect={onSelect}
                    onDragStart={onDragStart}
                    onDropConnect={onDropConnect}
                  />
                );
              })}
            </div>
          </div>
        )}

        {unassignedHere.length === 0 && q && <p className="py-3 text-center text-small text-ledger-meta">No fields match “{q}”</p>}
      </div>
    </Card>
  );
}

export default function Mapping() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { workflow, mapping, joinMap: storeJoinMap, loading } = useWorkflow();
  const toast = useToast((s) => s.add);

  const [sources, setSources] = useState([]);
  const [fieldMeta, setFieldMeta] = useState(new Map());
  const [groups, setGroups] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [queries, setQueries] = useState({});
  const [stats, setStats] = useState({ common: 0, potential: 0, uncommon: 0 });
  const [loadingSug, setLoadingSug] = useState(true);
  const [sugError, setSugError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [joinMap, setJoinMap] = useState(null);
  const [joinUploading, setJoinUploading] = useState(false);
  const joinInput = useRef(null);

  // existing join map from workflow detail
  useEffect(() => {
    if (storeJoinMap) {
      setJoinMap({
        id: storeJoinMap._id,
        fileName: storeJoinMap.fileName || 'join-map',
        rows: Array.isArray(storeJoinMap.rows) ? storeJoinMap.rows.length : storeJoinMap.rows || 0,
      });
    }
  }, [storeJoinMap]);

  const pushHistory = (nextGroups, nextUnassigned) => {
    setHistory((h) => [...h.slice(-49), { groups, unassigned }]);
    setGroups(nextGroups);
    setUnassigned(nextUnassigned);
  };

  const applyCounts = (gs, un) => {
    setStats({
      common: gs.filter((g) => g.status === 'common').length,
      potential: gs.filter((g) => g.status === 'potential').length,
      uncommon: un.length,
    });
  };

  useEffect(() => {
    const meta = new Map();
    for (const s of sources) for (const f of s.fields || []) meta.set(key(s.sourceId, f.name), f);
    setFieldMeta(meta);
  }, [sources]);

  useEffect(() => {
    let cancelled = false;
    setLoadingSug(true);
    setSugError(null);
    const existing = mapping && mapping.mappings && mapping.mappings.length > 0 ? mapping.mappings : null;

    const applyData = (data, preferExisting) => {
      const srcs = data.sources || [];
      if (cancelled) return;
      setSources(srcs);
      const meta = new Map();
      for (const s of srcs) for (const f of s.fields || []) meta.set(key(s.sourceId, f.name), f);
      setFieldMeta(meta);

      let gs;
      let un;
      if (preferExisting) {
        gs = existing.map((g) => ({
          ...g,
          fields: (g.fields || []).map((f) => ({ sourceId: f.sourceId, fieldName: f.fieldName })),
          overriddenByUser: !!g.overriddenByUser,
        }));
        const covered = new Set(gs.flatMap((g) => g.fields.map((f) => key(f.sourceId, f.fieldName))));
        un = srcs
          .flatMap((s) => (s.fields || []).map((f) => ({ sourceId: s.sourceId, name: f.name, dtype: f.dtype, sampleValues: f.sampleValues, cardinality: f.cardinality })))
          .filter((f) => !covered.has(key(f.sourceId, f.name)));
      } else {
        gs = (data.groups || []).map((g) => ({ ...g, overriddenByUser: !!g.overriddenByUser }));
        un = (data.unassigned || []).map((f) => ({
          sourceId: f.sourceId,
          name: f.name ?? f.fieldName,
          dtype: f.dtype,
          sampleValues: f.sampleValues,
          cardinality: f.cardinality,
        }));
      }
      setGroups(gs);
      setUnassigned(un);
      applyCounts(gs, un);
      setHistory([]);
      setSelected(null);
    };

    const fetchSuggestions = async () => {
      try {
        const { data } = await api.get(`/workflows/${id}/mapping-suggestions`);
        if (!cancelled) applyData(data, !!existing);
      } catch (err) {
        if (cancelled) return;
        setSugError(errMsg(err, 'Could not load mapping suggestions'));
        if (existing) {
          const gs = existing.map((g) => ({
            ...g,
            fields: (g.fields || []).map((f) => ({ sourceId: f.sourceId, fieldName: f.fieldName })),
            overriddenByUser: true,
          }));
          setGroups(gs);
          setUnassigned([]);
          applyCounts(gs, []);
        }
      } finally {
        if (!cancelled) setLoadingSug(false);
      }
    };

    const hasLoads = (workflow?.sources || []).some((s) => s.loadStats?.lastLoadId);
    if (existing || hasLoads) fetchSuggestions();
    else {
      setLoadingSug(false);
      setSugError('Ingest at least two sources before mapping.');
    }

    return () => {
      cancelled = true;
    };
  }, [id, workflow?.sources, mapping]);

  const groupOf = (k) => groups.find((g) => g.fields.some((f) => key(f.sourceId, f.fieldName) === k)) || null;
  const unassignedField = (k) => unassigned.find((f) => key(f.sourceId, f.name) === k) || null;

  const connect = (kA, kB) => {
    if (!kA || !kB || kA === kB) return;
    const [srcA, nameA] = kA.split('|');
    const [srcB, nameB] = kB.split('|');
    if (srcA === srcB) return;
    const gA = groupOf(kA);
    const gB = groupOf(kB);

    let nextGroups = groups.map((g) => ({ ...g, fields: [...g.fields] }));
    let nextUnassigned = [...unassigned];

    // collapse any 1-member groups that would be invalid after mutation
    const collapseSingletons = (list) => {
      const orphans = [];
      const kept = [];
      for (const g of list) {
        if (g.fields.length === 1) {
          const f = g.fields[0];
          orphans.push({ sourceId: f.sourceId, name: f.fieldName });
        } else {
          kept.push(g);
        }
      }
      return { kept, orphans };
    };
    const nextUn = (list, orphans) => {
      const un = nextUnassigned.filter((f) => !orphans.some((o) => key(o.sourceId, o.name) === key(f.sourceId, f.name)));
      return [...un, ...orphans];
    };

    if (gA && gB) {
      if (gA.targetGroupId === gB.targetGroupId) return;
      const target = nextGroups.find((g) => g.targetGroupId === gA.targetGroupId);
      const absorbed = nextGroups.find((g) => g.targetGroupId === gB.targetGroupId);
      target.fields.push(...absorbed.fields);
      target.confidence = Math.min(target.confidence || 0, absorbed.confidence || 0);
      target.overriddenByUser = true;
      if (target.status === 'common' && absorbed.status !== 'common') target.status = 'potential';
      nextGroups = nextGroups.filter((g) => g.targetGroupId !== gB.targetGroupId);
      const { kept, orphans } = collapseSingletons(nextGroups);
      pushHistory(kept, nextUn(kept, orphans));
    } else if (gA) {
      const target = nextGroups.find((g) => g.targetGroupId === gA.targetGroupId);
      if (!target.fields.some((f) => key(f.sourceId, f.fieldName) === kB)) {
        target.fields.push({ sourceId: srcB, fieldName: nameB });
        target.overriddenByUser = true;
        if (target.status === 'common' && nameSim(target.targetGroupId, nameB) < 0.9) target.status = 'potential';
        nextUnassigned = nextUnassigned.filter((f) => key(f.sourceId, f.name) !== kB);
      }
      const { kept, orphans } = collapseSingletons(nextGroups);
      pushHistory(kept, nextUn(kept, orphans));
    } else if (gB) {
      const target = nextGroups.find((g) => g.targetGroupId === gB.targetGroupId);
      if (!target.fields.some((f) => key(f.sourceId, f.fieldName) === kA)) {
        target.fields.push({ sourceId: srcA, fieldName: nameA });
        target.overriddenByUser = true;
        if (target.status === 'common' && nameSim(target.targetGroupId, nameA) < 0.9) target.status = 'potential';
        nextUnassigned = nextUnassigned.filter((f) => key(f.sourceId, f.name) !== kA);
      }
      const { kept, orphans } = collapseSingletons(nextGroups);
      pushHistory(kept, nextUn(kept, orphans));
    } else {
      const fa = unassignedField(kA);
      const fb = unassignedField(kB);
      if (!fa || !fb) return;
      const conf = newGroupConfidence(nameA, nameB);
      if (conf < 0.75) {
        toast.error('These fields are uncommon. Please upload a Mapping file (Join Map) to link them.');
        setSelected(null);
        return;
      }
      const bothNumeric = fieldMeta.get(kA)?.dtype === 'numeric' && fieldMeta.get(kB)?.dtype === 'numeric';
      const isReconcile =
        bothNumeric && AMOUNT_NAMES.some((n) => nameA.toLowerCase().includes(n) || nameB.toLowerCase().includes(n));
      nextGroups.push({
        targetGroupId: nameA.localeCompare(nameB) <= 0 ? nameA : nameB,
        fields: [
          { sourceId: srcA, fieldName: nameA },
          { sourceId: srcB, fieldName: nameB },
        ],
        status: conf >= 0.95 ? 'common' : 'potential',
        confidence: conf,
        isReconcileField: isReconcile,
        suggestedReconcileField: isReconcile,
        overriddenByUser: true,
        evidence: [],
      });
      nextUnassigned = nextUnassigned.filter((f) => key(f.sourceId, f.name) !== kA && key(f.sourceId, f.name) !== kB);
      pushHistory(nextGroups, nextUnassigned);
    }
    setSelected(null);
  };

  const removeFromGroup = (k) => {
    const g = groupOf(k);
    if (!g) return;
    const nextGroups = groups
      .map((gr) => (gr.targetGroupId === g.targetGroupId ? { ...gr, fields: gr.fields.filter((f) => key(f.sourceId, f.fieldName) !== k) } : gr))
      .filter((gr) => gr.fields.length > 0);
    const orphans = g.fields
      .filter((f) => key(f.sourceId, f.fieldName) !== k)
      .map((f) => ({ sourceId: f.sourceId, name: f.fieldName }));
    const singletons = nextGroups.filter((gr) => gr.fields.length === 1);
    const kept = nextGroups.filter((gr) => gr.fields.length > 1);
    const un = [...unassigned, ...orphans, ...singletons.flatMap((sg) => sg.fields.map((f) => ({ sourceId: f.sourceId, name: f.fieldName })))];
    pushHistory(kept, un);
    setSelected(null);
  };

  const toggleReconcile = (g) => {
    const nextGroups = groups.map((gr) =>
      gr.targetGroupId === g.targetGroupId ? { ...gr, isReconcileField: !gr.isReconcileField, overriddenByUser: true } : gr
    );
    pushHistory(nextGroups, unassigned);
  };

  const clearAll = () => {
    const un = groups.flatMap((g) => g.fields.map((f) => ({ sourceId: f.sourceId, name: f.fieldName }))).concat(unassigned);
    pushHistory([], un);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setGroups(prev.groups);
    setUnassigned(prev.unassigned);
    setHistory(history.slice(0, -1));
    setSelected(null);
  };

  const uploadJoinMap = async (file) => {
    if (!file) return;
    setJoinUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/workflows/${id}/mappings/upload-join-map`, fd);
      setJoinMap({ id: data.joinMap._id, fileName: data.joinMap.fileName || file.name, rows: data.rows });
      toast.success(`Join map loaded — ${data.rows} rows`);
    } catch (err) {
      toast.error(errMsg(err, 'Join map upload failed'));
    } finally {
      setJoinUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        mappings: groups.map((g) => ({
          targetGroupId: g.targetGroupId,
          fields: g.fields,
          status: g.status,
          confidence: g.confidence,
          isReconcileField: !!g.isReconcileField,
          overriddenByUser: !!g.overriddenByUser,
        })),
        joinMapFileId: joinMap?.id || undefined,
      };
      const { data } = await api.put(`/workflows/${id}/mappings`, payload);
      toast.success(`Saved ${data.mapping.mappings.length} mapping groups`);
      navigate(`/workflows/${id}/preview`);
    } catch (err) {
      toast.error(errMsg(err, 'Could not save mappings'));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !workflow) return <Card className="p-5"><SkeletonRows rows={5} cols={4} /></Card>;

  const ready = (workflow?.sources || []).filter((s) => s.loadStats).length >= 2;

  if (!ready && !loadingSug && sources.length === 0) {
    return (
      <div>
        <PageHeader title="Field Mapping" subtitle="Match fields across your ingested sources" />
        <EmptyState
          title="Nothing to map yet"
          message="Ingest at least two sources first, then AI suggestions will appear here."
          action={<Link to={`/workflows/${id}/ingest`}><Button>Go to Ingest</Button></Link>}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Field Mapping"
        subtitle={workflow ? `AI-matched fields for “${workflow.name}” — drag to connect, or click two fields to pair` : '…'}
        actions={
          <>
            <Button variant="outline" onClick={undo} disabled={history.length === 0}>↶ Undo</Button>
            <Button variant="outline" onClick={clearAll} disabled={groups.length === 0}>Clear all mappings</Button>
            <Button onClick={save} loading={saving} disabled={!ready}>Save &amp; Preview</Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3 text-small text-ledger-meta">
          <span><span className="font-mono font-semibold text-ledger-match">{stats.common}</span> common</span>
          <span><span className="font-mono font-semibold text-ledger-potential">{stats.potential}</span> potential</span>
          <span><span className="font-mono font-semibold text-ledger-brk">{stats.uncommon}</span> unmatched</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {joinMap ? (
            <Chip tone="reconcile" dot>join map · {joinMap.fileName} · {joinMap.rows} rows</Chip>
          ) : (
            <Chip tone="neutral">no join map</Chip>
          )}
          <input
            ref={joinInput}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => e.target.files[0] && uploadJoinMap(e.target.files[0])}
          />
          <Button variant="outline" size="sm" loading={joinUploading} onClick={() => joinInput.current?.click()}>
            Upload join map
          </Button>
        </div>
      </div>

      {sugError && !loadingSug && (
        <div className="mb-4 rounded-lg border border-ledger-reconcile/50 bg-ledger-panel px-3 py-2 text-small text-ledger-reconcile">
          {sugError} — you can still build groups manually below.
        </div>
      )}

      {loadingSug ? (
        <Card className="p-5"><SkeletonRows rows={6} cols={3} /></Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {sources.map((s) => (
            <SourcePanel
              key={s.sourceId}
              source={s}
              groups={groups}
              unassigned={unassigned}
              fieldMeta={fieldMeta}
              query={queries[s.sourceId] || ''}
              onQuery={(v) => setQueries((qq) => ({ ...qq, [s.sourceId]: v }))}
              selectedKey={selected}
              onSelect={(k) => {
                if (selected && selected !== k) connect(selected, k);
                else setSelected(selected === k ? null : k);
              }}
              onDropConnect={connect}
              onToggleReconcile={toggleReconcile}
              onRemoveField={removeFromGroup}
              draggingKey={dragging}
              onDragStart={setDragging}
            />
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-ledger-line bg-ledger-panel px-4 py-3">
        <p className="text-small text-ledger-meta">
          {selected ? (
            <>Selected <span className="font-mono text-ledger-accent">{selected.split('|')[1]}</span> — click a field in another source to connect.</>
          ) : (
            'Select a field, then click a field in another source — or drag one chip onto another. Amber chips are reconcile targets.'
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={undo} disabled={history.length === 0}>↶ Undo</Button>
          <Button onClick={save} loading={saving} disabled={!ready}>Save &amp; proceed to Preview</Button>
        </div>
      </div>
    </div>
  );
}