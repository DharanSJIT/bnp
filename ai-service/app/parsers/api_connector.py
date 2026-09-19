"""Paginated REST connector for the MA report API.

Contract (matches the provided ma_api_server_YYYYMM.py exactly):
  GET {base}/api/ma/health          -> {"status","service","period"}
  GET {base}/api/ma/summary         -> {"period","total_records","total_amount","avg_amount"}
  GET {base}/api/ma/transactions?page=&per_page=  -> {"data":[...],"total","page","per_page","total_pages"}

The connector pages until page == total_pages, casts Amount (string -> float)
per the SRS, and survives per-page errors (retries, then records them) rather
than aborting the whole pull.
"""
import requests


async def ingest_api(base_url, per_page=500, test_only=False, headers=None,
                     timeout_ms=30000, page_param="page", per_page_param="per_page",
                     data_key="data", total_key="total", total_pages_key="total_pages",
                     transactions_path="/api/ma/transactions",
                     health_path="/api/ma/health", summary_path="/api/ma/summary",
                     max_pages=None):
    base = (base_url or "").rstrip("/")
    headers = headers or {}
    timeout = max(timeout_ms / 1000.0, 1) if timeout_ms else 30

    def get(url, **kw):
        return requests.get(url, headers=headers, timeout=timeout, **kw)

    health = None
    summary = None
    try:
        r = get(f"{base}{health_path}")
        r.raise_for_status()
        health = r.json()
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"Health check failed for {base}: {e}")

    try:
        r = get(f"{base}{summary_path}")
        if r.ok:
            summary = r.json()
    except Exception:  # noqa: BLE001
        summary = None

    if test_only:
        return {
            "ok": True,
            "health": health,
            "summary": summary,
            "period": summary.get("period", health.get("period", "")),
        }

    # first page to learn total_pages
    r = get(f"{base}{transactions_path}", params={page_param: 1, per_page_param: per_page})
    r.raise_for_status()
    first = r.json()
    rows = list(first.get(data_key) or [])
    total = first.get(total_key, 0)
    total_pages = int(first.get(total_pages_key, 1))
    if max_pages:
        total_pages = min(total_pages, int(max_pages))

    pages = 1
    errors = []
    page = 2
    while page <= total_pages:
        ok = False
        for attempt in range(3):
            try:
                r = get(f"{base}{transactions_path}", params={page_param: page, per_page_param: per_page})
                r.raise_for_status()
                body = r.json()
                rows.extend(body.get(data_key) or [])
                ok = True
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
        if not ok:
            errors.append({"page": page, "error": str(last_err)})
        page += 1
        pages += 1

    # normalize: cast Amount string -> float (SRS consequence #1)
    cast_errors = 0
    for row in rows:
        amt = row.get("Amount")
        if isinstance(amt, str):
            try:
                row["Amount"] = float(amt)
            except (TypeError, ValueError):
                cast_errors += 1
                row["Amount"] = None

    return {
        "rows": rows,
        "pages": pages,
        "total": len(rows),
        "reported_total": total,
        "period": first.get("period", summary.get("period", "")),
        "sample": rows[:5],
        "errors": errors,
        "cast_errors": cast_errors,
    }