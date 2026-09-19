"""Rebuild a clean, demo-ready OneRecon state.

Wipes workflows/runs/breaks/mappings/join-maps/raw transactions for the demo
user, then builds ONE configured August-2026 workflow:
  ingest GL (xml) + MA (REST pull, :5001) + FA (csv) -> validate all sources ->
  acknowledge gate -> AI mapping suggestions (Amount marked as reconcile field)
  -> upload join map -> run reconciliation.

Usage (backend, ai-service and the august MA server must already be running):
    python ai-service/.venv/bin/python scripts/seed_demo.py
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
EMAIL = "investigator@onerecon.io"
PASSWORD = "Invest@123"
NAME = "OneRecon Demo — August 2026 GL·MA·FA"


def call(method, path, body=None, token=None, raw=False, timeout=600):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read()
            return payload if raw else json.loads(payload)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:400]}")


def multipart(path, url, token, field="file", timeout=600):
    boundary = "----onereconboundary"
    name = os.path.basename(path)
    ctype = {"xml": "application/xml", "csv": "text/csv", "txt": "text/plain"}.get(name.split(".")[-1], "application/octet-stream")
    with open(path, "rb") as fh:
        content = fh.read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{name}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(BASE + url, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                                          "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def main():
    token = call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})["token"]
    print("[1] logged in as", EMAIL)

    # wipe previous demo workflows for this user
    wfs = call("GET", "/api/workflows", None, token)["workflows"]
    for w in wfs:
        call("DELETE", f"/api/workflows/{w['_id']}", None, token)
    print(f"[2] wiped {len(wfs)} previous workflows")

    r = call("POST", "/api/workflows", {
        "name": NAME, "period": "202608",
        "sources": [
            {"sourceId": "GL", "displayName": "GL", "ingestionType": "file"},
            {"sourceId": "MA", "displayName": "MA", "ingestionType": "api", "config": {"baseUrl": MA_URL}},
            {"sourceId": "FA", "displayName": "FA", "ingestionType": "file"},
        ],
    }, token)
    wid = str(r["workflow"]["_id"])
    print(f"[3] workflow created: {NAME} ({wid})")

    gl = multipart(f"{DATA}/gl_report_202608.xml", f"/api/workflows/{wid}/sources/GL/upload", token)
    fa = multipart(f"{DATA}/fa_report_202608.csv", f"/api/workflows/{wid}/sources/FA/upload", token)
    ma = call("POST", f"/api/workflows/{wid}/sources/MA/api-ingest", {"baseUrl": MA_URL, "perPage": 500}, token)
    print(f"[4] ingested GL={gl['recordsLoaded']} MA={ma['recordsLoaded']} FA={fa['recordsLoaded']}")

    loads = {"GL": gl["loadId"], "MA": ma["loadId"], "FA": fa["loadId"]}
    for sid in ("GL", "MA", "FA"):
        v = call("POST", f"/api/workflows/{wid}/validate", {"sourceId": sid, "loadId": loads[sid], "rulesPath": RULES}, token)
        print(f"[5] validate {sid}: {v['totals']['records']} rows | failures={len(v['ruleFailures'])} | warnings={len(v['warnings'])}")
    call("POST", f"/api/workflows/{wid}/acknowledge-validation", {}, token)
    print("[6] validation acknowledged")

    sug = call("GET", f"/api/workflows/{wid}/mapping-suggestions", None, token)
    groups = sug["groups"]
    for g in groups:
        if g["targetGroupId"].lower() == "amount":
            g["isReconcileField"] = True
    call("PUT", f"/api/workflows/{wid}/mappings", {"mappings": groups}, token)
    print(f"[7] saved {len(groups)} mapping groups (Amount = reconcile field)")

    jm = multipart(f"{DATA}/join_map.txt", f"/api/workflows/{wid}/mappings/upload-join-map", token)
    print(f"[8] join map uploaded ({jm['rows']} rows)")

    t0 = time.time()
    r = call("POST", f"/api/workflows/{wid}/run", {}, token, timeout=900)
    run = r["run"]
    print(f"[9] run finished in {time.time() - t0:.1f}s: status={run['status']} matchRate={round(run['matchRate'] * 100, 2)}% "
          f"breaks={run['counts']['breaks']} anomalies={run['counts']['anomalies']}")
    print(f"    summary={json.dumps(r['summary'])}")

    print(f"\nDemo ready. Open the UI and load workflow: {wid} | last run: {run['_id']}")


if __name__ == "__main__":
    main()