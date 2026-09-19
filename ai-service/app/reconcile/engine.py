"""OneRecon reconciliation engine.

Pipeline (one function per stage, matching SRS §10):
  1. load    — pull mapped, rule-validated rows per source from Mongo
  2. normalize — cast Amount→float, resolve canonical account key via join map
  3. transactional match — outer merge on TransactionID (presence + value breaks)
  4. dimensional match   — groupby canonical key, sum reconcile field, compare n-way
  5. classify & score    — materiality + historical frequency → priority_score
  6. anomaly layer       — IsolationForest flags (distinct from rule violations)
  7. root cause          — deterministic explainer per break
  8. persist             — write run summary + breaks to Mongo

Tolerance default 0 (exact-cent parity), configurable per workflow.
"""
import datetime
from bson import ObjectId

from .. import db
from ..anomaly import detector
from ..rootcause import explainer

TOLERANCE_DEFAULT = 0.0
MAX_ANOMALIES = 60


# ---------- stage 1/2: load + normalize ----------

def _load_sources(workflow_id, workflow):
    loads = {}
    for src in workflow.get("sources", []):
        load_id = (src.get("loadStats") or {}).get("lastLoadId")
        if not load_id:
            continue
        docs = db.coll("raw_transactions").find(
            {"workflowId": ObjectId(workflow_id), "sourceId": src["sourceId"], "loadId": load_id}
        )
        rows = [normalize_row(d["row"], src["sourceId"]) for d in docs]
        loads[src["sourceId"]] = rows
    return loads


def normalize_row(row, source_id):
    out = dict(row)
    amt = out.get("Amount", out.get("amount"))
    try:
        out["Amount"] = float(amt)
    except (TypeError, ValueError):
        out["Amount"] = None
    out["_Amount"] = out["Amount"]
    out["_source"] = source_id
    return out


# ---------- join map helpers ----------

def build_join_index(jm_rows):
    by_gl, by_ma, by_fa = {}, {}, {}
    for r in jm_rows:
        if r.get("gl_account_id"):
            by_gl[r["gl_account_id"]] = r
        if r.get("ma_customer_key"):
            by_ma[r["ma_customer_key"]] = r
        if r.get("fa_key"):
            by_fa[r["fa_key"]] = r
    return by_gl, by_ma, by_fa


def key_field(source_id):
    return {"GL": "gl_account_id", "MA": "ma_customer_key", "FA": "fa_key"}.get(source_id)


def resolve_account(row, source_id, join_index):
    by_gl, by_ma, by_fa = join_index
    kf = key_field(source_id)
    if not kf or kf not in row:
        return None, None, False
    val = row.get(kf)
    jr = by_gl.get(val) or by_ma.get(val) or by_fa.get(val)
    if not jr:
        return val, val, False
    return jr.get("gl_account_id"), jr.get("entity") or "Global", True


# ---------- stage 3: transactional ----------

def transactional_match(loads, order, tolerance, period):
    """Outer merge on TransactionID. Returns list of break rows + matched count."""
    txns = {}
    for sid in order:
        if sid not in loads:
            continue
        for row in loads[sid]:
            tid = row.get("TransactionID")
            if not tid:
                continue
            txns.setdefault(tid, {}).setdefault(sid, []).append(row)

    breaks = []
    matched = 0
    for tid, by_source in txns.items():
        present = sorted(by_source.keys())
        dupes = {s: len(rows) for s, rows in by_source.items() if len(rows) > 1}
        if dupes:
            for s, n in dupes.items():
                breaks.append({
                    "type": "transactional",
                    "key": tid,
                    "sourcesInvolved": [s],
                    "expected": 0, "actual": 0, "variance": 0,
                    "materiality": 0.0,
                    "status": "open",
                    "evidence": {"is_duplicate": True, "duplicate_source": s, "dup_count": n, "period": period},
                })
            continue
        missing = [s for s in order if s in loads and s not in by_source]
        amounts = {s: r[0]["_Amount"] for s, r in by_source.items() if r[0]["_Amount"] is not None}
        if missing:
            # presence break
            first = by_source[present[0]][0]
            expected = amounts.get(present[0], 0)
            near_end = False
            try:
                d = datetime.date.fromisoformat(str(first.get("TransactionDate", ""))[:10])
                near_end = d.day >= 28
            except (ValueError, TypeError):
                pass
            breaks.append({
                "type": "transactional",
                "key": tid,
                "sourcesInvolved": present + missing,
                "expected": round(expected, 2),
                "actual": round(expected, 2),
                "variance": 0.0,
                "materiality": 0.0,
                "status": "open",
                "evidence": {
                    "present_sources": present, "missing_sources": missing, "period": period,
                    "near_month_end": near_end,
                    "per_source_amounts": {s: round(a, 2) for s, a in amounts.items()},
                    "date": first.get("TransactionDate"),
                },
            })
        else:
            # all present — value equality on reconcile field
            present_amounts = {s: a for s, a in amounts.items()}
            if len(present_amounts) >= 2:
                items = list(present_amounts.items())
                first_sid, expected = items[0]
                diff_found = None
                for s, a in items[1:]:
                    if abs(a - expected) > tolerance:
                        diff_found = (s, a)
                        break
                if diff_found:
                    breaks.append({
                        "type": "transactional",
                        "key": tid,
                        "sourcesInvolved": present,
                        "expected": round(expected, 2),
                        "actual": round(diff_found[1], 2),
                        "variance": round(diff_found[1] - expected, 2),
                        "materiality": 0.0,
                        "status": "open",
                        "evidence": {
                            "value_diff_sources": [first_sid, diff_found[0]],
                            "per_source_amounts": {s: round(a, 2) for s, a in present_amounts.items()},
                            "period": period,
                        },
                    })
                else:
                    matched += 1
            else:
                matched += 1
    return breaks, matched, len(txns)


# ---------- stage 4: dimensional ----------

def dimensional_match(loads, order, join_index, tolerance, period):
    """groupby canonical gl_account_id, sum Amount per source, compare n-way."""
    per_source_sums = {}  # sid -> {account: total}
    unmapped = {}  # account -> {"count": n, "sources": {sid: key}}
    for sid in order:
        if sid not in loads:
            continue
        sums = {}
        for row in loads[sid]:
            acct, entity, mapped = resolve_account(row, sid, join_index)
            amt = row.get("_Amount") or 0.0
            if not mapped:
                key_s = (acct or "?")
                u = unmapped.setdefault(key_s, {"count": 0, "sources": {}})
                u["count"] += 1
                u["sources"][sid] = row.get(key_field(sid))
                continue
            sums[acct] = sums.get(acct, 0.0) + amt
        per_source_sums[sid] = {k: round(v, 2) for k, v in sums.items()}

    breaks = []
    all_accounts = set()
    for sums in per_source_sums.values():
        all_accounts |= set(sums.keys())

    for acct in all_accounts:
        entries = [(sid, per_source_sums[sid].get(acct, 0.0)) for sid in order if sid in per_source_sums]
        if len(entries) < 2:
            continue
        vals = [e[1] for e in entries]
        if max(vals) - min(vals) > tolerance:
            ref = max(entries, key=lambda e: abs(e[1]))
            other = min(entries, key=lambda e: abs(e[1]))
            variance = ref[1] - other[1]
            breaks.append({
                "type": "dimensional",
                "key": acct,
                "dimension": "gl_account_id",
                "sourcesInvolved": [e[0] for e in entries],
                "expected": round(other[1], 2),
                "actual": round(ref[1], 2),
                "variance": round(variance, 2),
                "materiality": 0.0,
                "status": "open",
                "evidence": {
                    "per_source_totals": {sid: round(v, 2) for sid, v in entries},
                    "period": period,
                },
            })

    dim_break = None
    if unmapped:
        top_keys = sorted(unmapped, key=lambda k: -unmapped[k]["count"])[:10]
        dim_break = {
            "type": "dimensional",
            "key": "(unmapped)",
            "dimension": "join_map_coverage",
            "sourcesInvolved": sorted({s for u in unmapped.values() for s in u["sources"]}),
            "expected": 0, "actual": 0, "variance": 0.0,
            "materiality": 0.0,
            "status": "open",
            "evidence": {
                "unmapped_dimensional": {"count": sum(u["count"] for u in unmapped.values()), "top_keys": top_keys},
                "period": period,
            },
        }
    return breaks, dim_break, per_source_sums


# ---------- stage 5/7: score + root cause ----------

def _historical_runs(workflow_id, key):
    """Distinct prior runs (different from current) that broke the same key."""
    try:
        runs = db.coll("breaks").distinct(
            "runId",
            {"workflowId": ObjectId(workflow_id), "key": key},
        )
        return len(runs)
    except Exception:  # noqa: BLE001
        return 0


def score_breaks(breaks, period_total, workflow_id):
    for b in breaks:
        mat = (abs(b.get("variance") or 0.0) / period_total) if period_total else 0.0
        b["materiality"] = round(mat, 8)
        hist = _historical_runs(workflow_id, b["key"]) if b.get("key") and b["key"] != "(unmapped)" else 0
        b["evidence"]["historical_frequency"] = hist
        # priority 0..100: 40% materiality (log-scaled), 30% history, 30% risk (variance rank proxy)
        mat_score = min(1.0, mat * 5000)  # 0.02% of period → full materiality score
        hist_score = min(1.0, hist / 3.0)
        risk_score = min(1.0, (abs(b.get("variance") or 0.0) / max(period_total * 0.0001, 1.0)))
        b["priorityScore"] = round(40 * mat_score + 30 * hist_score + 30 * risk_score, 1)
    return breaks


def _attach_root_cause(breaks, period):
    for b in breaks:
        rc = explainer.explain(b, dict(b.get("evidence") or {}))
        b["aiRootCause"] = rc["summary"]
        b["evidence"]["explainers"] = rc["explainers"]
        b["evidence"]["root_cause_confidence"] = rc["confidence"]
        b["period"] = period


# ---------- stage 6: anomaly layer ----------

def anomaly_breaks(loads, order, period):
    flagged = []
    for sid in order:
        if sid not in loads:
            continue
        rows = [{"TransactionID": r.get("TransactionID"), "Amount": r.get("_Amount")} for r in loads[sid] if r.get("_Amount") is not None]
        if not rows:
            continue
        results = detector.scan_source(rows)
        for res in results:
            flagged.append({
                "type": "transactional",
                "key": res["key"] or f"{sid}-row{res['rowIndex']}",
                "sourcesInvolved": [sid],
                "expected": round(res["value"], 2),
                "actual": round(res["value"], 2),
                "variance": 0.0,
                "materiality": 0.0,
                "status": "open",
                "evidence": {
                    "is_anomaly": True,
                    "anomaly_col": res["column"],
                    "deviation": res["deviationScore"],
                    "source": sid,
                    "period": period,
                },
            })
    return flagged


# ---------- stage 8: persist ----------

def persist(run_id, workflow_id, run_doc_patch, breaks):
    db.coll("breaks").delete_many({"runId": ObjectId(run_id)})
    if breaks:
        docs = []
        for b in breaks:
            docs.append({
                "runId": ObjectId(run_id),
                "workflowId": ObjectId(workflow_id),
                "period": b.get("period", ""),
                "type": b["type"],
                "key": b["key"],
                "dimension": b.get("dimension", ""),
                "sourcesInvolved": b.get("sourcesInvolved", []),
                "expected": b.get("expected", 0),
                "actual": b.get("actual", 0),
                "variance": b.get("variance", 0),
                "materiality": b.get("materiality", 0),
                "priorityScore": b.get("priorityScore", 0),
                "aiRootCause": b.get("aiRootCause", ""),
                "evidence": b.get("evidence", {}),
                "status": "open",
                "createdAt": datetime.datetime.utcnow(),
                "updatedAt": datetime.datetime.utcnow(),
            })
        db.coll("breaks").insert_many(docs, ordered=False)
    db.coll("runs").update_one({"_id": ObjectId(run_id)}, {"$set": run_doc_patch})


# ---------- main ----------

def reconcile(workflow_id, run_id, period, tolerance=None, max_anomalies=60):
    detector.MAX_ANOMALIES_PER_SOURCE = max_anomalies
    wf = db.coll("workflows").find_one({"_id": ObjectId(workflow_id)})
    if not wf:
        raise ValueError(f"workflow {workflow_id} not found")
    tol = tolerance if tolerance is not None else TOLERANCE_DEFAULT

    loads = _load_sources(workflow_id, wf)
    order = [s["sourceId"] for s in wf.get("sources", []) if s.get("sourceId") in loads]
    if len(order) < 2:
        raise ValueError("At least 2 ingested sources required")

    jm_doc = db.coll("join_maps").find_one({"workflowId": ObjectId(workflow_id), "period": period})
    join_index = build_join_index((jm_doc or {}).get("rows") or [])

    tx_breaks, matched, total_txns = transactional_match(loads, order, tol, period)
    dim_breaks, dim_break, per_source_sums = dimensional_match(loads, order, join_index, tol, period)
    anomalies = anomaly_breaks(loads, order, period)

    all_breaks = tx_breaks + dim_breaks + ([dim_break] if dim_break else []) + anomalies

    period_total = round(sum(r.get("_Amount") or 0.0 for sid in order for r in loads.get(sid, [])), 2)
    all_breaks = score_breaks(all_breaks, period_total, workflow_id)
    _attach_root_cause(all_breaks, period)

    all_breaks.sort(key=lambda b: -b["priorityScore"])
    break_count = len(all_breaks)
    total_union = total_txns
    match_rate = round(matched / total_union, 6) if total_union else 0.0

    counts = {
        "bySource": {sid: len(loads.get(sid, [])) for sid in order},
        "matched": matched,
        "breaks": break_count,
        "anomalies": len(anomalies),
        "totalTransactions": total_union,
    }
    totals = {
        "bySource": {sid: round(sum(r.get("_Amount") or 0.0 for r in loads.get(sid, [])), 2) for sid in order},
        "periodTotal": period_total,
    }

    patch = {
        "counts": counts,
        "matchRate": match_rate,
        "totals": totals,
        "aiMetrics": {
            "transactionalBreaks": len(tx_breaks),
            "dimensionalBreaks": len(dim_breaks) + (1 if dim_break else 0),
            "anomalyFlags": len(anomalies),
        },
        "updatedAt": datetime.datetime.utcnow(),
    }
    persist(run_id, workflow_id, patch, all_breaks)

    return {
        "runId": run_id,
        "workflowId": workflow_id,
        "period": period,
        "matchRate": match_rate,
        "counts": counts,
        "totals": totals,
        "aiMetrics": patch["aiMetrics"],
        "breaksCreated": break_count,
        "summary": {
            "transactionalBreaks": len(tx_breaks),
            "presenceBreaks": len([b for b in tx_breaks if b["evidence"].get("missing_sources")]),
            "valueBreaks": len([b for b in tx_breaks if b["evidence"].get("value_diff_sources")]),
            "dimensionalBreaks": len(dim_breaks) + (1 if dim_break else 0),
            "anomalyFlags": len(anomalies),
            "note": "Anomaly flags are AI suggestions layered on top of deterministic checks.",
        },
        "topBreaks": all_breaks[:20],
    }