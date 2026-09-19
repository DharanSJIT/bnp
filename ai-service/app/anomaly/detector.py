"""Statistical anomaly detection beyond hard rule checks.

IsolationForest on numeric columns per source, with z-score fallback for small
samples. Output is capped (top N by deviation) so anomaly flags stay a
reviewable layer rather than flooding the break list.
"""
import numpy as np

MAX_ANOMALIES_PER_SOURCE = 60


def scan_source(rows, numeric_cols=("Amount",), contamination=0.01):
    """rows: list of {column: value} dicts. Returns list of anomaly dicts."""
    if not rows or not numeric_cols:
        return []
    try:
        from sklearn.ensemble import IsolationForest
    except Exception:  # noqa: BLE001
        return []

    n = len(rows)
    features = []
    flat = []
    for row in rows:
        vec = []
        for col in numeric_cols:
            try:
                vec.append(float(row.get(col)))
            except (TypeError, ValueError):
                vec.append(np.nan)
        if any(np.isnan(v) for v in vec):
            continue
        features.append(vec)
        flat.append(row)
    if len(features) < 20:
        return []

    X = np.array(features, dtype=float)
    if X.shape[1] == 0:
        return []

    if n >= 200:
        model = IsolationForest(contamination=contamination, random_state=42, n_jobs=-1)
        pred = model.fit_predict(X)
        scores = -model.score_samples(X)
    else:
        # z-score fallback (one numeric column)
        if X.shape[1] != 1:
            return []
        mu, sd = X[:, 0].mean(), X[:, 0].std()
        if sd == 0:
            return []
        z = np.abs((X[:, 0] - mu) / sd)
        pred = np.where(z > 4, -1, 1)
        scores = z
    scores = np.asarray(scores, dtype=float)

    anomalies = []
    for i in range(len(flat)):
        if pred[i] == -1:
            val = X[i][0]
            anomalies.append({
                "rowIndex": i,
                "key": flat[i].get("TransactionID") or flat[i].get("gl_account_id", ""),
                "value": round(float(val), 2),
                "deviationScore": round(float(scores[i]), 4),
                "column": numeric_cols[0],
            })
    anomalies.sort(key=lambda a: a["deviationScore"], reverse=True)
    return anomalies[:MAX_ANOMALIES_PER_SOURCE]