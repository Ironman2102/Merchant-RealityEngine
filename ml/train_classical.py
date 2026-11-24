"""Train the Stage 2 LR, shallow decision tree and random forest on curated synthetic fixtures.

The fixture set is intentionally small and synthetic. Saved estimators are a development
ensemble only; the service marks confidence LOW and recommends review at this sample size.
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'ml' / 'data' / 'synthetic_features.csv'
OUT = ROOT / 'ml' / 'models' / 'classical-v0'
SEED = 7

def main() -> None:
    df = pd.read_csv(DATA)
    y = df['label'].to_numpy(dtype=int)
    drop = {'merchant_id', 'label', 'posterior', 'prior', 'logodds_total'}
    cols = [c for c in df.columns if c not in drop and not c.startswith(('cov_', 'unk_'))]
    X = df[cols].replace([np.inf, -np.inf], np.nan).fillna(0).to_numpy(dtype=float)
    if len(y) < 4 or len(np.unique(y)) != 2:
        raise ValueError('Both labels and at least four examples are required.')
    models = {
        'logistic-regression-v0': make_pipeline(StandardScaler(), LogisticRegression(class_weight='balanced', C=0.5, max_iter=2000, random_state=SEED)),
        'decision-tree-v0': DecisionTreeClassifier(max_depth=3, min_samples_leaf=2, class_weight='balanced', random_state=SEED),
        'random-forest-v0': RandomForestClassifier(n_estimators=200, max_depth=4, min_samples_leaf=2, class_weight='balanced', random_state=SEED, n_jobs=1),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    for name, model in models.items():
        model.fit(X, y)
        joblib.dump({'model': model, 'features': cols, 'version': name, 'synthetic': True, 'training_examples': len(y)}, OUT / f'{name}.joblib')
    (OUT / 'metadata.json').write_text(json.dumps({'synthetic': True, 'training_examples': len(y), 'positive': int(y.sum()), 'negative': int((1-y).sum()), 'source': 'ml/data/synthetic_features.csv', 'warning': 'Small synthetic fixture set; low confidence and analyst review required.'}, indent=2))
    print(f'Trained {len(models)} classical models on {len(y)} synthetic examples. These are development opinions only.')

if __name__ == '__main__':
    main()
