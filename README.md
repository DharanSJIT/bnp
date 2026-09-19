# OneRecon — AI-Powered Financial Reconciliation Platform

Configurable **workflow orchestration** for reconciling heterogeneous finance systems (GL / MA / FA / RR) at transaction and aggregate level — with AI-assisted mapping, root-cause generation, maker–checker governance, live analytics, audit-ready exports in six formats, **email delivery of the final document**, and a **BNP Paribas knowledge-base assistant** powered by Groq.

Built for the BNP Paribas "OneRecon" hackathon (UC-3). The full SRS flow is implemented end-to-end: **register → create workflow → ingest → validate → map → preview → reconcile → breaks & maker–checker → reports (export / email) → analytics → audit → history**. Thee verified API contract driving the frontend is `docs/api-contract.md`.

```
┌────────────────────────┐         ┌───────────────────────────────┐
│ React + Vite + Tailwind │  JWT    │ Node.js + Express (:4000)      │
│  frontend (:5173)       ├────────►│ auth/RBAC · orchestration ·     │
│  (floating BNP assistant)│        │ maker-checker · exports · audit │
└────────────────────────┘         │ email delivery (nodemailer)     │
                                   └──────┬───────────────────┬──────┘
                                          │ internal REST /   │ SMTP
                                   ┌──────▼──────────────┐  ┌─▼────────────────┐
                                   │ Python FastAPI (:8000)│  │ Gmail SMTP       │
                                   │ parsers · rules ·     │  │ (EMAIL_USER /    │
                                   │ mapping · reconcile · │  │  EMAIL_PASS)     │
                                   │ anomaly · RCA · chat   │  └──────────────────┘
                                   │  ┌─────────────────┐  │
                                   │  │ Groq API (RAG / │  │
                                   │  │ optional mapper)│  │
                                   └──┴────────┬────────┴──┘
                                               │  /   MongoDB (:27017)
                                                │
                                 MA Flask API (:5001, per-month server)
                                 uploaded GL XML / FA CSV files
```

## Feature highlights

| Area | What you get |
|---|---|
| **Workflows** | Name + period (e.g. `202608`), ≥2 sources (file upload / REST API), per-workflow outbound config (delivery API URL, notify-email, PDF/Excel format) |
| **Ingestion** | GL XML, FA CSV, paginated MA REST connector (45 pages / ~22k rows), per-source status tracking |
| **AI validation gate** | Nulls / outliers / rule violations from `business_rules.txt` (R01–R10) + schema drift; Go-Ahead to proceed |
| **Field mapping** | AI-suggested groups (TransactionID, Date, Amount, Currency, Country, Description), reconcile-field marking, monthly join-map upload |
| **Reconciliation** | Transactional match (natural key) + dimensional match (join-map sums) + IsolationForest anomaly layer + deterministic root causes in ~2–3 s for ~66k rows |
| **Breaks & maker–checker** | Priority-scored breaks, AI root cause with evidence, single / bulk / CSV-upload decisions, grounded chat per break |
| **Analytics dashboard** | Live KPIs computed from real run/break data: by-source volume, match-rate trend, root-cause categories, break aging, system volumes |
| **Reports** | Summary (donut / trend / top-10 materiality) + **Compare** (cross-system A/B and run-to-run deltas), exports in **CSV · XLSX · JSON · PDF · XML · TEXT** |
| **Email delivery** | Send any report by email (manual ✉ EMAIL on the Reports page), or auto-email after every successful run when a notify-email is configured |
| **BNP Paribas assistant** | Floating chat widget (bottom-right, every page) answering general company questions via **Groq RAG** over `bnp_paribas_knowledge_base.txt` |
| **Governance** | Immutable, filterable audit log of every state change; admin-managed users; role badges |

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite, Tailwind CSS, Framer Motion, Zustand, Recharts, react-dropzone, React Router |
| Backend API | Node 20+ / Express, JWT + bcryptjs, Mongoose, exceljs / pdfkit / json2csv / xml2js, **nodemailer** (Gmail SMTP) |
| AI/data service | Python 3.11+ / FastAPI, pandas, scikit-learn (IsolationForest), rapidfuzz, pymongo, **groq** SDK |
| Chat / LLM | Groq API (`openai/gpt-oss-120b`, configurable via `GROQ_MODEL`) — used for the BNP assistant and (optionally) field mapping, with deterministic offline fallbacks when no key is present |
| Email | Gmail SMTP app-password (`EMAIL_USER` / `EMAIL_PASS`) — OTPs and report delivery |
| Database | MongoDB (local by default — inspect with **MongoDB Compass** at `mongodb://127.0.0.1:27017/onerecon`) |

## Prerequisites

- **Node.js ≥ 20**
- **Python 3.11+**
- **MongoDB** running locally (`brew install mongodb-community`), or an Atlas cluster
- **Gmail account with an app password** for email delivery (optional — OTP + report emails need it)
- **Groq API key** for the BNP assistant (optional — chat falls back to grounded excerpts without it)

> The core reconciliation pipeline is deterministic and offline-safe: no AI keys are required to ingest, reconcile, and export. Groq unlocks the BNP assistant and smarter field mapping.

## Quickstart

```bash
# 0. Prerequisites are in place (node, python venv, local mongod)

# 1. Start MongoDB (if not already running)
mongod --dbpath .mongo-data --port 27017 --bind_ip 127.0.0.1

# 2. AI service (port 8000)
cd ai-service
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # add your GROQ_API_KEY here
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 3. MA data server for the month you reconcile (port 5001 — macOS reserves 5000)
cd ..   # repo root
python ai-service/.venv/bin/python scripts/start_ma_server.py \
  "Current Data/august/ma_api_server_202608.py"
# switch month: .../july/ma_api_server_202607.py, etc. (only one at a time)

# 4. Backend (port 4000)
cd backend
npm install
cp .env.example .env          # set MONGO_URI, JWT_SECRET, EMAIL_USER, EMAIL_PASS
node scripts/seedUsers.js     # seed the main admin + 7 bank roles (idempotent)
npm run dev

# 5. Frontend (port 5173)
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5173** and log in (demo credential chips are on the login page):

| Role | Email | Password |
|---|---|---|
| Admin (system administrator) | admin@onerecon.io | Admin@123 |
| General Manager | gm@onerecon.io | Manager@123 |
| Operations Manager | manager@onerecon.io | Manager@123 |
| Approver | approver@onerecon.io | Approver@123 |
| Investigator | investigator@onerecon.io | Invest@123 |
| Reconciliation Monitor | monitor@onerecon.io | Monitor@123 |
| Chief Accountant | accountant@onerecon.io | Account@123 |
| Cashier | cashier@onerecon.io | Cashier@123 |

> **Registration**: any client can self-register (name, email, password + OTP) — there is **no role selector**. Everyone who self-registers becomes a standard **Report user** (`investigator`) and can immediately create workflows, run reconciliations, and generate / download / email reports. The backend ignores any role sent by the client; higher roles are granted only by an admin via **⚙ Admin Users**.

> One-command alternative: `bash scripts/dev_all.sh` starts Mongo (if needed), the MA server (august by default), the AI service, backend and frontend.

> Data lives in `.mongo-data` (visible in MongoDB Compass at `localhost:27017`). For Atlas, set `MONGO_URI` in `backend/.env` **and** `ONERECON_MONGO_URI` in `ai-service/.env` to the same connection string and whitelist this machine's IP in Atlas — both services must target the same database.

## Preload a populated demo workflow (optional but recommended)

```bash
python ai-service/.venv/bin/python scripts/seed_demo.py
```

This wipes existing workflows/runs/breaks for the demo user, then builds one fully
configured **August 2026 GL–MA–FA** workflow: ingests all three sources, uploads
the join map, saves the AI mapping, runs reconciliation (~94% match rate, ~3k
breaks with root causes + evidence) — ready to open in the UI immediately.

## End-to-end workflow

1. **Landing / Login / Register** → JWT + role badge; clients self-register with an **email OTP** (no role selection) and are signed straight in as report users.
2. **Create workflow** → name, period (e.g. `202608`), **≥2 sources** (file / REST API).
3. **Ingest** → upload GL XML + FA CSV; configure & Test the MA REST connector; **Ingest All Pages** pulls 45 pages / ~22k rows.
4. **AI validation gate** → per-source nulls / outliers / rule violations + schema drift; click **Go-Ahead** once clean.
5. **Field mapping** → AI-suggested mapping groups; mark **Amount** as the reconcile field; upload the monthly join map.
6. **Preview & Run** → aligned rows with dtype/duplicate warnings; set the **outbound configuration** (delivery API URL, **Email report to**, PDF/Excel format); **Run Reconciliation** → transactional + dimensional match, anomaly layer, deterministic root causes (~2–3 s for ~66k rows).
   - If a **notify-email** is configured, the final report is **automatically emailed** (XLSX, or PDF if the toggle says so) after the run succeeds — failures are audited, never fail the run.
7. **Breaks & Maker–Checker** → priority-scored break list; AI root-cause with evidence; investigator submits cause → pending-approval; approver approves/rejects (single, bulk, or CSV upload); Copilot answers grounded questions scoped to a break.
8. **Reports & Compare** → donut / trend / top-10 materiality; **export in CSV, XLSX, JSON, PDF, XML or TEXT**; **✉ EMAIL** opens the delivery modal (recipients pre-filled from the workflow notify-email / owner / runner, with clickable role chips to add colleagues, format & subject editable) — the generated document is attached and sent, and the delivery is recorded with an audit entry.
   - **Comparison module**: cross-system (e.g. GL vs FA by `gl_account_id`, grand totals + variance banner) and run-to-run (match-rate / break deltas, newly appeared / resolved breaks, mapping diff).
9. **Analytics dashboard** → live KPIs from real processed data: overall match rate, processing volume by source, match-rate trend across runs, root-cause categories, break aging buckets, and system volumes.
10. **Audit trail** → every state change (login, ingest, mapping override, validation acknowledgment, run start/finish, decisions, exports, **emails sent**, failures) is immutable and filterable.
11. **History** → every processed workflow & run ever performed (global), with match rate, break counts and one-click downloads of the exports.

**BNP Paribas assistant (always on)** → the green chat bubble in the **bottom-right corner** answers general questions about the BNP Paribas Group (overview, divisions, purpose, products, history…). It retrieves the most relevant sections of `bnp_paribas_knowledge_base.txt` and answers via **Groq**, in clean plain text (no markdown, no citations).

## Configuration

| File | Keys | Purpose |
|---|---|---|
| `backend/.env` | `PORT`, `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `AI_SERVICE_URL`, `MA_API_BASE_URL`, `UPLOAD_DIR`, `EXPORT_DIR` | API gateway settings |
| `backend/.env` (email) | `EMAIL_USER`, `EMAIL_PASS` | Gmail SMTP for OTPs + report delivery (use a Google **app password**, not your account password) |
| `ai-service/.env` | `ONERECON_MONGO_URI`, `ONERECON_DB`, **`GROQ_API_KEY`**, `GROQ_MODEL` (default `openai/gpt-oss-120b`), `BNP_KB_PATH` (optional override for the knowledge base file) | AI service + Groq |
| `frontend/vite.config.js` | `/api` proxy → `:4000` | Dev proxy |

> **Gmail app password**: enable 2-Step Verification on the Gmail account, then create an app password at myaccount.google.com/apppasswords and put it in `EMAIL_PASS`. Never commit it.

## Tests

```bash
# End-to-end API smoke test (backend + AI + MA server must be running)
python ai-service/.venv/bin/python scripts/e2e_api_test.py
```

Manual checks worth doing after setup:

- **Email**: on any workflow's **Reports** page click **✉ EMAIL** → recipients pre-fill → **Send** → success toast + email in the inbox; or set **Email report to** on the Run page and confirm the report arrives after the next successful run. Audit log shows `report.emailed` / `report.email.failed`.
- **BNP assistant**: click the bottom-right bubble and ask e.g. *"How many countries does BNP Paribas operate in?"* → grounded answer with no markdown.
- **Registration**: register a fresh client (OTP by email) → lands on the dashboard as a report user with no role question.

## Repository layout

```
backend/            Node/Express — models/ routes/ services/ middleware/ scripts/seedUsers.js, exports/
ai-service/         FastAPI — parsers/ rules/ mapping/ reconcile/ anomaly/ rootcause/ chat/ (copilot.py, bnp.py)
frontend/           React + Vite + Tailwind — pages/ components/ store/ lib/
scripts/            start_ma_server.py · e2e_api_test.py · seed_demo.py · dev_all.sh
docs/               API contract spec (api-contract.md)
bnp_paribas_knowledge_base.txt    Knowledge base used by the BNP assistant (Groq RAG)
chatbot/           sample knowledge-base artifacts (FA/GL reports)
Current Data/      august (GL/FA/MA server/join map) + business_rules.txt
Historical Data/   june + july
```

No secrets are committed — `.gitignore` excludes every `.env`, `uploads/`, `exports/`, and `.mongo-data`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Port already in use (4000 / 5173 / 8000 / 5001) | `lsof -i :<port>` and stop the previous process, or use `scripts/dev_all.sh` which manages them |
| OTP / report emails not arriving | Check `EMAIL_USER` / `EMAIL_PASS` in `backend/.env` (must be a Gmail **app password**); look at the Audit log for `report.email.failed`; check Promotions/Updates tabs |
| BNP assistant says the model is decommissioned | Groq occasionally retires models — list available ones (`from groq import Groq; [m.id for m in Groq().models.list().data]`) and set a current id in `GROQ_MODEL` |
| BNP assistant returns "knowledge base not found" | Confirm `bnp_paribas_knowledge_base.txt` sits at the repo root, or point `BNP_KB_PATH` at it in `ai-service/.env` |
| Atlas connection refused | Whitelist this machine's IP in Atlas Network Access; both `backend/.env` and `ai-service/.env` must use the same connection string |
| 403 "Not your workflow" on another user's workflow | Ownership-scoped by design — only admins and the workflow owner may view/edit/email a workflow's data |

## Scope & assumptions

- DB ingestion connector (SQL/Oracle) is **out of scope** for this build (documented interface only).
- Currency conversion is not applied; mixed-currency groups are flagged rather than summed silently.
- Email delivery (manual + auto after run) **is implemented** and dispatched through Gmail SMTP; the outbound **HTTP delivery API** field remains stored-but-not-dispatched.
- Lineage graph and predictive break flags are Phase 5/6 stretch — the data model (`breaks.sourcesInvolved`, evidence) supports them without schema change.
- The BNP assistant answers from the knowledge base only; it cannot access live stock prices, job openings, or current news.