"""Tests for the dynamic business-rule interpreter."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.rules import rule_engine  # noqa: E402

RULES_FILE = Path(__file__).resolve().parent.parent.parent / "business_rules.txt"


def test_parses_real_rules_file():
    rules = rule_engine.parse_rules_file(str(RULES_FILE))
    assert len(rules) >= 25
    ids = [r["id"] for r in rules]
    assert "R01" in ids and "R10" in ids and "R25" in ids


def test_dummy_placeholder_rules_are_noops():
    rules = rule_engine.parse_rules_file(str(RULES_FILE))
    dummy = [r for r in rules if r["field"].startswith("DummyField")]
    assert len(dummy) == 15
    # none of them must ever fire a violation (^.*$ matches everything)
    row = {f"DummyField{i}": ["anything", "", 123, "x"][i % 4] for i in range(1, 16)}
    failures = rule_engine.validate_rows([row], dummy)
    assert failures == []


def test_regex_rule_with_double_dollar_artifact():
    rules = [{"id": "R1", "field": "TransactionID", "type": "REGEX", "params": "^[A-F0-9]{16}$$", "description": ""}]
    ok = rule_engine.validate_rows([{"TransactionID": "9E8A808F82034E32"}], rules)
    bad = rule_engine.validate_rows([{"TransactionID": "not-hex!"}], rules)
    assert ok == []
    assert bad[0]["ruleId"] == "R1" and bad[0]["count"] == 1


def test_real_rules_catch_violations():
    rules = rule_engine.parse_rules_file(str(RULES_FILE))
    rows = [
        {"TransactionID": "ZZZZZZZZZZZZZZZZ", "TransactionDate": "2026-13-45", "Amount": -5,
         "Currency": "XXX", "Country": "ZZ", "Description": "x"},
        {"TransactionID": "9E8A808F82034E32", "TransactionDate": "2026-08-23", "Amount": 40000,
         "Currency": "JPY", "Country": "DE", "Description": "Valid row"},
    ]
    failures = rule_engine.validate_rows(rows, rules)
    by_rule = {f["ruleId"]: f["count"] for f in failures}
    assert by_rule["R01"] == 1   # bad hex
    assert by_rule["R03"] == 1   # bad date
    assert by_rule["R04"] == 1   # negative amount
    assert by_rule["R05"] == 1   # currency XXX
    assert by_rule["R06"] == 1   # country ZZ
    assert by_rule["R07"] == 1   # description too short


def test_unknown_rule_type_is_skipped_gracefully():
    rules = [{"id": "X1", "field": "Amount", "type": "BOGUS-TYPE", "params": "1", "description": ""}]
    assert rule_engine.validate_rows([{"Amount": 5}], rules) == []


def test_absent_field_means_no_rule_failure():
    rules = [{"id": "R1", "field": "MissingField", "type": "REGEX", "params": "^x$", "description": ""}]
    assert rule_engine.validate_rows([{"Other": 1}], rules) == []


def test_rule_summary_counts_placeholders():
    rules = rule_engine.parse_rules_file(str(RULES_FILE))
    s = rule_engine.rules_summary(rules)
    assert s["total"] == 25
    assert s["activeCheckerRules"] == 7  # R01-R07
    assert s["skippedPlaceholders"] == 15
    assert "GL:gl_account_id" in s["keySpec"]