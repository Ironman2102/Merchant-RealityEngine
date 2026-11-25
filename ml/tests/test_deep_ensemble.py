"""Tests for the deep-ensemble neural network and its contribution to epistemic uncertainty."""
import pickle

import numpy as np
import pytest

from ml.deep_ensemble import DeepEnsembleMLP, expand_members
from ml.stage2_math import entropy_decomposition


@pytest.fixture(scope='module')
def fitted():
    rng = np.random.default_rng(0)
    X = rng.normal(0, 1, (300, 4))
    y = (X[:, 0] + 0.5 * X[:, 1] + rng.normal(0, 0.5, 300) > 0).astype(int)
    return DeepEnsembleMLP(hidden_layer_sizes=(8,), alpha=1e-2, n_members=4, max_iter=300, random_state=1).fit(X, y), X, y


def test_prediction_is_the_mean_of_the_members(fitted):
    model, X, _ = fitted
    P = model.member_proba(X)
    assert P.shape == (4, len(X))
    assert np.allclose(model.predict_proba(X)[:, 1], P.mean(axis=0))
    assert np.allclose(model.predict_proba(X).sum(axis=1), 1.0)


def test_members_differ_by_seed_but_all_learn(fitted):
    model, X, y = fitted
    P = model.member_proba(X)
    assert np.abs(P[0] - P[1]).max() > 1e-4
    for row in P:
        assert ((row >= 0.5).astype(int) == y).mean() > 0.8


def test_pickle_round_trip_preserves_predictions(fitted):
    model, X, _ = fitted
    again = pickle.loads(pickle.dumps(model))
    assert np.allclose(again.predict_proba(X), model.predict_proba(X))


def test_sample_weights_change_the_fit():
    rng = np.random.default_rng(2)
    X = rng.normal(0, 1, (200, 3))
    y = (X[:, 0] > 0).astype(int)
    w = np.where(y == 1, 5.0, 1.0)
    a = DeepEnsembleMLP(hidden_layer_sizes=(6,), n_members=2, max_iter=200).fit(X, y).predict_proba(X)[:, 1]
    b = DeepEnsembleMLP(hidden_layer_sizes=(6,), n_members=2, max_iter=200).fit(X, y, sample_weight=w).predict_proba(X)[:, 1]
    assert b.mean() > a.mean()


def test_expanded_members_keep_the_mixture_and_add_nonnegative_epistemic(fitted):
    model, X, _ = fitted

    class Plain:
        def predict_proba(self, Z):
            return np.column_stack([np.full(len(Z), 0.7), np.full(len(Z), 0.3)])

    models = {'plain': Plain(), 'nn': model}
    base = {'plain': np.full(len(X), 0.3), 'nn': model.predict_proba(X)[:, 1]}
    rows, w = expand_members(models, ['plain', 'nn'], base, [0.4, 0.6], X)
    assert rows.shape == (1 + 4, len(X)) and w.sum() == pytest.approx(1.0, abs=1e-9)
    mix = (w / w.sum()) @ rows
    assert np.allclose(mix, 0.4 * base['plain'] + 0.6 * base['nn'], atol=1e-9)
    unc = entropy_decomposition(rows, w)
    assert (unc['epistemic'] >= 0).all()
    collapsed = entropy_decomposition(np.vstack([base['plain'], base['nn']]), [0.4, 0.6])
    # Splitting the network into its members can only add disagreement (Jensen): epistemic never decreases.
    assert (unc['epistemic'] >= collapsed['epistemic'] - 1e-12).all()


def test_logit_variance_is_nonnegative_and_zero_for_one_member():
    rng = np.random.default_rng(3)
    X = rng.normal(0, 1, (120, 2))
    y = (X[:, 0] > 0).astype(int)
    one = DeepEnsembleMLP(hidden_layer_sizes=(4,), n_members=1, max_iter=200).fit(X, y)
    assert np.allclose(one.member_logit_variance(X), 0)
    many = DeepEnsembleMLP(hidden_layer_sizes=(4,), n_members=3, max_iter=200).fit(X, y)
    assert (many.member_logit_variance(X) >= 0).all()
