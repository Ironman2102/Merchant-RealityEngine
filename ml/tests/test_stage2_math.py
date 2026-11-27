"""Each formula in ml/stage2_math.py is checked against an exact identity, an independent implementation, or a simulation."""
import numpy as np
import pytest
from scipy import stats
from sklearn.metrics import roc_auc_score

from ml.stage2_math import (BetaCalibrator, apply_calibration, brier_decomposition, brier_skill_score, conformal_pvalue,
                            delong_test, em_prevalence, entropy_decomposition, expected_cost_curve, ks_statistic,
                            mcnemar_exact, np_threshold, psi, reliability_curve, wilson_interval)


def test_brier_decomposition_is_exact_when_forecasts_are_constant_within_bins():
    rng = np.random.default_rng(0)
    p = rng.choice([0.05, 0.25, 0.45, 0.65, 0.85], 5000)
    y = (rng.random(5000) < np.clip(p + 0.05, 0, 1)).astype(int)  # slightly miscalibrated on purpose
    d = brier_decomposition(y, p)
    assert d['brier'] == pytest.approx(d['reliability'] - d['resolution'] + d['uncertainty'], abs=1e-12)
    assert d['reliability'] > 0 and d['resolution'] > 0


def test_brier_skill_score_is_zero_for_climatology_and_one_for_perfect():
    y = np.r_[np.ones(30), np.zeros(70)]
    assert brier_skill_score(y, np.full(100, 0.3)) == pytest.approx(0.0)
    assert brier_skill_score(y, y) == pytest.approx(1.0)


def test_wilson_interval_matches_statsmodels_reference_values():
    lo, hi = wilson_interval(81, 263)  # reference: 0.2553, 0.3662 (Newcombe 1998, table I style check)
    assert lo == pytest.approx(0.2553, abs=1e-3) and hi == pytest.approx(0.3662, abs=1e-3)
    assert wilson_interval(0, 10)[0] == 0.0


def test_reliability_curve_bins_cover_every_case():
    rng = np.random.default_rng(1)
    p = rng.random(1000)
    y = (rng.random(1000) < p).astype(int)
    curve = reliability_curve(y, p)
    assert sum(b['n'] for b in curve) == 1000
    assert all(b['observedCi'][0] <= b['observed'] <= b['observedCi'][1] for b in curve)


def test_beta_calibration_repairs_an_overconfident_model_and_contains_identity():
    rng = np.random.default_rng(2)
    true = rng.beta(2, 2, 20000)
    y = (rng.random(20000) < true).astype(int)
    over = 1 / (1 + np.exp(-3 * np.log(true / (1 - true))))   # overconfident distortion
    cal = BetaCalibrator().fit(over, y)
    fixed = cal.predict(over)
    assert np.mean((fixed - true) ** 2) < 0.1 * np.mean((over - true) ** 2)
    assert np.allclose(apply_calibration(cal.params(), over), fixed)
    ident = BetaCalibrator().fit(true, y)
    assert ident.a == pytest.approx(1, abs=0.1) and ident.b == pytest.approx(1, abs=0.1) and ident.c == pytest.approx(0, abs=0.1)


def test_delong_auc_matches_sklearn_and_variance_matches_bootstrap():
    rng = np.random.default_rng(3)
    y = rng.integers(0, 2, 400)
    a = y * 1.0 + rng.normal(0, 1, 400)
    b = y * 0.6 + rng.normal(0, 1, 400)
    r = delong_test(y, a, b)
    assert r['auc1'] == pytest.approx(roc_auc_score(y, a)) and r['auc2'] == pytest.approx(roc_auc_score(y, b))
    diffs = []
    for _ in range(2000):
        i = rng.integers(0, 400, 400)
        diffs.append(roc_auc_score(y[i], a[i]) - roc_auc_score(y[i], b[i]))
    se_boot, se_delong = np.std(diffs), abs(r['diff'] / r['z'])
    assert se_delong == pytest.approx(se_boot, rel=0.15)
    assert delong_test(y, a, a)['p'] == 1.0


def test_delong_has_correct_size_under_the_null():
    rng = np.random.default_rng(4)
    rejections = 0
    for _ in range(400):
        y = rng.integers(0, 2, 200)
        s = y * 0.8 + rng.normal(0, 1, 200)
        rejections += delong_test(y, s + rng.normal(0, 0.5, 200), s + rng.normal(0, 0.5, 200))['p'] < 0.05
    assert 0.02 <= rejections / 400 <= 0.09


def test_mcnemar_counts_discordant_pairs():
    y = np.array([1, 1, 1, 1, 0, 0, 0, 0])
    a = np.array([1, 1, 1, 1, 0, 0, 0, 0])
    b = np.array([0, 0, 0, 1, 0, 0, 0, 0])
    r = mcnemar_exact(a, b, y)
    assert r['aRightBWrong'] == 3 and r['aWrongBRight'] == 0 and r['p'] == pytest.approx(0.25)


def test_neyman_pearson_threshold_controls_false_alarm_rate_with_probability_one_minus_delta():
    rng = np.random.default_rng(5)
    violations = 0
    for _ in range(300):
        t = np_threshold(rng.normal(0, 1, 300), alpha=0.05, delta=0.05)['threshold']
        violations += stats.norm.sf(t) > 0.05          # the true false-alarm rate of this threshold
    assert violations / 300 <= 0.05 + 0.03
    assert np_threshold(np.zeros(10), alpha=0.05, delta=0.05)['threshold'] is None  # 59 honest cases needed


def test_expected_cost_curve_minimum_matches_bayes_rule_for_calibrated_scores():
    rng = np.random.default_rng(6)
    p = rng.random(50000)
    y = (rng.random(50000) < p).astype(int)
    curve = expected_cost_curve(y, p, cost_fn=4.0, cost_fp=1.0, grid=201)
    best = min(curve, key=lambda r: r['cost'])['t']
    assert best == pytest.approx(1 / (1 + 4.0), abs=0.03)


def test_entropy_decomposition_identities():
    same = entropy_decomposition([[0.7], [0.7], [0.7]])
    assert same['epistemic'][0] == pytest.approx(0, abs=1e-12) and same['total'][0] == pytest.approx(same['aleatoric'][0])
    split = entropy_decomposition([[0.999], [0.001]])
    assert split['epistemic'][0] > 0.95 and split['aleatoric'][0] < 0.05      # confident members that disagree
    noisy = entropy_decomposition([[0.5], [0.5]])
    assert noisy['aleatoric'][0] == pytest.approx(1.0) and noisy['epistemic'][0] == pytest.approx(0)


def test_conformal_pvalues_are_uniform_under_exchangeability():
    # The guarantee is marginal over calibration and test draws together, so a fresh calibration set each trial.
    rng = np.random.default_rng(7)
    ps = [conformal_pvalue(rng.normal(0, 1, 50), rng.normal(0, 1), rng) for _ in range(4000)]
    assert stats.kstest(ps, 'uniform').pvalue > 0.01


def test_em_recovers_the_true_prevalence_under_label_shift():
    rng = np.random.default_rng(8)
    pi0, pi1 = 1 / 3, 0.05
    # Calibrated scores at prevalence pi0 from a known likelihood ratio model.
    def batch(pi, n):
        y = rng.random(n) < pi
        s = np.where(y, rng.normal(1.5, 1, n), rng.normal(-1.5, 1, n))
        lr = stats.norm.pdf(s, 1.5) / stats.norm.pdf(s, -1.5)
        return lr * pi0 / (lr * pi0 + (1 - pi0))
    est = em_prevalence(batch(pi1, 20000), pi0)
    assert est['prevalence'] == pytest.approx(pi1, abs=0.01)
    assert est['naiveMean'] > 0.1  # averaging scores alone is badly biased toward the training rate


def test_psi_and_ks_detect_shift_and_stay_quiet_without_it():
    rng = np.random.default_rng(9)
    ref = rng.normal(0, 1, 20000)
    edges = np.quantile(ref, np.linspace(0.1, 0.9, 9))
    q = np.quantile(ref, np.linspace(0, 1, 101))
    same, moved = rng.normal(0, 1, 3000), rng.normal(0.5, 1, 3000)
    assert psi(same, edges, np.full(10, 0.1)) < 0.02 and psi(moved, edges, np.full(10, 0.1)) > 0.2
    assert ks_statistic(same, q)['p'] > 0.01 and ks_statistic(moved, q)['p'] < 1e-6
