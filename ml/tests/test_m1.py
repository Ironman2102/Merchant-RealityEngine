"""M1 is a second opinion: deterministic, calibrated, monotone on illicit weights, and useless if labels are shuffled."""
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import pytest
from sklearn.metrics import average_precision_score

from ml.score import apply_iso, load

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / 'ml' / 'models' / 'm1-v0'


def test_model_files_exist_and_load():
    booster, cols, cal = load(MODEL)
    assert booster.num_feature() == len(cols)
    assert len(cal['X_thresholds_']) >= 2


def test_predictions_are_deterministic_and_in_unit_interval():
    df = pd.read_csv(ROOT / 'ml' / 'data' / 'features.csv').head(30)
    _, cols, cal = load(MODEL)
    booster = lgb.Booster(model_file=str(MODEL / 'model.txt'))
    raw1 = booster.predict(df[cols])
    raw2 = booster.predict(df[cols])
    assert np.allclose(raw1, raw2)
    p = apply_iso(np.asarray(raw1, dtype=float), cal)
    assert np.all((p >= 0) & (p <= 1))


def test_raising_an_illicit_weight_does_not_lower_the_score():
    df = pd.read_csv(ROOT / 'ml' / 'data' / 'features.csv')
    booster, cols, cal = load(MODEL)
    rng = np.random.default_rng(7)
    take = rng.choice(len(df), size=min(50, len(df)), replace=False)
    llr = [c for c in cols if c.startswith('llr_')]
    for i in take:
        row = df.iloc[[i]][cols].copy()
        col = llr[int(rng.integers(0, len(llr)))]
        base = apply_iso(np.asarray(booster.predict(row), dtype=float), cal)[0]
        row.iloc[0, row.columns.get_loc(col)] = float(row.iloc[0][col]) + 1
        raised = apply_iso(np.asarray(booster.predict(row), dtype=float), cal)[0]
        assert raised + 1e-8 >= base, (col, base, raised)


def test_shuffled_labels_collapse_to_the_base_rate():
    df = pd.read_csv(ROOT / 'ml' / 'data' / 'features.csv')
    y = df['label'].to_numpy().copy()
    rng = np.random.default_rng(7)
    rng.shuffle(y)
    X = df.drop(columns=['merchant_id', 'label'])
    cols = [c for c in X.columns if c.startswith('llr_') or c.startswith('fired_')]
    mono = [1] * len(cols)
    pos = max(int((y == 1).sum()), 1)
    clf = lgb.LGBMClassifier(objective='binary', n_estimators=30, num_leaves=7, random_state=7, deterministic=True, n_jobs=1,
                             scale_pos_weight=(len(y) - pos) / pos, monotone_constraints=mono, verbosity=-1)
    cut = int(len(df) * 0.7)
    clf.fit(X.iloc[:cut][cols], y[:cut])
    pred = clf.predict_proba(X.iloc[cut:][cols])[:, 1]
    rate = float(y[cut:].mean())
    ap = average_precision_score(y[cut:], pred) if len(np.unique(y[cut:])) > 1 else rate
    assert abs(ap - rate) <= 0.05 or ap <= rate + 0.05
    json.dumps({'ap': ap, 'rate': rate})
