"""Compare calibrated M1 with the Bayesian posterior on the held-out merchants. Report whichever is better."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

from ml.score import apply_iso, load

ROOT = Path(__file__).resolve().parents[1]

def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    margin = z * np.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / den
    return float(max(0, centre - margin)), float(min(1, centre + margin))

def ece(p: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0, 1, bins + 1)
    err = 0.0
    for i in range(bins):
        m = (p >= edges[i]) & (p < edges[i + 1] if i < bins - 1 else p <= edges[i + 1])
        if m.sum() == 0:
            continue
        err += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(err)

def mcnemar(a: np.ndarray, b: np.ndarray) -> float:
    b01 = int(((a == 1) & (b == 0)).sum())
    b10 = int(((a == 0) & (b == 1)).sum())
    n = b01 + b10
    if n == 0:
        return 1.0
    from math import comb
    tail = sum(comb(n, k) for k in range(0, min(b01, b10) + 1))
    return min(1.0, 2 * tail / (2 ** n))

def bayesian_gate_mask(df: pd.DataFrame) -> np.ndarray:
    """Reconstruct the Bayesian governance gate (>=2 provenances or >=3 families with family LLR >= 0.5)."""
    detectors = json.loads((ROOT / 'rules' / 'detectors.json').read_text())
    engine = json.loads((ROOT / 'rules' / 'engine.json').read_text())
    rho = float(engine.get('familyRho', 0.3))
    min_nats = float(engine['gate']['minNats'])
    min_prov = int(engine['gate']['minProvenances'])
    min_fam = int(engine['gate']['minFamiliesSingleProvenance'])
    by_fam: dict[str, list[tuple[str, str]]] = {}
    for det_id, cfg in detectors.items():
        if det_id.startswith('_') or not isinstance(cfg, dict):
            continue
        col = f'llr_{det_id}'
        if col in df.columns:
            by_fam.setdefault(cfg['family'], []).append((col, cfg['provenance']))
    passed = []
    for _, row in df.iterrows():
        fam_llrs = {}
        prov_nats: dict[str, float] = {}
        for fam, items in by_fam.items():
            pos = sorted([float(row[c]) for c, _ in items if float(row[c]) > 0], reverse=True)
            neg = sorted([float(row[c]) for c, _ in items if float(row[c]) < 0])
            p_sum = (pos[0] + rho * sum(pos[1:])) if pos else 0.0
            n_sum = (neg[0] + rho * sum(neg[1:])) if neg else 0.0
            fam_llrs[fam] = p_sum + n_sum
            pos_items = sorted([(float(row[c]), prov) for c, prov in items if float(row[c]) > 0], reverse=True)
            for idx, (val, prov) in enumerate(pos_items):
                prov_nats[prov] = prov_nats.get(prov, 0.0) + val * (rho if idx else 1.0)
        strong_fam = sum(1 for v in fam_llrs.values() if v >= min_nats)
        strong_prov = sum(1 for v in prov_nats.values() if v >= min_nats)
        passed.append(strong_prov >= min_prov or strong_fam >= min_fam)
    return np.asarray(passed, dtype=bool)

def main() -> None:
    df = pd.read_csv(ROOT / 'ml' / 'data' / 'features.csv')
    test_ids = set(pd.read_csv(ROOT / 'ml' / 'data' / 'test_ids.csv')['merchant_id'].astype(str))
    held = df[df['merchant_id'].astype(str).isin(test_ids)].copy()
    booster, cols, cal = load(ROOT / 'ml' / 'models' / 'm1-v0')
    raw = booster.predict(held[cols])
    p = apply_iso(np.asarray(raw, dtype=float), cal)
    y = held['label'].to_numpy()
    bayes_raw = held['posterior'].to_numpy()
    gate = bayesian_gate_mask(held)
    bayes = np.where(gate, bayes_raw, np.minimum(bayes_raw, 0.099))
    rng = np.random.default_rng(7)
    def boot_ap(score: np.ndarray) -> tuple[float, float, float]:
        point = float(average_precision_score(y, score))
        stats = []
        for _ in range(1000):
            i = rng.integers(0, len(y), len(y))
            if len(np.unique(y[i])) < 2:
                continue
            stats.append(average_precision_score(y[i], score[i]))
        lo, hi = np.quantile(stats, [0.025, 0.975]) if stats else (point, point)
        return point, float(lo), float(hi)
    m_ap, m_lo, m_hi = boot_ap(p)
    b_ap, b_lo, b_hi = boot_ap(bayes)
    def at(score: np.ndarray, gated: np.ndarray | None = None) -> tuple[int, int, int, int]:
        pred = (score >= 0.10) & (gated if gated is not None else True)
        tp = int(((pred == 1) & (y == 1)).sum()); fp = int(((pred == 1) & (y == 0)).sum())
        fn = int(((pred == 0) & (y == 1)).sum()); tn = int(((pred == 0) & (y == 0)).sum())
        return tp, fp, fn, tn
    mt, mf, mfn, mtn = at(p)
    bt, bf, bfn, btn = at(bayes_raw, gate)
    better = 'M1' if m_ap > b_ap else 'the Bayesian posterior'
    text = f"""# Model comparison (synthetic)

**Synthetic.** Held-out merchants from the portfolio generator. This is not real-world accuracy.

Whichever ranks better on average precision: **{better}**.

| Model | AUC-PR | bootstrap 95% | Recall at 0.10 | Wilson 95% | Genuine FP rate | Wilson 95% | ECE |
|---|---|---|---|---|---|---|---|
| M1 calibrated | {m_ap:.3f} | {m_lo:.3f}–{m_hi:.3f} | {mt}/{mt+mfn} | {wilson(mt, mt+mfn)[0]:.3f}–{wilson(mt, mt+mfn)[1]:.3f} | {mf}/{mf+mtn} | {wilson(mf, mf+mtn)[0]:.3f}–{wilson(mf, mf+mtn)[1]:.3f} | {ece(p, y):.3f} |
| Bayesian posterior | {b_ap:.3f} | {b_lo:.3f}–{b_hi:.3f} | {bt}/{bt+bfn} | {wilson(bt, bt+bfn)[0]:.3f}–{wilson(bt, bt+bfn)[1]:.3f} | {bf}/{bf+btn} | {wilson(bf, bf+btn)[0]:.3f}–{wilson(bf, bf+btn)[1]:.3f} | {ece(bayes, y):.3f} |

McNemar exact p on decisions at 0.10: {mcnemar((p >= 0.10).astype(int), (bayes >= 0.10).astype(int)):.4f}.

M1 stays a second opinion. It does not open or close a case.
"""
    out = ROOT / 'reports' / 'model-comparison.md'
    out.parent.mkdir(exist_ok=True)
    out.write_text(text)
    (ROOT / 'ml' / 'models' / 'm1-v0' / 'metrics.json').write_text(json.dumps({
        'auc_pr': m_ap, 'auc_pr_lo': m_lo, 'auc_pr_hi': m_hi, 'ece': ece(p, y), 'bayes_auc_pr': b_ap,
    }, indent=2))
    print(text)

if __name__ == '__main__':
    main()
