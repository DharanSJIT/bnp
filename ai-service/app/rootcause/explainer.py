"""Deterministic root-cause generation.

Runs a decision tree of explainers over the structured facts gathered for a
break and renders natural language. The deterministic explainer is the source
of truth — evidence is always attached, so no "black box" verdicts.
"""
import re


def explain(break_row, facts):
    """break_row: the break dict (key/type/expected/actual/variance...).
    facts: dict with optional keys:
        missing_sources, present_sources, is_duplicate, duplicate_source,
        dup_count, unmapped_key, unmapped_value, value_diff_sources,
        near_month_end, month_end_source, currency_diff, currencies,
        is_anomaly, anomaly_col, deviation, source_pair, period, txn_id
    """
    reasons = []
    evidence = dict(facts or {})
    b = break_row

    if facts.get("is_anomaly"):
        reasons.append(
            f"Statistical outlier: {facts.get('anomaly_col', 'Amount')} value "
            f"{b.get('actual', b.get('value'))} deviates {facts.get('deviation', '')} from the "
            f"source distribution (IsolationForest flag) — no hard rule violated."
        )

    if facts.get("unmapped_key"):
        reasons.append(
            f"{facts['unmapped_value']} for key {facts['unmapped_key']} has no effective mapping in "
            f"join_map for period {facts.get('period', '?')} — the row was excluded from dimensional totals."
        )

    if facts.get("is_duplicate"):
        reasons.append(
            f"Duplicate {facts.get('dup_count')} occurrences of key {b.get('key')} inside "
            f"{facts.get('duplicate_source', 'one source')} — duplicate key inflates the aggregate."
        )

    missing = facts.get("missing_sources") or []
    present = facts.get("present_sources") or []
    if missing and b["type"] == "transactional":
        why = []
        if facts.get("near_month_end"):
            why.append("posting occurs near period end (date boundary), which suggests a timing/late-posting difference")
        if facts.get("currency_diff"):
            why.append(f"currency mismatch ({', '.join(facts.get('currencies') or [])})")
        reasons.append(
            f"Transaction {b.get('key')} exists in {', '.join(present) if present else 'the other systems'} "
            f"but is absent from {', '.join(missing)}. {('; '.join(why) + '.') if why else 'Possible exclusion, late posting, or a system-specific filter in the missing system(s).'}"
        )

    if facts.get("value_diff_sources"):
        reasons.append(
            f"Value break across {', '.join(facts['value_diff_sources'])}: expected {b.get('expected')} vs actual "
            f"{b.get('actual')} (variance {b.get('variance')}). Likely FX conversion timing, adjustment posting, "
            f"or reclassification between systems."
        )

    if facts.get("unmapped_dimensional"):
        reasons.append(
            f"{facts['unmapped_dimensional']['count']} rows could not be resolved to the join map "
            f"(top keys: {', '.join(facts['unmapped_dimensional'].get('top_keys', [])[:5]) or 'n/a'}) and are "
            f"excluded from account aggregates — check join_map coverage for period {facts.get('period', '?')}."
        )

    if not reasons:
        reasons.append("No deterministic explainer fired for this break — review the raw evidence below.")

    sentence = " ".join(reasons)
    return {
        "summary": sentence,
        "confidence": "high" if facts.get("unmapped_key") or facts.get("is_duplicate") or facts.get("missing_sources") else "medium",
        "explainers": [r for r in reasons],
        "evidence": evidence,
    }


def root_cause_for_break(break_row, extra_facts=None):
    facts = dict(break_row.get("evidence") or {})
    if extra_facts:
        facts.update(extra_facts)
    return explain(break_row, facts)