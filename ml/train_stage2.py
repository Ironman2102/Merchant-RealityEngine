"""Train Stage 2 v1: five base models, a stacked ensemble, conformal uncertainty and novelty detection.

Usage (from the repo root):
    npx tsx ml/generate_synthetic_features.ts        # training data from the engine
    npx tsx ml/export_labels.ts                      # optional: analyst-labelled cases from the case database
    python -m ml.train_stage2                        # trains into ml/models/stage2-candidate
    python -m ml.train_stage2 --promote              # champion/challenger gate, then promote to stage2-v1

What each piece is, and the published method behind it:
- Base models: logistic regression, a shallow decision tree, a random forest, monotone gradient-boosted trees (LightGBM)
  and a small neural network. Hyperparameters are chosen by grouped cross-validated log loss, a proper scoring rule.
- Grouped cross-validation (StratifiedGroupKFold): a merchant and its augmented copy are always in the same fold, so
  validation never sees a merchant it trained on.
- Stacked generalisation (Wolpert 1992): a logistic meta-model over the base models' out-of-fold logits, with
  non-negative weights, replaces the plain average. It is fitted on predictions the base models made blind.
- Prior-shift correction (Saerens, Latinne & Decaestecker 2002): training data is 1/3 fronts, real portfolios far fewer.
  The server moves each probability onto the engine's own prior for that merchant before it is blended or shown.
- Cost-sensitive threshold (Elkan 2001): flag for review when p >= C_FP / (C_FP + C_FN).
- Mondrian split-conformal prediction (Vovk, Gammerman & Shafer 2005): a class-conditional 90% prediction set.
  {front} or {honest} is a confident call; {front, honest} or {} means "not sure", so a human reviews.
- Novelty detection: Mahalanobis distance with Ledoit-Wolf shrinkage covariance (Ledoit & Wolf 2004). A merchant far
  from everything in training is flagged as an unfamiliar pattern instead of being scored with false confidence.
- Population Stability Index reference bins for drift monitoring (standard credit-risk practice: <0.1 stable,
  0.1-0.25 moderate, >0.25 significant).
- Analyst labels, when present, join training with extra weight; a candidate is promoted only if a paired bootstrap
  shows it is not worse than the current model (champion/challenger).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
from datetime import datetime, timezone

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

from ml.stage2_math import (BetaCalibrator, IdentityCalibrator, IsotonicCalibrator, apply_calibration, brier_decomposition, brier_skill_score,
                            delong_test, entropy_decomposition, expected_cost_curve, mcnemar_exact, np_threshold,
                            reliability_curve, wilson_interval)
from ml.stage2_lib import (DATA, ROOT, SEED, Novelty, bootstrap_ci, coverage_dropout, feature_columns, holdout_split, load_portfolio,
                           load_samples, logit, matrix, metrics, paired_bootstrap_delta, sigmoid, write_json)

MODELS = ROOT / 'ml' / 'models'
CANDIDATE = MODELS / 'stage2-candidate'
CHAMPION = MODELS / 'stage2-v1'
LABELS = ROOT / 'ml' / 'data' / 'labelled_cases.csv'
VERSION = 'stage2-v1'
ALPHA = 0.10            # conformal miscoverage: 90% prediction sets
COST_RATIO = 20.0       # a missed front costs this many needless reviews (configurable in ensemble.json)
REAL_LABEL_WEIGHT = 5.0
OOD_QUANTILE = 0.995
NP_ALPHA, NP_DELTA = 0.05, 0.05   # Neyman-Pearson: false-alarm rate <= 5% with 95% confidence
BASE = ['logistic_regression', 'decision_tree', 'random_forest', 'lightgbm', 'neural_net']


# ---------------------------------------------------------------- base models

def make_model(name: str, params: dict, cols: list[str]):
    if name == 'logistic_regression':
        return make_pipeline(StandardScaler(), LogisticRegression(C=params['C'], class_weight='balanced', max_iter=5000, random_state=SEED))
    if name == 'decision_tree':
        return DecisionTreeClassifier(max_depth=params['max_depth'], min_samples_leaf=params['min_samples_leaf'], class_weight='balanced', random_state=SEED)
    if name == 'random_forest':
        return RandomForestClassifier(n_estimators=300, max_depth=params['max_depth'], min_samples_leaf=params['min_samples_leaf'],
                                      max_features='sqrt', class_weight='balanced_subsample', random_state=SEED, n_jobs=-1)
    if name == 'lightgbm':
        mono = [1 if c.startswith(('llr_', 'fired_')) else 0 for c in cols]
        return lgb.LGBMClassifier(objective='binary', random_state=SEED, deterministic=True, n_jobs=1, verbosity=-1, is_unbalance=True,
                                  monotone_constraints=mono, colsample_bytree=0.5, subsample=0.8, subsample_freq=1, max_depth=4, **params)
    if name == 'neural_net':
        return make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(32, 16), alpha=params['alpha'], max_iter=600,
                                                             early_stopping=False, random_state=SEED))
    raise ValueError(name)


GRIDS = {
    'logistic_regression': [{'C': c} for c in (0.03, 0.1, 0.3, 1.0)],
    'decision_tree': [{'max_depth': d, 'min_samples_leaf': l} for d in (3, 4, 5) for l in (5, 15)],
    'random_forest': [{'max_depth': d, 'min_samples_leaf': l} for d in (5, 8, None) for l in (2, 5)],
    'lightgbm': [{'num_leaves': nl, 'min_child_samples': mc, 'learning_rate': 0.05, 'n_estimators': ne, 'reg_lambda': 5.0}
                 for nl in (7, 15) for mc in (10, 20) for ne in (150, 300)],
    'neural_net': [{'alpha': a} for a in (1e-3, 1e-2, 1e-1)],
}


def fit(model, X, y, w):
    """Fit with sample weights; pipelines route them to the final estimator."""
    if hasattr(model, 'steps'):
        last = model.steps[-1][0]
        return model.fit(X, y, **{f'{last}__sample_weight': w})
    return model.fit(X, y, sample_weight=w)


def balanced_weights(y: np.ndarray, w: np.ndarray, name: str) -> np.ndarray:
    """MLP has no class_weight option; rebalance through the sample weights instead."""
    if name != 'neural_net':
        return w
    pos, neg = w[y == 1].sum(), w[y == 0].sum()
    return np.where(y == 1, w * (pos + neg) / (2 * pos), w * (pos + neg) / (2 * neg))


def oof_predictions(name, params, X, y, w, groups, cols, folds) -> np.ndarray:
    out = np.zeros(len(y))
    for tr, va in folds:
        m = make_model(name, params, cols)
        fit(m, X[tr], y[tr], balanced_weights(y[tr], w[tr], name))
        out[va] = m.predict_proba(X[va])[:, 1]
    return out


# ---------------------------------------------------------------- ensemble maths

def fit_stacker(Z: np.ndarray, y: np.ndarray, w: np.ndarray, l2: float = 1e-2) -> tuple[float, np.ndarray]:
    """Weighted logistic regression on base-model logits, weights constrained >= 0 (L-BFGS-B)."""
    k = Z.shape[1]

    def loss(theta):
        a, b = theta[0], theta[1:]
        p = sigmoid(a + Z @ b)
        p = np.clip(p, 1e-9, 1 - 1e-9)
        nll = -np.sum(w * (y * np.log(p) + (1 - y) * np.log(1 - p))) / w.sum()
        grad_z = w * (p - y) / w.sum()
        return nll + l2 * np.sum(b ** 2), np.concatenate([[grad_z.sum()], Z.T @ grad_z + 2 * l2 * b])

    res = minimize(loss, np.concatenate([[0.0], np.full(k, 1.0 / k)]), jac=True, method='L-BFGS-B',
                   bounds=[(None, None)] + [(0.0, None)] * k)
    return float(res.x[0]), res.x[1:]


def stack(Z: np.ndarray, intercept: float, weights: np.ndarray) -> np.ndarray:
    return sigmoid(intercept + Z @ weights)


def conformal_quantiles(p: np.ndarray, y: np.ndarray, alpha: float = ALPHA) -> dict[str, float]:
    """Mondrian split conformal: per-class quantile of the nonconformity score 1 - p(true class)."""
    q = {}
    for cls, score in ((1, 1 - p[y == 1]), (0, p[y == 0])):
        n = len(score)
        level = min(1.0, np.ceil((n + 1) * (1 - alpha)) / n)
        q[str(cls)] = float(np.quantile(score, level, method='higher'))
    return q


def conformal_set(p: np.ndarray, q: dict[str, float]) -> list[list[int]]:
    return [[c for c, ok in ((1, 1 - x <= q['1']), (0, x <= q['0'])) if ok] for x in np.atleast_1d(p)]


def psi_reference(values: np.ndarray, bins: int = 10) -> dict:
    edges = np.unique(np.quantile(values, np.linspace(0, 1, bins + 1)))
    edges[0], edges[-1] = -np.inf, np.inf
    counts = np.histogram(values, bins=edges)[0]
    return {'edges': [float(e) for e in edges[1:-1]], 'shares': (counts / counts.sum()).tolist()}


def bayes_threshold(cost_ratio: float) -> float:
    return 1.0 / (1.0 + cost_ratio)


def shift_prior(p: np.ndarray, train_prev: float, target_prev: np.ndarray | float) -> np.ndarray:
    return sigmoid(logit(p) - logit(np.array([train_prev]))[0] + logit(np.atleast_1d(target_prev)))


# ---------------------------------------------------------------- training

def load_training() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame | None, list[str]]:
    df = load_portfolio()
    cols = feature_columns(df)
    train_i, test_i = holdout_split(df)
    train, test = df.iloc[train_i].reset_index(drop=True), df.iloc[test_i].reset_index(drop=True)
    return train, test, load_labels(LABELS), cols


def load_labels(path) -> pd.DataFrame | None:
    """Analyst-labelled cases exported by ml/export_labels.ts, or None when there are none."""
    if not path.exists():
        return None
    real = pd.read_csv(path)
    if len(real) == 0:
        return None
    real['merchant_id'] = 'case:' + real['merchant_id'].astype(str)
    real['kind'] = 'analyst label'
    return real


def train_ensemble(train: pd.DataFrame, cols: list[str], real: pd.DataFrame | None, params: dict | None = None, verbose: bool = True):
    rng = np.random.default_rng(SEED)
    frames = [train.assign(_w=1.0, _aug=0), coverage_dropout(train, rng).assign(_w=1.0, _aug=1)]
    if real is not None:
        frames.append(real.assign(_w=REAL_LABEL_WEIGHT, _aug=0))
    full = pd.concat(frames, ignore_index=True)
    X, y, w = matrix(full, cols), full['label'].to_numpy(dtype=int), full['_w'].to_numpy(dtype=float)
    groups = full['merchant_id'].astype(str).to_numpy()
    folds = list(StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED).split(X, y, groups))

    chosen, oof = {}, {}
    for name in BASE:
        best = None
        for cand in ([params[name]] if params else GRIDS[name]):
            p = oof_predictions(name, cand, X, y, w, groups, cols, folds)
            ll = log_loss(y, np.clip(p, 1e-6, 1 - 1e-6), sample_weight=w)
            if best is None or ll < best[0]:
                best = (ll, cand, p)
        chosen[name], oof[name] = best[1], best[2]
        if verbose:
            print(f'  {name:20} params={best[1]}  grouped-CV log loss={best[0]:.4f}  AP={average_precision_score(y, best[2], sample_weight=w):.4f}')

    Z = np.column_stack([logit(oof[n]) for n in BASE])
    intercept, weights = fit_stacker(Z, y, w)
    # Second-level cross-validation: stacked predictions for rows whose stacker never saw them, for conformal calibration.
    stacked_oof = np.zeros(len(y))
    for tr, va in folds:
        a, b = fit_stacker(Z[tr], y[tr], w[tr])
        stacked_oof[va] = stack(Z[va], a, b)

    fitted = {}
    for name in BASE:
        m = make_model(name, chosen[name], cols)
        fit(m, X, y, balanced_weights(y, w, name))
        fitted[name] = m

    orig = full['_aug'].to_numpy() == 0
    # Post-hoc calibration: choose identity / beta / isotonic by cross-fitted log loss on the blind stacked predictions.
    cal_name, cal_oof, cal_table = select_calibration(stacked_oof[orig], y[orig], w[orig])
    calibrator = CALIBRATORS[cal_name]().fit(stacked_oof[orig], y[orig], w[orig])
    if verbose:
        print('  calibration (cross-fitted log loss):', {k: round(v, 4) for k, v in cal_table.items()}, '->', cal_name)
    q = conformal_quantiles(cal_oof, y[orig])
    oof_dist = np.zeros(len(y))
    for tr, va in folds:
        oof_dist[va] = Novelty().fit(X[tr]).distance(X[va])
    novelty = Novelty().fit(X)
    novelty.threshold = float(np.quantile(oof_dist, OOD_QUANTILE))
    constant = [c for c, sd in zip(cols, X.std(axis=0)) if sd < 1e-12]
    train_prev = float(np.average(y, weights=w))
    yo = y[orig]
    return {
        'models': fitted, 'params': chosen, 'intercept': intercept, 'weights': weights, 'conformal': q, 'novelty': novelty,
        'calibrator': calibrator, 'calibration_table': cal_table,
        # Nonconformity scores of the blind, calibrated predictions, per class, for conformal p-values at serving time.
        'conformal_scores': {'1': np.sort(1 - cal_oof[yo == 1]).tolist(), '0': np.sort(cal_oof[yo == 0]).tolist()},
        'np': np_threshold(cal_oof[yo == 0], alpha=NP_ALPHA, delta=NP_DELTA),
        'novelty_oof': np.sort(oof_dist),
        'reference': {'features': {c: np.quantile(X[orig][:, j], np.linspace(0, 1, 101)).tolist() for j, c in enumerate(cols)},
                      'score': np.quantile(cal_oof, np.linspace(0, 1, 101)).tolist()},
        'train_prevalence': train_prev, 'oof_stacked': cal_oof, 'oof_y': yo,
        'oof_mean': np.mean(np.column_stack([oof[n] for n in BASE]), axis=1)[orig], 'n_train': int(len(y)),
        'n_real': int(0 if real is None else len(real)), 'constant_features': constant,
        # Baseline for the linear-SHAP and integrated-gradients explanations (ml/explain.py): the training-input mean.
        'background_mean': X.mean(axis=0),
    }


CALIBRATORS = {'identity': IdentityCalibrator, 'beta': BetaCalibrator, 'isotonic': IsotonicCalibrator}


def select_calibration(p: np.ndarray, y: np.ndarray, w: np.ndarray) -> tuple[str, np.ndarray, dict[str, float]]:
    """Cross-fit each calibrator (5 folds) and keep the one with the lowest weighted log loss on rows it did not fit."""
    folds = list(StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED).split(p.reshape(-1, 1), y))
    table, preds = {}, {}
    for name, cls in CALIBRATORS.items():
        out = np.zeros(len(y))
        for tr, va in folds:
            out[va] = cls().fit(p[tr], y[tr], w[tr]).predict(p[va])
        preds[name] = np.clip(out, 1e-6, 1 - 1e-6)
        table[name] = float(log_loss(y, preds[name], sample_weight=w))
    best = min(table, key=table.get)
    return best, preds[best], table


def predict(ens: dict, df: pd.DataFrame, cols: list[str]) -> dict[str, np.ndarray]:
    X = matrix(df, cols)
    base = {n: ens['models'][n].predict_proba(X)[:, 1] for n in BASE}
    Z = np.column_stack([logit(base[n]) for n in BASE])
    raw = stack(Z, ens['intercept'], ens['weights'])
    members = np.vstack([base[n] for n in BASE])
    unc = entropy_decomposition(members, np.maximum(ens['weights'], 0) + 1e-12)
    return {**base, 'mean': np.mean(members, axis=0), 'stacked_raw': raw,
            'stacked': np.clip(ens['calibrator'].predict(raw), 1e-6, 1 - 1e-6),
            'epistemic': unc['epistemic'], 'aleatoric': unc['aleatoric'], 'distance': ens['novelty'].distance(X)}


def train_threshold(ens: dict, cost_ratio: float, median_prior: float) -> float:
    """The training-scale probability that equals the Bayes threshold after moving to a typical engine prior."""
    t_adj = bayes_threshold(cost_ratio)
    return float(sigmoid(logit(np.array([t_adj]))[0] - logit(np.array([median_prior]))[0] + logit(np.array([ens['train_prevalence']]))[0]))


def leave_one_kind_out(df_train: pd.DataFrame, df_all: pd.DataFrame, cols: list[str], params: dict, t: float) -> list[dict]:
    """Retrain without one fraud type, then score every merchant of that type: can the models catch fraud they never saw?"""
    rows = []
    for kind in sorted(df_all.loc[df_all['label'] == 1, 'kind'].unique()):
        ens = train_ensemble(df_train[df_train['kind'] != kind].reset_index(drop=True), cols, None, params, verbose=False)
        unseen = df_all[df_all['kind'] == kind].reset_index(drop=True)
        pr = predict(ens, unseen, cols)
        flagged_ood = pr['distance'] > ens['novelty'].threshold
        n = len(unseen)
        k_mean, k_st = int((pr['mean'] >= t).sum()), int((pr['stacked'] >= t).sum())
        k_any = int(((pr['stacked'] >= t) | flagged_ood).sum())
        rows.append({'kind': kind, 'n': int(n),
                     'recall_mean_ensemble': k_mean / n, 'recall_mean_ensemble_ci': wilson_interval(k_mean, n),
                     'recall_stacked': k_st / n, 'recall_stacked_ci': wilson_interval(k_st, n),
                     'novelty_flagged': float(flagged_ood.mean()),
                     'caught_or_flagged': k_any / n, 'caught_or_flagged_ci': wilson_interval(k_any, n),
                     'mean_epistemic_bits': float(pr['epistemic'].mean()),
                     'engine_open_case': float((unseen['posterior'] >= 0.5).mean()) if 'posterior' in unseen else None})
        lo, hi = rows[-1]['recall_stacked_ci']
        print(f"  unseen {kind:28} n={n:3}  mean-ens {k_mean / n:.2f}  stacked {k_st / n:.2f} [{lo:.2f}, {hi:.2f}]  "
              f"novelty {rows[-1]['novelty_flagged']:.2f}  caught-or-flagged {k_any / n:.2f}  epistemic {rows[-1]['mean_epistemic_bits']:.3f} bits")
    return rows


def save(ens: dict, cols: list[str], report: dict, out) -> None:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    joblib.dump({'models': ens['models'], 'features': cols, 'novelty': ens['novelty']}, out / 'models.joblib')
    write_json(out / 'ensemble.json', {
        'version': VERSION, 'trainedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'data': {'file': str(DATA.relative_to(ROOT)), 'sha256': hashlib.sha256(DATA.read_bytes()).hexdigest(),
                 'synthetic': True, 'trainingRows': ens['n_train'], 'analystLabels': ens['n_real']},
        'baseModels': BASE, 'params': ens['params'],
        'stacker': {'intercept': ens['intercept'], 'weights': dict(zip(BASE, ens['weights'].tolist()))},
        'calibration': {**ens['calibrator'].params(), 'crossFittedLogLoss': ens['calibration_table']},
        'trainPrevalence': ens['train_prevalence'],
        'costRatio': COST_RATIO, 'bayesThreshold': bayes_threshold(COST_RATIO),
        'neymanPearson': ens['np'],
        'conformal': {'alpha': ALPHA, 'quantiles': ens['conformal'], 'scores': ens['conformal_scores']},
        'novelty': {'method': 'mahalanobis-ledoit-wolf', 'shrinkage': ens['novelty'].shrinkage,
                    'threshold': ens['novelty'].threshold, 'quantile': OOD_QUANTILE,
                    'oofDistances': ens['novelty_oof'].tolist(),
                    'featuresNeverSeenVarying': ens['constant_features']},
        'psi': {'score': psi_reference(ens['oof_stacked'])},
        'reference': ens['reference'],
        'explain': {'method': 'stacked-logit SHAP (ml/explain.py)', 'backgroundMean': ens['background_mean'].tolist()},
        'evaluation': report,
    })


def evaluate(ens: dict, train: pd.DataFrame, test: pd.DataFrame, cols: list[str]) -> dict:
    y = test['label'].to_numpy()
    pr = predict(ens, test, cols)
    median_prior = float(np.median(test['prior'])) if 'prior' in test else 0.012
    t = train_threshold(ens, COST_RATIO, median_prior)
    rep = {'heldoutMerchants': int(len(test)), 'threshold': t, 'models': {}}
    for name in BASE + ['mean', 'stacked']:
        m = metrics(y, pr[name], t)
        m['ap_ci'] = bootstrap_ci(y, pr[name], average_precision_score, draws=500)
        m['brier_ci'] = bootstrap_ci(y, pr[name], brier_score_loss, draws=500)
        rep['models'][name] = m
    sets = conformal_set(pr['stacked'], ens['conformal'])
    singleton = np.array([len(s) == 1 for s in sets])
    covered = np.array([int(lbl) in s for lbl, s in zip(y, sets)])
    rep['conformal'] = {'coverage_front': float(covered[y == 1].mean()), 'coverage_honest': float(covered[y == 0].mean()),
                        'singleton_share': float(singleton.mean()),
                        'singleton_accuracy': float(covered[singleton].mean()) if singleton.any() else None}
    rep['novelty'] = {'heldout_flag_rate': float((pr['distance'] > ens['novelty'].threshold).mean())}

    # Deeper diagnostics on the held-out merchants.
    s, mn = pr['stacked'], pr['mean']
    rep['calibration'] = {'method': ens['calibrator'].params()['method'], 'crossFittedLogLoss': ens['calibration_table'],
                          'brierDecomposition': {'stacked': brier_decomposition(y, s), 'mean': brier_decomposition(y, mn)},
                          'brierSkill': {'stacked': brier_skill_score(y, s), 'mean': brier_skill_score(y, mn)},
                          'reliabilityCurve': reliability_curve(y, s)}
    rep['significance'] = {
        'delong': {f'stacked_vs_{n}': delong_test(y, s, pr[n]) for n in BASE + ['mean']},
        'mcnemar_stacked_vs_mean_at_threshold': mcnemar_exact((s >= t).astype(int), (mn >= t).astype(int), y),
    }
    npt = ens['np']['threshold']
    if npt is not None:
        flag = s > npt
        k_fa, n_h = int((flag & (y == 0)).sum()), int((y == 0).sum())
        rep['neymanPearson'] = {**ens['np'], 'heldoutRecall': float((flag & (y == 1)).sum() / max(1, (y == 1).sum())),
                                'heldoutFalseAlarm': k_fa / max(1, n_h), 'heldoutFalseAlarmCi': wilson_interval(k_fa, n_h)}
    curve = expected_cost_curve(y, s, cost_fn=COST_RATIO, cost_fp=1.0, prevalence=median_prior)
    best = min(curve, key=lambda r: r['cost'])
    rep['expectedCost'] = {'atDeploymentPrevalence': median_prior, 'bestThreshold': best['t'], 'bestCostPerMerchant': best['cost'],
                           'costAtChosenThreshold': next(r['cost'] for r in curve if r['t'] >= t - 1e-9),
                           'costFlagNobody': COST_RATIO * median_prior}
    err = ((s >= t).astype(int) != y).astype(int)
    rep['uncertainty'] = {'meanEpistemicBits': float(pr['epistemic'].mean()), 'meanAleatoricBits': float(pr['aleatoric'].mean()),
                          'errorsAtThreshold': int(err.sum()),
                          'epistemicAurocForErrors': float(roc_auc_score(err, pr['epistemic'])) if 0 < err.sum() < len(err) else None}
    samples = load_samples()
    if samples is not None:
        sp = predict(ens, samples, cols)
        rep['samples'] = {mid: {'label': int(lbl), 'stacked': round(float(p), 3), 'mean': round(float(m), 3),
                                'set': cs, 'novel': bool(d > ens['novelty'].threshold), 'distance': round(float(d), 1),
                                'epistemicBits': round(float(ep), 3),
                                'unfamiliar': ens['novelty'].drivers(x, cols) if d > ens['novelty'].threshold else []}
                          for mid, lbl, p, m, cs, d, ep, x in zip(samples['merchant_id'], samples['label'], sp['stacked'], sp['mean'],
                                                                  conformal_set(sp['stacked'], ens['conformal']), sp['distance'],
                                                                  sp['epistemic'], matrix(samples, cols))}
    return rep


def nested_cv(df_all: pd.DataFrame, cols: list[str], t: float, folds: int = 5) -> dict:
    """Unbiased estimate of the whole pipeline: hyperparameter search, stacking and calibration are redone inside every
    outer fold, and each merchant is scored exactly once by a pipeline that never saw it (Varma & Simon 2006)."""
    y = df_all['label'].to_numpy()
    groups = df_all['merchant_id'].astype(str).to_numpy()
    p_st, p_mn = np.zeros(len(y)), np.zeros(len(y))
    outer = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=SEED + 1)
    for i, (tr, te) in enumerate(outer.split(np.zeros(len(y)), y, groups)):
        ens = train_ensemble(df_all.iloc[tr].reset_index(drop=True), cols, None, verbose=False)
        pr = predict(ens, df_all.iloc[te].reset_index(drop=True), cols)
        p_st[te], p_mn[te] = pr['stacked'], pr['mean']
        print(f'  outer fold {i + 1}/{folds}: log loss stacked {log_loss(y[te], p_st[te], labels=[0, 1]):.4f}, '
              f'mean {log_loss(y[te], np.clip(p_mn[te], 1e-6, 1 - 1e-6), labels=[0, 1]):.4f}')
    out = {'merchants': int(len(y)), 'folds': folds}
    for name, p in (('stacked', p_st), ('mean', p_mn)):
        m = metrics(y, p, t)
        m['log_loss_ci'] = bootstrap_ci(y, p, lambda a, b: log_loss(a, np.clip(b, 1e-6, 1 - 1e-6), labels=[0, 1]), draws=500)
        m['brier_ci'] = bootstrap_ci(y, p, brier_score_loss, draws=500)
        m['brierDecomposition'] = brier_decomposition(y, p)
        out[name] = m
    out['delong_stacked_vs_mean'] = delong_test(y, p_st, p_mn)
    out['logLossDelta'] = paired_bootstrap_delta(y, p_mn, p_st, lambda a, b: log_loss(a, np.clip(b, 1e-6, 1 - 1e-6), labels=[0, 1]))
    return out


def bundle_scores(path, frame: pd.DataFrame) -> np.ndarray:
    """Calibrated stacked probabilities from a saved bundle (ensemble.json + models.joblib)."""
    bundle = joblib.load(path / 'models.joblib')
    meta = json.loads((path / 'ensemble.json').read_text())
    X = matrix(frame, bundle['features'])
    Z = np.column_stack([logit(bundle['models'][n].predict_proba(X)[:, 1]) for n in meta['baseModels']])
    raw = stack(Z, meta['stacker']['intercept'], np.array([meta['stacker']['weights'][n] for n in meta['baseModels']]))
    return np.clip(apply_calibration(meta.get('calibration', {'method': 'identity'}), raw), 1e-6, 1 - 1e-6)


def promote(candidate=None, champion=None, models_dir=None, test: pd.DataFrame | None = None, verbose: bool = True) -> dict:
    """Champion/challenger: promote the candidate only if it is not worse on the fixed held-out merchants."""
    candidate, champion, models_dir = candidate or CANDIDATE, champion or CHAMPION, models_dir or MODELS
    if not (candidate / 'ensemble.json').exists():
        raise SystemExit('No candidate. Run python -m ml.train_stage2 first.')
    if test is None:
        df = load_portfolio()
        _, test_i = holdout_split(df)
        test = df.iloc[test_i].reset_index(drop=True)
    y = test['label'].to_numpy()
    new = bundle_scores(candidate, test)
    decision = {'at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'candidate': json.loads((candidate / 'ensemble.json').read_text())['data']}
    if (champion / 'ensemble.json').exists():
        old = bundle_scores(champion, test)
        # Non-inferiority on three proper or ranking scores; log loss is the most sensitive when AP is saturated.
        ap = paired_bootstrap_delta(y, new, old, average_precision_score)
        neg_brier = paired_bootstrap_delta(y, new, old, lambda a, b: -brier_score_loss(a, b))
        neg_ll = paired_bootstrap_delta(y, new, old, lambda a, b: -log_loss(a, b, labels=[0, 1]))
        decision.update({'ap': ap, 'negBrier': neg_brier, 'negLogLoss': neg_ll,
                         'rule': 'promote if the 95% lower bound of each delta is >= -0.01 (AP, Brier) and >= -0.02 (log loss)'})
        ok = ap['lo'] >= -0.01 and neg_brier['lo'] >= -0.01 and neg_ll['lo'] >= -0.02
    else:
        ok = True
        decision['note'] = 'No champion yet; first promotion.'
    decision['promoted'] = bool(ok)
    with (models_dir / 'promotions.jsonl').open('a', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(decision, default=float) + '\n')
    if ok:
        prev = champion.parent / f'{champion.name}.previous'
        if prev.exists():
            shutil.rmtree(prev)
        if champion.exists():
            champion.rename(prev)
        shutil.copytree(candidate, champion)
    if verbose:
        print(json.dumps(decision, indent=2, default=float))
    return decision


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--promote', action='store_true', help='champion/challenger gate, then promote the candidate')
    ap.add_argument('--skip-loko', action='store_true', help='skip the leave-one-fraud-type-out study (faster)')
    ap.add_argument('--skip-nested', action='store_true', help='skip nested cross-validation (faster)')
    args = ap.parse_args()
    if args.promote:
        return promote()
    t0 = time.time()
    train, test, real, cols = load_training()
    print(f'Training on {len(train)} synthetic merchants (+ coverage-dropout copies), {0 if real is None else len(real)} analyst labels, {len(cols)} features')
    ens = train_ensemble(train, cols, real)
    print('  stacker weights:', {n: round(float(v), 3) for n, v in zip(BASE, ens['weights'])}, 'intercept', round(ens['intercept'], 3))
    report = evaluate(ens, train, test, cols)
    if not args.skip_loko:
        print('Leave-one-fraud-type-out:')
        report['leaveOneKindOut'] = leave_one_kind_out(train, pd.concat([train, test], ignore_index=True), cols, ens['params'], report['threshold'])
    if not args.skip_nested:
        print('Nested cross-validation over all merchants (full pipeline refit in each outer fold):')
        report['nestedCv'] = nested_cv(pd.concat([train, test], ignore_index=True), cols, report['threshold'])
    save(ens, cols, report, CANDIDATE)
    # The held-out merchant ids, also read by the v0 tests (same split as ml/train_m1.py).
    (ROOT / 'ml' / 'data' / 'test_ids.csv').write_text(
        'merchant_id\n' + ''.join(f'{m}\n' for m in test['merchant_id'].astype(str)), encoding='utf-8', newline='\n')
    write_json(ROOT / 'reports' / 'stage2-v1-evaluation.json', report)
    print(f"\nHeld-out ({report['heldoutMerchants']} merchants), threshold {report['threshold']:.3f}:")
    print(f"{'model':20} {'AP':>6} {'AUC':>6} {'Brier':>6} {'LogL':>6} {'ECE':>6} {'recall':>7} {'falseAl':>7}")
    for n, m in report['models'].items():
        print(f"{n:20} {m['ap']:6.3f} {m['roc_auc']:6.3f} {m['brier']:6.3f} {m['log_loss']:6.3f} {m['ece']:6.3f} {m['recall']:7.3f} {m['false_alarm_rate']:7.3f}")
    print('conformal:', report['conformal'], '| novelty:', report['novelty'])
    bd = report['calibration']['brierDecomposition']['stacked']
    print(f"calibration: {report['calibration']['method']}  Brier {bd['brier']:.4f} = reliability {bd['reliability']:.4f} - resolution "
          f"{bd['resolution']:.4f} + uncertainty {bd['uncertainty']:.4f}; skill {report['calibration']['brierSkill']['stacked']:.3f}")
    for k, d in report['significance']['delong'].items():
        print(f"  DeLong {k:32} AUC {d['auc1']:.4f} vs {d['auc2']:.4f}  z={d['z']:+.2f}  p={d['p']:.3g}")
    if 'neymanPearson' in report:
        r = report['neymanPearson']
        print(f"Neyman-Pearson (FPR<= {r['alpha']} w.p. {1 - r['delta']}): threshold {r['threshold']:.3f}, held-out recall {r['heldoutRecall']:.3f}, "
              f"false alarm {r['heldoutFalseAlarm']:.3f} CI {np.round(r['heldoutFalseAlarmCi'], 3).tolist()}")
    ec = report['expectedCost']
    print(f"expected cost at prevalence {ec['atDeploymentPrevalence']:.4f}: best t={ec['bestThreshold']:.2f} cost {ec['bestCostPerMerchant']:.4f}; "
          f"chosen t cost {ec['costAtChosenThreshold']:.4f}; flag nobody {ec['costFlagNobody']:.4f}")
    print('uncertainty:', report['uncertainty'])
    if 'nestedCv' in report:
        for n in ('stacked', 'mean'):
            m = report['nestedCv'][n]
            print(f"  nested {n:8} AP {m['ap']:.4f}  log loss {m['log_loss']:.4f} CI {np.round(m['log_loss_ci'], 4).tolist()}  Brier {m['brier']:.4f}  ECE {m['ece']:.4f}")
        d = report['nestedCv']['logLossDelta']
        print(f"  nested log loss reduction (mean - stacked) {d['delta']:+.4f} CI [{d['lo']:+.4f}, {d['hi']:+.4f}]")
    for mid, s in report.get('samples', {}).items():
        print(f"  {mid:38} label={s['label']} stacked={s['stacked']:.3f} mean={s['mean']:.3f} set={s['set']} novel={s['novel']} d={s['distance']} {s['unfamiliar']}")
    print(f'Wrote {CANDIDATE} in {time.time() - t0:.0f}s. Promote with: python -m ml.train_stage2 --promote')


if __name__ == '__main__':
    main()
