# OneRecon — Build Trace (SRS → Implementation)

How each SRS requirement maps to the delivered implementation (Phases 1–4).

| SRS area | Requirement | Where implemented | Status |
|---|---|---|---|
| §8 · Workflow registration | Entity-type workflow: name, period, ≥2 sources, per-source ingestion type | `backend/src/routes/workflows.js` POST/PUT; `src/pages/WorkflowNew.jsx` | ✅ |
| §8 · Sources | File upload (CSV/XLSX/JSON/XML) with preview | `sources.js` upload → `ai-service/app/parsers/*`; `pages/Ingest.jsx` | ✅ |
| §8 · REST pull | MA paginated connector (`Amount` str→float, health/pages) | `ai-service/app/parsers/api_connector.py`; upload via `api-ingest` | ✅ |
| §8 · DB connector | SQL/Oracle ingestion | `sources.js` `db-ingest` → 501 with informative JSON (Phase 6 stretch) | 🟨 stubbed |
| §9 · Validation gate | Rule-driven validation before mapping; Go-Ahead acknowledgment; schema drift vs previous load | `ai-service/app/rules/rule_engine.py` (dynamic REGISTRY interpreter, R01–R25 incl. 15 no-op placeholders); `validate` + `acknowledge-validation` routes; `pages/Ingest.jsx` | ✅ |
| §10 · Field mapping | AI suggestions (name/dtype/value-set/形状), confidence, exclusive mapping, manual override, join-map upload, undo | `ai-service/app/mapping/field_mapper.py` (rapidfuzz + transitive union-find); `mapping-suggestions`, PUT `mappings`, `upload-join-map`; `pages/Mapping.jsx` | ✅ |
| §11 · Reconciliation | Two private modes: transactional (natural key + amount equality) and dimensional (join-map-resolved aggregates per dimension) | `ai-service/app/reconcile/engine.py` | ✅ |
| §11 · Break scoring | Priority = 40% materiality + 30% historical frequency + 30% anomaly | `engine.py` `score_breaks`; `breaks.js` sort `-priorityScore` | ✅ |
| §11 · AI root-cause | Deterministic explainer (missing/dupes/unmapped/value-diff/month-end/anomaly) + evidence | `ai-service/app/rootcause/explainer.py`; copilot `chat/copilot.py` grounded answers | ✅ |
| §12 · Maker-checker | Investigator → pending-approval → approver approve/reject; bulk + CSV decisions | `breaks.js` investigate/decide/bulk-decide/upload; `pages/Breaks.jsx` | ✅ |
| §13 · Audit trail | Immutable per-action log with actor/role/before/after | `services/auditService.js` (never throws); `routes/audit.js`; `pages/Audit.jsx` | ✅ |
| §14 · Reports & export | CSV/XLSX/JSON/PDF incl. disclaimer; dashboard payload | `routes/reports.js` + `services/exportService.js` (exceljs/pdfkit/json2csv) | ✅ |
| §14 · Comparison | Cross-system (per join-map dimension) + run-to-run (deltas, newly-appeared/resolved, mapping diff) | `reports.js` compare + compare-export; `pages/Reports.jsx` Compare tab | ✅ |
| §7 · Design | Clean Ledger: white surfaces, near-black text, blue-700 accent, functional colors as chips only, no gradients, motion guidelines | `frontend/tailwind.config.js` + tokens in `index.css`; enforced across pages (built to `docs/api-contract.md` §3) | ✅ |
| §15 · Architecture | 3-tier frontend/backend/AI + MongoDB; heavy payloads stay server-side | `README.md` topology; staging service chunks 2k rows; orchestrator REST | ✅ |
| §16 · Run flow | 12-step configurable workflow incl. outbound config | backend orchestration + `pages/Run.jsx`; outbound stored, dispatch stubbed | ✅ |
| NFR · Offline AI | No external keys; deterministic analyses | all of `ai-service/` | ✅ |
| NFR · Performance | Match ~66k rows <10 s | measured 1.5–2.3 s on M-series | ✅ |
| NFR · Security | Password hashing (bcryptjs), JWT, admin-only user mgmt | `backend/src/middleware/*` + `routes/users.js` | ✅ |
| NFR · Testing | Unit + integration tests | `ai-service/tests/` (12 tests, pytest); `scripts/e2e_api_test.py` full-flow | ✅ |
| Phase 5 (stretch) | Lineage graph | data model supports (`sourcesInvolved`, evidence); no UI | 🟨 not built |
| Phase 5 (stretch) | Chatbot / copilot | per-break grounded copilot shipped; global NLP assistant on pause | 🟨 partial |
| Phase 6 (stretch) | Predictive breaks / ML forecasting | IsolationForest anomaly layer shipped; time-series forecast stub | 🟨 partial |

Legend: ✅ demo-solid · 🟨 documented/stubbed/partial with clear path.