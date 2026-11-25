"""Local second-opinion scorer. GET /health, POST /score. The Bayesian engine still decides."""
import concurrent.futures
import json
import os
import threading
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

try:
    import lightgbm as lgb
except Exception:  # LightGBM's optional OpenMP runtime may be absent on CPU-only dev hosts.
    lgb = None
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / 'ml' / 'models' / 'm1-v0'
NET = ROOT / 'ml' / 'models' / 'nn-v0' / 'network.json'

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    if os.getenv('MRE_ENCODER_PRELOAD', '').strip() == '1':
        model_name = os.getenv('MRE_ENCODER_MODEL', 'valhalla/distilbart-mnli-12-1').strip()
        _start_encoder_load(model_name)
    yield


app = FastAPI(lifespan=_lifespan)
_booster = None
_cols: list[str] = []
_cal: dict = {}
_net: dict | None = None
_encoder = None
_encoder_lock = threading.Lock()
_encoder_loading = False
_encoder_exec = concurrent.futures.ThreadPoolExecutor(max_workers=1)
_classical: list[dict] = []

@lru_cache(maxsize=128)
def _run_encoder(encoder_id: int, model_name: str, snippet: str):
    result = _encoder(snippet, candidate_labels=[
        'description consistent with the declared merchant business',
        'description suggests a different or undisclosed business activity',
        'insufficient context to assess the merchant description',
    ], multi_label=False)
    labels = result.get('labels', [])
    scores = result.get('scores', [])
    return (labels[0] if labels else None, float(scores[0]) if scores else None)


def _start_encoder_load(model_name: str):
    global _encoder_loading
    with _encoder_lock:
        if _encoder is not None or _encoder_loading or not model_name:
            return
        _encoder_loading = True

    def _load():
        global _encoder, _encoder_loading
        try:
            from transformers import pipeline
            enc = pipeline('zero-shot-classification', model=model_name, device=-1)
            with _encoder_lock:
                _encoder = enc
        except Exception:
            pass
        finally:
            with _encoder_lock:
                _encoder_loading = False

    threading.Thread(target=_load, daemon=True).start()


def _contextual_score(text: str):
    """Optional lazy zero-shot text encoder. Loads only once without blocking /score if still warming."""
    model_name = os.getenv('MRE_ENCODER_MODEL', 'valhalla/distilbart-mnli-12-1').strip()
    snippet = text.strip()[:900]
    if not model_name or not snippet:
        return None
    if _encoder is None:
        _start_encoder_load(model_name)
        return None
    try:
        timeout_s = float(os.getenv('MRE_ENCODER_TIMEOUT_SEC', '6'))
        fut = _encoder_exec.submit(_run_encoder, id(_encoder), model_name, snippet)
        label, score = fut.result(timeout=max(0.5, timeout_s))
        return {'label': label, 'score': score, 'modelVersion': model_name}
    except Exception:
        # Encoder availability or CPU latency must never take down the statistical/model scoring path.
        return None

def ready() -> bool:
    global _booster, _cols, _cal, _net, _classical
    if NET.exists() and _net is None:
        _net = json.loads(NET.read_text())
    if lgb is not None and (MODEL / 'model.txt').exists() and _booster is None:
        _booster = lgb.Booster(model_file=str(MODEL / 'model.txt'))
        _cols = json.loads((MODEL / 'features.json').read_text())
        _cal = json.loads((MODEL / 'calibrator.json').read_text())
    classical_dir = ROOT / 'ml' / 'models' / 'classical-v0'
    if not _classical and classical_dir.exists():
        try:
            import joblib
            _classical = [joblib.load(p) for p in sorted(classical_dir.glob('*.joblib'))]
        except Exception:
            _classical = []
    return _booster is not None or _net is not None

def _nn_forward(row: np.ndarray) -> tuple[float, list[dict]]:
    assert _net is not None
    cols = _net['features']
    z = (row - np.asarray(_net['mean'])) / np.asarray(_net['std'])
    h = z.reshape(1, -1)
    acts = [h]
    weights = [np.asarray(w) for w in _net['coefs']]
    biases = [np.asarray(b) for b in _net['intercepts']]
    for i, (w, b) in enumerate(zip(weights, biases)):
        h = h @ w + b
        if i < len(weights) - 1:
            h = np.maximum(h, 0)
        else:
            h = 1 / (1 + np.exp(-np.clip(h, -40, 40)))
        acts.append(h)
    raw = float(h.ravel()[0])
    xs = np.asarray(_net['calibrator']['X_thresholds_'], dtype=float)
    ys = np.asarray(_net['calibrator']['y_thresholds_'], dtype=float)
    p = float(np.clip(np.interp(raw, xs, ys), 0, 1))
    grad = np.ones((1, 1))
    for i in range(len(weights) - 1, -1, -1):
        if i < len(weights) - 1:
            grad = grad * (acts[i + 1] > 0)
        grad = grad @ weights[i].T
    attr = (acts[0] * grad).ravel()
    order = np.argsort(-np.abs(attr))[:5]
    drivers = [{'feature': cols[i], 'shap': float(attr[i])} for i in order]
    return p, drivers

class ScoreIn(BaseModel):
    features: dict[str, float]
    context: str = ''

# ------------------------------------------------------------------ Stage 2 v1 (stacked ensemble)
STAGE2 = ROOT / 'ml' / 'models' / 'stage2-v1'
_v1: dict | None = None


def v1_ready() -> bool:
    global _v1
    if _v1 is None and (STAGE2 / 'ensemble.json').exists() and (STAGE2 / 'models.joblib').exists():
        try:
            import joblib
            import ml.stage2_lib  # noqa: F401  (the novelty detector class is pickled from this module)
            _v1 = {**joblib.load(STAGE2 / 'models.joblib'), 'meta': json.loads((STAGE2 / 'ensemble.json').read_text())}
        except Exception as err:  # a broken v1 bundle falls back to v0, never takes the service down
            print('Stage 2 v1 bundle could not be loaded; using v0.', err)
            _v1 = {}
    return bool(_v1)


def _logit(p):
    p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def _sigmoid(z):
    return 1 / (1 + np.exp(-np.clip(z, -40, 40)))


def _v1_scores(features: list[dict[str, float]]) -> dict:
    """Base models -> stacked logit -> post-hoc calibration, plus the novelty distance and ensemble entropy terms."""
    from ml.stage2_math import apply_calibration, entropy_decomposition
    meta, cols = _v1['meta'], _v1['features']
    X = np.asarray([[float(f.get(c, 0) or 0) for c in cols] for f in features], dtype=float)
    X[~np.isfinite(X)] = 0.0
    names = meta['baseModels']
    base = {n: _v1['models'][n].predict_proba(X)[:, 1] for n in names}
    w = np.asarray([meta['stacker']['weights'][n] for n in names])
    raw = _sigmoid(meta['stacker']['intercept'] + np.column_stack([_logit(base[n]) for n in names]) @ w)
    p_train = np.clip(apply_calibration(meta.get('calibration', {'method': 'identity'}), raw), 1e-6, 1 - 1e-6)
    from ml.deep_ensemble import expand_members  # deep-ensemble members count towards epistemic uncertainty
    rows, mix = expand_members(_v1['models'], names, base, w, X)
    unc = entropy_decomposition(rows, mix)
    return {'X': X, 'base': base, 'p_train': p_train, 'distance': _v1['novelty'].distance(X), **unc}


def _rank_pvalue(sorted_reference: np.ndarray, value: float) -> float:
    """Conformal p-value (n_greater_or_equal + 1) / (n + 1) against sorted reference scores."""
    n = len(sorted_reference)
    return float((n - np.searchsorted(sorted_reference, value, side='left') + 1) / (n + 1))


def _v1_explain(x: np.ndarray) -> tuple[list[dict], dict | None]:
    """Top-5 drivers of the stacked logit (ml/explain.py). Bundles trained before explanations fall back to LightGBM SHAP."""
    meta = _v1['meta']
    background = meta.get('explain', {}).get('backgroundMean')
    if background is not None:
        try:
            if '_explainer' not in _v1:
                from ml.explain import EnsembleExplainer
                _v1['_explainer'] = EnsembleExplainer(_v1['models'], meta['baseModels'], meta['stacker'], background,
                                                      _v1['features'], meta.get('calibration', {}).get('method', 'identity'))
            r = _v1['_explainer'].explain(x)
            return r['drivers'], r['explanation']
        except Exception as err:  # an explanation failure must never block the score
            print('Ensemble explanation failed; using LightGBM SHAP.', err)
    contrib = _v1['models']['lightgbm'].booster_.predict(x.reshape(1, -1), pred_contrib=True)[0][:-1]
    order = np.argsort(-np.abs(contrib))[:5]
    return [{'feature': _v1['features'][i], 'shap': float(contrib[i])} for i in order], None


def _v1_score(body: 'ScoreIn') -> dict:
    meta = _v1['meta']
    s = _v1_scores([body.features])
    p_train = float(s['p_train'][0])
    base = {n: float(v[0]) for n, v in s['base'].items()}
    # Prior shift (Saerens et al. 2002): move from the training base rate onto the engine's prior for this merchant.
    prior = body.features.get('prior')
    shifted = prior is not None and 0 < float(prior) < 1
    p = float(_sigmoid(_logit(p_train) - _logit(meta['trainPrevalence']) + _logit(float(prior)))) if shifted else p_train
    threshold = meta['bayesThreshold'] if shifted else meta['evaluation']['threshold']
    # Mondrian conformal: per-class p-values and the 90% set. Class-conditional validity survives label shift,
    # because each class is calibrated only against its own members.
    conf = meta['conformal']
    pv = {'front': _rank_pvalue(np.asarray(conf['scores']['1']), 1 - p_train),
          'honest': _rank_pvalue(np.asarray(conf['scores']['0']), p_train)}
    cset = [c for c in ('front', 'honest') if pv[c] > conf['alpha']]
    distance = float(s['distance'][0])
    nov_p = _rank_pvalue(np.asarray(meta['novelty']['oofDistances']), distance)
    novel = distance > meta['novelty']['threshold']
    epistemic, aleatoric = float(s['epistemic'][0]), float(s['aleatoric'][0])
    # LOW: unfamiliar, or the conformal set is not one class. MEDIUM: the members disagree (mutual information above
    # 0.1 bit). HIGH otherwise.
    confidence = 'LOW' if novel or len(cset) != 1 else ('MEDIUM' if epistemic > 0.1 else 'HIGH')
    npt = meta.get('neymanPearson', {}).get('threshold')
    drivers, explanation = _v1_explain(s['X'][0])
    names = {'logistic_regression': 'logistic-regression-v1', 'decision_tree': 'decision-tree-v1',
             'random_forest': 'random-forest-v1', 'lightgbm': 'lightgbm-v1', 'neural_net': 'neural-net-v1'}
    encoder = _contextual_score(body.context) if (novel or len(cset) != 1) else None
    return {
        'p_raw': p_train, 'p': p, 'drivers': drivers, 'modelVersion': meta['version'],
        **({'explanation': explanation} if explanation else {}),
        'classical': [{'p': base[n], 'modelVersion': names[n]} for n in meta['baseModels'] if n != 'neural_net'],
        'nn': {'p': base['neural_net'], 'drivers': [], 'modelVersion': names['neural_net']},
        'ensemble': {
            'p': p, 'pTrainScale': p_train, 'method': 'stacked', 'models': [names[n] for n in meta['baseModels']],
            'weights': {names[n]: float(v) for n, v in meta['stacker']['weights'].items()},
            'calibration': meta.get('calibration', {}).get('method', 'identity'),
            'disagreement': float(max(base.values()) - min(base.values())), 'confidence': confidence, 'review': confidence == 'LOW',
            'uncertainty': {'totalBits': float(s['total'][0]), 'aleatoricBits': aleatoric, 'epistemicBits': epistemic},
            'priorShift': {'applied': shifted, 'enginePrior': float(prior) if shifted else None, 'trainPrevalence': meta['trainPrevalence']},
            'threshold': float(threshold), 'flag': bool(p >= threshold), 'costRatio': meta['costRatio'],
            'neymanPearson': None if npt is None else {'threshold': npt, 'flag': bool(p_train > npt),
                                                        'alpha': meta['neymanPearson']['alpha'], 'delta': meta['neymanPearson']['delta']},
            'conformalSet': cset, 'conformalAlpha': conf['alpha'], 'conformalPValues': pv,
            'novelty': {'distance': distance, 'threshold': meta['novelty']['threshold'], 'flagged': bool(novel), 'pValue': nov_p,
                        'unfamiliar': _v1['novelty'].drivers(s['X'], _v1['features']) if novel else []},
            'syntheticTrainingExamples': meta['data']['trainingRows'],
        },
        **({'encoder': encoder} if encoder else {}),
    }


class DriftIn(BaseModel):
    rows: list[dict[str, float]]


@app.post('/drift')
def drift(body: DriftIn):
    """Batch shift report against the training reference.

    - score PSI and KS against the calibrated out-of-fold score distribution
    - per-feature PSI (training deciles) and KS, top movers listed, Benjamini-Hochberg control of the KS p-values
    - the EM estimate of the batch's fraud rate (Saerens et al. 2002), with and without the novelty-flagged rows
    """
    from ml.stage2_math import em_prevalence, ks_statistic, psi
    if not v1_ready() or not body.rows:
        return {'n': len(body.rows), 'psi': None, 'status': 'UNAVAILABLE'}
    meta = _v1['meta']
    s = _v1_scores(body.rows)
    score_psi = psi(s['p_train'], meta['psi']['score']['edges'], meta['psi']['score']['shares'])
    score_ks = ks_statistic(s['p_train'], meta['reference']['score'])
    feats = []
    for j, c in enumerate(_v1['features']):
        q = np.asarray(meta['reference']['features'][c])
        if q[0] == q[-1]:
            continue  # constant in training: covered by the novelty detector instead
        edges = np.unique(q[10:100:10])
        ref_shares = np.diff(np.concatenate([[0.0], np.searchsorted(q, edges, side='right') / len(q), [1.0]]))
        feats.append({'feature': c, 'psi': psi(s['X'][:, j], edges, ref_shares), **ks_statistic(s['X'][:, j], q)})
    m = len(feats)
    for rank, f in enumerate(sorted(feats, key=lambda f: f['p']), start=1):
        f['qValue'] = min(1.0, f['p'] * m / rank)
    shifted = [f for f in feats if f['qValue'] < 0.05]
    status = 'SIGNIFICANT' if score_psi > 0.25 else 'MODERATE' if score_psi > 0.1 else 'OK'
    novel = s['distance'] > meta['novelty']['threshold']
    familiar = s['p_train'][~novel]
    return {
        'n': len(body.rows), 'psi': score_psi, 'status': status, 'scoreKs': score_ks,
        'novelShare': float(novel.mean()), 'expectedNovelShare': 1 - meta['novelty']['quantile'],
        'prevalence': {'trainPrevalence': meta['trainPrevalence'], **em_prevalence(s['p_train'], meta['trainPrevalence']),
                       'familiarOnly': em_prevalence(familiar, meta['trainPrevalence'])['prevalence'] if len(familiar) else None},
        'featuresShifted': len(shifted), 'featuresTested': m,
        'topShiftedFeatures': sorted(feats, key=lambda f: -f['psi'])[:10],
    }


@app.get('/health')
def health():
    ok = ready()
    v1 = v1_ready()
    return {
        'status': 'ok' if (ok or v1) else 'no-model',
        'model': 'stage2-v1' if v1 else ('m1-v0' if _booster is not None else ('nn-v0' if _net is not None else None)),
        'nn': _net is not None or v1,
        'classical': bool(_classical) or v1,
        'stage2': v1,
        'encoder': _encoder is not None,
        'serveVersion': 2,
    }

@app.post('/score')
def score(body: ScoreIn):
    if v1_ready():
        return _v1_score(body)
    if not ready():
        return {'p_raw': None, 'p': None, 'drivers': [], 'modelVersion': None}
    nn_out = None
    if _net is not None:
        nn_row = np.array([float(body.features.get(c, 0)) for c in _net['features']])
        nn_p, nn_drivers = _nn_forward(nn_row)
        nn_out = {'p': nn_p, 'drivers': nn_drivers, 'modelVersion': 'nn-v0'}
    if _booster is None and nn_out is not None:
        classical_out = []
        for bundle in _classical:
            row = np.asarray([[float(body.features.get(c, 0)) for c in bundle['features']]], dtype=float)
            classical_out.append({'p': float(bundle['model'].predict_proba(row)[0, 1]), 'modelVersion': bundle['version']})
        scores = [nn_out['p']] + [x['p'] for x in classical_out]
        p = float(np.mean(scores))
        coverage = [v for k, v in body.features.items() if k.startswith('cov_')]
        need_context = 0.35 <= p <= 0.65 or (coverage and sum(coverage) < min(4, len(coverage)))
        encoder = _contextual_score(body.context) if need_context else None
        return {'p_raw': p, 'p': p, 'drivers': nn_out['drivers'], 'modelVersion': 'nn-v0',
                'classical': classical_out,
                'ensemble': {'p': p, 'models': ['nn-v0'] + [x['modelVersion'] for x in classical_out],
                             'disagreement': float(max(scores) - min(scores)) if len(scores) > 1 else 0.0,
                             'confidence': 'LOW', 'review': True,
                             'syntheticTrainingExamples': min([x.get('training_examples', 0) for x in _classical], default=None)},
                'nn': nn_out,
                **({'encoder': encoder} if encoder else {})}
    row = np.array([[float(body.features.get(c, 0)) for c in _cols]])
    raw = float(_booster.predict(row)[0])
    xs = np.asarray(_cal['X_thresholds_'], dtype=float)
    ys = np.asarray(_cal['y_thresholds_'], dtype=float)
    p = float(np.clip(np.interp(raw, xs, ys), 0, 1))
    contrib = _booster.predict(row, pred_contrib=True)[0][:-1]
    order = np.argsort(-np.abs(contrib))[:5]
    drivers = [{'feature': _cols[i], 'shap': float(contrib[i])} for i in order]
    classical_out = []
    if _classical:
        for bundle in _classical:
            cols = bundle['features']
            row = np.asarray([[float(body.features.get(c, 0)) for c in cols]], dtype=float)
            q = float(bundle['model'].predict_proba(row)[0, 1])
            classical_out.append({'p': q, 'modelVersion': bundle['version']})
    scores = [p] + ([nn_out['p']] if nn_out else []) + [x['p'] for x in classical_out]
    ensemble_p = float(np.mean(scores))
    disagreement = float(max(scores) - min(scores)) if len(scores) > 1 else 0.0
    # Until a separately validated calibration set exists, disagreement is a conservative
    # review signal; it must not be presented as a calibrated confidence probability.
    # The fixture-trained classical models are deliberately low-confidence until real adjudicated
    # examples exist. Ensemble score remains informative for shadow comparison, never auto-action.
    synthetic_small = any(x.get('synthetic') and x.get('training_examples', 0) < 100 for x in _classical)
    confidence = 'LOW' if synthetic_small else ('HIGH' if len(scores) > 1 and disagreement <= 0.05 else ('MEDIUM' if len(scores) > 1 and disagreement <= 0.15 else 'LOW'))
    # Trigger contextual interpretation only when Stage 1/model evidence is uncertain.
    coverage = [v for k, v in body.features.items() if k.startswith('cov_')]
    need_context = 0.35 <= ensemble_p <= 0.65 or disagreement >= 0.2 or (coverage and sum(coverage) < min(4, len(coverage)))
    encoder = _contextual_score(body.context) if need_context else None
    return {'p_raw': raw, 'p': p, 'drivers': drivers, 'modelVersion': 'm1-v0',
            'classical': classical_out,
            'ensemble': {'p': ensemble_p, 'models': ['m1-v0'] + (['nn-v0'] if nn_out else []) + [x['modelVersion'] for x in classical_out],
                         'disagreement': disagreement, 'confidence': confidence,
                         'review': confidence == 'LOW', 'syntheticTrainingExamples': min([x.get('training_examples', 0) for x in _classical], default=None)},
            **({'encoder': encoder} if encoder else {}), **({'nn': nn_out} if nn_out else {})}
