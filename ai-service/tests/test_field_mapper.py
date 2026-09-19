"""Tests for the field-mapping scorer."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.mapping import field_mapper  # noqa: E402


def _fld(name, dtype="string", samples=()):
    return {"name": name, "dtype": dtype, "sampleValues": list(samples), "cardinality": len(samples)}


def test_exact_names_are_common():
    srcs = [
        {"sourceId": "GL", "displayName": "GL", "fields": [_fld("Amount", "numeric", ["1", "2"])]},
        {"sourceId": "FA", "displayName": "FA", "fields": [_fld("Amount", "numeric", ["1", "2"])]},
    ]
    out = field_mapper.suggest_mapping(srcs)
    amount = [g for g in out["groups"] if g["targetGroupId"] == "Amount"][0]
    assert amount["status"] == "common"
    assert amount["confidence"] == 1.0
    assert amount["suggestedReconcileField"] is True


def test_id_fields_stay_unassigned():
    srcs = [
        {"sourceId": "GL", "displayName": "GL", "fields": [_fld("gl_account_id", "string", ["ACC0001"])]},
        {"sourceId": "FA", "displayName": "FA", "fields": [_fld("fa_key", "string", ["FA-000001"])]},
    ]
    out = field_mapper.suggest_mapping(srcs)
    assert out["stats"]["uncommon"] == 2
    assert out["groups"] == []


def test_transitive_grouping_across_three_sources():
    srcs = [
        {"sourceId": "A", "displayName": "A", "fields": [_fld("TransactionDate", "date", ["2026-08-01"])]},
        {"sourceId": "B", "displayName": "B", "fields": [_fld("TransactionDate", "date", ["2026-08-01"])]},
        {"sourceId": "C", "displayName": "C", "fields": [_fld("TransactionDate", "date", ["2026-08-01"])]},
    ]
    out = field_mapper.suggest_mapping(srcs)
    groups = [g for g in out["groups"] if g["targetGroupId"] == "TransactionDate"]
    assert groups and len(groups[0]["fields"]) == 3


def test_partial_name_match_is_potential():
    srcs = [
        {"sourceId": "A", "displayName": "A", "fields": [_fld("TransactionDate", "date", ["2026-08-01"])]},
        {"sourceId": "B", "displayName": "B", "fields": [_fld("Transaction Date", "date", ["2026-08-01"])]},
    ]
    out = field_mapper.suggest_mapping(srcs)
    assert out["stats"]["potential"] == 1
    group = out["groups"][0]
    assert group["status"] == "potential"
    assert 0.75 <= group["confidence"] < 0.95


def test_numeric_vs_string_amounts_still_match():
    srcs = [
        {"sourceId": "A", "displayName": "A", "fields": [_fld("Amount", "numeric", ["1", "2"])]},
        {"sourceId": "B", "displayName": "B", "fields": [_fld("Amount", "string", ["1", "2"])]},
    ]
    out = field_mapper.suggest_mapping(srcs)
    amount = [g for g in out["groups"] if g["targetGroupId"] == "Amount"]
    assert amount and amount[0]["status"] in ("common", "potential")