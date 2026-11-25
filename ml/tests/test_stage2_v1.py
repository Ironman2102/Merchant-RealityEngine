"""Tests for the Stage 2 v1 maths and the v1 scoring path in ml/serve.py."""
from pathlib import Path

import numpy as np
import pytest

from ml.stage2_lib import ece, metrics, paired_bootstrap_delta
from ml.stage2_lib import Novelty
from ml.train_stage2 import bayes_threshold, conformal_quantiles, conformal_set, fit_stacker, shift_prior, stack

ROOT = Path(__file__).resolve().parents[2]
V1 = ROOT / 'ml' / 'models' / 'stage2-v1'


def test_ece_is_zero_for_perfect_calibration_and_large_for_overconfidence():
    p = np.repeat([0.2, 0.8], 1000)
    y = np.concatenate([np.r_[np.ones(200), np.zeros(800)], np.r_[np.ones(800), np.zeros(200)]])
    assert ece(p, y) < 1e-9
    assert ece(np.full(2000, 0.99), y) > 0.45


def test_bayes_threshold_and_prior_shift():
    assert bayes_threshold(1.0) == pytest.approx(0.5)
    assert bayes_threshold(19.0) == pytest.approx(0.05)
    # A prediction equal to the training base rate carries no evidence, so it maps exactly onto the new prior.
    assert shift_prior(np.array([1 / 3]), 1 / 3, 0.012)[0] == pytest.approx(0.012)
    # Shifting preserves the likelihood ratio: odds scale by the ratio of prior odds.
    p = shift_prior(np.array([0.9]), 0.5, 0.1)[0]
    assert (p / (1 - p)) == pytest.approx(9 * (0.1 / 0.9))


def test_stacker_weights_are_non_negative_and_ignore_a_useless_model():
    rng = np.random.default_rng(0)
    y = rng.integers(0, 2, 4000)
    good = np.where(y == 1, 2.0, -2.0) + rng.normal(0, 1, len(y))
    anti = -good + rng.normal(0, 0.1, len(y))  # anti-correlated model: a negative weight would exploit it, we forbid that
    noise = rng.normal(0, 1, len(y))
    a, w = fit_stacker(np.column_stack([good, anti, noise]), y, np.ones(len(y)))
    assert (w >= 0).all()
    assert w[0] > 0.5 and w[1] < 1e-6
    assert metrics(y, stack(np.column_stack([good, anti, noise]), a, w))['roc_auc'] > 0.95


def test_mondrian_conformal_reaches_its_coverage_per_class():
    rng = np.random.default_rng(1)
    y = rng.integers(0, 2, 6000)
    p = np.clip(np.where(y == 1, rng.beta(5, 2, len(y)), rng.beta(2, 5, len(y))), 1e-4, 1 - 1e-4)
    cal, test = slice(0, 3000), slice(3000, None)
    q = conformal_quantiles(p[cal], y[cal], alpha=0.1)
    sets = conformal_set(p[test], q)
    covered = np.array([lbl in s for lbl, s in zip(y[test], sets)])
    for cls in (0, 1):
        assert covered[y[test] == cls].mean() >= 0.88


def test_novelty_flags_points_far_from_training():
    rng = np.random.default_rng(2)
    X = rng.normal(0, 1, (800, 6))
    nv = Novelty().fit(X)
    nv.threshold = float(np.quantile(nv.distance(rng.normal(0, 1, (800, 6))), 0.995))
    assert (nv.distance(rng.normal(0, 1, (500, 6))) > nv.threshold).mean() < 0.03
    far = np.zeros((1, 6))
    far[0, 1:4] = 25.0  # novelty shows in several features at once, as with the fake store's never-seen detectors
    assert nv.distance(far)[0] > nv.threshold
    assert set(nv.drivers(far, list('abcdef'), k=3)) == {'b', 'c', 'd'}


def test_paired_bootstrap_detects_a_better_model():
    rng = np.random.default_rng(3)
    y = rng.integers(0, 2, 600)
    strong = np.clip(np.where(y == 1, 0.8, 0.2) + rng.normal(0, 0.1, len(y)), 0.01, 0.99)
    weak = np.clip(np.where(y == 1, 0.6, 0.4) + rng.normal(0, 0.25, len(y)), 0.01, 0.99)
    from sklearn.metrics import average_precision_score
    d = paired_bootstrap_delta(y, strong, weak, average_precision_score, draws=300)
    assert d['delta'] > 0 and d['lo'] > 0


@pytest.mark.skipif(not (V1 / 'ensemble.json').exists(), reason='Stage 2 v1 not trained')
def test_v1_service_scores_with_prior_shift_conformal_and_novelty():
    import ml.serve as serve
    serve._v1 = None
    h = serve.health()
    assert h['status'] == 'ok' and h['model'] == 'stage2-v1' and h['stage2'] is True

    honest = serve.score(serve.ScoreIn(features={'n_sales': 600, 'weekend_share': 0.28, 'ticket_cv': 0.6,
                                                      'sweep_lag_median_h': 30, 'payer_hhi': 0.01, 'prior': 0.012}))
    e = honest['ensemble']
    assert honest['modelVersion'] == 'stage2-v1' and e['method'] == 'stacked'
    assert 0 <= honest['p'] <= 1 and 0 <= e['pTrainScale'] <= 1
    assert e['priorShift']['applied'] is True and honest['p'] <= e['pTrainScale'] + 1e-9  # prior 1.2% < training 33%
    assert e['confidence'] in ('HIGH', 'MEDIUM', 'LOW') and isinstance(e['novelty']['flagged'], bool)
    assert set(e['conformalSet']) <= {'front', 'honest'}
    assert all(w >= 0 for w in e['weights'].values())
    assert len(honest['classical']) == 4 and honest['nn']['modelVersion'] == 'neural-net-v1'
    # The multi-modal encoders added on main must also run on the v1 path, not only on the v0 fallback.
    if serve._ae_forward({'n_sales': 1.0}) is not None:
        assert 0.0 <= honest['autoencoder']['anomalyScore'] <= 1.0
    u = e['uncertainty']
    assert u['totalBits'] == pytest.approx(u['aleatoricBits'] + u['epistemicBits'], abs=1e-9) and u['epistemicBits'] >= 0
    pv = e['conformalPValues']
    assert 0 < pv['front'] <= 1 and 0 < pv['honest'] <= 1
    assert set(e['conformalSet']) == {c for c in ('front', 'honest') if pv[c] > e['conformalAlpha']}
    assert 0 < e['novelty']['pValue'] <= 1

    weird = serve.score(serve.ScoreIn(features={'llr_B9': 3.0, 'fired_B9': 1, 'eff_B9': 0.55, 'llr_D10': 2.7, 'eff_D10': 0.56}))
    assert weird['ensemble']['novelty']['flagged'] is True and weird['ensemble']['confidence'] == 'LOW'
    assert weird['ensemble']['novelty']['pValue'] < 0.01
    assert weird['ensemble']['priorShift']['applied'] is False

    d = serve.drift(serve.DriftIn(rows=[{'n_sales': 600, 'weekend_share': 0.28}] * 20))
    assert d['n'] == 20 and d['status'] in ('OK', 'MODERATE', 'SIGNIFICANT') and d['psi'] >= 0
    assert 0 <= d['prevalence']['prevalence'] <= 1 and d['featuresTested'] > 0
    assert all(0 <= f['qValue'] <= 1 for f in d['topShiftedFeatures'])
