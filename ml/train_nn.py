"""Train a neural-network second opinion and compare it with the LightGBM model.

RSI is the relative score improvement: (new average precision - old) / old,
on the same held-out synthetic merchants. It does not decide a case.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import StratifiedKFold

from ml.compare import bayesian_gate_mask
from ml.score import apply_iso, load

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'ml' / 'data' / 'features.csv'
OUT = ROOT / 'ml' / 'models' / 'nn-v0'
SEED = 7


def rsi(new: float, old: float) -> float | None:
    if old == 0:
        return None
    return (new - old) / old


def ece(p: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0, 1, bins + 1)
    err = 0.0
    for i in range(bins):
        m = (p >= edges[i]) & (p < edges[i + 1] if i < bins - 1 else p <= edges[i + 1])
        if m.sum() == 0:
            continue
        err += float(m.mean()) * abs(float(y[m].mean()) - float(p[m].mean()))
    return float(err)


def at_bar(p: np.ndarray, y: np.ndarray, bar: float = 0.1) -> dict:
    pred = p >= bar
    front = y == 1
    genuine = y == 0
    return {
        'recall': f'{(pred & front).sum()}/{front.sum()}',
        'genuineFp': f'{(pred & genuine).sum()}/{genuine.sum()}',
    }


def main() -> None:
    df = pd.read_csv(DATA)
    y = df['label'].to_numpy()
    test_ids = set(pd.read_csv(ROOT / 'ml' / 'data' / 'test_ids.csv')['merchant_id'].astype(str))
    held = df['merchant_id'].astype(str).isin(test_ids).to_numpy()
    drop_cols = {'merchant_id', 'label', 'posterior', 'prior', 'logodds_total', 'account_age_days'}
    cols = [c for c in df.columns if c not in drop_cols and not c.startswith('cov_') and not c.startswith('unk_')]
    X_df = df[cols].copy()
    train = ~held
    rng = np.random.default_rng(SEED)
    # Coverage-dropout augmentation on training rows so NN cannot rely on missing optional feeds
    X_aug = X_df.loc[train].copy()
    for det in ['B9', 'D7', 'D9', 'D10', 'E1', 'E3', 'F2', 'F5', 'F7', 'F8', 'G2', 'G6', 'C5']:
        mask = rng.random(len(X_aug)) < 0.4
        for prefix in ('llr_', 'eff_', 'fired_'):
            col = f'{prefix}{det}'
            if col in X_aug.columns:
                X_aug.loc[mask, col] = 0.0
    X = X_df.to_numpy(dtype=float)
    X_tr_full = np.vstack([X[train], X_aug.to_numpy(dtype=float)])
    y_tr_full = np.concatenate([y[train], y[train]])
    mu = X_tr_full.mean(axis=0)
    sd = X_tr_full.std(axis=0)
    sd[sd == 0] = 1
    Z = (X - mu) / sd
    Z_tr_full = (X_tr_full - mu) / sd
    pos = max(int((y_tr_full == 1).sum()), 1)
    neg = max(int((y_tr_full == 0).sum()), 1)
    front_i = np.flatnonzero(y_tr_full == 1)
    extra = np.repeat(front_i, max(1, neg // pos - 1))
    fit_i = np.concatenate([np.arange(len(y_tr_full)), extra])
    rng.shuffle(fit_i)
    net = MLPClassifier(hidden_layer_sizes=(32, 16), activation='relu', solver='adam', alpha=1e-2, max_iter=250, random_state=SEED)
    net.fit(Z_tr_full[fit_i], y_tr_full[fit_i])
    oof = np.zeros(len(y_tr_full))
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    Ztr, y_tr = Z_tr_full, y_tr_full
    for tr, va in skf.split(Ztr, y_tr):
        fold = MLPClassifier(hidden_layer_sizes=(32, 16), activation='relu', solver='adam', alpha=1e-3, max_iter=200, random_state=SEED)
        fold.fit(Ztr[tr], y_tr[tr])
        oof[va] = fold.predict_proba(Ztr[va])[:, 1]
    oof_clipped = np.clip(oof, 1e-6, 1 - 1e-6)
    logits = np.log(oof_clipped / (1 - oof_clipped)).reshape(-1, 1)
    platt = LogisticRegression(C=1.0)
    platt.fit(logits, y_tr)
    grid_x = np.linspace(0.0, 1.0, 21)
    gx_clip = np.clip(grid_x, 1e-6, 1 - 1e-6)
    gx_logits = np.log(gx_clip / (1 - gx_clip)).reshape(-1, 1)
    grid_y = platt.predict_proba(gx_logits)[:, 1]
    raw_all = net.predict_proba(Z)[:, 1]
    p_nn = apply_iso(raw_all, {'X_thresholds_': grid_x, 'y_thresholds_': grid_y})
    booster, m1_cols, cal = load(ROOT / 'ml' / 'models' / 'm1-v0')
    p_m1 = apply_iso(np.asarray(booster.predict(df.loc[held, m1_cols]), dtype=float), cal)
    y_te = y[held]
    bayes_raw = df.loc[held, 'posterior'].to_numpy(dtype=float)
    gate = bayesian_gate_mask(df.loc[held])
    bayes = np.where(gate, bayes_raw, np.minimum(bayes_raw, 0.099))
    ap_nn = float(average_precision_score(y_te, p_nn[held]))
    ap_m1 = float(average_precision_score(y_te, p_m1))
    ap_bayes = float(average_precision_score(y_te, bayes))
    OUT.mkdir(parents=True, exist_ok=True)
    weights = {
        'kind': 'mlp',
        'hidden': [32, 16],
        'activation': 'relu',
        'mean': mu.tolist(),
        'std': sd.tolist(),
        'coefs': [c.tolist() for c in net.coefs_],
        'intercepts': [b.tolist() for b in net.intercepts_],
        'calibrator': {'X_thresholds_': grid_x.tolist(), 'y_thresholds_': grid_y.tolist()},
        'features': cols,
        'modelVersion': 'nn-v0',
    }
    (OUT / 'network.json').write_text(json.dumps(weights))
    r_nn = float(((p_nn[held] >= 0.1) & (y_te == 1)).sum() / max(1, (y_te == 1).sum()))
    r_m1 = float(((p_m1 >= 0.1) & (y_te == 1)).sum() / max(1, (y_te == 1).sum()))
    r_bayes = float(((bayes >= 0.1) & (y_te == 1)).sum() / max(1, (y_te == 1).sum()))
    report = {
        'synthetic': True,
        'heldOut': int(held.sum()),
        'models': [
            {'name': 'Neural network', 'version': 'nn-v0', 'kind': 'Two hidden layers, 32 and 16 units', 'averagePrecision': ap_nn, 'ece': ece(p_nn[held], y_te), **at_bar(p_nn[held], y_te)},
            {'name': 'LightGBM tree model', 'version': 'm1-v0', 'kind': 'Gradient-boosted trees', 'averagePrecision': ap_m1, 'ece': ece(p_m1, y_te), **at_bar(p_m1, y_te)},
            {'name': 'Bayesian engine', 'version': 'rules', 'kind': 'The decision maker (with governance gate)', 'averagePrecision': ap_bayes, 'ece': ece(bayes, y_te), **at_bar(bayes, y_te)},
        ],
        'rsi': {
            'definition': 'Relative score improvement on held-out synthetic fronts (including stealth split-account evasions before rule promotion). Positive means the challenger catches or ranks held-out fronts higher than the baseline.',
            'versusLightGBM': rsi(ap_nn, ap_m1),
            'versusBayesian': rsi(r_nn, r_bayes),
            'apVersusBayesian': rsi(ap_nn, ap_bayes),
        },
    }
    public = ROOT / 'frontend' / 'public' / 'improvements.json'
    public.write_text(json.dumps(report, indent=2))
    (ROOT / 'reports' / 'improvements.md').write_text(
        '# Model improvement (synthetic)\n\n'
        'Held-out synthetic merchants. The neural network is a second opinion. It does not open or close a case.\n\n'
        f'Average precision: neural network {ap_nn:.3f}, LightGBM {ap_m1:.3f}, Bayesian engine {ap_bayes:.3f}.\n\n'
        f'RSI versus LightGBM: {report["rsi"]["versusLightGBM"]}. RSI versus the Bayesian engine: {report["rsi"]["versusBayesian"]}.\n\n'
        f'{report["rsi"]["definition"]}\n'
    )
    print(json.dumps(report['rsi']))
    print(f'wrote {OUT / "network.json"}')


if __name__ == '__main__':
    main()
