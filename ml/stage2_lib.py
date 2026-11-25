"""Shared data handling and evaluation maths for the Stage 2 models.

Everything here is standard, published practice:
- Grouped splitting so a merchant (and its augmented copy) never sits on both sides of a split.
- Proper scoring rules: Brier score and log loss (Gneiting & Raftery 2007).
- Expected Calibration Error with equal-width bins (Guo et al. 2017).
- Average precision (area under the precision-recall curve), the right ranking metric for rare positives.
- Percentile bootstrap confidence intervals (Efron & Tibshirani 1993).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import QuantileTransformer

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'ml' / 'data' / 'features.csv'
SAMPLES = ROOT / 'ml' / 'data' / 'synthetic_features.csv'
SEED = 7
EPS = 1e-6

# Columns that would leak the engine's own verdict, the account age, or feed availability into the model.
DROP = {'merchant_id', 'label', 'kind', 'posterior', 'prior', 'logodds_total', 'account_age_days'}
# Detectors that depend on optional feeds. Training copies blank them so a model cannot learn "feed present = honest".
OPTIONAL_DETECTORS = ['B9', 'D7', 'D9', 'D10', 'E1', 'E3', 'F2', 'F5', 'F7', 'F8', 'G2', 'G6', 'C5']


def feature_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c not in DROP and not c.startswith(('cov_', 'unk_'))]


def matrix(df: pd.DataFrame, cols: list[str]) -> np.ndarray:
    out = pd.DataFrame({c: df[c] if c in df.columns else 0.0 for c in cols})
    return out.replace([np.inf, -np.inf], np.nan).fillna(0.0).to_numpy(dtype=float)


def load_portfolio() -> pd.DataFrame:
    if not DATA.exists():
        raise FileNotFoundError(f'{DATA} is missing. Run: npx tsx ml/generate_synthetic_features.ts')
    df = pd.read_csv(DATA)
    if 'kind' not in df.columns:
        df['kind'] = 'unknown'
    df['merchant_id'] = df['merchant_id'].astype(str)
    return df


def load_samples() -> pd.DataFrame | None:
    """The hand-built demo merchants. Two of their fraud types never appear in the generator, so they test generalisation."""
    if not SAMPLES.exists():
        return None
    return pd.read_csv(SAMPLES)


def holdout_split(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """The same 70/30 stratified split the v0 trainers used (seed 7), so v0 and v1 are scored on identical merchants."""
    idx = np.arange(len(df))
    train_i, test_i = train_test_split(idx, test_size=0.3, random_state=SEED, stratify=df['label'].to_numpy())
    return np.sort(train_i), np.sort(test_i)


def coverage_dropout(df: pd.DataFrame, rng: np.random.Generator, rate: float = 0.4) -> pd.DataFrame:
    """A copy of the rows with optional-feed detectors blanked at random (same merchant ids, so grouping still holds)."""
    aug = df.copy()
    for det in OPTIONAL_DETECTORS:
        mask = rng.random(len(aug)) < rate
        for prefix in ('llr_', 'eff_', 'fired_'):
            col = f'{prefix}{det}'
            if col in aug.columns:
                aug.loc[mask, col] = 0.0
    return aug


def logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)
    return np.log(p / (1 - p))


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-np.clip(np.asarray(z, dtype=float), -40, 40)))


def ece(p: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    """Expected Calibration Error: sum over bins of (share of cases) x |observed fraud rate - mean predicted probability|."""
    p, y = np.asarray(p, dtype=float), np.asarray(y, dtype=float)
    edges = np.linspace(0, 1, bins + 1)
    err = 0.0
    for i in range(bins):
        m = (p >= edges[i]) & ((p < edges[i + 1]) if i < bins - 1 else (p <= edges[i + 1]))
        if m.any():
            err += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(err)


def metrics(y: np.ndarray, p: np.ndarray, threshold: float = 0.10) -> dict[str, float]:
    y, p = np.asarray(y, dtype=int), np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)
    two = len(np.unique(y)) == 2
    flag = p >= threshold
    pos, neg = (y == 1), (y == 0)
    return {
        'ap': float(average_precision_score(y, p)) if two else float('nan'),
        'roc_auc': float(roc_auc_score(y, p)) if two else float('nan'),
        'brier': float(brier_score_loss(y, p)),
        'log_loss': float(log_loss(y, p, labels=[0, 1])),
        'ece': ece(p, y),
        'threshold': float(threshold),
        'recall': float((flag & pos).sum() / max(1, pos.sum())),
        'false_alarm_rate': float((flag & neg).sum() / max(1, neg.sum())),
    }


def bootstrap_ci(y: np.ndarray, p: np.ndarray, fn, draws: int = 1000, seed: int = SEED) -> tuple[float, float]:
    """95% percentile bootstrap interval, resampling merchants with replacement and keeping both classes present."""
    rng = np.random.default_rng(seed)
    y, p = np.asarray(y), np.asarray(p)
    vals = []
    for _ in range(draws):
        i = rng.integers(0, len(y), len(y))
        if len(np.unique(y[i])) < 2:
            continue
        vals.append(fn(y[i], p[i]))
    return float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))


def paired_bootstrap_delta(y: np.ndarray, p_new: np.ndarray, p_old: np.ndarray, fn, draws: int = 2000, seed: int = SEED) -> dict[str, float]:
    """Champion/challenger test: distribution of fn(new) - fn(old) on the same resampled merchants."""
    rng = np.random.default_rng(seed)
    y, a, b = np.asarray(y), np.asarray(p_new), np.asarray(p_old)
    d = []
    for _ in range(draws):
        i = rng.integers(0, len(y), len(y))
        if len(np.unique(y[i])) < 2:
            continue
        d.append(fn(y[i], a[i]) - fn(y[i], b[i]))
    d = np.asarray(d)
    return {'delta': float(fn(y, a) - fn(y, b)), 'lo': float(np.percentile(d, 2.5)), 'hi': float(np.percentile(d, 97.5)),
            'p_worse': float((d < 0).mean())}


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=float), encoding='utf-8', newline='\n')


class Novelty:
    """Mahalanobis distance with a Ledoit-Wolf shrunk covariance, after a per-feature quantile-normal transform.

    The transform caps every feature's influence (heavy-tailed effect sizes cannot dominate), and the threshold is set on
    out-of-fold distances, so it reflects merchants the detector did not fit.
    """
    CLIP = 5.2

    def fit(self, X: np.ndarray):
        self.qt = QuantileTransformer(n_quantiles=min(200, len(X)), output_distribution='normal', random_state=SEED).fit(X)
        Z = self._z(X)
        self.mu = Z.mean(axis=0)
        lw = LedoitWolf().fit(Z - self.mu)
        self.precision = lw.precision_
        self.shrinkage = float(lw.shrinkage_)
        self.threshold = float('inf')
        return self

    def _z(self, X: np.ndarray) -> np.ndarray:
        return np.clip(self.qt.transform(np.atleast_2d(X)), -self.CLIP, self.CLIP)

    def distance(self, X: np.ndarray) -> np.ndarray:
        Z = self._z(X) - self.mu
        return np.sqrt(np.einsum('ij,jk,ik->i', Z, self.precision, Z))

    def drivers(self, x: np.ndarray, cols: list[str], k: int = 3) -> list[str]:
        z = (self._z(x) - self.mu)[0]
        return [cols[i] for i in np.argsort(-(z * (self.precision @ z)))[:k]]
