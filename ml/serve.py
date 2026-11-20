"""Local second-opinion scorer. GET /health, POST /score. The Bayesian engine still decides."""
import json
from pathlib import Path

import lightgbm as lgb
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

def ready() -> bool:
    global _booster, _cols, _cal, _net
    if NET.exists():
        if _net is None:
            _net = json.loads(NET.read_text())
        return True
    if not (MODEL / 'model.txt').exists():
        return False
    if _booster is None:
        _booster = lgb.Booster(model_file=str(MODEL / 'model.txt'))
        _cols = json.loads((MODEL / 'features.json').read_text())
        _cal = json.loads((MODEL / 'calibrator.json').read_text())
    return True

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

@app.get('/health')
def health():
    return {'status': 'ok' if ready() else 'no-model', 'model': 'nn-v0' if _net is not None else 'm1-v0'}

@app.post('/score')
def score(body: ScoreIn):
    if not ready():
        return {'p_raw': None, 'p': None, 'drivers': [], 'modelVersion': None}
    if _net is not None:
        row = np.array([float(body.features.get(c, 0)) for c in _net['features']])
        p, drivers = _nn_forward(row)
        return {'p_raw': p, 'p': p, 'drivers': drivers, 'modelVersion': 'nn-v0'}
    row = np.array([[float(body.features.get(c, 0)) for c in _cols]])
    raw = float(_booster.predict(row)[0])
    xs = np.asarray(_cal['X_thresholds_'], dtype=float)
    ys = np.asarray(_cal['y_thresholds_'], dtype=float)
    p = float(np.clip(np.interp(raw, xs, ys), 0, 1))
    contrib = _booster.predict(row, pred_contrib=True)[0][:-1]
    order = np.argsort(-np.abs(contrib))[:5]
    drivers = [{'feature': _cols[i], 'shap': float(contrib[i])} for i in order]
    return {'p_raw': raw, 'p': p, 'drivers': drivers, 'modelVersion': 'm1-v0'}
