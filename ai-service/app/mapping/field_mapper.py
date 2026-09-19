"""NLP-assisted cross-source field mapping.

Scoring pipeline per field pair:
  1. exact name match (case-insensitive)         -> 1.0
  2. rapidfuzz token_set ratio on names          -> 0..1
  3. data-profile similarity (dtype + value-set / regex-shape overlap) -> 0..1
Combined confidence = max(name-based, profile-based) with token-set blending.

Groups are built transitively across N sources (not pairwise-only), and every
suggestion carries its own evidence so the UI can show *why* (explainability).
"""
from rapidfuzz import fuzz

COMMON_THRESHOLD = 0.95
POTENTIAL_THRESHOLD = 0.75


def _normalize(name):
    return re_sub(name).strip().lower()


def re_sub(name):
    import re
    s = str(name)
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return s.strip()


def _name_sim(a, b):
    if a.lower() == b.lower():
        return 1.0
    na, nb = _normalize(a), _normalize(b)
    if not na or not nb:
        return 0.0
    return fuzz.token_set_ratio(na, nb) / 100.0


def _shape(sample):
    """Regex-shape fingerprint of a value set, e.g. 'XXXX-XXXX' or 'AA####'."""
    import re
    seen = set()
    for v in sample[:20]:
        s = str(v)
        if not s:
            continue
        out = []
        for ch in s:
            if ch.isdigit():
                out.append("#")
            elif ch.isalpha():
                out.append("A")
            else:
                out.append(ch)
        seen.add("".join(out))
    return seen


def _profile_sim(a, b):
    if a["dtype"] != b["dtype"]:
        # numeric-vs-string can still match when shapes coincide (e.g. IDs)
        base = 0.35
    else:
        base = 0.6
    overlap = 0.0
    av, bv = set(map(str, a.get("sampleValues") or [])), set(map(str, b.get("sampleValues") or []))
    if av and bv:
        union = av | bv
        if union:
            overlap = len(av & bv) / len(union)
    shape_a, shape_b = _shape(a.get("sampleValues") or []), _shape(b.get("sampleValues") or [])
    shape_overlap = 1.0 if shape_a and shape_b and shape_a == shape_b else (
        len(shape_a & shape_b) / len(shape_a | shape_b) if (shape_a | shape_b) else 0.0
    )
    return min(1.0, base + 0.25 * overlap + 0.15 * shape_overlap)


def _pair_score(a, b):
    name = _name_sim(a["name"], b["name"])
    profile = _profile_sim(a, b)
    if name >= 1.0:
        combined = 1.0
    else:
        combined = 0.55 * name + 0.45 * profile
    evidence = {
        "nameSimilarity": round(name, 3),
        "profileSimilarity": round(profile, 3),
        "dtypeA": a["dtype"], "dtypeB": b["dtype"],
        "shapeMatch": _shape(a.get("sampleValues") or []) == _shape(b.get("sampleValues") or []) if (a.get("sampleValues") and b.get("sampleValues")) else False,
    }
    return min(1.0, max(0.0, combined)), evidence


def suggest_mapping(sources):
    """sources: [{sourceId, displayName, fields: [{name, dtype, sampleValues, cardinality}]}]"""
    # flatten with index
    all_fields = []
    for src in sources:
        for f in src["fields"]:
            all_fields.append({"sourceId": src["sourceId"], **f})

    # union-find grouping by transitive strong matches
    parent = list(range(len(all_fields)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    pair_scores = {}
    for i in range(len(all_fields)):
        for j in range(i + 1, len(all_fields)):
            fi, fj = all_fields[i], all_fields[j]
            score, evidence = _pair_score(fi, fj)
            pair_scores[(i, j)] = (score, evidence)
            if score >= POTENTIAL_THRESHOLD:
                union(i, j)

    groups = {}
    for idx, field in enumerate(all_fields):
        root = find(idx)
        groups.setdefault(root, []).append(idx)

    result_groups = []
    unassigned = []
    for root, idxs in groups.items():
        members = [all_fields[i] for i in idxs]
        if len(idxs) == 1:
            unassigned.append(members[0])
            continue
        # compute pairwise min score within group for status/confidence
        scores = []
        for a_i in range(len(idxs)):
            for b_i in range(a_i + 1, len(idxs)):
                i, j = sorted((idxs[a_i], idxs[b_i]))
                scores.append(pair_scores.get((i, j), (0, {}))[0])
        min_score = min(scores)
        status = "common" if min_score >= COMMON_THRESHOLD else "potential"
        confidence = round(min_score, 3)
        name_counts = {}
        for m in members:
            name_counts[m["name"]] = name_counts.get(m["name"], 0) + 1
        target_name = max(name_counts, key=lambda k: (name_counts[k], k))
        # suggest reconcile field: shared numeric amount-like column
        is_amt = all(m["dtype"] == "numeric" for m in members) and any(
            _normalize(m["name"]) in ("amount", "value", "total", "balance") for m in members
        )
        result_groups.append({
            "targetGroupId": target_name,
            "fields": [{"sourceId": m["sourceId"], "fieldName": m["name"]} for m in members],
            "status": status,
            "confidence": confidence,
            "isReconcileField": is_amt,
            "suggestedReconcileField": is_amt,
            "evidence": [{"sources": "|".join(sorted({m["sourceId"] for m in members}))}],
        })

    # stable ordering: reconcile fields first, then by name
    result_groups.sort(key=lambda g: (not g["isReconcileField"], g["targetGroupId"].lower()))

    return {
        "sources": sources,
        "groups": result_groups,
        "unassigned": unassigned,
        "stats": {
            "common": len([g for g in result_groups if g["status"] == "common"]),
            "potential": len([g for g in result_groups if g["status"] == "potential"]),
            "uncommon": len(unassigned),
        },
    }