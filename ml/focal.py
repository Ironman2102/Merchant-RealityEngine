"""Focal loss for gradient-boosted trees (Lin, Goyal, Girshick, He & Dollar 2017), and a LightGBM wrapper that uses it.

With z the raw score, t = 2y - 1 and p_t = sigmoid(t z) (the probability given to the true class):

    FL(z)  = -(1 - p_t)^gamma * ln p_t
    g      = dFL/dz   = t * [ gamma * p_t * (1 - p_t)^gamma * ln p_t  -  (1 - p_t)^(gamma + 1) ]
    h      = d2FL/dz2 = p_t (1 - p_t) * { gamma * [ (1 - p_t)^gamma * (ln p_t + 1) - gamma * p_t * (1 - p_t)^(gamma - 1) * ln p_t ]
                                          + (gamma + 1) * (1 - p_t)^gamma }

gamma = 0 gives the log loss exactly: g = p - y, h = p (1 - p). gamma > 0 down-weights examples the model already gets
right, so training effort goes to the hard, ambiguous merchants. The class-balancing alpha of the paper is applied as
sample weights (inverse class frequency), which is the same thing for a binary problem.

The Hessian of the focal loss is not positive everywhere for gamma > 0; it is floored at HESS_FLOOR, as is usual for
Newton boosting with non-convex losses.
"""
from __future__ import annotations

import lightgbm as lgb
import numpy as np
from sklearn.base import BaseEstimator, ClassifierMixin

HESS_FLOOR = 1e-6


def _log_sigmoid(x: np.ndarray) -> np.ndarray:
    return -np.logaddexp(0.0, -x)


def focal_loss(y: np.ndarray, z: np.ndarray, gamma: float) -> np.ndarray:
    t = 2 * np.asarray(y, dtype=float) - 1
    log_pt = _log_sigmoid(t * z)
    pt = np.exp(log_pt)
    return -((1 - pt) ** gamma) * log_pt


def focal_grad_hess(y: np.ndarray, z: np.ndarray, gamma: float, floor: float = HESS_FLOOR) -> tuple[np.ndarray, np.ndarray]:
    t = 2 * np.asarray(y, dtype=float) - 1
    z = np.asarray(z, dtype=float)
    log_pt = _log_sigmoid(t * z)
    pt = np.exp(log_pt)
    q = 1 - pt
    g = t * (gamma * pt * q ** gamma * log_pt - q ** (gamma + 1))
    q_gm1 = q ** (gamma - 1) if gamma >= 1 else np.where(q > 0, q ** (gamma - 1), 0.0)
    inner = gamma * (q ** gamma * (log_pt + 1) - gamma * pt * q_gm1 * log_pt) + (gamma + 1) * q ** gamma
    h = pt * q * inner
    return g, np.maximum(h, floor)


class FocalLGBMClassifier(BaseEstimator, ClassifierMixin):
    """LightGBM binary classifier with focal loss (gamma > 0) or the built-in log loss (gamma = 0).

    predict_proba always returns sigmoid(raw score), and booster_ is exposed so TreeSHAP (pred_contrib) keeps working;
    contributions stay additive in log-odds for both objectives.
    """

    def __init__(self, gamma: float = 0.0, monotone_constraints=None, num_leaves: int = 7, min_child_samples: int = 10,
                 learning_rate: float = 0.05, n_estimators: int = 300, reg_lambda: float = 5.0, random_state: int = 7):
        self.gamma = gamma
        self.monotone_constraints = monotone_constraints
        self.num_leaves = num_leaves
        self.min_child_samples = min_child_samples
        self.learning_rate = learning_rate
        self.n_estimators = n_estimators
        self.reg_lambda = reg_lambda
        self.random_state = random_state

    def _params(self) -> dict:
        return dict(random_state=self.random_state, deterministic=True, n_jobs=1, verbosity=-1,
                    monotone_constraints=self.monotone_constraints, colsample_bytree=0.5, subsample=0.8, subsample_freq=1,
                    max_depth=4, num_leaves=self.num_leaves, min_child_samples=self.min_child_samples,
                    learning_rate=self.learning_rate, n_estimators=self.n_estimators, reg_lambda=self.reg_lambda)

    def fit(self, X, y, sample_weight=None):
        y = np.asarray(y, dtype=int)
        w = np.ones(len(y)) if sample_weight is None else np.asarray(sample_weight, dtype=float)
        self.classes_ = np.array([0, 1])
        if self.gamma == 0:
            # Identical to the v1 configuration: built-in binary log loss with LightGBM's class rebalancing.
            self.model_ = lgb.LGBMClassifier(objective='binary', is_unbalance=True, **self._params())
            self.model_.fit(X, y, sample_weight=w)
        else:
            pos, neg = w[y == 1].sum(), w[y == 0].sum()
            w = np.where(y == 1, w * (pos + neg) / (2 * pos), w * (pos + neg) / (2 * neg))
            gamma = float(self.gamma)
            self.model_ = lgb.LGBMClassifier(objective=lambda yt, zp: focal_grad_hess(yt, zp, gamma), **self._params())
            self.model_.fit(X, y, sample_weight=w)
        return self

    @property
    def booster_(self):
        return self.model_.booster_

    def decision_function(self, X) -> np.ndarray:
        return self.model_.booster_.predict(np.asarray(X, dtype=float), raw_score=True)

    def predict_proba(self, X) -> np.ndarray:
        p = 1 / (1 + np.exp(-np.clip(self.decision_function(X), -40, 40)))
        return np.column_stack([1 - p, p])

    def predict(self, X) -> np.ndarray:
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)

    def __getstate__(self):
        # The focal objective is a lambda; drop it from the fitted wrapper (prediction only needs the booster).
        state = self.__dict__.copy()
        if 'model_' in state and self.gamma != 0:
            booster = state['model_'].booster_
            state['model_'] = _BoosterHolder(booster.model_to_string())
        return state

    def __setstate__(self, state):
        if isinstance(state.get('model_'), _BoosterHolder):
            state['model_'] = state['model_'].restore()
        self.__dict__.update(state)


class _BoosterHolder:
    """Pickle-safe container for a trained booster (the custom objective closure cannot be pickled)."""

    def __init__(self, model_str: str):
        self.model_str = model_str

    def restore(self):
        return _FittedBooster(lgb.Booster(model_str=self.model_str))


class _FittedBooster:
    def __init__(self, booster):
        self.booster_ = booster
