"""Train M1, a LightGBM second opinion. It does not replace the Bayesian decision."""
import json
import hashlib
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score
from sklearn.model_selection import StratifiedKFold, train_test_split

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'ml' / 'data' / 'features.csv'
OUT = ROOT / 'ml' / 'models' / 'm1-v0'
SEED = 7

def main() -> None:
    df = pd.read_csv(DATA)
    y = df['label'].to_numpy()
    ids = df['merchant_id']
    # Drop Bayesian output leakage (posterior, prior, logodds_total) and missingness shortcuts (cov_*, unk_*)
    drop_cols = {'merchant_id', 'label', 'posterior', 'prior', 'logodds_total'}
    cols = [c for c in df.columns if c not in drop_cols and not c.startswith('cov_') and not c.startswith('unk_')]
    X = df[cols].copy()
    mono = [1 if c.startswith('llr_') or c.startswith('fired_') else 0 for c in cols]
    idx = np.arange(len(df))
    train_i, test_i = train_test_split(idx, test_size=0.3, random_state=SEED, stratify=y)
    Xtr_base, ytr_base = X.iloc[train_i].copy(), y[train_i]
    # Coverage-dropout augmentation: mask optional non-acquiring detectors on 40% of rows so M1 cannot collapse onto B9/D10 availability
    rng = np.random.default_rng(SEED)
    opt_dets = ['B9', 'D7', 'D9', 'D10', 'E1', 'E3', 'F2', 'F5', 'F7', 'F8', 'G2', 'G6', 'C5']
    Xtr_aug = Xtr_base.copy()
    for det in opt_dets:
        mask = rng.random(len(Xtr_aug)) < 0.4
        for prefix in ('llr_', 'eff_', 'fired_'):
            col = f'{prefix}{det}'
            if col in Xtr_aug.columns:
                Xtr_aug.loc[mask, col] = 0.0
    Xtr = pd.concat([Xtr_base, Xtr_aug], ignore_index=True)
    ytr = np.concatenate([ytr_base, ytr_base])
    grid = []
    for leaves, child, lr, trees, reg in rng.choice(
        [(a, b, c, d, e) for a in (7, 15) for b in (10, 20, 30) for c in (0.03, 0.05, 0.1) for d in (100, 200) for e in (1, 5, 10)],
        size=24, replace=False,
    ):
        grid.append(dict(num_leaves=int(leaves), min_child_samples=int(child), learning_rate=float(lr), n_estimators=int(trees), reg_lambda=float(reg), colsample_bytree=0.5, subsample=0.8, subsample_freq=1, max_depth=4))
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    pos = max(int((ytr == 1).sum()), 1)
    neg = max(int((ytr == 0).sum()), 1)
    best, best_score = None, -1.0
    for params in grid:
        scores = []
        for tr, va in skf.split(Xtr, ytr):
            clf = lgb.LGBMClassifier(objective='binary', random_state=SEED, deterministic=True, n_jobs=1, scale_pos_weight=neg / pos, monotone_constraints=mono, verbosity=-1, **params)
            clf.fit(Xtr.iloc[tr], ytr[tr])
            scores.append(average_precision_score(ytr[va], clf.predict_proba(Xtr.iloc[va])[:, 1]))
        mean = float(np.mean(scores))
        if mean > best_score:
            best, best_score = params, mean
    assert best is not None
    model = lgb.LGBMClassifier(objective='binary', random_state=SEED, deterministic=True, n_jobs=1, scale_pos_weight=neg / pos, monotone_constraints=mono, verbosity=-1, **best)
    model.fit(Xtr, ytr)
    oof = np.zeros(len(ytr))
    for tr, va in skf.split(Xtr, ytr):
        fold = lgb.LGBMClassifier(objective='binary', random_state=SEED, deterministic=True, n_jobs=1, scale_pos_weight=neg / pos, monotone_constraints=mono, verbosity=-1, **best)
        fold.fit(Xtr.iloc[tr], ytr[tr])
        oof[va] = fold.predict_proba(Xtr.iloc[va])[:, 1]
    iso = IsotonicRegression(out_of_bounds='clip')
    iso.fit(oof, ytr)
    OUT.mkdir(parents=True, exist_ok=True)
    model.booster_.save_model(str(OUT / 'model.txt'))
    (OUT / 'calibrator.json').write_text(json.dumps({'X_thresholds_': iso.X_thresholds_.tolist(), 'y_thresholds_': iso.y_thresholds_.tolist()}))
    (OUT / 'features.json').write_text(json.dumps(cols))
    (OUT / 'params.json').write_text(json.dumps({'params': best, 'cv_average_precision': best_score}))
    raw = DATA.read_bytes()
    card = f"""# M1-v0 model card

Purpose: second opinion on P(front). It does not choose the action.

Data: synthetic portfolio (`ml/data/features.csv`), SHA-256 {hashlib.sha256(raw).hexdigest()}.

Features: {len(cols)} columns from the TypeScript engine. Monotone +1 on llr_* and fired_*.

Params: {json.dumps(best)}. Cross-validated average precision {best_score:.4f}.

Limits: trained on synthetic data derived from nine hand-built samples. Not a measure of real-world accuracy. Second opinion only.
"""
    (OUT / 'model_card.md').write_text(card)
    (ROOT / 'ml' / 'data' / 'test_ids.csv').write_text('merchant_id\n' + '\n'.join(ids.iloc[test_i].astype(str)) + '\n')
    print(f'trained M1 cv AP {best_score:.4f} → {OUT}')

if __name__ == '__main__':
    main()
