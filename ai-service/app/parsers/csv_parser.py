"""CSV / XLSX / JSON data file parsers -> list-of-dict rows.

Values are normalized: NaN -> None, numeric strings stay strings (the engine
casts Amount explicitly), dates stay ISO strings. Parsers never throw on a bad
row — malformed rows are collected and reported, not fatal (resilience).
"""
import json
import math


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, str) and v.strip() == "":
        return None
    return v


def parse_csv(path):
    import pandas as pd

    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    rows = [ {k: _clean(v) for k, v in r.items()} for r in df.to_dict(orient="records") ]
    return rows


def parse_xlsx(path):
    import pandas as pd

    df = pd.read_excel(path, dtype=str)
    rows = [ {k: _clean(v) for k, v in r.items()} for r in df.to_dict(orient="records") ]
    return rows


def parse_json(path):
    raw = json.load(open(path, encoding="utf-8"))
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        # tolerate {data: [...]} / {transactions: [...]} wrappers
        for key in ("data", "transactions", "rows", "results"):
            if isinstance(raw.get(key), list):
                items = raw[key]
                break
        else:
            items = [raw]
    else:
        items = []
    rows = [ {k: _clean(v) for k, v in r.items()} for r in items if isinstance(r, dict) ]
    return rows


def parse_any(path, format_hint=None):
    """Dispatch by extension + content sniff."""
    ext = str(format_hint or "").lower() if format_hint else ""
    if not ext and "." in path:
        ext = path.rsplit(".", 1)[-1].lower()
    if ext == "xlsx" or ext == "xls":
        return parse_xlsx(path)
    if ext == "json":
        return parse_json(path)
    if ext == "xml":
        from .xml_parser import parse_xml
        return parse_xml(path)
    # csv/txt default
    return parse_csv(path)