"""Compare the pruning, bootstrap-fraction and focal-loss candidates one by one (grouped CV and held-out).

    MRE_ML_JOBS=1 python -m ml.compare_tree_settings     # writes reports/agent4-trees.json
"""
import json

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss
from sklearn.model_selection import StratifiedGroupKFold

from ml.stage2_lib import ROOT, coverage_dropout, feature_columns, holdout_split, load_portfolio, matrix
from ml.stage2_math import brier_decomposition
from ml.train_stage2 import SEED, decision_tree_grid, fit, make_model, oof_predictions


def main() -> None:
    df = load_portfolio()
    cols = feature_columns(df)
    tr, te = holdout_split(df)
    train, test = df.iloc[tr].reset_index(drop=True), df.iloc[te].reset_index(drop=True)
    full = pd.concat([train.assign(_w=1.0), coverage_dropout(train, np.random.default_rng(SEED)).assign(_w=1.0)], ignore_index=True)
    X, y, w = matrix(full, cols), full['label'].to_numpy(), full['_w'].to_numpy()
    g = full['merchant_id'].astype(str).to_numpy()
    folds = list(StratifiedGroupKFold(5, shuffle=True, random_state=SEED).split(X, y, g))
    Xt, yt = matrix(test, cols), test['label'].to_numpy()
    rows = []

    def run(name, p, label):
        o = oof_predictions(name, p, X, y, w, g, cols, folds)
        cv = log_loss(y, np.clip(o, 1e-6, 1 - 1e-6), sample_weight=w)
        m = make_model(name, p, cols)
        fit(m, X, y, w)
        q = np.clip(m.predict_proba(Xt)[:, 1], 1e-6, 1 - 1e-6)
        r = {'model': name, 'setting': label, 'params': p, 'cvLogLoss': cv, 'heldoutLogLoss': log_loss(yt, q),
             'heldoutBrier': brier_score_loss(yt, q), 'heldoutAP': average_precision_score(yt, q),
             'heldoutReliability': brier_decomposition(yt, q)['reliability']}
        if name == 'decision_tree':
            r['leaves'] = int(m.get_n_leaves())
        rows.append(r)
        print(f"{name:14} {label:36} cv {cv:.4f} | held-out LL {r['heldoutLogLoss']:.4f} Brier {r['heldoutBrier']:.4f} "
              f"AP {r['heldoutAP']:.4f} REL {r['heldoutReliability']:.4f}" + (f" leaves {r['leaves']}" if 'leaves' in r else ''))

    for c in decision_tree_grid(X, y, w):
        run('decision_tree', c, f"depth={c['max_depth']} ccp_alpha={c['ccp_alpha']:.5f}")
    for s in (None, 0.6):
        run('random_forest', {'max_depth': None, 'min_samples_leaf': 2, 'max_samples': s}, f'depth=None leaf=2 max_samples={s}')
    base = {'num_leaves': 7, 'min_child_samples': 10, 'learning_rate': 0.05, 'n_estimators': 300, 'reg_lambda': 5.0}
    for gm in (0.0, 1.0, 2.0):
        run('lightgbm', {**base, 'gamma': gm}, f'v1 params, focal gamma={gm}')
    (ROOT / 'reports' / 'agent4-trees.json').write_text(json.dumps(rows, indent=2, default=float), encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
