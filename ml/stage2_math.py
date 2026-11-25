"""Statistical machinery for Stage 2. Each function implements a published method; references are inline.

Calibration and scoring
    brier_decomposition   Murphy (1973): Brier = reliability - resolution + uncertainty
    brier_skill_score     1 - Brier / Brier(climatology)
    reliability_curve     binned observed rate with Wilson score intervals (Wilson 1927)
    BetaCalibrator        Kull, Silva Filho & Flach (2017), beta calibration
    IsotonicCalibrator    Zadrozny & Elkan (2002), pool-adjacent-violators

Model comparison
    delong_test           DeLong, DeLong & Clarke-Pearson (1988), fast O(n log n) form of Sun & Xu (2014)
    mcnemar_exact         exact binomial McNemar test on paired decisions
    wilson_interval       score interval for a binomial proportion

Decision thresholds
    np_threshold          Neyman-Pearson umbrella (Tong, Feng & Li 2018): P(false-alarm rate > alpha) <= delta
    expected_cost_curve   expected cost per merchant as a function of the threshold

Uncertainty
    entropy_decomposition total = aleatoric + epistemic (mutual information), Depeweg et al. (2018); BALD, Houlsby et al. (2011)
    conformal_pvalue      smoothed conformal p-value, Vovk, Gammerman & Shafer (2005)

Dataset shift
    em_prevalence         EM estimate of the fraud rate in an unlabelled batch, Saerens, Latinne & Decaestecker (2002)
    psi                   Population Stability Index
    ks_statistic          two-sample Kolmogorov-Smirnov statistic with asymptotic p-value
"""
from __future__ import annotations

import math

import numpy as np
from scipy import stats
from scipy.optimize import minimize

EPS = 1e-12


def _clip(p):
    return np.clip(np.asarray(p, dtype=float), 1e-9, 1 - 1e-9)


# ------------------------------------------------------------------ calibration and scoring

def brier_decomposition(y, p, bins: int = 10) -> dict[str, float]:
    """Murphy decomposition over equal-width bins.

    reliability = (1/N) sum_k n_k (pbar_k - obar_k)^2      lower is better (calibration)
    resolution  = (1/N) sum_k n_k (obar_k - obar)^2        higher is better (discrimination)
    uncertainty = obar (1 - obar)                          fixed by the data
    Brier ~= reliability - resolution + uncertainty (exact when p is constant within each bin).
    """
    y, p = np.asarray(y, dtype=float), np.asarray(p, dtype=float)
    n, obar = len(y), float(np.mean(y))
    idx = np.minimum((p * bins).astype(int), bins - 1)
    rel = res = 0.0
    for k in range(bins):
        m = idx == k
        if m.any():
            rel += m.sum() * (p[m].mean() - y[m].mean()) ** 2
            res += m.sum() * (y[m].mean() - obar) ** 2
    return {'brier': float(np.mean((p - y) ** 2)), 'reliability': rel / n, 'resolution': res / n,
            'uncertainty': obar * (1 - obar)}


def brier_skill_score(y, p) -> float:
    y = np.asarray(y, dtype=float)
    ref = np.mean(y) * (1 - np.mean(y))
    return float(1 - np.mean((np.asarray(p) - y) ** 2) / ref) if ref > 0 else float('nan')


def wilson_interval(k: int, n: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    ph = k / n
    den = 1 + z * z / n
    centre = (ph + z * z / (2 * n)) / den
    half = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den
    return max(0.0, centre - half), min(1.0, centre + half)


def reliability_curve(y, p, bins: int = 10) -> list[dict]:
    y, p = np.asarray(y, dtype=int), np.asarray(p, dtype=float)
    idx = np.minimum((p * bins).astype(int), bins - 1)
    out = []
    for k in range(bins):
        m = idx == k
        if m.any():
            lo, hi = wilson_interval(int(y[m].sum()), int(m.sum()))
            out.append({'bin': [k / bins, (k + 1) / bins], 'n': int(m.sum()), 'meanPredicted': float(p[m].mean()),
                        'observed': float(y[m].mean()), 'observedCi': [lo, hi]})
    return out


class BetaCalibrator:
    """Beta calibration: logit(q) = a ln p - b ln(1 - p) + c, with a, b >= 0 (Kull et al. 2017).

    Contains Platt scaling (a = b) and the identity (a = b = 1, c = 0) as special cases, and can fix the
    S-shaped and inverse-S distortions typical of tree ensembles, which Platt cannot.
    """

    def fit(self, p, y, w=None):
        p, y = _clip(p), np.asarray(y, dtype=float)
        w = np.ones_like(y) if w is None else np.asarray(w, dtype=float)
        X = np.column_stack([np.log(p), -np.log(1 - p)])

        def loss(t):
            z = X @ t[:2] + t[2]
            q = _clip(1 / (1 + np.exp(-z)))
            g = w * (q - y) / w.sum()
            return -np.sum(w * (y * np.log(q) + (1 - y) * np.log(1 - q))) / w.sum(), np.concatenate([X.T @ g, [g.sum()]])

        r = minimize(loss, np.array([1.0, 1.0, 0.0]), jac=True, method='L-BFGS-B', bounds=[(0, None), (0, None), (None, None)])
        self.a, self.b, self.c = (float(v) for v in r.x)
        return self

    def predict(self, p):
        p = _clip(p)
        return 1 / (1 + np.exp(-(self.a * np.log(p) - self.b * np.log(1 - p) + self.c)))

    def params(self) -> dict:
        return {'method': 'beta', 'a': self.a, 'b': self.b, 'c': self.c}


class IsotonicCalibrator:
    def fit(self, p, y, w=None):
        from sklearn.isotonic import IsotonicRegression
        self.iso = IsotonicRegression(out_of_bounds='clip', y_min=1e-6, y_max=1 - 1e-6).fit(p, y, sample_weight=w)
        return self

    def predict(self, p):
        return self.iso.predict(np.asarray(p, dtype=float))

    def params(self) -> dict:
        return {'method': 'isotonic', 'x': self.iso.X_thresholds_.tolist(), 'y': self.iso.y_thresholds_.tolist()}


class IdentityCalibrator:
    def fit(self, p, y, w=None):
        return self

    def predict(self, p):
        return np.asarray(p, dtype=float)

    def params(self) -> dict:
        return {'method': 'identity'}


def apply_calibration(params: dict, p):
    p = np.asarray(p, dtype=float)
    if params['method'] == 'beta':
        q = _clip(p)
        return 1 / (1 + np.exp(-(params['a'] * np.log(q) - params['b'] * np.log(1 - q) + params['c'])))
    if params['method'] == 'isotonic':
        return np.interp(p, params['x'], params['y'])
    return p


# ------------------------------------------------------------------ model comparison

def _midrank(x):
    order = np.argsort(x, kind='mergesort')
    xs = x[order]
    n = len(x)
    ranks = np.empty(n)
    i = 0
    while i < n:
        j = i
        while j < n and xs[j] == xs[i]:
            j += 1
        ranks[i:j] = 0.5 * (i + j - 1) + 1
        i = j
    out = np.empty(n)
    out[order] = ranks
    return out


def delong_test(y, p1, p2) -> dict[str, float]:
    """Two correlated ROC AUCs on the same cases: AUCs, their difference, the DeLong z statistic and two-sided p-value."""
    y = np.asarray(y, dtype=int)
    pos, neg = y == 1, y == 0
    m, n = int(pos.sum()), int(neg.sum())
    preds = np.vstack([np.asarray(p1, dtype=float), np.asarray(p2, dtype=float)])
    aucs, v10, v01 = [], [], []
    for s in preds:
        tx, ty, tz = _midrank(s[pos]), _midrank(s[neg]), _midrank(np.concatenate([s[pos], s[neg]]))
        aucs.append((tz[:m].sum() - m * (m + 1) / 2) / (m * n))
        v10.append((tz[:m] - tx) / n)
        v01.append(1 - (tz[m:] - ty) / m)
    s10, s01 = np.cov(np.vstack(v10)), np.cov(np.vstack(v01))
    cov = s10 / m + s01 / n
    var = cov[0, 0] + cov[1, 1] - 2 * cov[0, 1]
    diff = aucs[0] - aucs[1]
    if var <= EPS:
        return {'auc1': float(aucs[0]), 'auc2': float(aucs[1]), 'diff': float(diff), 'z': 0.0, 'p': 1.0 if abs(diff) < EPS else 0.0}
    z = diff / math.sqrt(var)
    return {'auc1': float(aucs[0]), 'auc2': float(aucs[1]), 'diff': float(diff), 'z': float(z), 'p': float(2 * stats.norm.sf(abs(z)))}


def mcnemar_exact(a, b, y) -> dict[str, float]:
    """Paired decisions: b01 = cases A gets right and B wrong, b10 the reverse; exact two-sided binomial p-value."""
    a, b, y = (np.asarray(v, dtype=int) for v in (a, b, y))
    ra, rb = a == y, b == y
    b01, b10 = int((ra & ~rb).sum()), int((~ra & rb).sum())
    n = b01 + b10
    p = 1.0 if n == 0 else float(min(1.0, 2 * stats.binom.cdf(min(b01, b10), n, 0.5)))
    return {'aRightBWrong': b01, 'aWrongBRight': b10, 'p': p}


# ------------------------------------------------------------------ decision thresholds

def np_threshold(scores_negative, alpha: float = 0.05, delta: float = 0.05) -> dict:
    """Neyman-Pearson umbrella threshold from honest-merchant scores.

    Sort the n honest scores s_(1) <= ... <= s_(n). Flagging scores > s_(k) has false-alarm rate R with
    P(R > alpha) = sum_{j=k}^{n} C(n, j) (1 - alpha)^j alpha^(n - j). Take the smallest k for which that is <= delta.
    Needs n >= ln(delta) / ln(1 - alpha) honest examples.
    """
    s = np.sort(np.asarray(scores_negative, dtype=float))
    n = len(s)
    need = math.ceil(math.log(delta) / math.log(1 - alpha))
    if n < need:
        return {'threshold': None, 'k': None, 'n': n, 'needed': need, 'alpha': alpha, 'delta': delta}
    tail = stats.binom.sf(np.arange(1, n + 1) - 1, n, 1 - alpha)  # P(Bin(n, 1-alpha) >= k) for k = 1..n
    k = int(np.argmax(tail <= delta) + 1)
    return {'threshold': float(s[k - 1]), 'k': k, 'n': n, 'needed': need, 'alpha': alpha, 'delta': delta,
            'violationProbability': float(tail[k - 1])}


def expected_cost_curve(y, p, cost_fn: float, cost_fp: float, prevalence: float | None = None, grid: int = 101) -> list[dict]:
    """Expected cost per merchant, C_FN * pi * (1 - TPR) + C_FP * (1 - pi) * FPR, re-weighted to a target prevalence pi."""
    y, p = np.asarray(y, dtype=int), np.asarray(p, dtype=float)
    pi = float(np.mean(y)) if prevalence is None else prevalence
    out = []
    for t in np.linspace(0, 1, grid):
        tpr = float(((p >= t) & (y == 1)).sum() / max(1, (y == 1).sum()))
        fpr = float(((p >= t) & (y == 0)).sum() / max(1, (y == 0).sum()))
        out.append({'t': float(t), 'tpr': tpr, 'fpr': fpr, 'cost': cost_fn * pi * (1 - tpr) + cost_fp * (1 - pi) * fpr})
    return out


# ------------------------------------------------------------------ uncertainty

def _h(p):
    p = _clip(p)
    return -(p * np.log2(p) + (1 - p) * np.log2(1 - p))


def entropy_decomposition(member_probs, weights=None) -> dict[str, np.ndarray]:
    """For an ensemble with member probabilities p_k (rows = members) and mixture weights w_k:

    total     = H( sum_k w_k p_k )              predictive entropy, bits
    aleatoric = sum_k w_k H(p_k)                expected entropy: noise the members agree is there
    epistemic = total - aleatoric >= 0          mutual information between the label and the member: disagreement
    """
    P = np.atleast_2d(np.asarray(member_probs, dtype=float))
    w = np.full(P.shape[0], 1 / P.shape[0]) if weights is None else np.asarray(weights, dtype=float) / np.sum(weights)
    mix = w @ P
    total = _h(mix)
    aleatoric = w @ _h(P)
    return {'total': total, 'aleatoric': aleatoric, 'epistemic': np.maximum(total - aleatoric, 0.0)}


def conformal_pvalue(calibration_scores, score, rng: np.random.Generator | None = None) -> float:
    """Smoothed conformal p-value: (#{s_i > s} + U * (#{s_i = s} + 1)) / (n + 1), U ~ Uniform(0, 1); exactly uniform under exchangeability."""
    c = np.asarray(calibration_scores, dtype=float)
    u = 0.5 if rng is None else float(rng.random())
    return float(((c > score).sum() + u * ((c == score).sum() + 1)) / (len(c) + 1))


# ------------------------------------------------------------------ dataset shift

def em_prevalence(p, train_prevalence: float, iters: int = 200, tol: float = 1e-8) -> dict[str, float]:
    """Estimate the fraud rate of an unlabelled batch from calibrated scores (Saerens et al. 2002).

    E-step: p_i' = (pi/pi0) p_i / ((pi/pi0) p_i + ((1-pi)/(1-pi0)) (1 - p_i))
    M-step: pi = mean(p_i')
    """
    p = _clip(p)
    pi0, pi = train_prevalence, float(np.mean(p))
    for i in range(iters):
        a = (pi / pi0) * p
        b = ((1 - pi) / (1 - pi0)) * (1 - p)
        new = float(np.mean(a / (a + b)))
        if abs(new - pi) < tol:
            pi = new
            break
        pi = new
    return {'prevalence': pi, 'iterations': i + 1, 'naiveMean': float(np.mean(p))}


def psi(actual, reference_edges, reference_shares) -> float:
    edges = np.concatenate([[-np.inf], np.asarray(reference_edges, dtype=float), [np.inf]])
    a = np.histogram(np.asarray(actual, dtype=float), bins=edges)[0] / max(1, len(actual))
    e = np.asarray(reference_shares, dtype=float)
    a, e = np.clip(a, 1e-4, None), np.clip(e, 1e-4, None)
    return float(np.sum((a - e) * np.log(a / e)))


def ks_statistic(sample, reference_quantiles) -> dict[str, float]:
    """KS distance between a sample and a reference distribution stored as its quantile function (101 points)."""
    q = np.asarray(reference_quantiles, dtype=float)
    x = np.sort(np.asarray(sample, dtype=float))
    grid = np.unique(np.concatenate([x, q]))
    f_ref = np.searchsorted(q, grid, side='right') / len(q)
    f_new = np.searchsorted(x, grid, side='right') / len(x)
    d = float(np.max(np.abs(f_ref - f_new)))
    n = len(x)
    return {'d': d, 'p': float(stats.kstwo.sf(d, n)) if n > 0 else 1.0}
