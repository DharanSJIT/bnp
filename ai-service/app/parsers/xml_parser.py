"""XML parser for <GLReport><Transaction>… file shape.

Extracts root attributes (source/period) and every child element of each
<Transaction> as a flat dict. Unknown/malformed transactions are skipped and
counted — never fatal.
"""
import xml.etree.ElementTree as ET

TRANSACTION_TAG = "Transaction"


def parse_xml(path):
    tree = ET.parse(path)
    root = tree.getroot()
    attrs = dict(root.attrib or {})
    rows = []
    skipped = 0
    for child in root:
        if child.tag != TRANSACTION_TAG:
            continue
        row = {}
        for field in child:
            row[field.tag] = (field.text or "").strip()
        if row:
            rows.append(row)
        else:
            skipped += 1
    return rows


def parse_xml_with_meta(path):
    tree = ET.parse(path)
    root = tree.getroot()
    attrs = dict(root.attrib or {})
    rows = parse_xml(path)
    return rows, attrs