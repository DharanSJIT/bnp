import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from '../lib/format';
import { useToast } from '../store/useToast';

const TONE = {
  success: { border: 'border-l-ledger-match', dot: 'bg-ledger-match', icon: '✓' },
  error: { border: 'border-l-ledger-brk', dot: 'bg-ledger-brk', icon: '✕' },
  info: { border: 'border-l-ledger-accent', dot: 'bg-ledger-accent', icon: 'ℹ' },
};

export function ToastHost() {
  const { toasts, remove } = useToast();
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-80 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.18 }}
            className={clsx(
              'pointer-events-auto relative overflow-hidden rounded-panel border border-ledger-line border-l-4 bg-white py-3 pl-4 pr-3 shadow-hover',
              TONE[t.type]?.border
            )}
          >
            <div className="flex items-start gap-2.5">
              <span className={clsx('mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white', TONE[t.type]?.dot)}>
                {TONE[t.type]?.icon}
              </span>
              <p className="flex-1 text-base text-ledger-ink">{t.message}</p>
              <button onClick={() => remove(t.id)} className="text-ledger-meta hover:text-ledger-ink">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div
              className="toast-underline absolute bottom-0 left-0 h-0.5 bg-ledger-line"
              style={{ animationDuration: `${t.duration}ms` }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}