import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api, { errMsg } from '../lib/api';
import { clsx } from '../lib/format';

const SUGGESTIONS = [
  'How many countries does BNP Paribas operate in?',
  'What is BNP Paribas\'s company purpose?',
  'Which divisions make up the BNP Paribas Group?',
];

export default function BnpChat() {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState([]); // {role: 'user'|'assistant', text, sources}
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat, busy, open]);

  const ask = async (q) => {
    const text = String(q || '').trim();
    if (!text || busy) return;
    setQuestion('');
    setError(null);
    setChat((c) => [...c, { role: 'user', text }]);
    setBusy(true);
    try {
      const { data } = await api.post('/bnp-chat', { question: text });
      setChat((c) => [...c, { role: 'assistant', text: data.answer || 'No answer.', sources: data.sources || [] }]);
    } catch (err) {
      setError(errMsg(err, 'The BNP assistant could not be reached'));
      setChat((c) => [...c, { role: 'assistant', text: errMsg(err, 'The BNP assistant could not be reached.'), sources: [] }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* launcher — bottom right corner */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close BNP assistant' : 'Open BNP assistant'}
        className="fixed bottom-5 right-5 z-[70] flex h-14 w-14 items-center justify-center rounded-full bg-ledger-accent text-white shadow-panel transition-colors hover:bg-ledger-accentHover"
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        )}
      </button>

      {/* panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="fixed bottom-24 right-5 z-[70] flex h-[520px] w-[370px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-panel border border-ledger-line bg-white shadow-panel"
          >
            {/* header */}
            <div className="flex items-center justify-between border-b border-ledger-line bg-ledger-panel px-4 py-3">
              <div>
                <p className="text-header-md font-semibold leading-tight">BNP Paribas Assistant</p>
                <p className="text-small text-ledger-meta">General questions, answered from the knowledge base</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Minimize"
                className="rounded-lg border border-ledger-line px-2 py-1 text-small text-ledger-meta transition-colors hover:text-ledger-ink"
              >
                −
              </button>
            </div>

            {/* messages */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {chat.length === 0 && (
                <div className="space-y-3">
                  <p className="text-small text-ledger-meta">
                    Hi! I answer general questions about the BNP Paribas Group using its official knowledge base. Try one of these:
                  </p>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      disabled={busy}
                      className="block w-full rounded-lg border border-ledger-line bg-ledger-panel px-3 py-2 text-left text-small text-ledger-ink transition-colors hover:border-ledger-accent disabled:opacity-60"
                    >
                      “{s}”
                    </button>
                  ))}
                </div>
              )}

              {chat.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-t-panel rounded-bl-panel bg-ledger-accent px-3.5 py-2 text-small text-white">{m.text}</div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[90%] rounded-t-panel rounded-br-panel border border-ledger-line bg-ledger-panel px-3.5 py-2.5">
                      <p className="whitespace-pre-wrap text-small text-ledger-ink">{m.text}</p>
                    </div>
                  </div>
                )
              )}

              {busy && (
                <div className="flex justify-start">
                  <div className="rounded-t-panel rounded-br-panel border border-ledger-line bg-ledger-panel px-3.5 py-2 text-small text-ledger-meta">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ledger-accent" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ledger-accent" style={{ animationDelay: '0.15s' }} />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ledger-accent" style={{ animationDelay: '0.3s' }} />
                      Thinking…
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <p className="rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">{error}</p>
              )}
            </div>

            {/* input */}
            <form
              className="flex items-center gap-2 border-t border-ledger-line px-3 py-3"
              onSubmit={(e) => { e.preventDefault(); ask(question); }}
            >
              <input
                className="input flex-1"
                placeholder="Ask about BNP Paribas…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !question.trim()}
                className={clsx(
                  'rounded-lg px-4 py-2 text-small font-semibold text-white transition-colors',
                  busy || !question.trim() ? 'bg-ledger-accentDisabled' : 'bg-ledger-accent hover:bg-ledger-accentHover'
                )}
              >
                Send
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}