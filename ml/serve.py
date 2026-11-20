"""Local second-opinion scorer. GET /health, POST /score. The Bayesian engine still decides."""
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / 'ml' / 'models' / 'm1-v0'

app = FastAPI()
_booster = None
_cols: list[str] = []
_cal: dict = {}

def ready() -> bool:
    global _booster, _cols, _cal
    if not (MODEL / 'model.txt').exists():
        return False
    if _booster is None:
        _booster = lgb.Booster(model_file=str(MODEL / 'model.txt'))
        _cols = json.loads((MODEL / 'features.json').read_text())
        _cal = json.loads((MODEL / 'calibrator.json').read_text())
    return True

class ScoreIn(BaseModel):
    features: dict[str, float]

@app.get('/health')
def health():
    return {'status': 'ok' if ready() else 'no-model', 'model': 'm1-v0'}

@app.post('/score')
def score(body: ScoreIn):
    if not ready():
        return {'p_raw': None, 'p': None, 'drivers': [], 'modelVersion': None}
    row = np.array([[float(body.features.get(c, 0)) for c in _cols]])
    raw = float(_booster.predict(row)[0])
    xs = np.asarray(_cal['X_thresholds_'], dtype=float)
    ys = np.asarray(_cal['y_thresholds_'], dtype=float)
    p = float(np.clip(np.interp(raw, xs, ys), 0, 1))
    contrib = _booster.predict(row, pred_contrib=True)[0][:-1]
    order = np.argsort(-np.abs(contrib))[:5]
    drivers = [{'feature': _cols[i], 'shap': float(contrib[i])} for i in order]
    return {'p_raw': raw, 'p': p, 'drivers': drivers, 'modelVersion': 'm1-v0'}
