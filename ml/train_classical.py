"""Train the Stage 2 LR, shallow decision tree, and random forest on the synthetic portfolio.

Uses ml/data/features.csv (excluding held-out test_ids.csv) with leakage-free behavioral columns
and 40% coverage-dropout augmentation on optional feeds, falling back to synthetic_features.csv
only if features.csv is not present.
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

ROOT = Path(__file__).resolve().parents[1]
PORTFOLIO_DATA = ROOT / 'ml' / 'data' / 'features.csv'
TEST_IDS_PATH = ROOT / 'ml' / 'data' / 'test_ids.csv'
FALLBACK_DATA = ROOT / 'ml' / 'data' / 'synthetic_features.csv'
OUT = ROOT / 'ml' / 'models' / 'classical-v0'
SEED = 7
OPT_DETS = ['B9', 'D7', 'D9', 'D10', 'E1', 'E3', 'F2', 'F5', 'F7', 'F8', 'G2', 'G6', 'C5']


def main() -> None:
    use_portfolio = PORTFOLIO_DATA.exists()
    data_path = PORTFOLIO_DATA if use_portfolio else FALLBACK_DATA
    df = pd.read_csv(data_path)
    drop = {'merchant_id', 'label', 'posterior', 'prior', 'logodds_total'}
    cols = [c for c in df.columns if c not in drop and not c.startswith(('cov_', 'unk_'))]

    if use_portfolio and TEST_IDS_PATH.exists():
        test_ids = set(pd.read_csv(TEST_IDS_PATH)['merchant_id'].astype(str))
        held = df['merchant_id'].astype(str).isin(test_ids).to_numpy()
        train_df, test_df = df.loc[~held].copy(), df.loc[held].copy()
    elif len(df) >= 20:
        train_df, test_df = train_test_split(df, test_size=0.3, random_state=SEED, stratify=df['label'])
    else:
        train_df, test_df = df.copy(), df.copy()

    rng = np.random.default_rng(SEED)
    aug_df = train_df.copy()
    for det in OPT_DETS:
        mask = rng.random(len(aug_df)) < 0.4
        for prefix in ('llr_', 'eff_', 'fired_'):
            col = f'{prefix}{det}'
            if col in aug_df.columns:
                aug_df.loc[mask, col] = 0.0
    full_train = pd.concat([train_df, aug_df], ignore_index=True)

    Xtr = full_train[cols].replace([np.inf, -np.inf], np.nan).fillna(0).to_numpy(dtype=float)
    ytr = full_train['label'].to_numpy(dtype=int)
    Xte = test_df[cols].replace([np.inf, -np.inf], np.nan).fillna(0).to_numpy(dtype=float)
    yte = test_df['label'].to_numpy(dtype=int)

    if len(ytr) < 4 or len(np.unique(ytr)) != 2:
        raise ValueError('Both labels and at least four examples are required.')

    cv_folds = min(5, max(2, int(min((ytr == 1).sum(), (ytr == 0).sum()))))
    base_models = {
        'logistic-regression-v0': make_pipeline(StandardScaler(), LogisticRegression(class_weight='balanced', C=0.5, max_iter=2000, random_state=SEED)),
        'decision-tree-v0': DecisionTreeClassifier(max_depth=4, min_samples_leaf=5, class_weight='balanced', random_state=SEED),
        'random-forest-v0': RandomForestClassifier(n_estimators=200, max_depth=5, min_samples_leaf=5, max_features='sqrt', class_weight='balanced', random_state=SEED, n_jobs=1),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    metrics_out: dict[str, dict[str, float]] = {}
    for name, est in base_models.items():
        model = CalibratedClassifierCV(est, method='sigmoid', cv=cv_folds) if len(ytr) >= 30 else est
        model.fit(Xtr, ytr)
        prob_te = model.predict_proba(Xte)[:, 1]
        ap = float(average_precision_score(yte, prob_te)) if len(np.unique(yte)) == 2 else 0.0
        rec = float(((prob_te >= 0.10) & (yte == 1)).sum() / max(1, (yte == 1).sum()))
        fp = float(((prob_te >= 0.10) & (yte == 0)).sum() / max(1, (yte == 0).sum()))
        metrics_out[name] = {'heldout_ap': round(ap, 4), 'recall_at_0_10': round(rec, 4), 'genuine_fp_at_0_10': round(fp, 4)}
        joblib.dump({'model': model, 'features': cols, 'version': name, 'synthetic': True, 'training_examples': len(ytr)}, OUT / f'{name}.joblib')

    (OUT / 'metadata.json').write_text(json.dumps({
        'synthetic': True,
        'training_examples': int(len(ytr)),
        'heldout_examples': int(len(yte)),
        'positive': int(ytr.sum()),
        'negative': int((1 - ytr).sum()),
        'source': str(data_path.relative_to(ROOT)),
        'metrics': metrics_out,
        'note': 'Leakage-free behavioral training with 40% coverage-dropout augmentation and sigmoid calibration.',
    }, indent=2))
    print(f'Trained {len(base_models)} classical models on {len(ytr)} examples from {data_path.name}: {metrics_out}')


if __name__ == '__main__':
    main()
