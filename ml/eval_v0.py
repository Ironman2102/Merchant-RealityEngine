"""Score the shipped v0 Stage 2 models honestly, as a baseline for v1.

Two views of the held-out merchants:
- as trained: every feature the models were trained on is supplied.
- as served:  the six behavioural features the backend did not send are zero, which is what production scored.
Plus the hand-built demo merchants, whose fake-store and rotation fraud types are absent from training.
"""
import json
import sys

import joblib
import lightgbm as lgb
import numpy as np

from ml.stage2_lib import ROOT, holdout_split, load_portfolio, load_samples, matrix, metrics, write_json

BEHAVIOURAL = ['night_share', 'weekend_share', 'refund_ratio', 'payer_hhi', 'ticket_cv', 'sweep_lag_median_h']


def v0_scores(df) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    m1 = ROOT / 'ml' / 'models' / 'm1-v0'
    cols = json.loads((m1 / 'features.json').read_text())
    cal = json.loads((m1 / 'calibrator.json').read_text())
    raw = lgb.Booster(model_file=str(m1 / 'model.txt')).predict(matrix(df, cols))
    out['lightgbm'] = np.clip(np.interp(raw, cal['X_thresholds_'], cal['y_thresholds_']), 0, 1)
    net = json.loads((ROOT / 'ml' / 'models' / 'nn-v0' / 'network.json').read_text())
    h = (matrix(df, net['features']) - np.asarray(net['mean'])) / np.asarray(net['std'])
    for i, (w, b) in enumerate(zip(net['coefs'], net['intercepts'])):
        h = h @ np.asarray(w) + np.asarray(b)
        h = np.maximum(h, 0) if i < len(net['coefs']) - 1 else 1 / (1 + np.exp(-np.clip(h, -40, 40)))
    out['neural_net'] = np.clip(np.interp(h.ravel(), net['calibrator']['X_thresholds_'], net['calibrator']['y_thresholds_']), 0, 1)
    for p in sorted((ROOT / 'ml' / 'models' / 'classical-v0').glob('*.joblib')):
        b = joblib.load(p)
        out[b['version'].replace('-v0', '')] = b['model'].predict_proba(matrix(df, b['features']))[:, 1]
    out['ensemble_mean'] = np.mean(np.vstack(list(out.values())), axis=0)
    return out


def main() -> None:
    df = load_portfolio()
    _, test_i = holdout_split(df)
    test = df.iloc[test_i].reset_index(drop=True)
    served = test.copy()
    served[BEHAVIOURAL] = 0.0
    report = {'heldout_merchants': int(len(test)), 'as_trained': {}, 'as_served': {}, 'samples': {}}
    for view, frame in (('as_trained', test), ('as_served', served)):
        for name, p in v0_scores(frame).items():
            report[view][name] = metrics(test['label'].to_numpy(), p)
    samples = load_samples()
    if samples is not None:
        for name, p in v0_scores(samples).items():
            report['samples'][name] = {mid: round(float(x), 3) for mid, x in zip(samples['merchant_id'], p)}
    write_json(ROOT / 'reports' / 'stage2-v0-baseline.json', report)
    for view in ('as_trained', 'as_served'):
        print(f'\n== v0 {view} ({len(test)} held-out merchants)')
        print(f"{'model':22} {'AP':>6} {'AUC':>6} {'Brier':>6} {'LogL':>6} {'ECE':>6} {'recall':>7} {'falseAl':>7}")
        for name, m in report[view].items():
            print(f"{name:22} {m['ap']:6.3f} {m['roc_auc']:6.3f} {m['brier']:6.3f} {m['log_loss']:6.3f} {m['ece']:6.3f} {m['recall']:7.3f} {m['false_alarm_rate']:7.3f}")


if __name__ == '__main__':
    sys.exit(main())
