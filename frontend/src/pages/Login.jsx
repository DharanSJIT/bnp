import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../store/useAuth';
import { Button, Chip, Spinner } from '../components/ui.jsx';

const DEMO_CREDENTIALS = [
  { email: 'investigator@onerecon.io', password: 'Invest@123', role: 'Investigator', tone: 'accent' },
  { email: 'approver@onerecon.io', password: 'Approver@123', role: 'Approver', tone: 'reconcile' },
  { email: 'admin@onerecon.io', password: 'Admin@123', role: 'Admin', tone: 'match' },
];

export default function Login() {
  const { login, loginError, loggingIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch {
      /* error surfaced via loginError */
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ledger-panel px-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-md rounded-panel border border-ledger-line bg-white p-8 shadow-hover"
      >
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ledger-accent text-lg font-bold text-white">R</span>
          <div>
            <h1 className="text-header-lg font-bold leading-tight">
              One<span className="text-ledger-accent">Recon</span>
            </h1>
            <p className="text-small text-ledger-meta">AI-powered financial reconciliation</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="you@onerecon.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <div className="relative">
              <input
                id="password"
                type={show ? 'text' : 'password'}
                className="input pr-10"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-small text-ledger-meta hover:text-ledger-ink"
              >
                {show ? 'hide' : 'show'}
              </button>
            </div>
          </div>

          {loginError && (
            <p className="rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">
              {loginError}
            </p>
          )}

          <Button type="submit" className="w-full" size="lg" loading={loggingIn}>
            {loggingIn ? <><Spinner className="h-4 w-4" /> Signing in…</> : 'Sign in'}
          </Button>
        </form>

        <div className="mt-6 border-t border-ledger-line pt-4">
          <p className="mb-2 text-small font-medium text-ledger-meta">Demo credentials</p>
          <div className="space-y-1.5">
            {DEMO_CREDENTIALS.map((c) => (
              <button
                key={c.email}
                type="button"
                onClick={() => { setEmail(c.email); setPassword(c.password); }}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-ledger-line bg-ledger-panel px-3 py-1.5 text-small hover:border-ledger-accent"
              >
                <span className="font-mono">{c.email}</span>
                <span className="flex items-center gap-2">
                  <Chip tone={c.tone} dot>{c.role}</Chip>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-small text-ledger-meta">Click a row to prefill, then press Sign in.</p>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-ledger-line pt-4 text-small">
          <span className="text-ledger-meta">
            New here?{' '}
            <Link to="/register" className="font-medium text-ledger-accent hover:text-ledger-accentHover">Create an account</Link>
          </span>
          <Link to="/" className="font-medium text-ledger-meta hover:text-ledger-accent">← Home</Link>
        </div>
      </motion.div>
    </div>
  );
}