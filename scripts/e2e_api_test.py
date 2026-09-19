"""End-to-end API smoke test for OneRecon (backend :4000 + AI service :8000).

Runs the full flow against the August dataset:
  login -> create workflow -> ingest GL/MA/FA -> validate -> acknowledge ->
  mapping suggestions -> upload join map -> save mappings -> preview -> run ->
  breaks -> report export -> compare.

Usage: .venv/bin/python scripts/e2e_api_test.py   (from repo root, ai-service venv)
Requires: backend, ai-service, MA server on :5001, MongoDB.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE = os.environ.get("API_URL", "http://127.0.0.1:4000")
DATA = "/Volumes/Placement/one-recon/Current Data/august"
RULES = "/Volumes/Placement/one-recon/backend/uploads/business_rules.txt"
MA_URL = os.environ.get("MA_URL", "http://127.0.0.1:5001")

TOKEN = None


def call(method, path, body=None, token=None, raw=False):
    url = BASE + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            payload = resp.read()
            return payload if raw else json.loads(payload)
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:600]
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {detail}")


def upload(path, field="file", token=None):
    import mimetypes
    boundary = "----onereconboundary"
    filename = os.path.basename(path)
    ctype, _ = mimetypes.guess_type(path)
    with open(path, "rb") as fh:
        content = fh.read()
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {ctype or 'application/octet-stream'}\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        BASE + "/none", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    # use a generic uploader through urllib (reuse call with raw bytes)
    raise NotImplementedError("use multipart helper below")


def main():
    global TOKEN
    # 1. login
    r = call("POST", "/api/auth/login", {"email": "investigator@onerecon.io", "password": "Invest@123"})
    TOKEN = r["token"]
    print("[1] login OK:", r["user"]["email"], r["user"]["role"])

    # 2. create workflow (unique name per run)
    r = call("POST", "/api/workflows", {
        "name": f"Aug 2026 GL-MA-FA Recon {int(time.time())}",
        "period": "202608",
        "sources": [
            {"sourceId": "GL", "displayName": "GL", "ingestionType": "file"},
            {"sourceId": "MA", "displayName": "MA", "ingestionType": "api", "config": {"baseUrl": MA_URL}},
            {"sourceId": "FA", "displayName": "FA", "ingestionType": "file"},
        ],
    }, TOKEN)
    wf = r["workflow"]
    wid = str(wf["_id"])
    print(f"[2] workflow created: {wf['name']} ({wid})")

    # 3. ingest GL xml
    with open(f"{DATA}/gl_report_202608.xml", "rb") as fh:
        content = fh.read()
    boundary = "----onereconboundary"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"gl_report_202608.xml\"\r\n"
            f"Content-Type: application/xml\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        BASE + f"/api/workflows/{wid}/sources/GL/upload", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Authorization": f"Bearer {TOKEN}"},
        method="POST")
    with urllib.request.urlopen(req, timeout=300) as resp:
        gl = json.loads(resp.read())
    print(f"[3] GL ingested: {gl['recordsLoaded']} rows ({gl['timeTakenMs']}ms)")
    gl_load = gl["loadId"]

    # FA csv
    with open(f"{DATA}/fa_report_202608.csv", "rb") as fh:
        content = fh.read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"fa_report_202608.csv\"\r\n"
            f"Content-Type: text/csv\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        BASE + f"/api/workflows/{wid}/sources/FA/upload", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Authorization": f"Bearer {TOKEN}"},
        method="POST")
    with urllib.request.urlopen(req, timeout=300) as resp:
        fa = json.loads(resp.read())
    print(f"[4] FA ingested: {fa['recordsLoaded']} rows ({fa['timeTakenMs']}ms)")
    fa_load = fa["loadId"]

    # MA api pull
    r = call("POST", f"/api/workflows/{wid}/sources/MA/api-ingest", {"baseUrl": MA_URL, "perPage": 500}, TOKEN)
    print(f"[5] MA ingested: {r['recordsLoaded']} rows in {r['pages']} pages ({r['timeTakenMs']}ms)")
    ma_load = r["loadId"]

    # 6. validate each source
    loads = {"GL": gl_load, "MA": ma_load, "FA": fa_load}
    for sid in ("GL", "MA", "FA"):
        r = call("POST", f"/api/workflows/{wid}/validate", {"sourceId": sid, "loadId": loads[sid], "rulesPath": RULES}, TOKEN)
        warn = "; ".join(r.get("warnings") or [])
        print(f"[6] validate {sid}: {r['totals']['records']} rows, failures={len(r['ruleFailures'])}, warnings: {warn or 'none'}")
        with open(f"/tmp/onerecon_validate_{sid}.json", "w") as fh:
            json.dump(r, fh, indent=2, default=str)

    r = call("POST", f"/api/workflows/{wid}/acknowledge-validation", {}, TOKEN)
    print("[7] validation acknowledged:", r["acknowledged"])

    # 8. mapping suggestions
    r = call("GET", f"/api/workflows/{wid}/mapping-suggestions", None, TOKEN)
    groups = r.get("groups", [])
    print(f"[8] mapping suggestions: {len(groups)} groups, stats={r.get('stats')}")
    with open("/tmp/onerecon_mapping_suggestions.json", "w") as fh:
        json.dump(r, fh, indent=2, default=str)

    # 9. upload join map
    with open(f"{DATA}/join_map.txt", "rb") as fh:
        content = fh.read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"join_map.txt\"\r\n"
            f"Content-Type: text/plain\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        BASE + f"/api/workflows/{wid}/mappings/upload-join-map", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Authorization": f"Bearer {TOKEN}"},
        method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        jm = json.loads(resp.read())
    print(f"[9] join map uploaded: {jm['rows']} rows")

    # 10. save mappings (AI groups + ensure Amount reconcile)
    for g in groups:
        if g["targetGroupId"].lower() == "amount":
            g["isReconcileField"] = True
    r = call("PUT", f"/api/workflows/{wid}/mappings", {"mappings": groups, "joinMapFileId": ""}, TOKEN)
    print(f"[10] mappings saved ({len(r['mapping']['mappings'])} groups)")

    # 11. preview
    r = call("GET", f"/api/workflows/{wid}/preview", None, TOKEN)
    print(f"[11] preview: {len(r['aligned'])} aligned groups, {len(r['warnings'])} warnings")

    # 12. run reconciliation
    t0 = time.time()
    r = call("POST", f"/api/workflows/{wid}/run", {}, TOKEN)
    dt = time.time() - t0
    run = r["run"]
    print(f"[12] run completed in {dt:.1f}s: status={run['status']}, matchRate={run['matchRate']}, counts={run['counts']}")
    print(f"     summary={json.dumps(r.get('summary'))}")
    run_id = str(run["_id"])

    # 13. breaks
    r = call("GET", f"/api/runs/{run_id}/breaks?limit=10", None, TOKEN)
    print(f"[13] breaks: total={r['total']}, byType={r['stats']['byType']}, byStatus={r['stats']['byStatus']}")
    if r["breaks"]:
        b = r["breaks"][0]
        print(f"     top break: {b['type']} key={b['key']} variance={b['variance']} priority={b['priorityScore']}\n     root cause: {b['aiRootCause'][:180]}")

    # 14. report export (xlsx)
    raw = call("GET", f"/api/reports/{run_id}/export?format=xlsx", None, TOKEN, raw=True)
    print(f"[14] xlsx export: {len(raw)} bytes")

    # 15. compare cross-system GL vs FA by gl_account_id
    r = call("POST", "/api/reports/compare", {
        "workflowId": wid, "mode": "cross-system",
        "a": {"sourceId": "GL"}, "b": {"sourceId": "FA"}, "groupBy": "gl_account_id",
    }, TOKEN)
    print(f"[15] compare GL vs FA: grand A={r['grand']['a']}, grand B={r['grand']['b']}, variance={r['grand']['variance']}, breaking groups={r['breakingCount']}")
    print(f"     exec summary: {r['execSummary'][:200]}")

    # 16. copilot
    r = call("POST", "/api/breaks/0/chat", {"question": "why do breaks exist?"}, TOKEN) if False else None
    r2 = call("POST", "/api/workflows/0/none", {}, None, TOKEN) if False else None
    print("[16] done. workflow id:", wid, "| run id:", run_id)
    with open("/tmp/onerecon_e2e_result.json", "w") as fh:
        json.dump({"workflowId": wid, "runId": run_id}, fh)


if __name__ == "__main__":
    main()