"""Deep ensemble of small neural networks (Lakshminarayanan, Pritzel & Blundell 2017).

M networks with the same architecture are trained from different random initialisations (and minibatch orders). The
ensemble probability is their average, p(x) = (1/M) sum_m p_m(x). Seed-to-seed disagreement is a practical estimate
of epistemic (model) uncertainty: on inputs like the training data the members agree; away from it they diverge.

The class lives in its own module so joblib can unpickle it from a stable import path.
"""
from __future__ import annotations

import numpy as np
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler


class DeepEnsembleMLP(BaseEstimator, ClassifierMixin):
    def __init__(self, hidden_layer_sizes=(32, 16), alpha: float = 1e-2, n_members: int = 5, max_iter: int = 600,
                 random_state: int = 7):
        self.hidden_layer_sizes = hidden_layer_sizes
        self.alpha = alpha
        self.n_members = n_members
        self.max_iter = max_iter
        self.random_state = random_state

    def fit(self, X, y, sample_weight=None):
        X = np.asarray(X, dtype=float)
        y = np.asarray(y)
        self.scaler_ = StandardScaler().fit(X)
        Z = self.scaler_.transform(X)
        self.members_ = []
        for m in range(self.n_members):
            net = MLPClassifier(hidden_layer_sizes=self.hidden_layer_sizes, alpha=self.alpha, max_iter=self.max_iter,
                                early_stopping=False, random_state=self.random_state + 1000 * m)
            net.fit(Z, y, sample_weight=sample_weight)
            self.members_.append(net)
        self.classes_ = self.members_[0].classes_
        return self

    def member_proba(self, X) -> np.ndarray:
        """Positive-class probability from each member, shape (n_members, n_samples)."""
        Z = self.scaler_.transform(np.asarray(X, dtype=float))
        return np.vstack([net.predict_proba(Z)[:, 1] for net in self.members_])

    def predict_proba(self, X) -> np.ndarray:
        p = self.member_proba(X).mean(axis=0)
        return np.column_stack([1 - p, p])

    def predict(self, X):
        return self.classes_[(self.predict_proba(X)[:, 1] >= 0.5).astype(int)]

    def member_logit_variance(self, X) -> np.ndarray:
        """Variance across members of logit(p_m): a scale-free measure of seed disagreement."""
        P = np.clip(self.member_proba(X), 1e-6, 1 - 1e-6)
        return np.log(P / (1 - P)).var(axis=0)


def expand_members(models: dict, names: list[str], base: dict[str, np.ndarray], weights, X) -> tuple[np.ndarray, np.ndarray]:
    """Rows of member probabilities and mixture weights for the entropy decomposition.

    A plain model contributes one row with its stacker weight w_k. A deep ensemble contributes its M members, each
    with weight w_k / M, so its share of the mixture is unchanged (the members average to its prediction) while its
    seed disagreement now counts towards the mutual-information (epistemic) term.
    """
    rows, ws = [], []
    for n, wk in zip(names, np.maximum(np.asarray(weights, dtype=float), 0) + 1e-12):
        m = models[n]
        if hasattr(m, 'member_proba'):
            P = m.member_proba(X)
            rows.extend(P)
            ws.extend([wk / len(P)] * len(P))
        else:
            rows.append(base[n])
            ws.append(wk)
    return np.vstack(rows), np.asarray(ws)
