"""Train an unsupervised tabular behavioral autoencoder (ae-v0) on benign merchants only.

Outputs pure-JSON weights for <1 ms NumPy inference in ml/serve.py.
High reconstruction error flags novel or out-of-distribution behavioral patterns without requiring fraud labels.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.neural_network import MLPRegressor

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'ml' / 'data' / 'features.csv'
OUT = ROOT / 'ml' / 'models' / 'ae-v0'
SEED = 7


def _forward_ae(Z: np.ndarray, coefs: list[np.ndarray], intercepts: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    h = Z
    latent = Z
    bottleneck_idx = len(coefs) // 2 - 1
    for i, (w, b) in enumerate(zip(coefs, intercepts)):
        h = h @ w + b
        if i < len(coefs) - 1:
            h = np.maximum(h, 0.0)
        if i == bottleneck_idx:
            latent = h
    return h, latent


def main() -> None:
    df = pd.read_csv(DATA)
    y = df['label'].to_numpy(dtype=int)
    test_ids_path = ROOT / 'ml' / 'data' / 'test_ids.csv'
    test_ids = set(pd.read_csv(test_ids_path)['merchant_id'].astype(str)) if test_ids_path.exists() else set()
    held = df['merchant_id'].astype(str).isin(test_ids).to_numpy()

    drop_cols = {'merchant_id', 'label', 'posterior', 'prior', 'logodds_total', 'account_age_days'}
    cols = [c for c in df.columns if c not in drop_cols and not c.startswith('cov_') and not c.startswith('unk_')]

    X_df = df[cols].copy()
    benign_train = (~held) & (y == 0)
    rng = np.random.default_rng(SEED)

    # Coverage-dropout augmentation on benign training rows so missing optional feeds do not spike reconstruction error.
    X_ben = X_df.loc[benign_train].copy()
    X_aug = X_ben.copy()
    for det in ['B9', 'D7', 'D9', 'D10', 'E1', 'E3', 'F2', 'F5', 'F7', 'F8', 'G2', 'G6', 'C5']:
        mask = rng.random(len(X_aug)) < 0.4
        for prefix in ('llr_', 'eff_', 'fired_'):
            col = f'{prefix}{det}'
            if col in X_aug.columns:
                X_aug.loc[mask, col] = 0.0

    X_fit = np.vstack([X_ben.to_numpy(dtype=float), X_aug.to_numpy(dtype=float)])
    mu = X_fit.mean(axis=0)
    sd = X_fit.std(axis=0)
    sd[sd < 1e-6] = 1.0

    Z_fit = np.clip((X_fit - mu) / sd, -8.0, 8.0)
    Z_all = np.clip((X_df.to_numpy(dtype=float) - mu) / sd, -8.0, 8.0)

    ae = MLPRegressor(
        hidden_layer_sizes=(16, 6, 16),
        activation='relu',
        solver='adam',
        alpha=1e-2,
        max_iter=350,
        early_stopping=True,
        n_iter_no_change=20,
        random_state=SEED,
    )
    ae.fit(Z_fit, Z_fit)

    coefs = [np.asarray(w, dtype=float) for w in ae.coefs_]
    intercepts = [np.asarray(b, dtype=float) for b in ae.intercepts_]

    Z_ben_hat, _ = _forward_ae(Z_fit, coefs, intercepts)
    ben_mse = np.mean((Z_fit - Z_ben_hat) ** 2, axis=1)

    p50 = float(np.quantile(ben_mse, 0.50))
    p90 = float(np.quantile(ben_mse, 0.90))
    p95 = float(np.quantile(ben_mse, 0.95))
    p99 = float(np.quantile(ben_mse, 0.99))
    scale = max(p95 - p50, float(np.std(ben_mse)), 1e-4)

    Z_all_hat, _ = _forward_ae(Z_all, coefs, intercepts)
    all_mse = np.mean((Z_all - Z_all_hat) ** 2, axis=1)
    scores = 1.0 / (1.0 + np.exp(-np.clip((all_mse - p95) / scale * 2.0, -30.0, 30.0)))

    metrics = {}
    if held.sum() > 0 and len(np.unique(y[held])) == 2:
        metrics = {
            'heldOutCount': int(held.sum()),
            'heldOutAuprc': round(float(average_precision_score(y[held], scores[held])), 4),
            'heldOutAuroc': round(float(roc_auc_score(y[held], scores[held])), 4),
            'benignMeanMse': round(float(ben_mse.mean()), 5),
        }

    OUT.mkdir(parents=True, exist_ok=True)
    artifact = {
        'kind': 'autoencoder',
        'modelVersion': 'ae-v0',
        'architecture': [len(cols), 16, 6, 16, len(cols)],
        'features': cols,
        'mean': mu.tolist(),
        'std': sd.tolist(),
        'coefs': [w.tolist() for w in coefs],
        'intercepts': [b.tolist() for b in intercepts],
        'calibration': {
            'p50': p50,
            'p90': p90,
            'p95': p95,
            'p99': p99,
            'scale': scale,
            'benignTrainingExamples': int(benign_train.sum()),
        },
        'metrics': metrics,
    }
    (OUT / 'autoencoder.json').write_text(json.dumps(artifact))
    print(f'wrote {OUT / "autoencoder.json"} metrics={json.dumps(metrics)}')


if __name__ == '__main__':
    main()
