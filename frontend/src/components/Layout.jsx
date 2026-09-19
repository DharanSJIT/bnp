import React, { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from '../lib/format';
import { useAuth, ROLE_LABEL } from '../store/useAuth';
import { useWorkflow } from '../store/useWorkflow';
import { RoleBadge, Skeleton } from './ui.jsx';
import { useToast } from '../store/useToast';

const BASE_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '▤' },
  { to: '/history', label: 'History', icon: '◷' },
  { to: '/workflows/new', label: 'New Workflow', icon: '＋' },
];

const WORKFLOW_NAV = [
  { to: 'ingest', label: 'Ingest', icon: '⇪' },
  { to: 'mapping', label: 'Mapping', icon: '⇄' },
  { to: 'preview', label: 'Preview', icon: '◫' },
  { to: 'run', label: 'Run', icon: '▶' },
  { to: 'breaks', label: 'Breaks', icon: '⚠' },
  { to: 'reports', label: 'Reports', icon: '▦' },
  { to: 'analytics', label: 'Analytics', icon: '◠' },
  { to: 'audit', label: 'Audit', icon: '≡' },
];

function useActiveWorkflow() {
  const { id } = useParams();
  const { workflow, loading, fetch } = useWorkflow();
  const fetchedId = React.useRef(null);
  useEffect(() => {
    if (id && fetchedId.current !== id) {
      fetchedId.current = id;
      fetch(id);
    } else if (!id) {
      fetchedId.current = null;
    }
  }, [id, fetch]);
  return { id, workflow, loading };
}

function Sidebar() {
  const { pathname } = useLocation();
  const { id, workflow } = useActiveWorkflow();
  const { user } = useAuth();
  const nav = [];

  nav.push(...BASE_NAV.map((n) => ({ ...n, active: pathname === n.to })));

  if (id) {
    nav.push(
      ...WORKFLOW_NAV.map((n) => ({
        ...n,
        to: `/workflows/${id}/${n.to}`,
        active: pathname.startsWith(`/workflows/${id}/${n.to}`),
      }))
    );
  }

  if (user?.role === 'admin') {
    nav.push({ to: '/admin/users', label: 'Admin Users', icon: '⚙', active: pathname.startsWith('/admin/users') });
  }

  return (
    <aside className="flex h-full w-60 flex-none flex-col border-r border-ledger-line bg-ledger-panel">
      <NavLink to="/dashboard" className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ledger-accent text-sm font-bold text-white">R</span>
        <span className="text-header-md font-bold tracking-tight">
          One<span className="text-ledger-accent">Recon</span>
        </span>
      </NavLink>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {id && (
          <div className="mb-3 rounded-lg border border-ledger-line bg-white px-3 py-2.5">
            <p className="max-w-full truncate text-small font-semibold text-ledger-ink" title={workflow?.name || '…'}>
              {workflow ? workflow.name : '…'}
            </p>
            {workflow && (
              <p className="mt-0.5 text-small text-ledger-meta">
                {workflow.period || 'no period'} · {workflow.sources?.length || 0} sources
              </p>
            )}
          </div>
        )}

        <nav className="flex flex-col gap-0.5">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/dashboard'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-base transition-colors',
                  isActive || n.active
                    ? 'bg-ledger-accent font-medium text-white'
                    : 'text-ledger-meta hover:bg-white hover:text-ledger-ink'
                )
              }
            >
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="border-t border-ledger-line px-4 py-3 text-small text-ledger-meta">
        Clean Ledger · v1.0
      </div>
    </aside>
  );
}

function Topbar() {
  const { id, workflow, loading } = useActiveWorkflow();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const toast = useToast((s) => s.add);

  const title = React.useMemo(() => {
    if (pathname === '/login') return '';
    if (pathname === '/dashboard') return 'Dashboard';
    if (pathname === '/history') return 'Processing History';
    if (pathname === '/workflows/new') return 'New Workflow';
    if (pathname.startsWith('/admin/users')) return 'Admin · Users';
    if (id && workflow) {
      const seg = pathname.split('/').pop();
      const found = WORKFLOW_NAV.find((n) => n.to === seg);
      if (found) return `${found.label} — ${workflow.name}`;
      return workflow.name;
    }
    return 'OneRecon';
  }, [pathname, id, workflow]);

  return (
    <header className="flex h-14 flex-none items-center justify-between border-b border-ledger-line bg-white px-6">
      <h2 className="min-w-0 truncate text-header-md font-semibold">{title}</h2>
      <div className="flex items-center gap-3">
        {id && loading && <Skeleton className="h-4 w-28" />}
        {user && (
          <>
            <RoleBadge role={user.role} />
            <div className="text-right">
              <p className="text-small font-medium leading-tight">{user.name}</p>
              <p className="text-small leading-tight text-ledger-meta">{user.email}</p>
            </div>
            <button
              onClick={() => {
                logout();
                toast('Signed out', 'info');
                navigate('/login');
              }}
              className="btn btn-outline px-2.5 py-1.5 text-small"
            >
              Logout
            </button>
          </>
        )}
      </div>
    </header>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  React.useEffect(() => {
    if (!user) navigate('/login', { replace: true });
  }, [user, navigate]);

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-ledger-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto px-6 py-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}