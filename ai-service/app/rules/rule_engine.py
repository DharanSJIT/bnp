"""Generic business-rule interpreter.

Rules are read dynamically from a business_rules.txt-style file:
    RuleID|Field|Type|Params|Description
Types are dispatched through a REGISTRY — never hardcoded per-field if/else.
Unknown or placeholder rule types (e.g. the deliberate R11..R25 dummy rules)
are skipped gracefully, so new rule files/rule types are pluggable with no
code change. Rules that reference fields absent from the data are skipped
(missing-column detection belongs to schema-drift, not the rule engine).
"""
import re
import datetime

REGISTRY = {}


def register(rule_type):
    def deco(fn):
        REGISTRY[rule_type] = fn
        return fn
    return deco


def parse_rules_file(path):
    """Parse a pipe-delimited rules file into rule dicts."""
    rules = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                rid, field, rtype, params, desc = line.split("|", 4)
            except ValueError:
                # tolerate 3-part lines (no description)
                try:
                    rid, field, rtype = line.split("|", 2)
                    params, desc = "", ""
                except ValueError:
                    continue
            rules.append({
                "id": rid.strip(),
                "field": field.strip(),
                "type": rtype.strip().upper(),
                "params": params.strip(),
                "description": desc.strip(),
            })
    return rules


# ---- rule implementations ----

@register("REGEX")
def _regex(rule, value, row):
    if value is None:
        return "value is null"
    pat = rule["params"]
    if pat.endswith("$$"):  # tolerate the file's double-anchor artifact
        pat = pat[:-1]
    if not pat:
        return None
    try:
        return None if re.fullmatch(pat, str(value)) else f"does not match {rule['params']}"
    except re.error:
        return None  # broken pattern → treat as informational, not a failure


@register("DATE")
def _date(rule, value, row):
    if value is None:
        return "value is null"
    fmt = rule["params"] or "%Y-%m-%d"
    try:
        datetime.datetime.strptime(str(value), fmt)
        return None
    except ValueError:
        return f"not a valid {fmt} date"


@register("RANGE")
def _range(rule, value, row):
    if value is None:
        return "value is null"
    try:
        lo, hi = (rule["params"].split(",") + ["", ""])[:2]
        num = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return f"not numeric (range {rule['params']})"
    if lo != "" and num < float(lo):
        return f"{num} < lower bound {lo}"
    if hi != "" and num > float(hi):
        return f"{num} > upper bound {hi}"
    return None


@register("LOOKUP")
def _lookup(rule, value, row):
    if value is None:
        return "value is null"
    allowed = [v.strip() for v in rule["params"].split(",") if v.strip()]
    if not allowed:
        return None
    return None if str(value).strip() in allowed else f"'{value}' not in allowed set"


@register("INGEST")
def _ingest(rule, value, row):
    return None  # capability rule ("INGEST ANY,ANY") — nothing to validate


@register("DEFINE")
def _define(rule, value, row):
    return None  # KEY_SPEC declaration — consumed by the engine, not a checker


@register("AGGREGATE")
def _aggregate(rule, value, row):
    return None  # aggregation instruction (SUM / KEYS=...) — not a checker


REGISTRY["SUM"] = REGISTRY["AGGREGATE"]  # rules files may spell it either way


def check_rule(rule, value, row):
    fn = REGISTRY.get(rule["type"])
    if fn is None:
        return None  # unknown/placeholder type → graceful no-op
    try:
        return fn(rule, value, row)
    except Exception:  # noqa: BLE001 — a broken rule must never crash a load
        return None


def validate_rows(rows, rules):
    """Aggregate rule failures across rows. Returns failures + per-rule stats."""
    failures = {}
    for row in rows:
        for rule in rules:
            if rule["type"] not in REGISTRY:
                continue
            field = rule["field"]
            if field not in row:
                continue  # absent column → schema-drift territory
            reason = check_rule(rule, row.get(field), row)
            if reason:
                key = (rule["id"], field, rule["type"], rule["params"])
                entry = failures.setdefault(key, {
                    "ruleId": rule["id"], "field": field, "type": rule["type"],
                    "params": rule["params"], "count": 0, "sampleValues": [],
                })
                entry["count"] += 1
                if len(entry["sampleValues"]) < 5:
                    entry["sampleValues"].append(str(row.get(field)))
    return list(failures.values())


def rules_summary(rules):
    """Human-useful summary of what a rule set declares."""
    defs = [r for r in rules if r["type"] == "DEFINE"]
    aggs = [r for r in rules if r["type"] in ("AGGREGATE", "SUM")]
    capability = ("INGEST", "DEFINE", "AGGREGATE", "SUM")
    # placeholder detection: catch-all regex rules (e.g. ^.*$ / ^.*$$) that can
    # never fail — the R11..R25 dummy rules in the real file are exactly this.
    placeholder_re = re.compile(r"^\^\.\*\$\$?$")
    placeholders = [r for r in rules if r["type"] == "REGEX" and placeholder_re.match(r["params"] or "")]
    ph_ids = {r["id"] for r in placeholders}
    active = [r for r in rules if r["type"] in REGISTRY and r["type"] not in capability and r["id"] not in ph_ids]
    return {
        "total": len(rules),
        "activeCheckerRules": len(active),
        "capabilityRules": len([r for r in rules if r["type"] in capability]),
        "skippedPlaceholders": len(placeholders) + len([r for r in rules if r["type"] not in REGISTRY]),
        "keySpec": defs[0]["params"] if defs else "",
        "aggregateSpec": aggs[0]["params"] if aggs else "",
        "rules": [{"id": r["id"], "type": r["type"], "field": r["field"], "params": r["params"]} for r in rules],
    }