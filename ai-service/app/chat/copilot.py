"""Grounded NLP copilot (deterministic, offline).

Answers questions with real data pulled from Mongo — sums, break counts,
dimension aggregates. Every answer carries `evidence` (the actual rows/numbers
used). If the question cannot be grounded, it says so instead of guessing.

No external LLM required: keyword + pattern routing over retrieved data.
"""
import re
from bson import ObjectId
from .. import db


def _fmt(n):
    try:
        return f"{float(n):,.2f}"
    except (TypeError, ValueError):
        return str(n)


def _latest_run(workflow_id):
    return db.coll("runs").find_one({"workflowId": ObjectId(workflow_id), "status": "success"}, sort=[("startedAt", -1)])


def _break_stats(workflow_id, run_id):
    pipeline = [
        {"$match": {"workflowId": ObjectId(workflow_id), "runId": ObjectId(run_id)}},
        {"$group": {"_id": "$type", "count": {"$sum": 1}}},
    ]
    by_type = {d["_id"]: d["count"] for d in db.coll("breaks").aggregate(pipeline)}
    return by_type


def _dimension_compare(workflow_id, run_id, dim="gl_account_id", top=5):
    """Top accounts by |variance| among dimensional breaks of a run."""
    docs = db.coll("breaks").find(
        {"runId": ObjectId(run_id), "type": "dimensional", "dimension": dim}
    ).sort("priorityScore", -1).limit(top)
    return [{"key": d["key"], "expected": d["expected"], "actual": d["actual"], "variance": d["variance"]} for d in docs]


def _break_by_key(workflow_id, key):
    return db.coll("breaks").find_one({"workflowId": ObjectId(workflow_id), "key": key}, sort=[("createdAt", -1)])


def answer(workflow_id, question, break_id=None):
    question = (question or "").strip()
    if not question:
        return {"answer": "Ask me about breaks, totals, or why two systems differ.", "evidence": []}

    q = question.lower()
    evidence = []
    run = _latest_run(workflow_id)
    if not run:
        return {
            "answer": "No successful reconciliation run exists yet for this workflow — run one first so I have data to ground answers in.",
            "evidence": [],
        }
    run_id = run["_id"]
    wf = db.coll("workflows").find_one({"_id": ObjectId(workflow_id)})
    period = wf.get("period", run.get("period", "?"))

    # 1) scope to a single break if a break id was provided
    if break_id:
        b = db.coll("breaks").find_one({"_id": ObjectId(break_id)})
        if b:
            answer_txt = (
                f"Break {b['_id']} ({b['type']}) on key {b['key']}: expected {_fmt(b.get('expected'))} vs actual "
                f"{_fmt(b.get('actual'))} (variance {_fmt(b.get('variance'))}, materiality {round((b.get('materiality') or 0) * 100, 4)}%). "
                f"AI root cause: {b.get('aiRootCause') or 'n/a'}."
            )
            evidence.append({"entity": "break", "id": str(b["_id"]), "key": b["key"], "status": b["status"]})
            return {"answer": answer_txt, "evidence": evidence}

    by_type = _break_stats(workflow_id, run_id)

    if any(k in q for k in ("total", "sum", "amount", "foot", "grand")):
        totals = run.get("totals") or {}
        bs = totals.get("bySource") or {}
        names = {s["sourceId"]: s["displayName"] for s in wf.get("sources", [])}
        parts = [f"{names.get(k, k)} {_fmt(v)}" for k, v in bs.items()]
        answer_txt = f"For period {period}, totals are: " + "; ".join(parts) + (
            f". Period total {_fmt(totals.get('periodTotal'))}." if totals.get("periodTotal") is not None else ""
        )
        evidence.append({"entity": "run-totals", "period": period, "bySource": bs})
        return {"answer": answer_txt, "evidence": evidence}

    if any(k in q for k in ("why", "break", "difference", "mismatch", "not match", "variance", "reconcil")):
        cnt = sum(by_type.values())
        dims = _dimension_compare(workflow_id, run_id)
        dim_txt = ""
        if dims:
            dim_txt = " Largest dimensional variances: " + "; ".join(
                f"{d['key']} (expected {_fmt(d['expected'])} vs actual {_fmt(d['actual'])}, variance {_fmt(d['variance'])})" for d in dims
            ) + "."
        meta_acc = None
        for d in dims:
            if any(acc in q for acc in (d["key"].lower(), d["key"].replace("acc", ""))):
                meta_acc = d
                break
        if meta_acc:
            answer_txt = (
                f"Account {meta_acc['key']} shows a dimensional break: expected {_fmt(meta_acc['expected'])} vs "
                f"actual {_fmt(meta_acc['actual'])} (variance {_fmt(meta_acc['variance'])}). "
                f"This means the summed amounts across systems disagree for this account — check the per-source "
                f"totals in the break evidence and the join-map coverage for period {period}."
            )
            evidence.append({"entity": "dimensional-break", **meta_acc})
            return {"answer": answer_txt, "evidence": evidence}
        answer_txt = (
            f"Period {period}: {cnt} breaks across the {len(wf.get('sources', []))} sources "
            f"({by_type.get('transactional', 0)} transactional, {by_type.get('dimensional', 0)} dimensional, "
            f"{by_type.get('anomalies', 0)} anomaly flags). Match rate {round((run.get('matchRate') or 0) * 100, 2)}%.{dim_txt}"
        )
        evidence.append({"entity": "break-summary", "byType": by_type, "matchRate": run.get("matchRate"), "topDimensional": dims})
        return {"answer": answer_txt, "evidence": evidence}

    if any(k in q for k in ("match rate", "matched", "reconciled", "health", "status")):
        counts = run.get("counts") or {}
        answer_txt = (
            f"Match rate for period {period} is {round((run.get('matchRate') or 0) * 100, 2)}% "
            f"({counts.get('matched')} of {counts.get('totalTransactions')} transactions matched across all sources; "
            f"{counts.get('breaks')} breaks)."
        )
        evidence.append({"entity": "run", "matchRate": run.get("matchRate"), "counts": counts})
        return {"answer": answer_txt, "evidence": evidence}

    if any(k in q for k in ("account", "acc", "deposit", "commercial", "segment", "entity")):
        dims = _dimension_compare(workflow_id, run_id, top=8)
        answer_txt = (
            f"Here are the top dimensional breaks by priority for period {period}: "
            + ("; ".join(f"{d['key']}: {_fmt(d['variance'])} variance" for d in dims) if dims else "none found.")
        )
        evidence.append({"entity": "top-dimensional", "rows": dims})
        return {"answer": answer_txt, "evidence": evidence}

    # default: grounded overview + scope guidance
    answer_txt = (
        f"I can answer grounded questions about this workflow's period-{period} data: totals/sums per source, "
        f"break counts and why they occurred, top problem accounts, and match-rate status. "
        f"Currently: {by_type.get('transactional', 0)} transactional and {by_type.get('dimensional', 0)} dimensional breaks."
    )
    evidence.append({"entity": "capability", "period": period, "byType": by_type})
    return {"answer": answer_txt, "evidence": evidence}