"""Local second-opinion scorer. GET /health, POST /score. The Bayesian engine still decides.

Multi-encoder Stage 2 service:
- Supervised tabular ensemble: LightGBM (m1-v0), MLP (nn-v0), Classical (LR/DT/RF)
- Unsupervised tabular behavioral autoencoder (ae-v0, pure NumPy)
- Temporal 1D-CNN sequence encoder (seq-v0, pure NumPy)
- Relational Graph Convolutional encoder (graph-v0, pure NumPy)
- Semantic Bi-Encoder for declared-vs-observed alignment (BAAI/bge-small-en-v1.5 or lexical fallback)
- Zero-shot NLI Cross-Encoder for contextual text assessment (DeBERTa-v3 NLI)
"""
import concurrent.futures
import json
import math
import os
import re
import threading
import time
from collections import Counter
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import lightgbm as lgb
except Exception:  # LightGBM's optional OpenMP runtime may be absent on CPU-only dev hosts.
    lgb = None
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / 'ml' / 'models' / 'm1-v0'
NET = ROOT / 'ml' / 'models' / 'nn-v0' / 'network.json'
AE_PATH = ROOT / 'ml' / 'models' / 'ae-v0' / 'autoencoder.json'
SEQ_PATH = ROOT / 'ml' / 'models' / 'seq-v0' / 'temporal.json'
GRAPH_PATH = ROOT / 'ml' / 'models' / 'graph-v0' / 'graph.json'

DEFAULT_NLI_MODEL = 'MoritzLaurer/DeBERTa-v3-xsmall-mnli-fever-anli-ling-binary'
DEFAULT_BI_MODEL = 'BAAI/bge-small-en-v1.5'

NLI_HYPOTHESIS_TEMPLATE = 'The merchant evidence indicates {}.'
NLI_LABELS = [
    'activity consistent with the declared merchant category',
    'a legitimate seasonal surge or declared business change',
    'undisclosed gambling, betting, or illicit front activity',
    'a fabricated storefront or mismatched product catalogue',
    'insufficient web and text context to assess the merchant',
]
NLI_ILLICIT_LABELS = {
    'undisclosed gambling, betting, or illicit front activity',
    'a fabricated storefront or mismatched product catalogue',
}
NLI_INSUFFICIENT_LABEL = 'insufficient web and text context to assess the merchant'


def _pick_device() -> tuple[str, Any]:
    """Select best available torch device (cuda -> mps -> cpu), honoring MRE_ENCODER_DEVICE."""
    override = os.getenv('MRE_ENCODER_DEVICE', '').strip().lower()
    if override == 'cpu':
        return 'cpu', -1
    try:
        import torch
        if override:
            if override == 'cuda' and torch.cuda.is_available():
                return 'cuda', 0
            if override == 'mps' and getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available():
                return 'mps', 'mps'
            return 'cpu', -1
        if torch.cuda.is_available():
            return 'cuda', 0
        if getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available():
            return 'mps', 'mps'
    except Exception:
        pass
    return 'cpu', -1


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    if os.getenv('MRE_ENCODER_PRELOAD', '').strip() == '1':
        nli_name = os.getenv('MRE_ENCODER_MODEL', DEFAULT_NLI_MODEL).strip()
        bi_name = os.getenv('MRE_BI_ENCODER_MODEL', DEFAULT_BI_MODEL).strip()
        if nli_name:
            _start_encoder_load(nli_name)
        if bi_name:
            _start_bi_encoder_load(bi_name)
    yield


app = FastAPI(lifespan=_lifespan)
_booster = None
_cols: list[str] = []
_cal: dict = {}
_net: dict | None = None
_ae: dict | None = None
_seq: dict | None = None
_graph: dict | None = None
_classical: list[dict] = []

_encoder = None
_encoder_lock = threading.Lock()
_encoder_loading = False
_encoder_status = 'idle'
_encoder_error: str | None = None
_encoder_model_loaded: str | None = None
_encoder_exec = concurrent.futures.ThreadPoolExecutor(max_workers=1)

_bi_tokenizer = None
_bi_model = None
_bi_device = 'cpu'
_bi_lock = threading.Lock()
_bi_loading = False
_bi_status = 'idle'
_bi_error: str | None = None
_bi_model_loaded: str | None = None
_bi_exec = concurrent.futures.ThreadPoolExecutor(max_workers=1)


# ---------------------------------------------------------------------------
# 1. NLI Text Cross-Encoder (Zero-Shot Contextual Assessment)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=256)
def _run_encoder(encoder_id: int, model_name: str, snippet: str) -> dict:
    t0 = time.perf_counter()
    try:
        import torch
        ctx = torch.inference_mode()
    except Exception:
        from contextlib import nullcontext
        ctx = nullcontext()
    with ctx:
        result = _encoder(
            snippet,
            candidate_labels=NLI_LABELS,
            hypothesis_template=NLI_HYPOTHESIS_TEMPLATE,
            multi_label=False,
        )
    latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    labels = list(result.get('labels') or [])
    scores = [float(s) for s in (result.get('scores') or [])]
    score_map = {lbl: round(sc, 4) for lbl, sc in zip(labels, scores)}
    top_label = labels[0] if labels else None
    top_score = float(scores[0]) if scores else None
    risk_score = round(sum(score_map.get(lbl, 0.0) for lbl in NLI_ILLICIT_LABELS), 4)
    abstained = (top_label == NLI_INSUFFICIENT_LABEL) or (top_score is None) or (top_score < 0.45)
    if abstained:
        verdict = 'INSUFFICIENT'
    elif top_label in NLI_ILLICIT_LABELS or risk_score >= 0.5:
        verdict = 'SUSPICIOUS'
    else:
        verdict = 'CONSISTENT'
    return {
        'label': top_label,
        'score': round(top_score, 4) if top_score is not None else None,
        'verdict': verdict,
        'riskScore': risk_score,
        'abstained': abstained,
        'scores': score_map,
        'latencyMs': latency_ms,
        'modelVersion': model_name,
    }


def _start_encoder_load(model_name: str):
    global _encoder_loading, _encoder_status, _encoder_error
    with _encoder_lock:
        if _encoder is not None or _encoder_loading or not model_name:
            return
        _encoder_loading = True
        _encoder_status = 'loading'
        _encoder_error = None

    def _load():
        global _encoder, _encoder_loading, _encoder_status, _encoder_error, _encoder_model_loaded
        try:
            from transformers import pipeline
            _, pipe_device = _pick_device()
            enc = pipeline('zero-shot-classification', model=model_name, device=pipe_device)
            with _encoder_lock:
                _encoder = enc
                _encoder_model_loaded = model_name
                _encoder_status = 'ready'
                _encoder_error = None
        except Exception as exc:
            with _encoder_lock:
                _encoder_status = 'error'
                _encoder_error = f'{type(exc).__name__}: {str(exc)[:180]}'
        finally:
            with _encoder_lock:
                _encoder_loading = False

    threading.Thread(target=_load, daemon=True).start()


def _contextual_score(text: str):
    """Optional lazy zero-shot NLI cross-encoder. Never blocks or breaks the statistical scoring path."""
    model_name = os.getenv('MRE_ENCODER_MODEL', DEFAULT_NLI_MODEL).strip()
    raw = text.strip()
    if not model_name or not raw:
        return None
    truncated = len(raw) > 1600
    snippet = raw[:1600]
    if _encoder is None:
        _start_encoder_load(model_name)
        return None
    try:
        timeout_s = float(os.getenv('MRE_ENCODER_TIMEOUT_SEC', '8'))
        fut = _encoder_exec.submit(_run_encoder, id(_encoder), model_name, snippet)
        out = dict(fut.result(timeout=max(0.5, timeout_s)))
        out['truncated'] = truncated
        return out
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 2. Semantic Bi-Encoder (Declared vs. Observed Alignment)
# ---------------------------------------------------------------------------

def _start_bi_encoder_load(model_name: str):
    global _bi_loading, _bi_status, _bi_error
    with _bi_lock:
        if _bi_model is not None or _bi_loading or not model_name:
            return
        _bi_loading = True
        _bi_status = 'loading'
        _bi_error = None

    def _load():
        global _bi_tokenizer, _bi_model, _bi_device, _bi_loading, _bi_status, _bi_error, _bi_model_loaded
        try:
            import torch
            from transformers import AutoModel, AutoTokenizer
            dev_name, _ = _pick_device()
            tok = AutoTokenizer.from_pretrained(model_name)
            mod = AutoModel.from_pretrained(model_name)
            mod.eval()
            if dev_name != 'cpu':
                mod.to(dev_name)
            with _bi_lock:
                _bi_tokenizer = tok
                _bi_model = mod
                _bi_device = dev_name
                _bi_model_loaded = model_name
                _bi_status = 'ready'
                _bi_error = None
        except Exception as exc:
            with _bi_lock:
                _bi_status = 'error'
                _bi_error = f'{type(exc).__name__}: {str(exc)[:180]}'
        finally:
            with _bi_lock:
                _bi_loading = False

    threading.Thread(target=_load, daemon=True).start()


def _lexical_embed(text: str) -> Counter:
    cleaned = re.sub(r'[^a-z0-9\s]+', ' ', text.lower()).strip()
    tokens = [t for t in cleaned.split() if len(t) >= 2]
    feats = Counter(tokens)
    compact = ' '.join(tokens)
    for n in (3, 4):
        for i in range(max(0, len(compact) - n + 1)):
            feats[f'c{n}:{compact[i:i + n]}'] += 0.35
    return feats


def _lexical_cosine(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    dot = sum(v * b[k] for k, v in a.items() if k in b)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return float(dot / (na * nb)) if na > 0 and nb > 0 else 0.0


def _neural_bi_similarities(declared: str, texts: list[str]) -> list[float]:
    import torch
    all_texts = [declared] + texts
    with torch.inference_mode():
        encoded = _bi_tokenizer(all_texts, padding=True, truncation=True, max_length=256, return_tensors='pt')
        if _bi_device != 'cpu':
            encoded = {k: v.to(_bi_device) for k, v in encoded.items()}
        out = _bi_model(**encoded)
        mask = encoded['attention_mask'].unsqueeze(-1).float()
        pooled = (out.last_hidden_state * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-6)
        normed = torch.nn.functional.normalize(pooled, p=2, dim=1)
        sims = (normed[1:] @ normed[0]).detach().cpu().numpy().tolist()
    return [float(max(-1.0, min(1.0, s))) for s in sims]


def _bi_encoder_score(alignment: dict | None) -> dict | None:
    if not alignment:
        return None
    declared = str(alignment.get('declared') or '').strip()
    raw_items = alignment.get('observed') or []
    items = [
        {'text': str(it.get('text') or '').strip()[:240], 'kind': str(it.get('kind') or 'item')}
        for it in raw_items[:32]
        if str(it.get('text') or '').strip()
    ]
    if not declared or not items:
        return None

    t0 = time.perf_counter()
    model_name = os.getenv('MRE_BI_ENCODER_MODEL', DEFAULT_BI_MODEL).strip()
    backend = 'lexical-fallback'
    version = 'lexical-bi-encoder-v0'
    sims: list[float] | None = None

    if model_name and _bi_model is not None and _bi_tokenizer is not None:
        try:
            timeout_s = float(os.getenv('MRE_ENCODER_TIMEOUT_SEC', '8'))
            fut = _bi_exec.submit(_neural_bi_similarities, declared, [x['text'] for x in items])
            sims = fut.result(timeout=max(0.5, timeout_s))
            backend = 'neural'
            version = model_name
        except Exception:
            sims = None
    elif model_name and _bi_status == 'idle' and os.getenv('MRE_BI_ENCODER_AUTOLOAD', '0').strip() == '1':
        _start_bi_encoder_load(model_name)

    if sims is None:
        dec_vec = _lexical_embed(declared)
        sims = [_lexical_cosine(dec_vec, _lexical_embed(x['text'])) for x in items]

    threshold = 0.35 if backend == 'neural' else 0.12
    scored = [
        {'text': it['text'], 'kind': it['kind'], 'similarity': round(float(s), 4)}
        for it, s in zip(items, sims)
    ]
    scored.sort(key=lambda x: x['similarity'])
    mean_sim = float(np.mean(sims))
    min_sim = float(np.min(sims))
    mismatch_share = float(np.mean([s < threshold for s in sims]))
    # Penalize severe off-domain embeds/sightings more strongly than ordinary catalogue items
    suspicious_kinds = [s for it, s in zip(items, sims) if it['kind'] in ('embed', 'sighting') and s < threshold]
    risk_raw = 0.65 * mismatch_share + 0.35 * max(0.0, 1.0 - min_sim / max(threshold * 2.0, 0.25))
    if suspicious_kinds:
        risk_raw = min(1.0, risk_raw + 0.15)
    risk_score = round(float(np.clip(risk_raw, 0.0, 1.0)), 4)

    return {
        'modelVersion': version,
        'backend': backend,
        'meanSimilarity': round(mean_sim, 4),
        'minSimilarity': round(min_sim, 4),
        'mismatchShare': round(mismatch_share, 4),
        'riskScore': risk_score,
        'itemCount': len(items),
        'mismatches': scored[:5],
        'latencyMs': round((time.perf_counter() - t0) * 1000.0, 1),
    }


# ---------------------------------------------------------------------------
# 3. Tabular Behavioral Autoencoder (ae-v0, Pure NumPy)
# ---------------------------------------------------------------------------

def _ae_forward(features: dict[str, float]) -> dict | None:
    if _ae is None:
        return None
    cols = _ae['features']
    row = np.asarray([float(features.get(c, 0.0)) for c in cols], dtype=float)
    z = np.clip((row - np.asarray(_ae['mean'])) / np.asarray(_ae['std']), -8.0, 8.0)
    h = z.reshape(1, -1)
    coefs = [np.asarray(w, dtype=float) for w in _ae['coefs']]
    intercepts = [np.asarray(b, dtype=float) for b in _ae['intercepts']]
    bottleneck_idx = len(coefs) // 2 - 1
    latent = h
    for i, (w, b) in enumerate(zip(coefs, intercepts)):
        h = h @ w + b
        if i < len(coefs) - 1:
            h = np.maximum(h, 0.0)
        if i == bottleneck_idx:
            latent = h
    z_hat = h.ravel()
    sq_err = (z - z_hat) ** 2
    mse = float(np.mean(sq_err))
    cal = _ae['calibration']
    p95 = float(cal['p95'])
    scale = max(float(cal['scale']), 1e-4)
    anomaly_score = float(1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, (mse - p95) / scale * 2.0)))))
    order = np.argsort(-sq_err)[:5]
    top_residuals = [{'feature': cols[i], 'residual': round(float(sq_err[i]), 4)} for i in order if sq_err[i] > 1e-4]
    return {
        'modelVersion': _ae.get('modelVersion', 'ae-v0'),
        'anomalyScore': round(anomaly_score, 4),
        'reconstructionError': round(mse, 5),
        'thresholdP95': round(p95, 5),
        'isAnomaly': bool(mse >= p95),
        'latentNorm': round(float(np.linalg.norm(latent)), 4),
        'topResiduals': top_residuals,
    }


# ---------------------------------------------------------------------------
# 4. Temporal 1D-CNN Sequence Encoder (seq-v0, Pure NumPy)
# ---------------------------------------------------------------------------

def _conv1d_single(x: np.ndarray, w: np.ndarray, b: np.ndarray) -> np.ndarray:
    T, _ = x.shape
    K, _, Cout = w.shape
    pad = K // 2
    xp = np.pad(x, ((pad, pad), (0, 0)), mode='constant')
    out = np.zeros((T, Cout), dtype=float)
    for k in range(K):
        out += xp[k:k + T, :] @ w[k]
    return out + b


def _temporal_forward(seq_in: dict | None) -> dict | None:
    if _seq is None or not seq_in:
        return None
    raw_events = seq_in.get('events') or []
    raw_weekly = seq_in.get('weekly') or []
    if not raw_events and not raw_weekly:
        return None

    max_ev = int(_seq.get('maxEvents', 64))
    ch = int(_seq.get('eventChannels', 10))
    wk_dim = int(_seq.get('weeklyDim', 8))

    seq = np.zeros((max_ev, ch), dtype=float)
    n_ev = min(len(raw_events), max_ev)
    for i, ev in enumerate(raw_events[-n_ev:] if n_ev else []):
        arr = np.asarray(ev[:ch], dtype=float)
        seq[i, :len(arr)] = arr

    wk = np.zeros(wk_dim, dtype=float)
    if raw_weekly:
        w_arr = np.asarray(raw_weekly[:wk_dim], dtype=float)
        wk[:len(w_arr)] = w_arr
    wk_mu = np.asarray(_seq['weeklyMean'], dtype=float)
    wk_sd = np.asarray(_seq['weeklyStd'], dtype=float)
    wk_n = np.clip((wk - wk_mu) / wk_sd, -6.0, 6.0)

    w = {k: np.asarray(v, dtype=float) for k, v in _seq['weights'].items()}
    mask = (np.abs(seq).sum(axis=1, keepdims=True) > 1e-8).astype(float)
    length = max(float(mask.sum()), 1.0)

    a1 = np.maximum(_conv1d_single(seq, w['c1_w'], w['c1_b']), 0.0) * mask
    a2 = np.maximum(_conv1d_single(a1, w['c2_w'], w['c2_b']), 0.0) * mask

    gap = a2.sum(axis=0) / length
    gmp = np.max(np.where(mask > 0.5, a2, -1e9), axis=0) if n_ev > 0 else np.zeros(a2.shape[1])
    h_cat = np.concatenate([gap, gmp, wk_n])
    a3 = np.maximum(h_cat @ w['fc1_w'] + w['fc1_b'], 0.0)
    logit = float((a3 @ w['fc2_w'] + w['fc2_b']).ravel()[0])
    risk = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, logit))))

    return {
        'modelVersion': _seq.get('modelVersion', 'seq-v0'),
        'riskScore': round(float(risk), 4),
        'embeddingNorm': round(float(np.linalg.norm(a3)), 4),
        'eventCount': int(n_ev),
        'signals': seq_in.get('signals') or {},
    }


# ---------------------------------------------------------------------------
# 5. Entity Graph R-GCN Encoder (graph-v0, Pure NumPy)
# ---------------------------------------------------------------------------

def _graph_forward(graph_in: dict | None) -> dict | None:
    if _graph is None or not graph_in:
        return None
    nodes = graph_in.get('nodes') or []
    edges = graph_in.get('edges') or []
    if not nodes:
        return None

    node_types = _graph['nodeTypes']
    edge_types = _graph['edgeTypes']
    node_idx = {t: i for i, t in enumerate(node_types)}
    edge_idx = {t: i for i, t in enumerate(edge_types)}
    in_dim = len(node_types) + len(edge_types) + 2

    n = len(nodes)
    id_to_i = {str(nd.get('id', i)): i for i, nd in enumerate(nodes)}
    X = np.zeros((n, in_dim), dtype=float)
    adjs = [np.zeros((n, n), dtype=float) for _ in edge_types]
    nbr_types: list[set[str]] = [set() for _ in range(n)]

    merchant_i = 0
    peer_count = 0
    beneficiary_count = 0
    for i, nd in enumerate(nodes):
        t = str(nd.get('type') or 'merchant')
        if t == 'merchant':
            merchant_i = i
        elif t == 'peer':
            peer_count += 1
        elif t == 'beneficiary':
            beneficiary_count += 1
        if t in node_idx:
            X[i, node_idx[t]] = 1.0

    edge_counts = Counter()
    for ed in edges:
        u = id_to_i.get(str(ed.get('source', '')))
        v = id_to_i.get(str(ed.get('target', '')))
        if u is None or v is None or u == v:
            continue
        et = str(ed.get('type') or 'PAYMENT_FLOW')
        edge_counts[et] += 1
        r = edge_idx.get(et, 2)
        wt = float(ed.get('weight') or 1.0)
        adjs[r][u, v] += wt
        adjs[r][v, u] += wt
        nbr_types[u].add(str(nodes[v].get('type') or ''))
        nbr_types[v].add(str(nodes[u].get('type') or ''))

    for r in range(len(edge_types)):
        deg = adjs[r].sum(axis=1)
        X[:, len(node_types) + r] = np.log1p(deg) / 2.5
        denom = np.where(deg > 0, deg, 1.0)[:, None]
        adjs[r] = adjs[r] / denom

    total_deg = sum((a > 0).sum(axis=1) for a in adjs)
    X[:, len(node_types) + len(edge_types)] = np.log1p(total_deg) / 3.0
    X[:, len(node_types) + len(edge_types) + 1] = np.asarray([len(s) / len(node_types) for s in nbr_types])

    w = {k: np.asarray(v, dtype=float) for k, v in _graph['weights'].items()}
    z1 = X @ w['w1_self'] + w['b1']
    for r, a in enumerate(adjs):
        z1 = z1 + (a @ X) @ w['w1_rel'][r]
    h1 = np.maximum(z1, 0.0)

    z2 = h1 @ w['w2_self'] + w['b2']
    for r, a in enumerate(adjs):
        z2 = z2 + (a @ h1) @ w['w2_rel'][r]
    h2 = np.maximum(z2, 0.0)

    readout = np.concatenate([h2.mean(axis=0), h2.max(axis=0), h2[merchant_i]])
    logit = float(readout @ w['fc_w'] + w['fc_b'][0])
    risk = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, logit))))

    return {
        'modelVersion': _graph.get('modelVersion', 'graph-v0'),
        'riskScore': round(float(risk), 4),
        'embeddingNorm': round(float(np.linalg.norm(readout)), 4),
        'nodeCount': n,
        'edgeCount': int(sum(edge_counts.values())),
        'motifs': {
            'sharedInfraEdges': int(edge_counts.get('SHARED_INFRASTRUCTURE', 0)),
            'websiteLinkEdges': int(edge_counts.get('WEBSITE_LINK', 0)),
            'behavioralSimEdges': int(edge_counts.get('BEHAVIOURAL_SIMILARITY', 0)),
            'peerCount': peer_count,
            'beneficiaryCount': beneficiary_count,
        },
    }


# ---------------------------------------------------------------------------
# Supervised Tabular Models (Existing LightGBM + MLP + Classical)
# ---------------------------------------------------------------------------

def ready() -> bool:
    global _booster, _cols, _cal, _net, _ae, _seq, _graph, _classical
    if NET.exists() and _net is None:
        _net = json.loads(NET.read_text())
    if AE_PATH.exists() and _ae is None:
        _ae = json.loads(AE_PATH.read_text())
    if SEQ_PATH.exists() and _seq is None:
        _seq = json.loads(SEQ_PATH.read_text())
    if GRAPH_PATH.exists() and _graph is None:
        _graph = json.loads(GRAPH_PATH.read_text())
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
    alignment: dict[str, Any] | None = None
    sequence: dict[str, Any] | None = None
    graph: dict[str, Any] | None = None
    force_encoder: bool = False


def _should_run_nli(ensemble_p: float, disagreement: float, features: dict[str, float], context: str, force: bool) -> bool:
    if force:
        return True
    low = float(os.getenv('MRE_ENCODER_LOW', '0.15'))
    high = float(os.getenv('MRE_ENCODER_HIGH', '0.80'))
    coverage = [v for k, v in features.items() if k.startswith('cov_')]
    low_cov = bool(coverage and sum(coverage) < min(4, len(coverage)))
    has_high_signal_text = ('Outside-in sightings:' in context) or ('Off-domain embeds:' in context)
    return (low <= ensemble_p <= high) or (disagreement >= 0.15) or low_cov or has_high_signal_text


def _run_aux_encoders(body: ScoreIn, ensemble_p: float, disagreement: float) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if _should_run_nli(ensemble_p, disagreement, body.features, body.context, body.force_encoder):
        enc = _contextual_score(body.context)
        if enc:
            out['encoder'] = enc
    bi = _bi_encoder_score(body.alignment)
    if bi:
        out['biEncoder'] = bi
    ae = _ae_forward(body.features)
    if ae:
        out['autoencoder'] = ae
    seq = _temporal_forward(body.sequence)
    if seq:
        out['temporal'] = seq
    gr = _graph_forward(body.graph)
    if gr:
        out['graph'] = gr
    return out


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
    # The multi-modal encoders (NLI, bi-encoder, autoencoder, temporal CNN, graph) run on the v1 path too. The NLI
    # encoder also runs when v1 is unsure: an unfamiliar merchant or a conformal set that is not one class.
    aux = _run_aux_encoders(body, p_train, float(max(base.values()) - min(base.values())))
    if 'encoder' not in aux and (novel or len(cset) != 1):
        enc = _contextual_score(body.context)
        if enc:
            aux['encoder'] = enc
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
        **aux,
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
        'encoderStatus': _encoder_status,
        'encoderModel': _encoder_model_loaded or os.getenv('MRE_ENCODER_MODEL', DEFAULT_NLI_MODEL).strip(),
        'encoderError': _encoder_error,
        'biEncoder': _bi_model is not None,
        'biEncoderStatus': _bi_status,
        'autoencoder': _ae is not None,
        'temporal': _seq is not None,
        'graph': _graph is not None,
        'serveVersion': 3,
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
        disagreement = float(max(scores) - min(scores)) if len(scores) > 1 else 0.0
        aux = _run_aux_encoders(body, p, disagreement)
        return {
            'p_raw': p, 'p': p, 'drivers': nn_out['drivers'], 'modelVersion': 'nn-v0',
            'classical': classical_out,
            'ensemble': {
                'p': p, 'models': ['nn-v0'] + [x['modelVersion'] for x in classical_out],
                'disagreement': disagreement, 'confidence': 'LOW', 'review': True,
                'syntheticTrainingExamples': min([x.get('training_examples', 0) for x in _classical], default=None),
            },
            'nn': nn_out,
            **aux,
        }
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
            c_row = np.asarray([[float(body.features.get(c, 0)) for c in cols]], dtype=float)
            q = float(bundle['model'].predict_proba(c_row)[0, 1])
            classical_out.append({'p': q, 'modelVersion': bundle['version']})
    scores = [p] + ([nn_out['p']] if nn_out else []) + [x['p'] for x in classical_out]
    ensemble_p = float(np.mean(scores))
    disagreement = float(max(scores) - min(scores)) if len(scores) > 1 else 0.0
    synthetic_small = any(x.get('synthetic') and x.get('training_examples', 0) < 100 for x in _classical)
    confidence = 'LOW' if synthetic_small else (
        'HIGH' if len(scores) > 1 and disagreement <= 0.05 else (
            'MEDIUM' if len(scores) > 1 and disagreement <= 0.15 else 'LOW'
        )
    )
    aux = _run_aux_encoders(body, ensemble_p, disagreement)
    return {
        'p_raw': raw, 'p': p, 'drivers': drivers, 'modelVersion': 'm1-v0',
        'classical': classical_out,
        'ensemble': {
            'p': ensemble_p,
            'models': ['m1-v0'] + (['nn-v0'] if nn_out else []) + [x['modelVersion'] for x in classical_out],
            'disagreement': disagreement, 'confidence': confidence,
            'review': confidence == 'LOW',
            'syntheticTrainingExamples': min([x.get('training_examples', 0) for x in _classical], default=None),
        },
        **aux,
        **({'nn': nn_out} if nn_out else {}),
    }
