"""Check the stacked-ensemble explanations: additivity on every held-out merchant and the demo samples, plus examples.

    python -m ml.explain_report [bundle_dir] [out.json]
"""
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np

from ml.explain import EnsembleExplainer
from ml.stage2_lib import ROOT, holdout_split, load_portfolio, load_samples, matrix, write_json

DEMO = ['01-sweet-crumbs-betting-front', '03-fabricated-online-store', '10-golden-oven-betting-on-the-side', '06-shree-ganesh-sweets-genuine']


def main() -> None:
    bundle = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'ml' / 'models' / 'stage2-v1'
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'reports' / 'agent3-shap.json'
    b = joblib.load(bundle / 'models.joblib')
    meta = json.loads((bundle / 'ensemble.json').read_text())
    bg = meta.get('explain', {}).get('backgroundMean')
    if bg is None:
        raise SystemExit(f'{bundle} has no explain.backgroundMean; retrain with ml.train_stage2.')
    ex = EnsembleExplainer(b['models'], meta['baseModels'], meta['stacker'], bg, b['features'], meta['calibration']['method'])
    df = load_portfolio()
    _, te = holdout_split(df)
    frames = {'heldout': matrix(df.iloc[te], b['features'])}
    samples = load_samples()
    if samples is not None:
        frames['samples'] = matrix(samples, b['features'])

    report = {'bundle': str(bundle.name), 'calibration': meta['calibration']['method'], 'completeness': {}, 'examples': {}}
    for name, X in frames.items():
        t0 = time.time()
        res = [ex.explain(x)['explanation'] for x in X]
        per = {m: np.abs([r['perModel'][m]['completenessError'] for r in res]) for m in meta['baseModels']}
        ens = np.abs([r['residual'] for r in res])
        report['completeness'][name] = {
            'merchants': len(X), 'secondsPerExplanation': (time.time() - t0) / len(X),
            'ensembleResidual': {'max': float(ens.max()), 'mean': float(ens.mean())},
            'perModelMaxAbsError': {m: float(v.max()) for m, v in per.items()},
        }
    if samples is not None:
        for mid, x in zip(samples['merchant_id'], frames['samples']):
            if mid in DEMO:
                r = ex.explain(x)
                e = r['explanation']
                report['examples'][mid] = {
                    'stackedLogit': e['stackedLogit'], 'baseLogit': e['baseLogit'], 'residual': e['residual'],
                    'drivers': r['drivers'],
                    'perModelTop': {m: e['perModel'][m]['top'] for m in meta['baseModels'] if e['perModel'][m]['weight'] > 0},
                }
    write_json(out, report)
    for name, c in report['completeness'].items():
        print(f"{name}: {c['merchants']} merchants, {c['secondsPerExplanation'] * 1000:.0f} ms each; ensemble residual max "
              f"{c['ensembleResidual']['max']:.2e}; per-model max |error| "
              + ', '.join(f'{m} {v:.1e}' for m, v in c['perModelMaxAbsError'].items()))
    for mid, e in report['examples'].items():
        print(f"\n{mid}: logit {e['baseLogit']:+.2f} (base) + {e['stackedLogit'] - e['baseLogit'] - e['residual']:+.2f} (attributions) "
              f"= {e['stackedLogit']:+.2f}")
        for d in e['drivers']:
            print(f"   {d['feature']:22} {d['shap']:+.3f}")


if __name__ == '__main__':
    main()
