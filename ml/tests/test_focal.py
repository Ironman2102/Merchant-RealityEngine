"""Focal-loss derivatives, the focal LightGBM wrapper, and cost-complexity pruning."""
import pickle

import numpy as np
import pytest
from sklearn.tree import DecisionTreeClassifier

from ml.focal import FocalLGBMClassifier, focal_grad_hess, focal_loss


@pytest.mark.parametrize('gamma', [0.0, 1.0, 2.0, 3.5])
def test_focal_gradient_and_hessian_match_finite_differences(gamma):
    rng = np.random.default_rng(0)
    z = rng.normal(0, 3, 400)
    y = rng.integers(0, 2, 400)
    eps = 1e-5
    g, h = focal_grad_hess(y, z, gamma, floor=-np.inf)
    g_num = (focal_loss(y, z + eps, gamma) - focal_loss(y, z - eps, gamma)) / (2 * eps)
    h_num = (focal_loss(y, z + eps, gamma) - 2 * focal_loss(y, z, gamma) + focal_loss(y, z - eps, gamma)) / eps ** 2
    assert np.allclose(g, g_num, atol=1e-6)
    gg_num = (focal_grad_hess(y, z + eps, gamma, floor=-np.inf)[0] - focal_grad_hess(y, z - eps, gamma, floor=-np.inf)[0]) / (2 * eps)
    assert np.allclose(h, gg_num, atol=1e-5)
    assert np.allclose(h, h_num, atol=1e-3)


def test_gamma_zero_is_exactly_log_loss():
    z = np.linspace(-8, 8, 101)
    for label in (0, 1):
        y = np.full_like(z, label)
        p = 1 / (1 + np.exp(-z))
        g, h = focal_grad_hess(y, z, 0.0)
        assert np.allclose(g, p - label) and np.allclose(h, p * (1 - p))
        assert np.allclose(focal_loss(y, z, 0.0), -(label * np.log(p) + (1 - label) * np.log(1 - p)))


def test_focal_loss_down_weights_easy_examples():
    # A confidently correct example contributes far less gradient under focal loss than under log loss.
    g0, _ = focal_grad_hess(np.array([1]), np.array([4.0]), 0.0)
    g2, _ = focal_grad_hess(np.array([1]), np.array([4.0]), 2.0)
    assert abs(g2[0]) < 0.05 * abs(g0[0])


@pytest.mark.parametrize('gamma', [0.0, 2.0])
def test_focal_lgbm_predicts_probabilities_shap_and_pickles(gamma):
    rng = np.random.default_rng(1)
    X = rng.normal(0, 1, (400, 5))
    y = (X[:, 0] + 0.5 * X[:, 1] + rng.normal(0, 0.7, 400) > 0.6).astype(int)
    m = FocalLGBMClassifier(gamma=gamma, monotone_constraints=[1, 0, 0, 0, 0], n_estimators=80).fit(X, y)
    p = m.predict_proba(X)[:, 1]
    assert ((p > 0) & (p < 1)).all() and np.corrcoef(p, X[:, 0])[0, 1] > 0.5
    contrib = m.booster_.predict(X[:3], pred_contrib=True)
    assert np.allclose(contrib.sum(axis=1), m.decision_function(X[:3]))       # TreeSHAP stays additive in log-odds
    back = pickle.loads(pickle.dumps(m))
    assert np.allclose(back.predict_proba(X)[:, 1], p)
    assert np.allclose(back.booster_.predict(X[:3], pred_contrib=True), contrib)


def test_cost_complexity_pruning_reduces_leaves():
    rng = np.random.default_rng(2)
    X = rng.normal(0, 1, (500, 6))
    y = (X[:, 0] + rng.normal(0, 1, 500) > 0).astype(int)
    full = DecisionTreeClassifier(random_state=0).fit(X, y)
    path = full.cost_complexity_pruning_path(X, y)
    alpha = float(np.quantile(path.ccp_alphas[path.ccp_alphas > 0], 0.9))
    pruned = DecisionTreeClassifier(random_state=0, ccp_alpha=alpha).fit(X, y)
    assert pruned.get_n_leaves() < full.get_n_leaves() / 3


def test_decision_tree_grid_includes_v1_setting_and_pruning_candidates():
    from ml.train_stage2 import decision_tree_grid
    rng = np.random.default_rng(3)
    X = rng.normal(0, 1, (300, 4))
    y = (X[:, 0] > 0).astype(int)
    grid = decision_tree_grid(X, y, np.ones(300))
    assert {'max_depth': 3, 'min_samples_leaf': 5, 'ccp_alpha': 0.0} in grid
    assert any(c['ccp_alpha'] > 0 for c in grid)
