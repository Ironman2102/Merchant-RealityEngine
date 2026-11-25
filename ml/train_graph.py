"""Train a 2-layer Relational Graph Convolutional Encoder (graph-v0) over merchant entity graphs.

Encodes typed nodes (merchant, payer, account, link, website, device, beneficiary, peer) and
6 relational edge types (ENTITY_RESOLUTION, BEHAVIOURAL_SIMILARITY, PAYMENT_FLOW,
SHARED_INFRASTRUCTURE, WEBSITE_LINK, SETTLEMENT_RELATIONSHIP) into a graph risk score & embedding.
Exports pure-JSON weights for <1 ms NumPy inference in ml/serve.py.
"""
import glob
import json
import math
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'ml' / 'models' / 'graph-v0'
SEED = 19

NODE_TYPES = ['merchant', 'payer', 'account', 'link', 'website', 'device', 'beneficiary', 'peer']
EDGE_TYPES = [
    'ENTITY_RESOLUTION',
    'BEHAVIOURAL_SIMILARITY',
    'PAYMENT_FLOW',
    'SHARED_INFRASTRUCTURE',
    'WEBSITE_LINK',
    'SETTLEMENT_RELATIONSHIP',
]
NODE_IDX = {t: i for i, t in enumerate(NODE_TYPES)}
EDGE_IDX = {t: i for i, t in enumerate(EDGE_TYPES)}
IN_DIM = len(NODE_TYPES) + len(EDGE_TYPES) + 2  # 16
H1_DIM = 12
H2_DIM = 8

GENUINE_HINTS = ('genuine', 'steady', 'honest-change')
ILLICIT_HINTS = ('betting', 'rotation', 'fabricated')


def graph_to_tensors(graph: dict) -> tuple[np.ndarray, list[np.ndarray], int]:
    nodes = graph.get('nodes') or []
    edges = graph.get('edges') or []
    if not nodes:
        return np.zeros((1, IN_DIM), dtype=float), [np.zeros((1, 1), dtype=float) for _ in EDGE_TYPES], 0

    n = len(nodes)
    id_to_i = {str(nd.get('id', i)): i for i, nd in enumerate(nodes)}
    X = np.zeros((n, IN_DIM), dtype=float)
    adjs = [np.zeros((n, n), dtype=float) for _ in EDGE_TYPES]
    nbr_types: list[set[str]] = [set() for _ in range(n)]

    merchant_i = 0
    for i, nd in enumerate(nodes):
        t = str(nd.get('type') or 'merchant')
        if t == 'merchant':
            merchant_i = i
        if t in NODE_IDX:
            X[i, NODE_IDX[t]] = 1.0

    for ed in edges:
        u = id_to_i.get(str(ed.get('source', '')))
        v = id_to_i.get(str(ed.get('target', '')))
        if u is None or v is None or u == v:
            continue
        et = str(ed.get('type') or 'PAYMENT_FLOW')
        r = EDGE_IDX.get(et, 2)
        w = float(ed.get('weight') or 1.0)
        adjs[r][u, v] += w
        adjs[r][v, u] += w
        nbr_types[u].add(str(nodes[v].get('type') or ''))
        nbr_types[v].add(str(nodes[u].get('type') or ''))

    for r in range(len(EDGE_TYPES)):
        deg = adjs[r].sum(axis=1)
        X[:, len(NODE_TYPES) + r] = np.log1p(deg) / 2.5
        denom = np.where(deg > 0, deg, 1.0)[:, None]
        adjs[r] = adjs[r] / denom

    total_deg = sum((a > 0).sum(axis=1) for a in adjs)
    X[:, len(NODE_TYPES) + len(EDGE_TYPES)] = np.log1p(total_deg) / 3.0
    X[:, len(NODE_TYPES) + len(EDGE_TYPES) + 1] = np.asarray([len(s) / len(NODE_TYPES) for s in nbr_types])
    return X, adjs, merchant_i


def _synth_graph(rng: np.random.Generator, illicit: bool) -> dict:
    nodes = [{'id': 'm0', 'type': 'merchant'}, {'id': 'acc0', 'type': 'account'}, {'id': 'b0', 'type': 'beneficiary'}]
    edges = [
        {'source': 'm0', 'target': 'acc0', 'type': 'ENTITY_RESOLUTION'},
        {'source': 'acc0', 'target': 'b0', 'type': 'SETTLEMENT_RELATIONSHIP'},
    ]
    n_payers = int(rng.integers(2, 6))
    for i in range(n_payers):
        pid = f'p{i}'
        nodes.append({'id': pid, 'type': 'payer'})
        edges.append({'source': pid, 'target': 'm0', 'type': 'PAYMENT_FLOW'})

    if not illicit:
        if rng.random() < 0.7:
            nodes.append({'id': 'w0', 'type': 'website'})
            edges.append({'source': 'm0', 'target': 'w0', 'type': 'ENTITY_RESOLUTION'})
        if rng.random() < 0.5:
            nodes.append({'id': 'l0', 'type': 'link'})
            edges.append({'source': 'm0', 'target': 'l0', 'type': 'PAYMENT_FLOW'})
        if rng.random() < 0.3:
            nodes.append({'id': 'peer0', 'type': 'peer'})
            edges.append({'source': 'm0', 'target': 'peer0', 'type': 'BEHAVIOURAL_SIMILARITY', 'weight': 0.2})
    else:
        archetype = int(rng.integers(0, 3))
        if archetype == 0:  # external betting website + payment links
            for k in range(int(rng.integers(1, 3))):
                lid = f'l{k}'
                wid = f'w{k}'
                nodes.append({'id': lid, 'type': 'link'})
                nodes.append({'id': wid, 'type': 'website'})
                edges.append({'source': 'm0', 'target': lid, 'type': 'PAYMENT_FLOW'})
                edges.append({'source': lid, 'target': wid, 'type': 'WEBSITE_LINK'})
            if rng.random() < 0.6:
                nodes.append({'id': 'b1', 'type': 'beneficiary'})
                edges.append({'source': 'acc0', 'target': 'b1', 'type': 'SETTLEMENT_RELATIONSHIP'})
        elif archetype == 1:  # merchant rotation / mule ring
            n_peers = int(rng.integers(1, 4))
            nodes.append({'id': 'd0', 'type': 'device'})
            edges.append({'source': 'm0', 'target': 'd0', 'type': 'SHARED_INFRASTRUCTURE'})
            for k in range(n_peers):
                pr = f'peer{k}'
                nodes.append({'id': pr, 'type': 'peer'})
                edges.append({'source': 'm0', 'target': pr, 'type': 'BEHAVIOURAL_SIMILARITY'})
                edges.append({'source': pr, 'target': 'd0', 'type': 'SHARED_INFRASTRUCTURE'})
                edges.append({'source': pr, 'target': 'b0', 'type': 'SETTLEMENT_RELATIONSHIP'})
                edges.append({'source': 'p0', 'target': pr, 'type': 'PAYMENT_FLOW'})
        else:  # fabricated storefront + shared infra + off-domain links
            nodes.extend([{'id': 'w0', 'type': 'website'}, {'id': 'l0', 'type': 'link'}, {'id': 'd0', 'type': 'device'}])
            edges.extend([
                {'source': 'm0', 'target': 'l0', 'type': 'PAYMENT_FLOW'},
                {'source': 'l0', 'target': 'w0', 'type': 'WEBSITE_LINK'},
                {'source': 'm0', 'target': 'd0', 'type': 'SHARED_INFRASTRUCTURE'},
                {'source': 'w0', 'target': 'd0', 'type': 'SHARED_INFRASTRUCTURE'},
            ])
    return {'nodes': nodes, 'edges': edges}


def _rgcn_forward(X: np.ndarray, adjs: list[np.ndarray], merchant_i: int, params: dict[str, np.ndarray]):
    z1 = X @ params['w1_self'] + params['b1']
    for r, a in enumerate(adjs):
        z1 = z1 + (a @ X) @ params['w1_rel'][r]
    h1 = np.maximum(z1, 0.0)

    z2 = h1 @ params['w2_self'] + params['b2']
    for r, a in enumerate(adjs):
        z2 = z2 + (a @ h1) @ params['w2_rel'][r]
    h2 = np.maximum(z2, 0.0)

    mean_p = h2.mean(axis=0)
    max_idx = np.argmax(h2, axis=0)
    max_p = h2[max_idx, np.arange(H2_DIM)]
    merch_p = h2[merchant_i]
    readout = np.concatenate([mean_p, max_p, merch_p])  # 24
    logit = float(readout @ params['fc_w'] + params['fc_b'][0])
    prob = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, logit))))
    return prob, (z1, h1, z2, h2, max_idx, readout)


def main() -> None:
    rng = np.random.default_rng(SEED)
    dataset = []

    for path in sorted(glob.glob(str(ROOT / 'dist-console' / 'samples' / '[0-9]*.json'))):
        name = Path(path).name.lower()
        if any(h in name for h in GENUINE_HINTS):
            lbl = 0.0
        elif any(h in name for h in ILLICIT_HINTS):
            lbl = 1.0
        else:
            continue
        g = json.loads(Path(path).read_text()).get('graph') or {}
        if g.get('nodes'):
            t = graph_to_tensors(g)
            for _ in range(5):
                dataset.append((t, lbl))

    for _ in range(160):
        dataset.append((graph_to_tensors(_synth_graph(rng, illicit=False)), 0.0))
    for _ in range(160):
        dataset.append((graph_to_tensors(_synth_graph(rng, illicit=True)), 1.0))

    perm = rng.permutation(len(dataset))
    dataset = [dataset[i] for i in perm]
    split = int(0.8 * len(dataset))
    train_set, val_set = dataset[:split], dataset[split:]

    R = len(EDGE_TYPES)
    params = {
        'w1_self': rng.normal(0, math.sqrt(2.0 / IN_DIM), size=(IN_DIM, H1_DIM)),
        'w1_rel': rng.normal(0, math.sqrt(1.0 / (IN_DIM * R)), size=(R, IN_DIM, H1_DIM)),
        'b1': np.zeros(H1_DIM),
        'w2_self': rng.normal(0, math.sqrt(2.0 / H1_DIM), size=(H1_DIM, H2_DIM)),
        'w2_rel': rng.normal(0, math.sqrt(1.0 / (H1_DIM * R)), size=(R, H1_DIM, H2_DIM)),
        'b2': np.zeros(H2_DIM),
        'fc_w': rng.normal(0, math.sqrt(1.0 / (3 * H2_DIM)), size=(3 * H2_DIM,)),
        'fc_b': np.zeros(1),
    }
    m = {k: np.zeros_like(val) for k, val in params.items()}
    v = {k: np.zeros_like(val) for k, val in params.items()}
    lr = 5e-3
    wd = 1e-3
    step = 0
    batch_size = 16

    for _epoch in range(70):
        order = rng.permutation(len(train_set))
        for start in range(0, len(train_set), batch_size):
            batch = [train_set[i] for i in order[start:start + batch_size]]
            grads = {k: np.zeros_like(val) for k, val in params.items()}
            B = len(batch)
            for (X, adjs, merchant_i), lbl in batch:
                prob, (z1, h1, z2, h2, max_idx, readout) = _rgcn_forward(X, adjs, merchant_i, params)
                dlogit = (prob - lbl) / B
                grads['fc_w'] += dlogit * readout
                grads['fc_b'][0] += dlogit
                dread = dlogit * params['fc_w']

                n = X.shape[0]
                dh2 = np.zeros_like(h2)
                dh2 += dread[:H2_DIM][None, :] / n
                dh2[max_idx, np.arange(H2_DIM)] += dread[H2_DIM:2 * H2_DIM]
                dh2[merchant_i] += dread[2 * H2_DIM:]

                dz2 = dh2 * (z2 > 0)
                grads['b2'] += dz2.sum(axis=0)
                grads['w2_self'] += h1.T @ dz2
                dh1 = dz2 @ params['w2_self'].T
                for r, a in enumerate(adjs):
                    ah1 = a @ h1
                    grads['w2_rel'][r] += ah1.T @ dz2
                    dh1 += a.T @ (dz2 @ params['w2_rel'][r].T)

                dz1 = dh1 * (z1 > 0)
                grads['b1'] += dz1.sum(axis=0)
                grads['w1_self'] += X.T @ dz1
                for r, a in enumerate(adjs):
                    grads['w1_rel'][r] += (a @ X).T @ dz1

            step += 1
            for k in params:
                g = grads[k] + (wd * params[k] if not k.startswith('b') and k != 'fc_b' else 0.0)
                m[k] = 0.9 * m[k] + 0.1 * g
                v[k] = 0.999 * v[k] + 0.001 * (g ** 2)
                mh = m[k] / (1.0 - 0.9 ** step)
                vh = v[k] / (1.0 - 0.999 ** step)
                params[k] -= lr * mh / (np.sqrt(vh) + 1e-8)

    y_va = np.asarray([lbl for _, lbl in val_set], dtype=float)
    p_va = np.asarray([_rgcn_forward(X, adjs, mi, params)[0] for (X, adjs, mi), _ in val_set], dtype=float)
    metrics = {
        'valCount': int(len(y_va)),
        'valAuprc': round(float(average_precision_score(y_va, p_va)), 4),
        'valAuroc': round(float(roc_auc_score(y_va, p_va)), 4),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    artifact = {
        'kind': 'rgcn-2layer',
        'modelVersion': 'graph-v0',
        'nodeTypes': NODE_TYPES,
        'edgeTypes': EDGE_TYPES,
        'weights': {k: val.tolist() for k, val in params.items()},
        'metrics': metrics,
    }
    (OUT / 'graph.json').write_text(json.dumps(artifact))
    print(f'wrote {OUT / "graph.json"} metrics={json.dumps(metrics)}')


if __name__ == '__main__':
    main()
