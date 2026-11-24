"""Local second-opinion scorer. GET /health, POST /score. The Bayesian engine still decides."""
import json
import os
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

app = FastAPI()
_booster = None
_cols: list[str] = []
_cal: dict = {}
_net: dict | None = None
_encoder = None
_classical: list[dict] = []

def _contextual_score(text: str):
    """Optional lazy zero-shot text encoder. Loads only for uncertain cases and only when configured."""
    global _encoder
    model_name = os.getenv('MRE_ENCODER_MODEL', 'valhalla/distilbart-mnli-12-1').strip()
    if not model_name or not text.strip():
        return None
    try:
        if _encoder is None:
            from transformers import pipeline
            _encoder = pipeline('zero-shot-classification', model=model_name, device=-1)
        result = _encoder(text[:6000], candidate_labels=[
            'description consistent with the declared merchant business',
            'description suggests a different or undisclosed business activity',
            'insufficient context to assess the merchant description',
        ], multi_label=False)
        labels = result.get('labels', [])
        scores = result.get('scores', [])
        return {'label': labels[0] if labels else None,
                'score': float(scores[0]) if scores else None,
                'modelVersion': model_name}
    except Exception:
        # Encoder availability must never take down the statistical/model scoring path.
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

@app.get('/health')
def health():
    ok = ready()
    return {'status': 'ok' if ok else 'no-model', 'model': 'm1-v0' if _booster is not None else ('nn-v0' if _net is not None else None), 'nn': _net is not None}

@app.post('/score')
def score(body: ScoreIn):
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
