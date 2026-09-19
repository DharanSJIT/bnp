# OneRecon — AI-Powered Financial Reconciliation Platform

Configurable **workflow orchestration** for reconciling heterogeneous finance systems (GL / MA / FA / RR) at transaction and aggregate level, with AI-assisted mapping, root-cause generation, maker-checker governance and audit-ready exports.

Built for the BNP Paribas "OneRecon" hackathon (UC-3). Phases **1–4 demo-solid** per the SRS; the verified API contract driving the frontend is `docs/api-contract.md`.

```
┌────────────────────────┐        ┌──────────────────────────────┐
│ React + Vite + Tailwind │  JWT   │ Node.js + Express (:4000)     │
│  frontend (:5173)       ├───────►│ auth/RBAC · orchestration ·    │
└────────────────────────┘        │ maker-checker · exports · audit │
                                  └────────────┬───────────────────┘
                                  internal REST │   /   MongoDB (:27017)
                                  ┌─────────────▼───────────────────┐
                                  │ Python FastAPI (:8000)           │
                                  │ parsers · rule engine · mapping  │
                                  │ reconciliation · anomaly · RCA   │
                                  │ grounded copilot                 │
                                  └─────────────┬───────────────────┘
                                                │
                                 MA Flask API (:5001, per-month server)
                                 uploaded GL XML / FA CSV files
```

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite, Tailwind CSS, Framer Motion, Zustand, Recharts, react-dropzone, React Router |
| Backend API | Node 20+ / Express, JWT + bcryptjs, Mongoose, exceljs/pdfkit/json2csv |
| AI/data service | Python 3.11+ / FastAPI, pandas, scikit-learn (IsolationForest), rapidfuzz, pymongo |
| Database | MongoDB (local by default; swap `MONGO_URI` in `backend/.env` for Atlas) |
| External data | MA REST API (paginated, `Amount` string→float), GL XML, FA CSV, monthly join maps |

No external AI API keys are required — the explainer, mapper, validation, and copilot are deterministic/offline-safe.

## Quickstart

```bash
# 0. Prerequisites: node ≥20, python 3.11+, local mongod (brew install mongodb-community)

# 1. Start MongoDB (if not already running)
mongod --dbpath .mongo-data --port 27017 --bind_ip 127.0.0.1

# 2. AI service (port 8000)
cd ai-service
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 3. MA data server for the month you reconcile (port 5001 — macOS reserves 5000)
cd ..   # repo root
python ai-service/.venv/bin/python scripts/start_ma_server.py \
  "Current Data/august/ma_api_server_202608.py"
# switch month: .../july/ma_api_server_202607.py , etc. (only one at a time)

# 4. Backend (port 4000)
cd backend
npm install
cp .env.example .env          # defaults point at local Mongo / ports already set
node scripts/seedUsers.js     # seed admin/investigator/approver
npm run dev

# 5. Frontend (port 5173)
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5173** and log in:

| Role | Email | Password |
|---|---|---|
| Investigator | investigator@onerecon.io | Invest@123 |
| Approver | approver@onerecon.io | Approver@123 |
| Admin | admin@onerecon.io | Admin@123 |

> One-command alternative: `bash scripts/dev_all.sh` starts Mongo (if needed), the MA server (august by default), AI service, backend and frontend.

## Preload a populated demo workflow (optional but recommended)

```bash
python ai-service/.venv/bin/python scripts/seed_demo.py
```

This wipes existing workflows/runs/breaks for the demo user, then builds one fully
configured **August 2026 GL–MA–FA** workflow: ingests all three sources, uploads
the join map, saves the AI mapping, runs reconciliation (~94% match rate, ~3k
breaks with root causes) — ready to open in the UI immediately.

## End-to-end flow

1. **Login** → JWT + role badge.
2. **Register workflow** → name, period (e.g. `202608`), ≥2 sources (file / REST API / db-beta).
3. **Ingest** → upload GL XML + FA CSV; configure & Test the MA REST connector; "Ingest All Pages" pulls 45 pages / 22k rows.
4. **AI validation gate** → per-source nulls/outliers/rule violations (from `business_rules.txt`, interpreted dynamically — R01–R10 active, R11–R25 placeholders skipped) + schema drift vs previous load; click **Go-Ahead** to proceed.
5. **Field mapping** → AI suggests 6 common groups (TransactionID, Date, Amount, Currency, Country, Description; key fields stay uncommon); mark **Amount** as reconcile field; upload the monthly join map.
6. **Preview & Run** → aligned rows + dtype/duplicate warnings; outbound config (stored); **Run Reconciliation** → transactional match (natural key) + dimensional match (join-map-resolved sums) + IsolationForest anomaly layer + deterministic root causes in **~2–3 s** for ~66k rows.
7. **Breaks & Maker–Checker** → priority-scored break list; AI root-cause with evidence; investigator submits cause → pending-approval; approver approves/rejects (single, bulk, or CSV upload); Copilot answers grounded questions per break.
8. **Reports & Compare** → donut/trend/top-10, CSV/XLSX/JSON/PDF exports, **Comparison module**: cross-system (e.g. FA vs RR-style GL-vs-FA by `gl_account_id`, grand totals + variance banner) and run-to-run (match-rate/break deltas, newly appeared/resolved breaks, mapping diff).
9. **Audit trail** → every state change (ingest, mapping override, validation acknowledgment, run start/finish, decisions, exports, logins) is immutable and filterable.

## Dataset notes

- `Current Data/august` + `Historical Data/{june,july}` — GL XML, FA CSV, join maps, MA servers.
- Record counts differ by system within a month **by design** (presence breaks); some transactions share an ID but differ in amount (value breaks); dimensional breaks surface account-level mismatches via the join map. These are the reconciliation "break" signal, not bugs.
- MA is **API-only** (no file) — `Amount` arrives as a string and is cast to float by the connector.

## Tests

```bash
# End-to-end API smoke test (backend + AI + MA server must be running)
python ai-service/.venv/bin/python scripts/e2e_api_test.py
```

## Config

| File | Purpose |
|---|---|
| `backend/.env` | PORT, MONGO_URI, JWT_SECRET, AI_SERVICE_URL, MA_API_BASE_URL |
| `ai-service/.env` | ONERECON_MONGO_URI, ONERECON_DB |
| `frontend/vite.config.js` | `/api` proxy → :4000 |

## Repository layout

```
backend/            Node/Express — models, routes, services, middleware, scripts/seedUsers.js
ai-service/         FastAPI — parsers/ rules/ mapping/ reconcile/ anomaly/ rootcause/ chat/
frontend/           React + Vite + Tailwind — pages/ components/ store/ lib/
scripts/            start_ma_server.py · e2e_api_test.py · seed_demo.py · dev_all.sh
docs/               this build's contract spec (api-contract.md)
Current Data/       august (GL/FA/MA server/join map) + business_rules.txt
Historical Data/    june + july
```

## Scope & assumptions

- DB ingestion connector (SQL/Oracle) and full NLP LLM integration are **out of scope** for this build (stubbed/documented); deterministic explainer + grounded copilot run offline with zero API keys.
- Currency conversion is not applied; mixed-currency groups are flagged rather than summed silently.
- Outbound delivery (email/API push) is **configured and stored** but not actually dispatched.
- Lineage graph and predictive break flags are Phase 5/6 stretch — the data model (`breaks.sourcesInvolved`, evidence) supports them without schema change.