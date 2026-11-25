"""Exact-sum feature attributions for the stacked Stage 2 ensemble, in log-odds (logit) space.

The stacked model is linear in the base models' logits:

    L(x) = a + sum_k w_k * logit(p_k(x))

so if every base model k has attributions phi_k with  b_k + sum_j phi_kj = logit(p_k(x)),  then

    phi_j = sum_k w_k * phi_kj,   base = a + sum_k w_k * b_k,   base + sum_j phi_j = L(x)

Per base model (Lundberg & Lee 2017, "A unified approach to interpreting model predictions"):
- LightGBM: TreeSHAP in raw log-odds (pred_contrib). Exact Shapley values of the tree model (Lundberg et al. 2020).
- Logistic regression: linear SHAP, phi_j = beta_j * (z_j - mean z_j) on standardised inputs. Exact under feature
  independence (the interventional Shapley value of a linear model).
- Decision tree, random forest: TreeSHAP gives exact Shapley values of the predicted PROBABILITY, phi^p, with
  E[p] + sum phi^p = p. They are mapped to log-odds by one common factor
      phi_j = phi^p_j * (logit(p) - logit(E[p])) / (p - E[p])
  which keeps the sum exact (it equals logit(p) - logit(E[p])) and every sign, but splits the total in proportion to the
  probability-space values: an exact-sum, approximate-split rescaling. When p == E[p] the derivative 1 / (E(1-E)) is used.
- Neural network: integrated gradients (Sundararajan, Taly & Yan 2017) of the output logit along the straight path from
  the training-mean input, phi_j = (x_j - xbar_j) * integral_0^1 dF/dx_j(xbar + t(x - xbar)) dt, trapezoid rule.
  Completeness (sum = F(x) - F(xbar)) holds up to discretisation; the residual is reported.

Logits use the same clipping as the stacker (p in [1e-6, 1 - 1e-6], |logit| <= 13.8). When a linear or network logit is
beyond that cap (saturated), its attributions are mapped onto the clipped logit with the same exact-sum rescaling; the row
is marked `saturated`. Attributions are of the stacked logit before any post-hoc calibration; with the identity
calibrator (the current choice) that is the served score on the logit scale.
"""
from __future__ import annotations

import numpy as np

EPS = 1e-6
IG_STEPS = 512   # one batched forward/backward pass of 513 points; keeps the integration residual near 1e-3 logit


def _logit(p):
    p = np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)
    return np.log(p / (1 - p))


LOGIT_CAP = float(_logit(1 - EPS))   # 13.8155...


# ------------------------------------------------------------------ per-model attributions (one row x, shape (d,))

def lightgbm_attr(model, x: np.ndarray) -> tuple[float, np.ndarray]:
    c = model.booster_.predict(x.reshape(1, -1), pred_contrib=True)[0]
    return float(c[-1]), c[:-1].astype(float)


def logistic_attr(pipe, x: np.ndarray, background_mean: np.ndarray) -> tuple[float, np.ndarray]:
    scaler, lr = pipe.steps[0][1], pipe.steps[-1][1]
    beta = lr.coef_.ravel()
    z, zbar = scaler.transform(x.reshape(1, -1))[0], scaler.transform(background_mean.reshape(1, -1))[0]
    base = float(lr.intercept_[0] + beta @ zbar)
    return base, beta * (z - zbar)


class TreeAttr:
    """TreeSHAP (path-dependent) for a scikit-learn tree or forest, mapped to log-odds by the exact-sum rescaling."""

    def __init__(self, model):
        import shap
        self.explainer = shap.TreeExplainer(model)
        ev = np.atleast_1d(self.explainer.expected_value)
        self.expected = float(ev[1] if len(ev) > 1 else ev[0])

    def __call__(self, x: np.ndarray, p: float) -> tuple[float, np.ndarray]:
        sv = self.explainer.shap_values(x.reshape(1, -1), check_additivity=False)
        # shap >= 0.45 returns (n, d, classes) for classifiers; older versions return a list with one array per class.
        phi_p = np.asarray(sv[1])[0] if isinstance(sv, list) else np.asarray(sv)[0, :, 1]
        e = self.expected
        diff_p = p - e
        diff_l = float(_logit(p) - _logit(e))
        scale = diff_l / diff_p if abs(diff_p) > 1e-9 else 1.0 / max(e * (1 - e), EPS)
        return float(_logit(e)), phi_p * scale


def _mlp_logit_and_grad(mlp, z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Batch forward pass of an sklearn MLP (ReLU hidden layers) to the output logit, and its gradient w.r.t. z."""
    acts, h = [z], z
    W, B = mlp.coefs_, mlp.intercepts_
    for i in range(len(W) - 1):
        h = np.maximum(h @ W[i] + B[i], 0.0)
        acts.append(h)
    out = (h @ W[-1] + B[-1]).ravel()
    g = np.tile(W[-1].ravel(), (z.shape[0], 1))
    for i in range(len(W) - 2, -1, -1):
        g = (g * (acts[i + 1] > 0)) @ W[i].T
    return out, g


def mlp_attr(pipe, x: np.ndarray, background_mean: np.ndarray, steps: int = IG_STEPS) -> tuple[float, np.ndarray, float]:
    """Integrated gradients in input units. Returns (base logit, attributions, completeness residual)."""
    scaler, mlp = pipe.steps[0][1], pipe.steps[-1][1]
    if mlp.out_activation_ != 'logistic':
        raise ValueError('integrated gradients here assume a binary MLP with a logistic output')
    z, zbar = scaler.transform(x.reshape(1, -1))[0], scaler.transform(background_mean.reshape(1, -1))[0]
    t = np.linspace(0.0, 1.0, steps + 1).reshape(-1, 1)
    path = zbar + t * (z - zbar)
    out, grads = _mlp_logit_and_grad(mlp, path)
    avg = (grads[:-1] + grads[1:]).sum(axis=0) / (2 * steps)          # trapezoid rule
    phi = (z - zbar) * avg                                            # identical in z or x units: dz/dx cancels
    residual = float((out[-1] - out[0]) - phi.sum())
    return float(out[0]), phi, residual


# ------------------------------------------------------------------ ensemble

class EnsembleExplainer:
    def __init__(self, models: dict, base_models: list[str], stacker: dict, background_mean, features: list[str],
                 calibration: str = 'identity'):
        self.models, self.names, self.features = models, base_models, features
        self.a, self.w = float(stacker['intercept']), {n: float(stacker['weights'][n]) for n in base_models}
        self.bg = np.asarray(background_mean, dtype=float)
        self.calibration = calibration
        self._tree = {}

    def _tree_attr(self, name):
        if name not in self._tree:
            self._tree[name] = TreeAttr(self.models[name])
        return self._tree[name]

    def model_attr(self, name: str, x: np.ndarray) -> dict:
        m = self.models[name]
        p = float(m.predict_proba(x.reshape(1, -1))[0, 1])
        target = float(_logit(p))
        ig_residual = None
        if name == 'lightgbm':
            base, phi = lightgbm_attr(m, x)
            method = 'TreeSHAP (exact, log-odds)'
        elif name == 'logistic_regression':
            base, phi = logistic_attr(m, x, self.bg)
            method = 'linear SHAP (exact, log-odds)'
        elif name in ('random_forest', 'decision_tree'):
            base, phi = self._tree_attr(name)(x, p)
            method = 'TreeSHAP on probability, exact-sum log-odds rescaling'
        elif name == 'neural_net':
            base, phi, ig_residual = mlp_attr(m, x, self.bg)
            method = f'integrated gradients ({IG_STEPS} steps) from the training mean'
        else:
            raise ValueError(name)
        # Saturation: the stacker uses logit(clip(p, 1e-6, 1 - 1e-6)), so |logit| <= 13.8. Linear and network logits can
        # go far beyond that; their attributions then explain a larger number than the stacker sees. Map them onto the
        # clipped logit by one common factor (exact sum, proportional split), as for the trees.
        explained = base + phi.sum() + (ig_residual or 0.0)
        saturated = abs(explained - target) > 1e-6 and abs(explained) > LOGIT_CAP - 1e-9
        if saturated and abs(phi.sum()) > 1e-12:
            phi = phi * (target - base) / phi.sum()
        return {'p': p, 'logit': target, 'base': base, 'phi': phi, 'method': method, 'saturated': bool(saturated),
                'completenessError': float(target - base - phi.sum()), 'integrationResidual': ig_residual}

    def explain(self, x: np.ndarray, top: int = 5, per_model_top: int = 3) -> dict:
        x = np.asarray(x, dtype=float).ravel()
        total = np.zeros(len(self.features))
        base = self.a
        stacked = self.a
        per = {}
        for n in self.names:
            r = self.model_attr(n, x)
            w = self.w[n]
            stacked += w * r['logit']
            base += w * r['base']
            total += w * r['phi']
            order = np.argsort(-np.abs(r['phi']))[:per_model_top]
            per[n] = {'weight': w, 'method': r['method'], 'baseLogit': r['base'], 'logit': r['logit'],
                      'completenessError': r['completenessError'], 'saturated': r['saturated'],
                      'integrationResidual': r['integrationResidual'],
                      'top': [{'feature': self.features[i], 'value': float(r['phi'][i])} for i in order]}
        order = np.argsort(-np.abs(total))
        return {
            'drivers': [{'feature': self.features[i], 'shap': float(total[i])} for i in order[:top]],
            'attributions': total,
            'explanation': {
                'method': 'stacked-logit SHAP: sum_k w_k * phi_k (log-odds)',
                'baseLogit': float(base), 'stackedLogit': float(stacked), 'sumOfAttributions': float(total.sum()),
                'residual': float(stacked - base - total.sum()),
                'preCalibration': self.calibration != 'identity',
                'perModel': per,
            },
        }
