import React, { useState } from 'react';
import { Drawer } from './Drawer.jsx';
import { Button, Spinner, Chip } from './ui.jsx';
import api, { errMsg } from '../lib/api';

/**
 * Copilot slide-over available on Breaks & Reports (§4.12).
 * Asks via POST /api/breaks/<latestBreakId>/chat (the only chat endpoint present).
 * `breakId` may be supplied directly; otherwise resolves the latest run's first break.
 */
export function Copilot({ open, onClose, workflowId, breakId: fixedBreakId }) {
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState([]); // {q, a, evidence}
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const send = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      let bid = fixedBreakId;
      if (!bid && workflowId) {
        // resolve latest run -> first break with a priority (prefer high)
        const runs = await api.get(`/workflows/${workflowId}`).catch(() => null);
        const run = runs?.data?.recentRuns?.[0];
        if (run) {
          const br = await api.get(`/runs/${run._id}/breaks?limit=1&sort=-priorityScore`).catch(() => null);
          bid = br?.data?.breaks?.[0]?._id;
        }
      }
      if (!bid) {
        setError('No break available yet to ground the copilot on. Run a reconciliation first, then ask.');
        setBusy(false);
        return;
      }
      const { data } = await api.post(`/breaks/${bid}/chat`, { question: q });
      setChat((c) => [...c, { q, a: data.answer, evidence: data.evidence || [] }]);
      setQuestion('');
    } catch (err) {
      setError(errMsg(err, 'Copilot request failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="OneRecon Copilot"
      subtitle="Ask anything about this reconciliation"
      width="max-w-xl"
    >
      <div className="mb-4 rounded-panel border border-ledger-line bg-ledger-panel p-3">
        <p className="text-small text-ledger-meta">
          Grounded on the live break ledger and reconciliation evidence. Capabilities: root-cause
          summaries, variance explanations, historical-frequency checks, and next-step investigation
          suggestions.
        </p>
      </div>

      <div className="space-y-3">
        {chat.map((c, i) => (
          <div key={i}>
            <div className="ml-auto w-fit max-w-[90%] rounded-lg rounded-br-sm bg-ledger-accent px-3 py-2 text-base text-white">
              {c.q}
            </div>
            <div className="mt-2 w-fit max-w-[92%] rounded-lg rounded-bl-sm border border-ledger-line bg-ledger-panel px-3 py-2 text-base text-ledger-ink">
              {c.a}
              {c.evidence && c.evidence.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.evidence.map((ev, j) => (
                    <Chip key={j} tone="neutral" className="font-mono">{String(ev)}</Chip>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {chat.length === 0 && (
          <p className="py-8 text-center text-base text-ledger-meta">
            {workflowId ? 'Ask about a break, a variance, or what to do next.' : 'Open from a workflow with a completed run.'}
          </p>
        )}
      </div>

      {error && <p className="mt-3 text-small text-ledger-brk">{error}</p>}

      <div className="mt-4 flex items-end gap-2 border-t border-ledger-line pt-3">
        <textarea
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="e.g. Why is GL vs MA variance 2.4% this period?"
          className="input flex-1 resize-none"
        />
        <Button onClick={send} loading={busy} disabled={!question.trim()}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : 'Ask'}
        </Button>
      </div>
    </Drawer>
  );
}