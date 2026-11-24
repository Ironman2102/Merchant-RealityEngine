"""Comprehensive edge-case, calibration, monotonicity, and dual-model tests for M1 (LightGBM) and NN (MLP)."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from sklearn.metrics import average_precision_score

from ml.compare import bayesian_gate_mask, ece, mcnemar, wilson
from ml.score import apply_iso, load, score_frame
from ml.train_nn import rsi

ROOT = Path(__file__).resolve().parents[2]
M1_DIR = ROOT / 'ml' / 'models' / 'm1-v0'
NN_PATH = ROOT / 'ml' / 'models' / 'nn-v0' / 'network.json'
DATA_CSV = ROOT / 'ml' / 'data' / 'features.csv'
TEST_IDS_CSV = ROOT / 'ml' / 'data' / 'test_ids.csv'


def _nn_forward(net: dict, row: np.ndarray) -> tuple[float, list[dict]]:
    cols = net['features']
    z = (row - np.asarray(net['mean'], dtype=float)) / np.asarray(net['std'], dtype=float)
    h = z.reshape(1, -1)
    acts = [h]
    weights = [np.asarray(w, dtype=float) for w in net['coefs']]
    biases = [np.asarray(b, dtype=float) for b in net['intercepts']]
    for i, (w, b) in enumerate(zip(weights, biases)):
        h = h @ w + b
        if i < len(weights) - 1:
            h = np.maximum(h, 0)
        else:
            h = 1 / (1 + np.exp(-np.clip(h, -40, 40)))
        acts.append(h)
    raw = float(h.ravel()[0])
    p = float(apply_iso(np.array([raw]), net['calibrator'])[0])
    grad = np.ones((1, 1))
    for i in range(len(weights) - 1, -1, -1):
        if i < len(weights) - 1:
            grad = grad * (acts[i + 1] > 0)
        grad = grad @ weights[i].T
    attr = (acts[0] * grad).ravel()
    order = np.argsort(-np.abs(attr))[:5]
    drivers = [{'feature': cols[i], 'shap': float(attr[i])} for i in order]
    return p, drivers


# -------------------- Artifact & Schema Integrity --------------------

def test_m1_and_nn_feature_schemas_match_exactly():
    _, m1_cols, cal = load(M1_DIR)
    net = json.loads(NN_PATH.read_text())
    df = pd.read_csv(DATA_CSV, nrows=1)
    csv_cols = set(c for c in df.columns if c not in ('merchant_id', 'label'))
    assert m1_cols == net['features']
    assert set(m1_cols).issubset(csv_cols)
    assert np.all(np.diff(cal['X_thresholds_']) >= 0)
    assert np.all(np.diff(cal['y_thresholds_']) >= -1e-12)
    assert np.all((np.asarray(cal['y_thresholds_']) >= 0) & (np.asarray(cal['y_thresholds_']) <= 1))


def test_nn_artifact_weights_and_calibrator_are_well_formed():
    net = json.loads(NN_PATH.read_text())
    n_feat = len(net['features'])
    assert net['kind'] == 'mlp'
    assert net['hidden'] == [32, 16]
    assert net['activation'] == 'relu'
    assert len(net['mean']) == n_feat
    assert len(net['std']) == n_feat
    assert all(float(s) > 0 for s in net['std'])
    assert [np.asarray(w).shape for w in net['coefs']] == [(n_feat, 32), (32, 16), (16, 1)]
    assert [np.asarray(b).shape for b in net['intercepts']] == [(32,), (16,), (1,)]
    xs = np.asarray(net['calibrator']['X_thresholds_'], dtype=float)
    ys = np.asarray(net['calibrator']['y_thresholds_'], dtype=float)
    assert len(xs) >= 2 and len(xs) == len(ys)
    assert np.all(np.diff(xs) >= 0)
    assert np.all((ys >= 0) & (ys <= 1))


# -------------------- M1 LightGBM Edge Cases --------------------

def test_m1_apply_iso_clamps_out_of_bounds_and_extremes():
    _, _, cal = load(M1_DIR)
    vals = apply_iso(np.array([-1e9, -1.0, 0.0, 0.5, 1.0, 1e9]), cal)
    assert vals.shape == (6,)
    assert np.all(np.isfinite(vals))
    assert np.all((vals >= 0.0) & (vals <= 1.0))
    assert np.all(np.diff(vals) >= -1e-12)


def test_m1_score_frame_handles_missing_extra_and_permuted_columns():
    df = pd.read_csv(DATA_CSV).head(10)
    full = score_frame(df, M1_DIR)

    # Extra unknown column & reversed feature columns
    feat_cols = [c for c in df.columns if c not in ('merchant_id', 'label')]
    df_perm = df[['merchant_id'] + list(reversed(feat_cols))].copy()
    df_perm['unknown_col'] = 999.0
    perm = score_frame(df_perm, M1_DIR)
    assert np.allclose(full['ml_p'], perm['ml_p'])
    assert np.allclose(full['ml_p_raw'], perm['ml_p_raw'])
    assert list(full['ml_top_drivers']) == list(perm['ml_top_drivers'])

    # Missing merchant_id & missing half the feature columns -> fills 0 without crash
    df_partial = df[feat_cols[:10]].copy()
    partial = score_frame(df_partial, M1_DIR)
    assert list(partial['merchant_id']) == list(df_partial.index)
    assert len(partial) == len(df_partial)
    assert np.all(np.isfinite(partial['ml_p']))
    assert np.all((partial['ml_p'] >= 0) & (partial['ml_p'] <= 1))


def test_m1_score_frame_single_row_and_extreme_values():
    _, cols, _ = load(M1_DIR)
    extreme = pd.DataFrame([
        {c: 0.0 for c in cols},
        {c: np.nan for c in cols},
        {c: 1e6 if c.startswith('llr_') else (1.0 if c.startswith('fired_') else 0.0) for c in cols},
        {c: -1e6 if c.startswith('llr_') else 0.0 for c in cols},
    ])
    extreme['merchant_id'] = ['ZERO', 'NAN', 'HUGE_POS', 'HUGE_NEG']
    batch_out = score_frame(extreme, M1_DIR)
    assert np.all(np.isfinite(batch_out['ml_p']))
    assert np.all((batch_out['ml_p'] >= 0) & (batch_out['ml_p'] <= 1))
    assert batch_out.loc[2, 'ml_p'] >= batch_out.loc[3, 'ml_p']

    # Single-row scoring equals batch row scoring
    single_out = score_frame(extreme.iloc[[2]], M1_DIR)
    assert np.isclose(single_out['ml_p'].iloc[0], batch_out['ml_p'].iloc[2])
    assert single_out['ml_top_drivers'].iloc[0] == batch_out['ml_top_drivers'].iloc[2]

    # Top-5 driver string format
    parts = single_out['ml_top_drivers'].iloc[0].split('|')
    assert len(parts) == 5
    assert all(':' in p for p in parts)


def test_m1_monotone_across_all_llr_and_fired_columns():
    df = pd.read_csv(DATA_CSV)
    booster, cols, cal = load(M1_DIR)
    mono_cols = [c for c in cols if c.startswith('llr_') or c.startswith('fired_')]
    rng = np.random.default_rng(19)
    sample_rows = df.iloc[rng.choice(len(df), size=10, replace=False)][cols]

    for _, r in sample_rows.iterrows():
        base_df = pd.DataFrame([r.to_dict()])[cols]
        base_raw = float(booster.predict(base_df)[0])
        base_p = float(apply_iso(np.array([base_raw]), cal)[0])
        for col in mono_cols:
            bumped = base_df.copy()
            bumped.iloc[0, bumped.columns.get_loc(col)] = float(bumped.iloc[0][col]) + (1.0 if col.startswith('fired_') else 2.0)
            new_raw = float(booster.predict(bumped)[0])
            new_p = float(apply_iso(np.array([new_raw]), cal)[0])
            assert new_raw + 1e-9 >= base_raw, (col, base_raw, new_raw)
            assert new_p + 1e-9 >= base_p, (col, base_p, new_p)


# -------------------- NN-v0 Forward Pass & Attribution Edge Cases --------------------

def test_nn_forward_deterministic_bounded_and_extreme_safe():
    net = json.loads(NN_PATH.read_text())
    cols = net['features']
    df = pd.read_csv(DATA_CSV).head(25)

    for _, r in df.iterrows():
        x = r[cols].to_numpy(dtype=float)
        p1, d1 = _nn_forward(net, x)
        p2, d2 = _nn_forward(net, x)
        assert p1 == p2
        assert d1 == d2
        assert 0.0 <= p1 <= 1.0
        assert len(d1) == 5
        mags = [abs(item['shap']) for item in d1]
        assert mags == sorted(mags, reverse=True)

    # Exact mean vector -> acts[0] == 0 -> all attributions are 0
    p_mean, d_mean = _nn_forward(net, np.asarray(net['mean'], dtype=float))
    assert 0.0 <= p_mean <= 1.0
    assert all(item['shap'] == 0.0 for item in d_mean)

    # Extreme values (+/- 1e6) must not overflow exp() or emit NaN
    p_hi, d_hi = _nn_forward(net, np.full(len(cols), 1e6))
    p_lo, d_lo = _nn_forward(net, np.full(len(cols), -1e6))
    assert np.isfinite(p_hi) and 0.0 <= p_hi <= 1.0
    assert np.isfinite(p_lo) and 0.0 <= p_lo <= 1.0
    assert all(np.isfinite(item['shap']) for item in d_hi + d_lo)


# -------------------- Held-out Evaluation & Dual-Model Agreement --------------------

def test_heldout_metrics_and_dual_model_agreement():
    df = pd.read_csv(DATA_CSV)
    test_ids = set(pd.read_csv(TEST_IDS_CSV)['merchant_id'].astype(str))
    held = df[df['merchant_id'].astype(str).isin(test_ids)].copy()
    assert len(held) > 0

    booster, m1_cols, cal = load(M1_DIR)
    p_m1 = apply_iso(np.asarray(booster.predict(held[m1_cols]), dtype=float), cal)

    net = json.loads(NN_PATH.read_text())
    nn_cols = net['features']
    p_nn = np.array([_nn_forward(net, row[nn_cols].to_numpy(dtype=float))[0] for _, row in held.iterrows()])

    y = held['label'].to_numpy()
    ap_m1 = float(average_precision_score(y, p_m1))
    ap_nn = float(average_precision_score(y, p_nn))
    assert ap_m1 >= 0.90, f'M1 held-out AP dropped: {ap_m1}'
    assert ap_nn >= 0.90, f'NN held-out AP dropped: {ap_nn}'
    assert ece(p_m1, y) <= 0.15
    assert ece(p_nn, y) <= 0.15


# -------------------- Comparison & Gate Helper Edge Cases --------------------

def test_stats_helpers_and_bayesian_gate_mask_edge_cases():
    assert wilson(0, 0) == (0.0, 1.0)
    lo0, hi0 = wilson(0, 100)
    assert lo0 == 0.0 and 0.0 < hi0 < 0.1
    lo1, hi1 = wilson(100, 100)
    assert np.isclose(hi1, 1.0) and 0.9 < lo1 < 1.0

    y = np.array([0, 0, 1, 1])
    assert ece(np.array([0.0, 0.0, 1.0, 1.0]), y) == 0.0
    assert ece(np.array([1.0, 1.0, 0.0, 0.0]), y) == 1.0

    a = np.array([1, 0, 1, 0])
    b = np.array([0, 1, 1, 0])
    assert mcnemar(a, a) == 1.0
    assert 0.0 <= mcnemar(a, b) <= 1.0
    assert mcnemar(a, b) == mcnemar(b, a)

    assert rsi(0.9, 0.0) is None
    assert np.isclose(rsi(0.9, 0.6), 0.5)

    # bayesian_gate_mask: 2 strong families on 1 provenance -> False; 3 families on 1 provenance -> True; 2 provenances -> True
    detectors = json.loads((ROOT / 'rules' / 'detectors.json').read_text())
    llr_cols = [f'llr_{k}' for k, v in detectors.items() if not k.startswith('_') and isinstance(v, dict)]
    base = {c: 0.0 for c in llr_cols}

    r_zero = dict(base)
    r_two_same_prov = {**base, 'llr_A4': 2.0, 'llr_C2': 2.0}       # payments only, 2 families
    r_three_same_prov = {**r_two_same_prov, 'llr_I2': 2.0}         # payments only, 3 families
    r_two_prov = {**base, 'llr_A4': 2.0, 'llr_B9': 2.0}            # payments + panel
    r_below_min_nats = {**base, 'llr_A4': 0.49, 'llr_B9': 0.49}    # < 0.5 minNats

    mask = bayesian_gate_mask(pd.DataFrame([r_zero, r_two_same_prov, r_three_same_prov, r_two_prov, r_below_min_nats]))
    assert list(mask) == [False, False, True, True, False]


# -------------------- [BUG-REG #1] ML Shortcut & Calibration Regressions --------------------

def test_m1_uses_more_than_missing_feed_shortcut():
    booster, cols, _ = load(M1_DIR)
    gains = dict(zip(cols, booster.feature_importance(importance_type='gain').tolist()))
    active = [c for c, g in gains.items() if g > 0]
    total_gain = sum(gains.values())
    b9_d10_gain = sum(g for c, g in gains.items() if c.endswith('_B9') or c.endswith('_D10'))
    assert len(active) > 2, f'M1 collapsed onto only {active}'
    assert b9_d10_gain / max(total_gain, 1e-12) < 0.95, f'B9+D10 hold {b9_d10_gain / total_gain:.1%} of M1 gain'


def test_m1_and_nn_do_not_flag_clean_genuine_with_missing_optional_feeds():
    df = pd.read_csv(DATA_CSV)
    genuine_row = df[df['label'] == 0].iloc[0].copy()
    detectors = json.loads((ROOT / 'rules' / 'detectors.json').read_text())
    for det_id, cfg in detectors.items():
        if det_id.startswith('_') or not isinstance(cfg, dict):
            continue
        if cfg.get('requires') != ['acquiring'] and cfg.get('requires') != []:
            genuine_row[f'llr_{det_id}'] = 0.0
            genuine_row[f'eff_{det_id}'] = 0.0
            genuine_row[f'fired_{det_id}'] = 0
            genuine_row[f'unk_{det_id}'] = 1
    for cov in ['cov_website', 'cov_orders', 'cov_bank', 'cov_fulfillment', 'cov_calendar', 'cov_verification']:
        genuine_row[cov] = 0
    genuine_row['posterior'] = 0.0002
    genuine_row['logodds_total'] = -8.5

    booster, cols, cal = load(M1_DIR)
    m1_p = float(apply_iso(np.asarray(booster.predict(pd.DataFrame([genuine_row])[cols]), dtype=float), cal)[0])
    net = json.loads(NN_PATH.read_text())
    nn_p, _ = _nn_forward(net, genuine_row[net['features']].to_numpy(dtype=float))
    assert m1_p < 0.20, f'M1 false-flagged clean acquirer-only genuine merchant: m1_p={m1_p:.4f}'
    assert nn_p < 0.20, f'NN false-flagged clean acquirer-only genuine merchant: nn_p={nn_p:.4f}'


def test_m1_and_nn_calibrators_are_not_degenerate_binary_steps():
    _, _, cal = load(M1_DIR)
    net = json.loads(NN_PATH.read_text())
    m1_levels = np.unique(np.round(cal['y_thresholds_'], 3))
    nn_levels = np.unique(np.round(net['calibrator']['y_thresholds_'], 3))
    assert len(m1_levels) > 2, f'M1 calibrator collapsed to binary step: {cal}'
    assert len(nn_levels) > 2, f'NN calibrator collapsed to binary step: {net["calibrator"]}'

