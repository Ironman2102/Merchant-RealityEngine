"""Score a feature CSV with M1. python -m ml.score --features <csv> --model ml/models/m1-v0 --out <csv>"""
import argparse
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import shap

def apply_iso(raw: np.ndarray, cal: dict) -> np.ndarray:
    xs = np.asarray(cal['X_thresholds_'], dtype=float)
    ys = np.asarray(cal['y_thresholds_'], dtype=float)
    return np.clip(np.interp(raw, xs, ys), 0, 1)

def load(model_dir: Path):
    booster = lgb.Booster(model_file=str(model_dir / 'model.txt'))
    cols = json.loads((model_dir / 'features.json').read_text())
    cal = json.loads((model_dir / 'calibrator.json').read_text())
    return booster, cols, cal

def score_frame(df: pd.DataFrame, model_dir: Path) -> pd.DataFrame:
    booster, cols, cal = load(model_dir)
    X = df.reindex(columns=cols).fillna(0)
    raw = booster.predict(X)
    p = apply_iso(np.asarray(raw, dtype=float), cal)
    explainer = shap.TreeExplainer(booster)
    values = np.asarray(explainer.shap_values(X))
    if values.ndim == 3:
        values = values[1] if values.shape[0] == 2 else values[-1]
    drivers = []
    for row in values:
        order = np.argsort(-np.abs(row))[:5]
        drivers.append('|'.join(f'{cols[i]}:{row[i]:+.2f}' for i in order))
    out = pd.DataFrame({'merchant_id': df['merchant_id'] if 'merchant_id' in df.columns else df.index, 'ml_p_raw': raw, 'ml_p': p, 'ml_top_drivers': drivers})
    return out

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--features', required=True)
    ap.add_argument('--model', default='ml/models/m1-v0')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    df = pd.read_csv(args.features)
    scored = score_frame(df, Path(args.model))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    scored.to_csv(args.out, index=False)
    print(f'wrote {args.out}')

if __name__ == '__main__':
    main()
