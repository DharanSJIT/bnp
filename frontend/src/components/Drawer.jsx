import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from '../lib/format';

/** Right slide-over drawer with 200ms scale/fade content (spec §3 motion) */
export function Drawer({ open, onClose, title, subtitle, children, width = 'max-w-2xl', footer }) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/25"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: [0.25, 0.8, 0.25, 1] }}
            className={clsx('absolute right-0 top-0 flex h-full w-full flex-col border-l border-ledger-line bg-white', width)}
          >
            <div className="flex items-start justify-between border-b border-ledger-line px-5 py-4">
              <div>
                <h3 className="text-header-md font-semibold text-ledger-ink">{title}</h3>
                {subtitle && <p className="mt-0.5 text-small text-ledger-meta">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-ledger-meta hover:bg-ledger-skeleton hover:text-ledger-ink">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="border-t border-ledger-line px-5 py-3.5">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}