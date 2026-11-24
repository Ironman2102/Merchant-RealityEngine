"""Edge-case tests for the FastAPI dual-model service in ml/serve.py."""
from pathlib import Path
import numpy as np
import pandas as pd
import pytest

try:
    from fastapi.testclient import TestClient
    import ml.serve as serve
except ImportError as exc:
    pytest.skip(f'fastapi/ml.serve unavailable in current Python ABI: {exc}', allow_module_level=True)

ROOT = Path(__file__).resolve().parents[2]


def _reset_serve_globals():
    serve._booster = None
    serve._cols = []
    serve._cal = {}
    serve._net = None
    serve._classical = []


def test_serve_health_and_score_full_partial_empty():
    _reset_serve_globals()
    client = TestClient(serve.app)

    h = client.get('/health')
    assert h.status_code == 200
    body_h = h.json()
    assert body_h['status'] == 'ok'
    assert body_h['model'] in ('m1-v0', 'nn-v0')
    assert body_h['nn'] is True

    # Empty features dict -> defaults missing features to 0, returns valid finite probabilities
    r_empty = client.post('/score', json={'features': {}})
    assert r_empty.status_code == 200
    b_empty = r_empty.json()
    assert 0.0 <= b_empty['p'] <= 1.0
    assert len(b_empty['drivers']) == 5
    assert b_empty['modelVersion'] in ('m1-v0', 'nn-v0')
    assert 0.0 <= b_empty['ensemble']['p'] <= 1.0
    assert b_empty['ensemble']['confidence'] in ('HIGH', 'MEDIUM', 'LOW')
    assert b_empty['ensemble']['review'] is True  # small synthetic fixture corpus
    assert len(b_empty['classical']) == 3

    # Full real row from features.csv + extra unknown key
    csv_path = ROOT / 'ml' / 'data' / 'synthetic_features.csv'
    if not csv_path.exists():
        csv_path = ROOT / 'ml' / 'data' / 'features.csv'
    df = pd.read_csv(csv_path).head(1)
    feats = {c: float(df[c].iloc[0]) for c in df.columns if c not in ('merchant_id', 'label')}
    feats['extra_unseen_feature'] = 123.45
    r_full = client.post('/score', json={'features': feats})
    assert r_full.status_code == 200
    b_full = r_full.json()
    assert np.isfinite(b_full['p']) and 0.0 <= b_full['p'] <= 1.0
    assert np.isfinite(b_full['ensemble']['p']) and 0.0 <= b_full['ensemble']['p'] <= 1.0

    # Extreme large features must not overflow or fail JSON serialization
    extreme = {k: 1e6 for k in feats}
    r_ext = client.post('/score', json={'features': extreme})
    assert r_ext.status_code == 200
    assert 0.0 <= r_ext.json()['p'] <= 1.0
    assert 0.0 <= r_ext.json()['ensemble']['p'] <= 1.0


def test_serve_no_model_and_nn_only_fallbacks(tmp_path, monkeypatch):
    _reset_serve_globals()
    monkeypatch.setattr(serve, 'MODEL', tmp_path / 'missing-m1')
    monkeypatch.setattr(serve, 'NET', tmp_path / 'missing-nn.json')
    client = TestClient(serve.app)

    h_no_model = client.get('/health').json()
    assert h_no_model['status'] == 'no-model' and h_no_model['model'] is None and h_no_model['nn'] is False
    assert client.post('/score', json={'features': {'llr_A1': 1.0}}).json() == {
        'p_raw': None, 'p': None, 'drivers': [], 'modelVersion': None,
    }

    # NN-only fallback when LightGBM model.txt is absent
    _reset_serve_globals()
    monkeypatch.setattr(serve, 'NET', ROOT / 'ml' / 'models' / 'nn-v0' / 'network.json')
    h_nn_only = client.get('/health').json()
    assert h_nn_only['status'] == 'ok' and h_nn_only['model'] == 'nn-v0' and h_nn_only['nn'] is True
    nn_res = client.post('/score', json={'features': {'llr_A1': 2.0}}).json()
    assert nn_res['modelVersion'] == 'nn-v0'
    assert 0.0 <= nn_res['p'] <= 1.0
    _reset_serve_globals()
