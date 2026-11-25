"""Edge-case and multi-encoder tests for the FastAPI model service in ml/serve.py."""
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


@pytest.fixture(autouse=True)
def _legacy_v0_only(tmp_path, monkeypatch):
    """These tests cover the v0 fallback path; Stage 2 v1 has its own tests in test_stage2_v1.py."""
    monkeypatch.setattr(serve, 'STAGE2', tmp_path / 'no-stage2')
    monkeypatch.setattr(serve, '_v1', None)


def _reset_serve_globals():
    serve._booster = None
    serve._cols = []
    serve._cal = {}
    serve._net = None
    serve._ae = None
    serve._seq = None
    serve._graph = None
    serve._classical = []
    serve._encoder = None
    serve._encoder_loading = False
    serve._encoder_status = 'idle'
    serve._encoder_error = None
    serve._encoder_model_loaded = None
    serve._run_encoder.cache_clear()


def test_serve_health_and_score_full_partial_empty():
    _reset_serve_globals()
    client = TestClient(serve.app)

    h = client.get('/health')
    assert h.status_code == 200
    body_h = h.json()
    assert body_h['status'] == 'ok'
    assert body_h['model'] in ('m1-v0', 'nn-v0')
    assert body_h['nn'] is True
    assert body_h['autoencoder'] is True
    assert body_h['temporal'] is True
    assert body_h['graph'] is False  # experimental encoders are off by default
    assert body_h['experimentalEncoders'] is False
    assert body_h['serveVersion'] == 3

    # Empty features dict -> defaults missing features to 0, returns valid finite probabilities + autoencoder
    r_empty = client.post('/score', json={'features': {}})
    assert r_empty.status_code == 200
    b_empty = r_empty.json()
    assert 0.0 <= b_empty['p'] <= 1.0
    assert len(b_empty['drivers']) == 5
    assert b_empty['modelVersion'] in ('m1-v0', 'nn-v0')
    assert 0.0 <= b_empty['ensemble']['p'] <= 1.0
    assert b_empty['ensemble']['confidence'] in ('HIGH', 'MEDIUM', 'LOW')
    assert b_empty['ensemble']['review'] is True
    assert len(b_empty['classical']) == 3
    assert 'autoencoder' in b_empty
    assert 0.0 <= b_empty['autoencoder']['anomalyScore'] <= 1.0

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


def test_multi_modal_encoders_end_to_end(monkeypatch):
    _reset_serve_globals()
    monkeypatch.setattr(serve, 'EXPERIMENTAL_ENCODERS', True)  # this test covers the graph and bi-encoder paths too

    # Mock NLI pipeline so CI never downloads weights
    def _fake_nli(snippet, candidate_labels, hypothesis_template, multi_label=False):
        assert hypothesis_template == serve.NLI_HYPOTHESIS_TEMPLATE
        assert 'Off-domain embeds:' in snippet
        return {
            'labels': [
                'undisclosed gambling, betting, or illicit front activity',
                'a fabricated storefront or mismatched product catalogue',
                'activity consistent with the declared merchant category',
                'a legitimate seasonal surge or declared business change',
                'insufficient web and text context to assess the merchant',
            ],
            'scores': [0.74, 0.14, 0.06, 0.04, 0.02],
        }

    monkeypatch.setattr(serve, '_encoder', _fake_nli)
    monkeypatch.setattr(serve, '_encoder_status', 'ready')
    client = TestClient(serve.app)

    payload = {
        'features': {'llr_A1': 2.5, 'fired_A1': 1.0, 'n_sales': 120.0},
        'context': (
            'Declared business: Bakeries (MCC 5462, Bengaluru). Products: Breads, Cakes.\n'
            'Off-domain embeds: betwin99.example/deposit [gambling, deposit].'
        ),
        'alignment': {
            'declared': 'Bakeries, Breads, Cakes, Pastries',
            'observed': [
                {'text': 'Chocolate Truffle Cake', 'kind': 'catalogue'},
                {'text': 'betwin99.example deposit gambling cricket', 'kind': 'embed'},
            ],
        },
        'sequence': {
            'events': [[0.4, 0.65, -0.5, 0.8, 1, 0, 0, 0, 1, 1] for _ in range(12)],
            'weekly': [1.8, 3.4, 3.2, 0.9, 0.15, 0.9, 0.35, 0.0],
            'signals': {'nightShare': 0.5, 'outOfStateShare': 0.8, 'upiLinkShare': 0.85, 'weeklyPeakRatio': 3.4},
        },
        'graph': {
            'nodes': [
                {'id': 'm1', 'type': 'merchant'},
                {'id': 'l1', 'type': 'link'},
                {'id': 'w1', 'type': 'website'},
                {'id': 'd1', 'type': 'device'},
                {'id': 'p1', 'type': 'peer'},
            ],
            'edges': [
                {'source': 'm1', 'target': 'l1', 'type': 'PAYMENT_FLOW'},
                {'source': 'l1', 'target': 'w1', 'type': 'WEBSITE_LINK'},
                {'source': 'm1', 'target': 'd1', 'type': 'SHARED_INFRASTRUCTURE'},
                {'source': 'p1', 'target': 'd1', 'type': 'SHARED_INFRASTRUCTURE'},
                {'source': 'm1', 'target': 'p1', 'type': 'BEHAVIOURAL_SIMILARITY'},
            ],
        },
        'force_encoder': True,
    }

    res = client.post('/score', json=payload)
    assert res.status_code == 200
    body = res.json()

    # 1. NLI Cross-Encoder
    assert body['encoder']['verdict'] == 'SUSPICIOUS'
    assert body['encoder']['abstained'] is False
    assert body['encoder']['riskScore'] == pytest.approx(0.88, abs=1e-3)
    assert len(body['encoder']['scores']) == 5

    # 2. Semantic Bi-Encoder (lexical fallback when neural weights absent)
    assert body['biEncoder']['backend'] == 'lexical-fallback'
    assert body['biEncoder']['itemCount'] == 2
    assert 0.0 <= body['biEncoder']['riskScore'] <= 1.0
    assert body['biEncoder']['mismatches'][0]['kind'] == 'embed'

    # 3. Tabular Behavioral Autoencoder
    assert body['autoencoder']['modelVersion'] == 'ae-v0'
    assert 0.0 <= body['autoencoder']['anomalyScore'] <= 1.0
    assert body['autoencoder']['reconstructionError'] >= 0.0

    # 4. Temporal 1D-CNN Sequence Encoder
    assert body['temporal']['modelVersion'] == 'seq-v0'
    assert 0.0 <= body['temporal']['riskScore'] <= 1.0
    assert body['temporal']['eventCount'] == 12

    # 5. Entity Graph R-GCN Encoder
    assert body['graph']['modelVersion'] == 'graph-v0'
    assert 0.0 <= body['graph']['riskScore'] <= 1.0
    assert body['graph']['nodeCount'] == 5
    assert body['graph']['motifs']['sharedInfraEdges'] == 2
    assert body['graph']['motifs']['websiteLinkEdges'] == 1

    _reset_serve_globals()


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


def test_experimental_encoders_are_off_by_default(monkeypatch):
    """The graph encoder and bi-encoder misread honest demo merchants, so /score leaves them out unless opted in."""
    _reset_serve_globals()
    monkeypatch.setattr(serve, 'EXPERIMENTAL_ENCODERS', False)
    client = TestClient(serve.app)
    body = client.post('/score', json={
        'features': {'llr_A1': 1.0, 'n_sales': 80.0},
        'alignment': {'declared': 'Bakeries, Breads', 'observed': [{'text': 'Sourdough loaf', 'kind': 'catalogue'}]},
        'graph': {'nodes': [{'id': 'm', 'type': 'merchant'}], 'edges': []},
    }).json()
    assert 'biEncoder' not in body and 'graph' not in body
    assert 'autoencoder' in body
    _reset_serve_globals()


def test_first_score_after_start_includes_encoders(monkeypatch):
    """A /score that arrives before any /health must still load the autoencoder and temporal encoder (Stage 2 v1 path)."""
    _reset_serve_globals()
    monkeypatch.setattr(serve, 'STAGE2', ROOT / 'ml' / 'models' / 'stage2-v1')  # undo the file's v0-only fixture
    monkeypatch.setattr(serve, '_v1', None)
    client = TestClient(serve.app)
    body = client.post('/score', json={'features': {'llr_A1': 1.0, 'n_sales': 80.0},
                                      'sequence': {'events': [[0.4, 0.6, -0.5, 0.8, 1, 0, 0, 0, 1, 1] for _ in range(12)],
                                                   'weekly': [1.0] * 8, 'signals': {}}}).json()
    assert body['modelVersion'] == 'stage2-v1'
    assert 'autoencoder' in body
    assert 'temporal' in body
    _reset_serve_globals()
