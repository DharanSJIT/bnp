"""FastAPI entrypoint for the OneRecon AI/data microservice."""
import numpy as np
from bson import ObjectId
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from loguru import logger

from . import db
from .parsers import csv_parser, xml_parser, api_connector
from .rules import rule_engine
from .mapping import field_mapper
from .reconcile import engine
from .anomaly import detector
from .rootcause import explainer
from .chat import copilot

app = FastAPI(title="OneRecon AI/Data Service", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok", "service": "onerecon-ai-service", "version": "1.0.0"}


# ---------- payload models ----------

class ParseFileRequest(BaseModel):
    path: str
    originalName: str = ""
    format: str = "csv"


class IngestApiRequest(BaseModel):
    baseUrl: str
    perPage: int = 500
    testOnly: bool = False
    headers: dict = {}
    timeoutMs: int = 30000
    pageParam: str = "page"
    perPageParam: str = "per_page"
    dataKey: str = "data"
    totalKey: str = "total"
    totalPagesKey: str = "total_pages"
    transactionsPath: str = "/api/ma/transactions"
    healthPath: str = "/api/ma/health"
    summaryPath: str = "/api/ma/summary"
    maxPages: int | None = None


class ValidateRequest(BaseModel):
    workflowId: str
    sourceId: str
    loadId: str
    rulesPath: str
    period: str = ""


class MapFieldsRequest(BaseModel):
    sources: list


class ReconcileRequest(BaseModel):
    workflowId: str
    runId: str
    period: str = ""
    tolerance: float | None = None
    maxAnomalies: int = 60


class RootCauseRequest(BaseModel):
    breakId: str


class AnomalyScanRequest(BaseModel):
    workflowId: str
    sourceId: str
    loadId: str


class ChatRequest(BaseModel):
    workflowId: str
    question: str
    breakId: str | None = None


# ---------- parsing endpoints ----------

@app.post("/ai/parse-file")
def parse_file(req: ParseFileRequest):
    rows = csv_parser.parse_any(req.path, req.format)
    columns = list(rows[0].keys()) if rows else []
    return {
        "rows": rows,
        "columns": columns,
        "sample": rows[:5],
        "stats": {"records": len(rows), "format": req.format, "fileName": req.originalName or req.path.split("/")[-1]},
    }


@app.post("/ai/parse-join-map")
def parse_join_map(req: ParseFileRequest):
    rows = csv_parser.parse_any(req.path, req.format or "csv")
    rows = [{k: (v if v is not None else "") for k, v in r.items()} for r in rows]
    return {"rows": rows, "count": len(rows)}


@app.post("/ai/ingest-api")
async def ingest_api(req: IngestApiRequest):
    try:
        result = await api_connector.ingest_api(
            base_url=req.baseUrl,
            per_page=req.perPage,
            test_only=req.testOnly,
            headers=req.headers,
            timeout_ms=req.timeoutMs,
            page_param=req.pageParam,
            per_page_param=req.perPageParam,
            data_key=req.dataKey,
            total_key=req.totalKey,
            total_pages_key=req.totalPagesKey,
            transactions_path=req.transactionsPath,
            health_path=req.healthPath,
            summary_path=req.summaryPath,
            max_pages=req.maxPages,
        )
        return result
    except Exception as e:  # noqa: BLE001
        logger.error(f"ingest-api failed: {e}")
        raise HTTPException(status_code=502, detail=f"API pull failed: {e}")


# ---------- validation / mapping ----------

@app.post("/ai/validate")
def validate_payload(req: ValidateRequest):
    rows_docs = list(db.coll("raw_transactions").find({
        "workflowId": ObjectId(req.workflowId), "sourceId": req.sourceId, "loadId": req.loadId,
    }))
    rows = [d["row"] for d in rows_docs]

    rules = rule_engine.parse_rules_file(req.rulesPath)
    failures = rule_engine.validate_rows(rows, rules)

    # nulls per field
    nulls = {}
    for row in rows:
        for k, v in row.items():
            if v is None or (isinstance(v, str) and v.strip() == ""):
                nulls[k] = nulls.get(k, 0) + 1

    # outliers on numeric fields (z-score > 3)
    outliers = {}
    numeric_fields = set()
    for row in rows[:4000]:
        for k, v in row.items():
            if isinstance(v, str):
                continue
            try:
                float(v)
                numeric_fields.add(k)
            except (TypeError, ValueError):
                pass
    for fld in numeric_fields:
        vals = []
        for row in rows[:4000]:
            try:
                vals.append(float(row.get(fld)))
            except (TypeError, ValueError):
                continue
        if len(vals) < 10:
            continue
        arr = np.array(vals, dtype=float)
        mu, sd = arr.mean(), arr.std()
        if sd == 0:
            continue
        z = np.abs((arr - mu) / sd)
        outliers[fld] = int((z > 3).sum())

    # schema drift vs previous load
    prev = db.coll("raw_transactions").find_one(
        {"workflowId": ObjectId(req.workflowId), "sourceId": req.sourceId, "loadId": {"$ne": req.loadId}},
        sort=[("createdAt", -1)],
    )
    drift = None
    if prev:
        cur_cols = set(rows[0].keys()) if rows else set()
        prev_cols = set(prev["row"].keys())
        drift = {
            "newColumns": sorted(cur_cols - prev_cols),
            "missingColumns": sorted(prev_cols - cur_cols),
            "previousLoadId": prev["loadId"],
        }

    warnings = []
    if nulls:
        top = ", ".join(f"{k} ({v})" for k, v in sorted(nulls.items(), key=lambda x: -x[1])[:5])
        warnings.append(f"Null/empty values detected: {top}")
    if any(outliers.values()):
        top = ", ".join(f"{k} ({v})" for k, v in outliers.items() if v)
        warnings.append(f"Statistical outliers (|z|>3): {top}")
    if failures:
        warnings.append(f"{sum(f['count'] for f in failures)} rule violations across {len(failures)} rules")
    if drift and (drift["newColumns"] or drift["missingColumns"]):
        warnings.append(
            "Schema drift vs previous load: "
            + ("new " + ",".join(drift["newColumns"]) if drift["newColumns"] else "")
            + ("; missing " + ",".join(drift["missingColumns"]) if drift["missingColumns"] else "")
        )

    return {
        "sourceId": req.sourceId,
        "loadId": req.loadId,
        "totals": {"records": len(rows), "columns": list(rows[0].keys()) if rows else []},
        "nulls": nulls,
        "outliers": outliers,
        "ruleFailures": failures,
        "schemaDrift": drift,
        "warnings": warnings,
        "ruleSummary": rule_engine.rules_summary(rules),
    }


@app.post("/ai/map-fields")
def map_fields(req: MapFieldsRequest):
    return field_mapper.suggest_mapping(req.sources)


# ---------- reconciliation ----------

@app.post("/ai/reconcile")
def reconcile_payload(req: ReconcileRequest):
    try:
        return engine.reconcile(
            workflow_id=req.workflowId,
            run_id=req.runId,
            period=req.period,
            tolerance=req.tolerance,
            max_anomalies=req.maxAnomalies,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.exception("reconcile failed")
        raise HTTPException(status_code=500, detail=f"Reconciliation failed: {e}")


@app.post("/ai/root-cause")
def root_cause_payload(req: RootCauseRequest):
    b = db.coll("breaks").find_one({"_id": ObjectId(req.breakId)})
    if not b:
        raise HTTPException(status_code=404, detail="Break not found")
    rc = explainer.root_cause_for_break(b)
    return {"breakId": str(b["_id"]), "key": b.get("key"), **rc}


@app.post("/ai/anomaly-scan")
def anomaly_scan_payload(req: AnomalyScanRequest):
    docs = list(db.coll("raw_transactions").find({
        "workflowId": ObjectId(req.workflowId), "sourceId": req.sourceId, "loadId": req.loadId,
    }))
    rows = [{"TransactionID": d["row"].get("TransactionID"), "Amount": d["row"].get("Amount")} for d in docs]
    flags = detector.scan_source(rows)
    return {"sourceId": req.sourceId, "loadId": req.loadId, "flags": flags, "count": len(flags)}


# ---------- copilot / stretch ----------

@app.post("/ai/chat")
def chat_payload(req: ChatRequest):
    return copilot.answer(req.workflowId, req.question, break_id=req.breakId)


class PredictRequest(BaseModel):
    workflowId: str
    period: str = ""


@app.post("/ai/predict-breaks")
def predict_breaks(req: PredictRequest):
    # Phase 6 stretch — deterministic placeholder that never blocks a demo.
    historical = list(db.coll("breaks").aggregate([
        {"$match": {"workflowId": ObjectId(req.workflowId)}},
        {"$group": {"_id": "$key", "periods": {"$sum": 1}}},
        {"$sort": {"periods": -1}},
        {"$limit": 10},
    ]))
    return {
        "note": "Predictive break flags are a Phase 6 stretch goal; returning historical-frequency signal only.",
        "frequentBreakers": [{"key": h["_id"], "periodsBroken": h["periods"]} for h in historical],
    }