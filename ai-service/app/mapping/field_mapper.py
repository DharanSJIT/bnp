import os
import json
import traceback
from loguru import logger
from groq import Groq
from rapidfuzz import fuzz

COMMON_THRESHOLD = 0.95
POTENTIAL_THRESHOLD = 0.75

def _normalize(name):
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

def fallback_suggest_mapping(sources):
    all_fields = []
    for src in sources:
        for f in src["fields"]:
            all_fields.append({"sourceId": src["sourceId"], **f})

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

def suggest_mapping(sources):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        logger.warning("GROQ_API_KEY not found, using fallback algorithm.")
        return fallback_suggest_mapping(sources)

    # Flatten fields to provide to Groq
    all_fields = []
    schema_desc = []
    for src in sources:
        for f in src["fields"]:
            all_fields.append({"sourceId": src["sourceId"], **f})
            schema_desc.append({
                "sourceId": src["sourceId"],
                "name": f["name"],
                "dtype": f["dtype"],
                "sampleValues": f.get("sampleValues", [])
            })

    prompt = f"""You are a data mapping AI. Your task is to match attributes/fields across different data sources based on their names, data types, and sample values.
    
    Given the following fields:
    {json.dumps(schema_desc, indent=2)}

    Please group fields that represent the same concept (e.g. "client_id" and "CustomerId"). A group MUST contain fields from different sources (do not group fields from the same source). 
    For each group, provide a single unified "targetGroupId", and a "confidence" score between 0.0 and 1.0. 
    If they are an exact match or highly certain, use confidence >= 0.95. If they are likely but not exact, use confidence between 0.75 and 0.94.
    
    Output strictly in the following JSON format:
    {{
        "groups": [
            {{
                "targetGroupId": "UnifiedName",
                "confidence": 0.96,
                "fields": [
                    {{"sourceId": "src1", "fieldName": "originalName1"}},
                    {{"sourceId": "src2", "fieldName": "originalName2"}}
                ]
            }}
        ]
    }}
    """
    
    try:
        client = Groq(api_key=api_key)
        res = client.chat.completions.create(
            model="llama-3.1-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        data = json.loads(res.choices[0].message.content)
        
        result_groups = []
        mapped_keys = set()
        
        for g in data.get("groups", []):
            if len(g.get("fields", [])) < 2:
                continue # Ignore singletons
            
            conf = g.get("confidence", 0.8)
            status = "common" if conf >= COMMON_THRESHOLD else "potential"
            
            # Reconcile field heuristic
            is_amt = False
            for f_info in g["fields"]:
                src_f = next((x for x in all_fields if x["sourceId"] == f_info["sourceId"] and x["name"] == f_info["fieldName"]), None)
                if src_f and src_f["dtype"] == "numeric" and any(word in _normalize(f_info["fieldName"]) for word in ["amount", "value", "total", "balance"]):
                    is_amt = True
            
            result_groups.append({
                "targetGroupId": g["targetGroupId"],
                "fields": g["fields"],
                "status": status,
                "confidence": conf,
                "isReconcileField": is_amt,
                "suggestedReconcileField": is_amt,
                "evidence": [{"sources": "|".join(sorted({f["sourceId"] for f in g["fields"]}))}],
            })
            
            for f in g["fields"]:
                mapped_keys.add(f"{f['sourceId']}|{f['fieldName']}")

        unassigned = []
        for f in all_fields:
            if f"{f['sourceId']}|{f['name']}" not in mapped_keys:
                unassigned.append(f)

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

    except Exception as e:
        logger.error(f"Groq API failed: {traceback.format_exc()}")
        # Fallback if Groq fails
        return fallback_suggest_mapping(sources)
