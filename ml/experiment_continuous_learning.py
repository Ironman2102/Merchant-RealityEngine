"""Continuous-learning experiment, step 2: do analyst labels teach Stage 2 a fraud pattern it has never seen?

    MRE_DB_FILE=<scratch.db> npx tsx ml/simulate_analyst_labels.ts "small side-stream" 40 60
    MRE_DB_FILE=<scratch.db> npx tsx ml/export_labels.ts <labels.csv>
    python -m ml.experiment_continuous_learning --labels <labels.csv> --kind "small side-stream" --work <dir>

A: trained on the synthetic portfolio with that fraud pattern removed, no analyst labels (the world before the pattern).
B: the same, plus the analyst-labelled cases at 5x weight.
Both are scored on fresh merchants of the pattern that no analyst labelled, and on the synthetic held-out merchants
without the pattern (to check the labels did no harm). Then the real champion/challenger gate decides between them.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss

from ml.stage2_lib import ROOT, feature_columns, holdout_split, load_portfolio, metrics, paired_bootstrap_delta, write_json
from ml.stage2_math import mcnemar_exact, wilson_interval
from ml.train_stage2 import CHAMPION, load_labels, predict, promote, save, train_ensemble


def recall_block(y, p, t):
    pos, neg = y == 1, y == 0
    k, f = int((p[pos] >= t).sum()), int((p[neg] >= t).sum())
    return {'recall': k / pos.sum(), 'recallCi': wilson_interval(k, int(pos.sum())),
            'falseAlarm': f / neg.sum(), 'falseAlarmCi': wilson_interval(f, int(neg.sum()))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--labels', required=True, type=Path)
    ap.add_argument('--kind', default='small side-stream')
    ap.add_argument('--work', required=True, type=Path)
    args = ap.parse_args()

    df = load_portfolio()
    cols = feature_columns(df)
    train_i, test_i = holdout_split(df)
    train, test = df.iloc[train_i].reset_index(drop=True), df.iloc[test_i].reset_index(drop=True)
    before = train[train['kind'] != args.kind].reset_index(drop=True)
    real = load_labels(args.labels)
    if real is None:
        raise SystemExit(f'No labels in {args.labels}.')
    champion_meta = json.loads((CHAMPION / 'ensemble.json').read_text())
    params, t = champion_meta['params'], champion_meta['evaluation']['threshold']
    print(f'Synthetic training without "{args.kind}": {len(before)} merchants ({len(train) - len(before)} removed). '
          f'Analyst labels: {len(real)} ({int(real["label"].sum())} fronts).')

    print('Training A (no labels) and B (with labels)...')
    ens_a = train_ensemble(before, cols, None, params, verbose=False)
    ens_b = train_ensemble(before, cols, real, params, verbose=False)

    fresh = pd.read_csv(ROOT / 'ml' / 'data' / 'eval_new_pattern.csv')
    y_new = fresh['label'].to_numpy()
    pa, pb = predict(ens_a, fresh, cols)['stacked'], predict(ens_b, fresh, cols)['stacked']
    ll = lambda a, b: log_loss(a, np.clip(b, 1e-6, 1 - 1e-6), labels=[0, 1])
    rec = lambda a, b: float((b[a == 1] >= t).mean())
    report = {
        'pattern': args.kind, 'threshold': t, 'analystLabels': int(len(real)), 'freshMerchants': int(len(fresh)),
        'fresh': {
            'A_noLabels': {**recall_block(y_new, pa, t), **metrics(y_new, pa, t)},
            'B_withLabels': {**recall_block(y_new, pb, t), **metrics(y_new, pb, t)},
            'recallGain': paired_bootstrap_delta(y_new, pb, pa, rec),
            'logLossReduction': paired_bootstrap_delta(y_new, pa, pb, ll),
            'mcnemar': mcnemar_exact((pb >= t).astype(int), (pa >= t).astype(int), y_new),
        },
    }
    other = test[test['kind'] != args.kind].reset_index(drop=True)
    y_o = other['label'].to_numpy()
    qa, qb = predict(ens_a, other, cols)['stacked'], predict(ens_b, other, cols)['stacked']
    report['noHarm'] = {'merchants': int(len(other)),
                        'A_noLabels': metrics(y_o, qa, t), 'B_withLabels': metrics(y_o, qb, t),
                        'logLossDelta_B_minus_A': paired_bootstrap_delta(y_o, qb, qa, ll)}

    # The real gate, on the fixed held-out merchants (which do include a few of the pattern).
    args.work.mkdir(parents=True, exist_ok=True)
    save(ens_a, cols, {'threshold': t}, args.work / 'champion')
    save(ens_b, cols, {'threshold': t}, args.work / 'candidate')
    log = args.work / 'promotions.jsonl'
    if log.exists():
        log.unlink()
    report['gate'] = promote(args.work / 'candidate', args.work / 'champion', args.work, test=test, verbose=False)
    write_json(ROOT / 'reports' / 'continuous-learning-experiment.json', report)

    f = report['fresh']
    print(f"\nFresh, unlabelled \"{args.kind}\" merchants ({int((y_new == 1).sum())} fronts, {int((y_new == 0).sum())} honest), bar {t:.3f}:")
    for k in ('A_noLabels', 'B_withLabels'):
        r = f[k]
        print(f"  {k:13} recall {r['recall']:.3f} CI [{r['recallCi'][0]:.2f}, {r['recallCi'][1]:.2f}]  false alarms {r['falseAlarm']:.3f}  "
              f"log loss {r['log_loss']:.3f}  Brier {r['brier']:.3f}  AP {r['ap']:.3f}")
    g = f['recallGain']
    print(f"  recall gain {g['delta']:+.3f} CI [{g['lo']:+.3f}, {g['hi']:+.3f}];  log loss reduction {f['logLossReduction']['delta']:+.3f} "
          f"CI [{f['logLossReduction']['lo']:+.3f}, {f['logLossReduction']['hi']:+.3f}];  McNemar {f['mcnemar']}")
    n = report['noHarm']
    print(f"No-harm check on {n['merchants']} held-out merchants of other kinds: log loss A {n['A_noLabels']['log_loss']:.4f} vs "
          f"B {n['B_withLabels']['log_loss']:.4f}; false alarms A {n['A_noLabels']['false_alarm_rate']:.3f} vs B {n['B_withLabels']['false_alarm_rate']:.3f}")
    gate = report['gate']
    print(f"Gate (B challenging A): promoted={gate['promoted']}  "
          + '  '.join(f"{k} {gate[k]['delta']:+.4f} [{gate[k]['lo']:+.4f}, {gate[k]['hi']:+.4f}]" for k in ('ap', 'negBrier', 'negLogLoss')))


if __name__ == '__main__':
    main()
