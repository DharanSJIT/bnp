import React from 'react';
import { clsx } from '../lib/format';
import { motion, AnimatePresence } from 'framer-motion';

/* ---------------------------------- Button ---------------------------------- */
export function Button({ variant = 'primary', size = 'md', loading = false, children, className, ...rest }) {
  const sizes = {
    sm: 'px-2.5 py-1.5 text-small',
    md: 'px-3.5 py-2 text-base',
    lg: 'px-5 py-2.5 text-base',
  };
  const variants = {
    primary: 'btn-primary',
    outline: 'btn-outline',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  };
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className={clsx('btn', variants[variant], sizes[size], className)}
      {...rest}
      disabled={loading || rest.disabled}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </motion.button>
  );
}

export function Spinner({ className }) {
  return (
    <svg className={clsx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
    </svg>
  );
}

/* ------------------------------------ Chip ----------------------------------- */
const CHIP_STYLES = {
  match: 'border-ledger-match text-ledger-match',
  potential: 'border-ledger-potential text-[#3F6212]',
  brk: 'border-ledger-brk text-ledger-brk',
  reconcile: 'border-ledger-reconcile text-ledger-reconcile',
  neutral: 'border-ledger-line text-ledger-meta',
  accent: 'border-ledger-accent text-ledger-accent',
};
const DOT_STYLES = {
  match: 'bg-ledger-match',
  potential: 'bg-ledger-potential',
  brk: 'bg-ledger-brk',
  reconcile: 'bg-ledger-reconcile',
  neutral: 'bg-ledger-meta',
  accent: 'bg-ledger-accent',
};

export function Chip({ tone = 'neutral', dot = false, children, className }) {
  return (
    <span className={clsx('chip', CHIP_STYLES[tone], className)}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full', DOT_STYLES[tone])} />}
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', className }) {
  return <span className={clsx('inline-block h-1.5 w-1.5 rounded-full', DOT_STYLES[tone], className)} />;
}

/* ---------------------------------- Card / header ----------------------------- */
export function Card({ className, children, ...rest }) {
  return (
    <div className={clsx('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="mb-5 flex flex-wrap items-end justify-between gap-3"
    >
      <div>
        <h1 className="text-header-xl font-bold text-ledger-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-base text-ledger-meta">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </motion.div>
  );
}

/* -------------------------------- Skeleton bits ------------------------------- */
export function Skeleton({ className }) {
  return <div className={clsx('skeleton', className)} />;
}

export function SkeletonRows({ rows = 4, cols = 4 }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, message, icon = '▦', action }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col items-center justify-center rounded-panel border border-dashed border-ledger-line bg-ledger-panel px-6 py-14 text-center"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-ledger-line bg-white text-xl text-ledger-meta">
        {icon}
      </div>
      <h3 className="text-header-md font-semibold text-ledger-ink">{title}</h3>
      {message && <p className="mt-1.5 max-w-sm text-base text-ledger-meta">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

/* ------------------------------------- Tabs ----------------------------------- */
export function Tabs({ tabs, active, onChange, className }) {
  return (
    <div className={clsx('inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-ledger-line bg-ledger-panel p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-small font-medium transition-colors',
            active === t.value
              ? 'bg-ledger-accent text-white'
              : 'text-ledger-meta hover:bg-white hover:text-ledger-ink'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------ Badge ----------------------------------- */
const ROLE_BADGES = {
  admin: { label: 'Admin', tone: 'match' },
  'general-manager': { label: 'General Manager', tone: 'match' },
  manager: { label: 'Manager', tone: 'reconcile' },
  approver: { label: 'Approver', tone: 'reconcile' },
  investigator: { label: 'Investigator', tone: 'accent' },
  monitor: { label: 'Monitor', tone: 'accent' },
  accountant: { label: 'Accountant', tone: 'accent' },
  cashier: { label: 'Cashier', tone: 'neutral' },
};
export function RoleBadge({ role }) {
  const r = ROLE_BADGES[role] || ROLE_BADGES.investigator;
  return <Chip tone={r.tone} dot>{r.label}</Chip>;
}

/* --------------------------------- Animated number ----------------------------- */
export function AnimatedNumber({ value, decimals = 0, prefix = '', suffix = '' }) {
  const [display, setDisplay] = React.useState(0);
  const prev = React.useRef(0);
  React.useEffect(() => {
    prev.current = 0;
    setDisplay(0);
  }, [value]);
  React.useEffect(() => {
    const target = Number(value) || 0;
    const from = prev.current;
    const duration = 550;
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const formatted = display.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (
    <span className="font-mono tabular-nums">
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

/* ---------------------------------- Confirm modal ------------------------------ */
export function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', tone = 'danger', busy = false, onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="sm">
      <p className="text-base text-ledger-meta">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

/* ---------------------------------- Modal ------------------------------------- */
export function Modal({ open, onClose, title, children, width = 'md' }) {
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className={clsx('w-full overflow-hidden rounded-panel border border-ledger-line bg-white shadow-hover', widths[width])}
          >
            {title && (
              <div className="flex items-center justify-between border-b border-ledger-line px-5 py-3.5">
                <h3 className="text-header-md font-semibold">{title}</h3>
                <button onClick={onClose} className="rounded-lg p-1 text-ledger-meta hover:bg-ledger-skeleton hover:text-ledger-ink">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              </div>
            )}
            <div className="px-5 py-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}