"""Train a lightweight 1D-CNN temporal sequence encoder (seq-v0) over transaction & weekly series.

Encodes up to 64 time-ordered payment events (10 channels each) with 2 Conv1D layers + masked GAP/GMP,
combined with an 8-dim weekly trajectory summary, and exports pure-JSON weights for <2 ms NumPy inference.
"""
from datetime import datetime
import glob
import json
import math
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'ml' / 'models' / 'seq-v0'
SEED = 11
MAX_EVENTS = 64
EVENT_CHANNELS = 10
WEEKLY_DIM = 8

GENUINE_HINTS = ('genuine', 'steady', 'honest-change')
ILLICIT_HINTS = ('betting', 'rotation', 'fabricated')


def _parse_ts(val) -> float:
    if isinstance(val, (int, float)):
        return float(val) / 1000.0 if val > 1e11 else float(val)
    try:
        return datetime.fromisoformat(str(val)).timestamp()
    except Exception:
        return 0.0


def encode_raw_sample(doc: dict) -> tuple[np.ndarray, np.ndarray]:
    merchant = doc.get('merchant') or {}
    local_states = set(merchant.get('localStates') or [])
    baseline = float(merchant.get('baselineWeekly') or 40000.0)
    txs = sorted(doc.get('transactions') or [], key=lambda x: _parse_ts(x.get('time', 0)))
    txs = txs[-MAX_EVENTS:]

    seq = np.zeros((MAX_EVENTS, EVENT_CHANNELS), dtype=float)
    prev_t = None
    for idx, tx in enumerate(txs):
        t = _parse_ts(tx.get('time', 0))
        dt = max(1.0, t - prev_t) if prev_t is not None and t > prev_t else 3600.0
        prev_t = t
        amt = max(1.0, float(tx.get('amount') or 0.0))
        # IST (+5:30) hour of day
        hour = ((t + 19800.0) % 86400.0) / 3600.0
        ang = 2.0 * math.pi * hour / 24.0
        typ = str(tx.get('type') or '').upper()
        ch = str(tx.get('channel') or '').upper()
        st = str(tx.get('payerState') or '')
        out_state = 1.0 if (local_states and st and st not in local_states) else 0.0
        seq[idx] = [
            min(math.log1p(dt) / 12.0, 1.5),
            min(math.log1p(amt) / 12.0, 1.5),
            math.sin(ang),
            math.cos(ang),
            1.0 if typ == 'SALE' else 0.0,
            1.0 if typ == 'REFUND' else 0.0,
            1.0 if typ == 'TRANSFER' else 0.0,
            1.0 if typ == 'SETTLEMENT' else 0.0,
            1.0 if ch in ('UPI_LINK', 'UPI_COLLECT') else 0.0,
            out_state,
        ]

    weekly = doc.get('weeklySales') or []
    ratios = []
    missing = 0
    for w in weekly:
        act = w.get('actual')
        if act is None:
            missing += 1
            continue
        mult = max(0.2, float(w.get('seasonalMultiplier') or w.get('seasonalMult') or 1.0))
        ratios.append(float(act) / max(1.0, baseline * mult))
    if ratios:
        arr = np.asarray(ratios, dtype=float)
        slope = float(arr[-1] - arr[0]) / max(1.0, len(arr) - 1) if len(arr) > 1 else 0.0
        w_vec = np.asarray([
            float(np.clip(arr.mean(), 0.0, 5.0)),
            float(np.clip(arr.max(), 0.0, 8.0)),
            float(np.clip(arr[-1], 0.0, 8.0)),
            float(np.clip(arr.std(), 0.0, 4.0)),
            float(np.clip(slope, -2.0, 2.0)),
            min(len(arr) / 16.0, 1.5),
            float(np.mean(arr >= 1.8)),
            missing / max(1, len(weekly)),
        ], dtype=float)
    else:
        w_vec = np.asarray([1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0], dtype=float)
    return seq, w_vec


def _synth_sequence(rng: np.random.Generator, illicit: bool) -> tuple[np.ndarray, np.ndarray]:
    n = int(rng.integers(24, MAX_EVENTS + 1))
    seq = np.zeros((MAX_EVENTS, EVENT_CHANNELS), dtype=float)
    archetype = int(rng.integers(0, 4)) if illicit else int(rng.integers(0, 3))

    for i in range(n):
        if not illicit:
            if archetype == 0:  # steady local retail
                dt = rng.exponential(5400.0)
                amt = rng.lognormal(6.0, 0.5)
                hour = rng.normal(15.0, 3.2) % 24.0
                out_state = 1.0 if rng.random() < 0.05 else 0.0
                upi_link = 1.0 if rng.random() < 0.12 else 0.0
                typ_p = [0.86, 0.04, 0.02, 0.08]
            elif archetype == 1:  # genuine festive/seasonal surge
                dt = rng.exponential(2800.0)
                amt = rng.lognormal(6.4, 0.55)
                hour = rng.normal(16.0, 3.5) % 24.0
                out_state = 1.0 if rng.random() < 0.12 else 0.0
                upi_link = 1.0 if rng.random() < 0.25 else 0.0
                typ_p = [0.85, 0.05, 0.02, 0.08]
            else:  # honest business change (national delivery)
                dt = rng.exponential(3600.0)
                amt = rng.lognormal(6.5, 0.6)
                hour = rng.normal(14.5, 3.8) % 24.0
                out_state = 1.0 if rng.random() < 0.35 else 0.0
                upi_link = 1.0 if rng.random() < 0.35 else 0.0
                typ_p = [0.84, 0.06, 0.02, 0.08]
        else:
            if archetype == 0:  # betting front: bursts, out-of-state, UPI links, evening/night
                dt = rng.exponential(420.0 if rng.random() < 0.65 else 3000.0)
                amt = float(rng.choice([500, 1000, 2000, 5000, 10000])) * rng.uniform(0.95, 1.05)
                hour = (rng.normal(21.5, 2.5) if rng.random() < 0.7 else rng.normal(1.5, 2.0)) % 24.0
                out_state = 1.0 if rng.random() < 0.78 else 0.0
                upi_link = 1.0 if rng.random() < 0.82 else 0.0
                typ_p = [0.70, 0.04, 0.16, 0.10]
            elif archetype == 1:  # night betting / side hustle
                dt = rng.exponential(700.0)
                amt = float(rng.choice([500, 1000, 2500, 5000]))
                hour = rng.normal(0.5, 2.2) % 24.0
                out_state = 1.0 if rng.random() < 0.62 else 0.0
                upi_link = 1.0 if rng.random() < 0.70 else 0.0
                typ_p = [0.72, 0.03, 0.15, 0.10]
            elif archetype == 2:  # rapid settlement-to-transfer sweep / rotation
                dt = rng.exponential(900.0)
                amt = rng.lognormal(7.6, 0.6)
                hour = rng.normal(19.0, 4.5) % 24.0
                out_state = 1.0 if rng.random() < 0.68 else 0.0
                upi_link = 1.0 if rng.random() < 0.65 else 0.0
                typ_p = [0.58, 0.04, 0.24, 0.14]
            else:  # fabricated online store (unusual refunds/transfers + remote payers)
                dt = rng.exponential(1500.0)
                amt = rng.lognormal(7.4, 0.5)
                hour = rng.normal(20.0, 4.0) % 24.0
                out_state = 1.0 if rng.random() < 0.72 else 0.0
                upi_link = 1.0 if rng.random() < 0.55 else 0.0
                typ_p = [0.68, 0.12, 0.12, 0.08]

        typ = int(rng.choice(4, p=typ_p))
        ang = 2.0 * math.pi * hour / 24.0
        seq[i] = [
            min(math.log1p(max(1.0, dt)) / 12.0, 1.5),
            min(math.log1p(max(1.0, amt)) / 12.0, 1.5),
            math.sin(ang),
            math.cos(ang),
            1.0 if typ == 0 else 0.0,
            1.0 if typ == 1 else 0.0,
            1.0 if typ == 2 else 0.0,
            1.0 if typ == 3 else 0.0,
            upi_link,
            out_state,
        ]

    # Weekly ratio vector
    if not illicit:
        base_r = rng.normal(1.02, 0.15, size=14)
        if archetype == 1:  # seasonal peak already adjusted by seasonalMult
            base_r[-3:] *= rng.uniform(1.0, 1.35)
    else:
        base_r = rng.normal(1.05, 0.18, size=14)
        base_r[-4:] *= rng.uniform(2.0, 4.2)
    base_r = np.clip(base_r, 0.2, 7.0)
    slope = float(base_r[-1] - base_r[0]) / max(1.0, len(base_r) - 1)
    w_vec = np.asarray([
        float(base_r.mean()),
        float(base_r.max()),
        float(base_r[-1]),
        float(base_r.std()),
        float(np.clip(slope, -2.0, 2.0)),
        len(base_r) / 16.0,
        float(np.mean(base_r >= 1.8)),
        0.0,
    ], dtype=float)
    return seq, w_vec


def _conv1d_forward(x: np.ndarray, w: np.ndarray, b: np.ndarray) -> np.ndarray:
    """x: (B, T, Cin), w: (K, Cin, Cout), b: (Cout,) -> (B, T, Cout) with same padding (K=3)."""
    B, T, Cin = x.shape
    K, _, Cout = w.shape
    pad = K // 2
    xp = np.pad(x, ((0, 0), (pad, pad), (0, 0)), mode='constant')
    out = np.zeros((B, T, Cout), dtype=float)
    for k in range(K):
        out += np.einsum('btc,co->bto', xp[:, k:k + T, :], w[k])
    return out + b


def _conv1d_backward(x: np.ndarray, w: np.ndarray, dout: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    B, T, Cin = x.shape
    K, _, Cout = w.shape
    pad = K // 2
    xp = np.pad(x, ((0, 0), (pad, pad), (0, 0)), mode='constant')
    dw = np.zeros_like(w)
    dxp = np.zeros_like(xp)
    for k in range(K):
        dw[k] = np.einsum('btc,bto->co', xp[:, k:k + T, :], dout)
        dxp[:, k:k + T, :] += np.einsum('bto,co->btc', dout, w[k])
    db = dout.sum(axis=(0, 1))
    dx = dxp[:, pad:pad + T, :] if pad > 0 else dxp
    return dx, dw, db


def _forward_all(seq: np.ndarray, wk: np.ndarray, params: dict[str, np.ndarray]):
    mask = (np.abs(seq).sum(axis=2, keepdims=True) > 1e-8).astype(float)  # (B, T, 1)
    lengths = np.maximum(mask.sum(axis=1), 1.0)  # (B, 1)

    z1 = _conv1d_forward(seq, params['c1_w'], params['c1_b'])
    a1 = np.maximum(z1, 0.0) * mask
    z2 = _conv1d_forward(a1, params['c2_w'], params['c2_b'])
    a2 = np.maximum(z2, 0.0) * mask

    gap = a2.sum(axis=1) / lengths  # (B, 12)
    masked_for_max = np.where(mask > 0.5, a2, -1e9)
    max_idx = np.argmax(masked_for_max, axis=1)  # (B, 12)
    gmp = np.take_along_axis(a2, max_idx[:, None, :], axis=1)[:, 0, :]

    h_cat = np.concatenate([gap, gmp, wk], axis=1)  # (B, 32)
    z3 = h_cat @ params['fc1_w'] + params['fc1_b']
    a3 = np.maximum(z3, 0.0)
    logit = (a3 @ params['fc2_w'] + params['fc2_b']).ravel()
    prob = 1.0 / (1.0 + np.exp(-np.clip(logit, -30.0, 30.0)))
    cache = (mask, lengths, z1, a1, z2, a2, max_idx, h_cat, z3, a3)
    return prob, cache


def main() -> None:
    rng = np.random.default_rng(SEED)
    seqs, wks, labels = [], [], []

    # Load real sample datasets first
    for path in sorted(glob.glob(str(ROOT / 'dist-console' / 'samples' / '[0-9]*.json'))):
        name = Path(path).name.lower()
        if any(h in name for h in GENUINE_HINTS):
            lbl = 0
        elif any(h in name for h in ILLICIT_HINTS):
            lbl = 1
        else:
            continue
        s, w = encode_raw_sample(json.loads(Path(path).read_text()))
        for _ in range(4):
            seqs.append(s + rng.normal(0, 0.015, size=s.shape) * (np.abs(s) > 0))
            wks.append(w + rng.normal(0, 0.02, size=w.shape))
            labels.append(lbl)

    # Synthetic training/validation sequences
    for _ in range(220):
        s, w = _synth_sequence(rng, illicit=False)
        seqs.append(s)
        wks.append(w)
        labels.append(0)
    for _ in range(180):
        s, w = _synth_sequence(rng, illicit=True)
        seqs.append(s)
        wks.append(w)
        labels.append(1)

    X_seq = np.asarray(seqs, dtype=float)
    X_wk = np.asarray(wks, dtype=float)
    y = np.asarray(labels, dtype=float)

    perm = rng.permutation(len(y))
    X_seq, X_wk, y = X_seq[perm], X_wk[perm], y[perm]
    split = int(0.8 * len(y))
    s_tr, w_tr, y_tr = X_seq[:split], X_wk[:split], y[:split]
    s_va, w_va, y_va = X_seq[split:], X_wk[split:], y[split:]

    wk_mu = w_tr.mean(axis=0)
    wk_sd = w_tr.std(axis=0)
    wk_sd[wk_sd < 1e-6] = 1.0
    w_tr_n = np.clip((w_tr - wk_mu) / wk_sd, -6.0, 6.0)
    w_va_n = np.clip((w_va - wk_mu) / wk_sd, -6.0, 6.0)

    params = {
        'c1_w': rng.normal(0, math.sqrt(2.0 / (3 * EVENT_CHANNELS)), size=(3, EVENT_CHANNELS, 12)),
        'c1_b': np.zeros(12),
        'c2_w': rng.normal(0, math.sqrt(2.0 / (3 * 12)), size=(3, 12, 12)),
        'c2_b': np.zeros(12),
        'fc1_w': rng.normal(0, math.sqrt(2.0 / 32), size=(32, 16)),
        'fc1_b': np.zeros(16),
        'fc2_w': rng.normal(0, math.sqrt(1.0 / 16), size=(16, 1)),
        'fc2_b': np.zeros(1),
    }
    m = {k: np.zeros_like(v) for k, v in params.items()}
    v = {k: np.zeros_like(val) for k, val in params.items()}
    lr = 4e-3
    wd = 1e-3
    step = 0
    batch_size = 32

    for _epoch in range(90):
        idx = rng.permutation(len(y_tr))
        for start in range(0, len(y_tr), batch_size):
            b = idx[start:start + batch_size]
            sb, wb, yb = s_tr[b], w_tr_n[b], y_tr[b]
            prob, (mask, lengths, z1, a1, z2, a2, max_idx, h_cat, z3, a3) = _forward_all(sb, wb, params)

            B = len(yb)
            dlogit = ((prob - yb) / B)[:, None]  # (B, 1)
            grads = {}
            grads['fc2_w'] = a3.T @ dlogit + wd * params['fc2_w']
            grads['fc2_b'] = dlogit.sum(axis=0)
            da3 = dlogit @ params['fc2_w'].T
            dz3 = da3 * (z3 > 0)
            grads['fc1_w'] = h_cat.T @ dz3 + wd * params['fc1_w']
            grads['fc1_b'] = dz3.sum(axis=0)
            dh = dz3 @ params['fc1_w'].T

            dgap = dh[:, :12]
            dgmp = dh[:, 12:24]
            da2 = (dgap[:, None, :] / lengths[:, :, None]) * mask
            # Scatter GMP gradients
            b_idx = np.arange(B)[:, None]
            c_idx = np.arange(12)[None, :]
            da2[b_idx, max_idx, c_idx] += dgmp

            dz2 = da2 * (z2 > 0) * mask
            da1, grads['c2_w'], grads['c2_b'] = _conv1d_backward(a1, params['c2_w'], dz2)
            grads['c2_w'] += wd * params['c2_w']
            dz1 = da1 * (z1 > 0) * mask
            _, grads['c1_w'], grads['c1_b'] = _conv1d_backward(sb, params['c1_w'], dz1)
            grads['c1_w'] += wd * params['c1_w']

            step += 1
            for k in params:
                m[k] = 0.9 * m[k] + 0.1 * grads[k]
                v[k] = 0.999 * v[k] + 0.001 * (grads[k] ** 2)
                mh = m[k] / (1.0 - 0.9 ** step)
                vh = v[k] / (1.0 - 0.999 ** step)
                params[k] -= lr * mh / (np.sqrt(vh) + 1e-8)

    va_prob, _ = _forward_all(s_va, w_va_n, params)
    metrics = {
        'valCount': int(len(y_va)),
        'valAuprc': round(float(average_precision_score(y_va, va_prob)), 4),
        'valAuroc': round(float(roc_auc_score(y_va, va_prob)), 4),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    artifact = {
        'kind': 'temporal-1d-cnn',
        'modelVersion': 'seq-v0',
        'maxEvents': MAX_EVENTS,
        'eventChannels': EVENT_CHANNELS,
        'weeklyDim': WEEKLY_DIM,
        'weeklyMean': wk_mu.tolist(),
        'weeklyStd': wk_sd.tolist(),
        'weights': {k: val.tolist() for k, val in params.items()},
        'metrics': metrics,
    }
    (OUT / 'temporal.json').write_text(json.dumps(artifact))
    print(f'wrote {OUT / "temporal.json"} metrics={json.dumps(metrics)}')


if __name__ == '__main__':
    main()
