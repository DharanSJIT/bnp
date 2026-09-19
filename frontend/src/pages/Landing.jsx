import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../store/useAuth';

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2 },
};

const FEATURES = [
  {
    icon: '◧',
    title: 'Workflow orchestration',
    text: 'Register a reconciliation once — define sources, mappings and delivery, then re-run it every period with one click.',
  },
  {
    icon: '⇪',
    title: 'Any-shape ingestion',
    text: 'CSV, XLSX, JSON, XML, live paginated REST APIs and (beta) databases — validated against a dynamically-parsed rule set.',
  },
  {
    icon: '⇄',
    title: 'AI field mapping',
    text: 'Cross-system mapping suggestions with confidence scores. Drag, search, override — or upload a lookup file for uncommon fields.',
  },
  {
    icon: '≋',
    title: 'Dual-level matching',
    text: 'Row-by-row transactional matching on natural keys plus dimensional aggregate matching resolved through monthly join maps.',
  },
  {
    icon: '✔',
    title: 'Maker–checker governance',
    text: 'Investigator → Approver flows with single, bulk and file-based decisions. Every action is written to an immutable audit trail.',
  },
  {
    icon: '▦',
    title: 'Audit-ready reporting',
    text: 'PDF, Excel, CSV and JSON exports, a cross-system comparison module, and run-to-run variance views for every period.',
  },
];

const STEPS = [
  { n: '01', title: 'Register', text: 'Name the reconciliation, pick the period, and add 2+ sources — GL, MA, FA or any pair.' },
  { n: '02', title: 'Ingest', text: 'Upload files or point at a paginated REST API. Raw rows land in the staging store.' },
  { n: '03', title: 'Map', text: 'Accept or refine AI-suggested field mappings and upload the monthly join map.' },
  { n: '04', title: 'Reconcile', text: 'Transactional + aggregate matching with root-cause explanations for every break.' },
  { n: '05', title: 'Approve & report', text: 'Resolve breaks through maker–checker, then export audit-ready reports.' },
];

const ROLES = [
  { role: 'Investigator', duty: 'Disputes and break investigation' },
  { role: 'Accountant', duty: 'Ledger entries and account mapping' },
  { role: 'Cashier', duty: 'Daily cash position checks' },
  { role: 'Monitor', duty: 'Continuous reconciliation oversight' },
  { role: 'Manager', duty: 'Review and approve outcomes' },
  { role: 'General Manager', duty: 'Final sign-off and governance' },
];

const COMPARE_ROWS = [
  { dim: 'Commercial Deposits', a: '₹8,420,500', b: '₹8,419,900', var: '−₹600', status: 'break' },
  { dim: 'Time Deposits', a: '₹12,330,000', b: '₹12,330,000', var: '0', status: 'match' },
  { dim: 'Current Accounts', a: '₹6,104,250', b: '₹6,104,250', var: '0', status: 'match' },
  { dim: 'Retail Savings', a: '₹9,871,400', b: '₹9,870,800', var: '−₹600', status: 'break' },
];

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-ledger-white text-ledger-ink">
      {/* ---------------- Top nav ---------------- */}
      <header className="sticky top-0 z-40 border-b border-ledger-line bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ledger-accent text-base font-bold text-white">R</span>
            <span className="text-header-md font-bold tracking-tight">
              One<span className="text-ledger-accent">Recon</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-7 text-base md:flex">
            {[
              ['Features', '#features'],
              ['How it works', '#how'],
              ['Roles', '#roles'],
              ['Comparison', '#compare'],
            ].map(([label, href]) => (
              <a key={href} href={href} className="text-ledger-meta transition-colors hover:text-ledger-accent">
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Link
                to="/dashboard"
                className="inline-flex items-center rounded-lg bg-ledger-accent px-4 py-2 text-base font-medium text-white hover:bg-ledger-accentHover"
              >
                Open dashboard →
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="inline-flex items-center rounded-lg border border-ledger-line px-4 py-2 text-base font-medium text-ledger-ink hover:border-ledger-accent hover:text-ledger-accent"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center rounded-lg bg-ledger-accent px-4 py-2 text-base font-medium text-white hover:bg-ledger-accentHover"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ---------------- Hero ---------------- */}
      <section className="border-b border-ledger-line">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
          <motion.div {...fade}>
            <Chip tone="accent">BNP Paribas · OneRecon Use Case UC-3</Chip>
            <h1 className="mt-4 text-header-xl font-bold leading-tight tracking-tight">
              Reconcile every system.<br />
              <span className="text-ledger-accent">One platform.</span>
            </h1>
            <p className="mt-4 max-w-lg text-base text-ledger-meta">
              OneRecon turns scattered GL, MA, FA and RR ledgers into a single reconciled
              source of truth — AI-assisted mapping, dual-level matching, explained breaks
              and an audit trail that regulators trust.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {user ? (
                <Link
                  to="/dashboard"
                  className="inline-flex items-center rounded-lg bg-ledger-accent px-5 py-2.5 text-base font-medium text-white hover:bg-ledger-accentHover"
                >
                  Go to dashboard →
                </Link>
              ) : (
                <>
                  <Link
                    to="/register"
                    className="inline-flex items-center rounded-lg bg-ledger-accent px-5 py-2.5 text-base font-medium text-white hover:bg-ledger-accentHover"
                  >
                    Start reconciling
                  </Link>
                  <a href="#features" className="inline-flex items-center rounded-lg border border-ledger-line px-5 py-2.5 text-base font-medium text-ledger-ink hover:border-ledger-accent hover:text-ledger-accent">
                    See the platform
                  </a>
                </>
              )}
            </div>
            <div className="mt-10 grid max-w-md grid-cols-3 gap-6">
              {[
                ['22k+', 'rows / month / system'],
                ['3', 'manufacturer formats'],
                ['~2s', 'per reconciliation run'],
              ].map(([v, l]) => (
                <div key={l}>
                  <p className="font-mono text-header-md font-bold text-ledger-ink">{v}</p>
                  <p className="mt-1 text-small text-ledger-meta">{l}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Mock console card */}
          <motion.div {...fade} transition={{ duration: 0.25, delay: 0.1 }}>
            <div className="rounded-panel border border-ledger-line bg-ledger-panel p-5 shadow-panel">
              <div className="flex items-center justify-between border-b border-ledger-line pb-3">
                <div>
                  <p className="text-small font-medium text-ledger-meta">Active reconciliation</p>
                  <p className="text-base font-semibold">August 2026 — GL · MA · FA</p>
                </div>
                <span className="rounded-full border border-ledger-line px-2.5 py-1 text-small font-medium text-ledger-meta">Period 202608</span>
              </div>
              <div className="space-y-2.5 py-4">
                {[
                  ['Transaction match', '94.2%', 'match'],
                  ['Aggregate match', '98.7%', 'potential'],
                  ['Open breaks', '1,204', 'brk'],
                  ['Pending approval', '86', 'reconcile'],
                ].map(([label, value, tone]) => (
                  <div key={label} className="flex items-center justify-between rounded-lg border border-ledger-line bg-white px-3.5 py-2.5">
                    <span className="flex items-center gap-2.5 text-base text-ledger-meta">
                      <span className={`h-2 w-2 rounded-full ${tone === 'match' ? 'bg-ledger-match' : tone === 'potential' ? 'bg-ledger-potential' : tone === 'brk' ? 'bg-ledger-brk' : 'bg-ledger-reconcile'}`} />
                      {label}
                    </span>
                    <span className="font-mono text-base font-semibold">{value}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-ledger-line bg-white px-3.5 py-2">
                <p className="text-small font-medium text-ledger-meta">AI root cause</p>
                <p className="mt-0.5 text-small leading-relaxed text-ledger-ink">
                  “RR excluded Entity Y due to a missing mapping in join_map for period 202608.”
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ---------------- Problem strip ---------------- */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-header-lg font-bold tracking-tight">
          The same transaction, described three ways
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-base text-ledger-meta">
          GL, MA and FA each keep their own keys, formats and refresh cadence. At month-end
          everything must foot back to one ledger — that is what OneRecon automates.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            {
              tag: 'GL · XML',
              name: 'General Ledger',
              key: 'gl_account_id · ACC0001',
              note: '16,824 → 22,105 rows over Jun–Aug',
            },
            {
              tag: 'MA · REST API',
              name: 'Management Accounting',
              key: 'ma_customer_key · CUS-000001',
              note: 'Paginated live API, Amount as string',
            },
            {
              tag: 'FA · CSV',
              name: 'Financial Accounting',
              key: 'fa_key · FA-000001',
              note: 'Monthly static files from the ledger',
            },
          ].map((c) => (
            <div key={c.tag} className="rounded-panel border border-ledger-line bg-ledger-panel p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-small font-medium text-ledger-accent">{c.tag}</span>
                <Chip tone="neutral">{c.name}</Chip>
              </div>
              <p className="mt-4 font-mono text-small text-ledger-ink">{c.key}</p>
              <p className="mt-1.5 text-small text-ledger-meta">{c.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Features ---------------- */}
      <section id="features" className="border-y border-ledger-line bg-ledger-panel">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-center text-header-lg font-bold tracking-tight">Platform capabilities</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-base text-ledger-meta">
            Every requirement from ingestion to audit-ready export — no gradients, no noise, just a clean ledger.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <motion.div key={f.title} {...fade} transition={{ duration: 0.2 }}>
                <div className="h-full rounded-panel border border-ledger-line bg-white p-5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-ledger-line text-lg text-ledger-accent">
                    {f.icon}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-small leading-relaxed text-ledger-meta">{f.text}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-header-lg font-bold tracking-tight">How it works</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-base text-ledger-meta">
          Configure once, re-run every month. The engine learns from previous mappings.
        </p>
        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <motion.div key={s.n} {...fade} transition={{ duration: 0.2, delay: i * 0.05 }}>
              <div className="flex items-center gap-3">
                <span className="font-mono text-header-md font-bold text-ledger-accent">{s.n}</span>
                <span className="h-px flex-1 bg-ledger-line" />
              </div>
              <h3 className="mt-3 text-base font-semibold">{s.title}</h3>
              <p className="mt-1 text-small leading-relaxed text-ledger-meta">{s.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ---------------- Comparison module preview ---------------- */}
      <section id="compare" className="border-y border-ledger-line bg-ledger-panel">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-2">
          <div>
            <Chip tone="reconcile">Cross-report comparison</Chip>
            <h2 className="mt-4 text-header-lg font-bold tracking-tight">Does RR’s total foot to FA’s?</h2>
            <p className="mt-3 text-base text-ledger-meta">
              Compare any two systems or two periods side by side — dimension totals, variance,
              drill-down to the underlying transactions, and an auto-generated executive summary.
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                'Side-by-side totals per account · entity · department · currency',
                'Grand-total variance banner — green when it foots, red when it breaks',
                'Drill into the rows behind every group total',
                'Export as PDF / Excel with an executive summary',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-base text-ledger-ink">
                  <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border border-ledger-match text-[11px] font-bold text-ledger-match">✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-panel border border-ledger-line bg-white p-5 shadow-panel">
            <div className="flex items-center justify-between border-b border-ledger-line pb-3">
              <p className="text-base font-semibold">RR vs FA · Time & Commercial Deposits</p>
              <span className="font-mono text-small font-semibold text-ledger-brk">−₹1,200</span>
            </div>
            <table className="w-full text-table">
              <thead>
                <tr className="border-b border-ledger-line text-left text-small text-ledger-meta">
                  {['Dimension', 'FA Total', 'RR Total', 'Variance', 'Status'].map((h) => (
                    <th key={h} className="py-2.5 pr-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((r) => (
                  <tr key={r.dim} className="border-b border-ledger-line last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{r.dim}</td>
                    <td className="pr-3 font-mono">{r.a}</td>
                    <td className="pr-3 font-mono">{r.b}</td>
                    <td className="pr-3 font-mono">{r.var}</td>
                    <td>
                      <Chip tone={r.status === 'match' ? 'match' : 'brk'} dot>
                        {r.status === 'match' ? 'matched' : 'break'}
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------------- Roles ---------------- */}
      <section id="roles" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-header-lg font-bold tracking-tight">Built for every authority in the bank</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-base text-ledger-meta">
          From cashier to general manager — every role has a seat at the reconciliation table.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r.role} className="flex items-center gap-4 rounded-panel border border-ledger-line bg-ledger-panel p-4">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-ledger-line bg-white text-base text-ledger-accent">
                {r.role.charAt(0)}
              </span>
              <div>
                <p className="text-base font-semibold">{r.role}</p>
                <p className="text-small text-ledger-meta">{r.duty}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="border-t border-ledger-line bg-ledger-accent py-14">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-header-lg font-bold tracking-tight text-white">
            Reconcile with confidence
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-base text-[#DBEAFE]">
            Register a reconciliation today — or sign in as your role and pick up where the team left off.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {user ? (
              <Link to="/dashboard" className="inline-flex items-center rounded-lg bg-white px-5 py-2.5 text-base font-medium text-ledger-accent hover:bg-[#F1F5FF]">
                Open dashboard →
              </Link>
            ) : (
              <>
                <Link to="/register" className="inline-flex items-center rounded-lg bg-white px-5 py-2.5 text-base font-medium text-ledger-accent hover:bg-[#F1F5FF]">
                  Start reconciling
                </Link>
                <Link to="/login" className="inline-flex items-center rounded-lg border border-white/70 px-5 py-2.5 text-base font-medium text-white hover:bg-white/10">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="border-t border-ledger-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ledger-accent text-sm font-bold text-white">R</span>
            <span className="text-header-md font-bold tracking-tight">
              One<span className="text-ledger-accent">Recon</span>
            </span>
          </div>
          <p className="text-small text-ledger-meta">
            AI-powered financial reconciliation · BNP Paribas hackathon UC-3 · Final decisions rest with authorized personnel.
          </p>
          <div className="flex items-center gap-4 text-small text-ledger-meta">
            <Link to="/login" className="hover:text-ledger-accent">Sign in</Link>
            <Link to="/register" className="hover:text-ledger-accent">Register</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Chip({ tone = 'neutral', children }) {
  const tones = {
    accent: 'border-ledger-accent text-ledger-accent',
    neutral: 'border-ledger-line text-ledger-meta',
    reconcile: 'border-ledger-reconcile text-ledger-reconcile',
    match: 'border-ledger-match text-ledger-match',
    brk: 'border-ledger-brk text-ledger-brk',
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-small font-medium ${tones[tone]}`}>{children}</span>;
}