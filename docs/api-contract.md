# OneRecon Frontend — API Contract & Build Specification

This document is the **complete, self-contained** specification for implementing the OneRecon React frontend. It is verified against the running backend (Node/Express :4000) and AI service (:8000). Build exactly to these shapes — do not invent fields.

## 0. Stack & Scaffold

- React 18 + Vite 5, plain **JSX (no TypeScript)**.
- Tailwind CSS **v3.4** (postcss + autoprefixer), config at `frontend/tailwind.config.js`.
- react-router-dom v6, zustand (state), framer-motion (motion), recharts (charts), react-dropzone (uploads), axios (HTTP), clsx.
- Fonts: `@fontsource/inter` (400/500/600/700) + `@fontsource/jetbrains-mono` (400/500). Import in `main.jsx`.
- Install with a **workspace-local npm cache**: `npm install --cache /Volumes/Placement/one-recon/.npm-cache`.
- Dev server: `npm run dev` → port **5173**, proxy `/api` → `http://127.0.0.1:4000` (configure in `vite.config.js`).
- Files to create under `frontend/`: `index.html`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `package.json`, `src/main.jsx`, `src/App.jsx`, `src/index.css`, `src/lib/api.js`, `src/store/useAuth.js`, `src/store/useToast.js`, `src/components/*`, `src/pages/*`.

## 1. Auth

Base URL: `http://127.0.0.1:4000` (proxy `/api` in dev). JWT via `Authorization: Bearer <token>` header.
- `POST /api/auth/login` body `{email, password}` → `{ token, user: {_id, name, email, role, active} }`. Store token in localStorage; on 401 redirect to `/login`.
- Role: `investigator | approver | admin`. Both non-admin roles can do everything; the UI defaults the maker/checker buttons by the logged-in role, and shows a role badge.
- Seed logins (documented on the login screen): `investigator@onerecon.io / Invest@123`, `approver@onerecon.io / Approver@123`, `admin@onerecon.io / Admin@123`.

## 2. Endpoints & exact response shapes

### Workflows (dashboard)
- `GET /api/workflows` → `{ workflows: [{_id, name, period, status, sources: [{sourceId, displayName, ingestionType: 'file'|'api'|'db', config, ingestStatus: 'not-started'|'ingesting'|'ingested'|'failed', loadStats: {recordsLoaded, method, timeTakenMs, lastLoadId, ingestedAt} | undefined}], validationAcknowledged, lastRunStatus: ''|'success'|'failed', lastMatchRate: number|null, lastRunAt: string|null, openBreaks: number, createdAt, updatedAt}] }`
- `GET /api/workflows/:id` → `{ workflow, mapping: {mappings:[...]}|null, joinMap: {rows:[...]}|null, recentRuns: [...] }`
- `POST /api/workflows` body `{name, period, sources: [{sourceId, displayName, ingestionType, config}]}` (≥2 sources) → `{ workflow }` (409 if name duplicated per user).
- `PUT /api/workflows/:id` body `{name?, period?, status?, sources?, outboundConfig?}` → `{ workflow }`.
- `DELETE /api/workflows/:id` → `{ ok: true }`.
- `POST /api/workflows/:id/run` → waits for reconcile, returns `{ run: {_id, status:'success'|'failed', matchRate, counts: {bySource, matched, breaks, anomalies, openBreaks}, totals, error?}, summary: {transactionalBreaks, presenceBreaks, valueBreaks, dimensionalBreaks, anomalyFlags, note} }`. Can be slow (~5–20s).

### Ingestion (per source)
- `POST /api/workflows/:id/sources/:sourceId/upload` — multipart, field name `file`. → `{ source, loadId, recordsLoaded, columns: [..], sample: [row...], timeTakenMs, parseStats }`.
- `POST /api/workflows/:id/sources/:sourceId/api-ingest` body `{baseUrl, perPage?}` → `{ source, loadId, recordsLoaded, pages, total, period, sample, timeTakenMs }`.
- `POST /api/workflows/:id/sources/:sourceId/api-test` body `{baseUrl}` → `{ ok, health, summary, period }`.
- `POST /api/workflows/:id/mappings/upload-join-map` — multipart `file` (csv/txt). → `{ joinMap, rows }`.

### Validation gate
- `POST /api/workflows/:id/validate` body `{sourceId, loadId}` → `{ sourceId, loadId, totals: {records, columns}, nulls: {field: count}, outliers: {field: count}, ruleFailures: [{ruleId, field, type, params, count, sampleValues: [..5] }], schemaDrift: {newColumns, missingColumns, previousLoadId} | null, warnings: [string], ruleSummary: {total, activeCheckerRules, keySpec, aggregateSpec, ...} }`.
- `POST /api/workflows/:id/acknowledge-validation` body `{}` → `{ acknowledged: true, workflow }`. The UI must block proceeding to Mapping until acknowledged (per-source validation results are stored on the workflow; re-uploading re-arms the gate).

### Field mapping
- `GET /api/workflows/:id/mapping-suggestions` → `{ sources: [{sourceId, displayName, fields: [{name, dtype: 'numeric'|'date'|'string', sampleValues: [..5], cardinality}]}], groups: [{targetGroupId, fields: [{sourceId, fieldName}], status: 'common'|'potential'|'uncommon', confidence: 0..1, isReconcileField: bool, suggestedReconcileField: bool, evidence}], unassigned: [...], stats: {common, potential, uncommon} }`.
  - The `unassigned` fields (e.g. `gl_account_id`, `ma_customer_key`, `fa_key`) are unmatched single-source fields — render them as **uncommon** (red) chips that can be dragged to form new groups.
- `PUT /api/workflows/:id/mappings` body `{mappings: [mappingGroup...], joinMapFileId?}` → `{ mapping }`. `mappingGroup = {targetGroupId, fields: [{sourceId, fieldName}], status, confidence, isReconcileField, overriddenByUser}`.
- UI: side-by-side panels (one per source, horizontal scroll >3), search per panel, hover tooltip = dtype + top-5 samples, color chips (green common, light-green potential, red uncommon, amber = reconcile target), drag-and-drop between panels, click-two-fields to connect, "Clear all mappings" (reset to all-uncommon), per-action undo stack, join-map upload control.

### Preview
- `GET /api/workflows/:id/preview` → `{ aligned: [{targetGroupId, status, isReconcileField, confidence, rows: [{sourceId: value}]}], warnings: [{type: 'duplicate-mapping'|'dtype-mismatch', message}], sourceIds }`.
- "Proceed to Run" enabled only when no blocking warnings (duplicate-mapping blocks; dtype-mismatch warns).

### Runs & breaks
- `GET /api/runs/:runId` → `{ run, counts: {...incl. openBreaks}, breakCountTotal }`.
- `GET /api/runs/:runId/breaks?type=transactional|dimensional&status=&source=&search=&page=&limit=&sort=-priorityScore` → `{ breaks: [{_id, type, key, dimension, sourcesInvolved: [..], expected, actual, variance, materiality, priorityScore, aiRootCause, evidence: {present_sources, missing_sources, per_source_amounts, ... , historical_frequency, explаiners? }, status: 'open'|'investigating'|'pending-approval'|'approved'|'rejected', createdAt}], total, page, pages, stats: {byType, byStatus} }`.
- `GET /api/breaks/:breakId` → `{ break, investigations: [{_id, investigatorId, cause, aiRootCauseOverridden, submittedAt, approverId, decision, decisionComment, decidedAt, history}], historicalFrequency: {periodsBroken, totalBreaks} }`.
- `POST /api/breaks/:breakId/investigate` body `{cause, overrideAiRootCause?}` → `{ break, investigation }`.
- `POST /api/breaks/:breakId/decide` body `{decision: 'approved'|'rejected', decisionComment?}` → `{ break, investigation }`.
- `POST /api/breaks/bulk-decide` body `{breakIds: [], decision, decisionComment?}` → `{ processed }`.
- `POST /api/breaks/bulk-decide/upload` — multipart `file` (CSV with columns `break_id,decision[,comment]`) → `{ processed, errors }`.
- `POST /api/breaks/:breakId/chat` body `{question}` → `{ answer, evidence: [] }`.

### Reports & comparison
- `GET /api/reports/:runId` → `{ run, totalBreaks, byType: {transactional, dimensional}, byStatus: {...}, trend: [{runId, startedAt, status, matchRate, breaks}], top10: [break...] }`.
- `GET /api/reports/:runId/export?format=csv|xlsx|json|pdf|xml|text` — binary download (use axios `responseType: 'blob'`, create object URL).
- `GET /api/reports/:runId/email-recipients` (admin or workflow owner) → `{ runId, workflowName, period, defaults: [email...], formats, candidates: [{_id, name, email, role}] }` — suggested recipients (workflow outboundConfig.email, owner, runBy) and the user directory for the email modal.
- `POST /api/reports/:runId/email` body `{to: [email...], format?, subject?, message?}` (admin or workflow owner) → `{ message, to, format, messageId }`. Generates the report file, attaches it via Gmail SMTP (`EMAIL_USER`/`EMAIL_PASS`), records a `Report` row with `meta.delivery:'email'`, and audits `report.emailed`.
- Report email is also delivered automatically after a successful run when the workflow's outbound config has a notify email: `Workflow.outboundConfig.email` receives the report (XLSX, or PDF when `filePdf` is set); delivery failures are audited as `report.email.failed` and never fail the run.
- `POST /api/reports/compare` body:
  - cross-system: `{workflowId, mode:'cross-system', a:{sourceId}, b:{sourceId}, groupBy: 'gl_account_id'|'entity'|'currency'|'TransactionID', tolerance?}` → `{ mode, a:{sourceId,displayName}, b:{sourceId,displayName}, groupBy, tolerance, grand:{a,b,variance}, table: [{dimension, aTotal, bTotal, variance, variancePct, status:'matched'|'break'}], breakingCount, execSummary }`.
  - run-to-run: `{workflowId, mode:'run-to-run', a:{runId}, b:{runId}}` → `{ mode, a:{runId,startedAt,matchRate,breaks}, b:{...}, deltas:{matchRate, breakCount, newlyAppeared, resolved}, newlyAppeared: [flatBreak], resolved: [flatBreak], mappingDiff: {changed: bool, diff?} }`.
- Comparison screen: tab switch between modes; side-by-side table (Dimension | Report A Total | Report B Total | Variance | Variance % | Status), summary banner with grand totals colored green/red, row click → drill-down modal listing underlying rows (the compare API returns aggregates; for drill-down reuse `GET /api/runs/:runId/breaks?search=<dimension>` when available).

### Audit & admin
- `GET /api/audit/:workflowId?page=&limit=&entity=&action=` → `{ logs: [{_id, actorName, role, action, entity, entityId, before, after, createdAt}], total, page, pages }`. Expandable before/after JSON diff.
- `GET /api/users` (admin) → `{ users: [...] }`; `POST /api/users` `{name,email,password,role}`; `PUT /api/users/:id` `{role?,active?,password?,name?}` → `{ user }`.

## 3. Design System — "Clean Ledger" (mandatory)

**No gradients anywhere.** Solid fills only.
- Page bg `#FFFFFF`; panel/card bg `#FAFAFA`, `1px solid #E5E7EB` border, `border-radius: 10px`.
- Text: primary `#0F1115`, secondary/meta `#4B5563` (sparingly). Base 14px body / 13px tables / 20–28px page headers with tight letter-spacing.
- Accent (buttons, active nav, links, focus ring, progress): `#1D4ED8`; hover `#1E40AF`; disabled `#93C5FD`. Solid buttons, white text, 8px radius, subtle darken on hover.
- Functional colors as **small chips/dots/borders only**, never backgrounds: matched/common `#16A34A`; potential `#84CC16`; break/uncommon `#DC2626`; reconcile/amount `#CA8A04`.
- Borders/dividers `#E5E7EB`. Hover shadow only `0 1px 2px rgba(0,0,0,0.04)`.
- IDs/amounts in JetBrains Mono; tables: no zebra, 1px row dividers, sticky header, monospace ID/amount columns.
- Motion (framer-motion): page fade 150ms + 8px slide-up; cards staggered 30ms; KPI count-up; button press scale 0.98/120ms; modal 200ms scale 0.97→1 + fade; run progress bar with step labels (Ingesting… Mapping… Matching… Scoring breaks…); toasts slide in top-right with shrinking progress underline; break accordion height auto-animate.
- Empty/loading states: skeleton blocks `#F3F4F6` (not spinners-only).
- Tabs/pills: outline by default, solid blue when active. Buttons: solid blue fill, never gradient.

## 4. Screens & routes (React Router)

1. `/login` — email+password; badges showing demo credentials; stores token.
2. `/dashboard` — KPI strip (total workflows, workflows run this month, avg match rate, total open breaks — animated count-up), workflow table/cards: name, sources count, last-run status (✅/❌/⏳/—), last run date, match %, open breaks; per-row actions: Run, View, Delete (confirm modal), Download last report (link `GET /api/reports/<lastRunId>/export?format=xlsx`); "Create New Workflow" primary button.
3. `/workflows/new` — name (required, unique), period (optional), ≥2 source blocks (display name, ingestion type file/api/db, db marked "beta"); submit → `/workflows/:id/ingest`.
4. `/workflows/:id/ingest` — per-source panels:
   - **file**: react-dropzone (accept .csv/.xls/.xlsx/.json/.xml), preview of columns + first rows after upload;
   - **api**: base URL (prefill `http://127.0.0.1:5001`), "Test Connection" (api-test), "Ingest All Pages" with progress bar (page X / total_pages — use `pages`/`total` from response);
   - **db**: disabled beta panel.
   - After ingestion: "Run AI Validation" per source → warning panel (nulls, outliers, rule failures with sample values, schema drift) + **Go-Ahead** button (blocks navigation to Mapping when unacknowledged) or "Fix & Re-upload".
5. `/workflows/:id/mapping` — per §2 Field mapping (AI suggestions, drag/search/override, reconcile-field selector, join-map upload, undo stack, clear all).
6. `/workflows/:id/preview` — aligned sample table + dtype/duplicate warnings; Proceed-to-Run gating.
7. `/workflows/:id/run` — outbound config (API endpoint URL field — stored, not delivered in this build; "Email report to" field — the final report is emailed after each successful run; PDF/Excel export toggle picks the emailed attachment format), "Run Reconciliation" → animated step progress (Ingest ✓ → Map ✓ → Match ⏳ → Score Breaks → Done), result banner (match rate, counts), "Download Report" (xlsx).
8. `/workflows/:id/breaks` — filterable/sortable table (type, sources involved, key, expected vs actual, variance, materiality, priority score, status, AI root-cause 1-liner); row click → slide-over/drawer detail (full field diff from evidence, AI root-cause card with explainers + confidence, historical-frequency badge, inline "Ask Copilot about this break" chat using `POST /api/breaks/:breakId/chat`); checkbox multi-select + bulk decision bar (bulk-decide); file-upload decision (bulk-decide/upload); detail drawer includes investigate form (cause textarea + override toggle) and decision buttons (Approve/Reject + comment) defaulted by role.
9. `/workflows/:id/reports` — donut (matched/breaks/pending via byType/byStatus), break trend line (trend[]), top-10 materiality table; export buttons CSV/XLSX/JSON/PDF; **Compare tab** (§2 comparison): mode tabs cross-system / run-to-run, grouping picker, grand-total banner, comparison table, drill-down modal, "Export Comparison" (POST compare then GET compare-export if needed — for exports use `GET /api/reports/:runId/export?format=` for the summary report and implement comparison export as downloading `GET /api/reports/:runId/compare-export?mode=&aSource=&bSource=&aRun=&bRun=&groupBy=&format=`).
10. `/workflows/:id/audit` — paginated filterable log, expandable before→after diff, role/actor badges.
11. `/admin/users` — (admin only) user table, create, toggle active, role change, reset password.
12. **Copilot slide-over** — available on Breaks & Reports: text input `{workflowId, question}` → POST via `/api/breaks/<anyBreakId>/chat` if scoped, else a small dedicated endpoint is not present — use the copilot through the break chat endpoint with the workflow's latest break, or show grounded capability text. Keep the panel simple: question → answer + evidence chips.

## 5. Layout & shell

- Sidebar navigation with workflow context: Dashboard, New Workflow; when a workflow is active: Ingest, Mapping, Preview, Run, Breaks, Reports, Audit. Top bar: page title, role badge, user name, logout. Admin link for admins.
- Workflow switcher: if route param `:id` present, fetch `GET /api/workflows/:id` and share via a zustand `useWorkflow` store.
- Global toasts, skeleton loaders, empty states ("No workflows yet — create your first reconciliation").

## 6. Quality bar

- Every mutation reflects through the audit trail automatically (backend-side) — no extra work.
- Handle API errors with a toast + inline message. Display loading skeletons everywhere.
- Match rates displayed as percentages (e.g. 93.37%). Amounts formatted with thousands separators, 2 decimals, monospace.
- No external AI keys, no calls outside `/api` (proxied to :4000).
- When done, run `npm run build` and fix any build errors; then `npm run dev` and verify the app compiles on http://127.0.0.1:5173 (leave it running via run_in_background if you can, but at minimum confirm the build succeeds).