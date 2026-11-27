"""The champion/challenger gate must reject a worse model, leave the champion untouched, log the decision, and still
promote a candidate that is as good. Runs against the real promoted stage2-v1 bundle in a temporary folder."""
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
V1 = ROOT / 'ml' / 'models' / 'stage2-v1'
DATA = ROOT / 'ml' / 'data' / 'features.csv'

pytestmark = pytest.mark.skipif(not ((V1 / 'ensemble.json').exists() and DATA.exists()),
                                reason='needs the promoted stage2-v1 bundle and ml/data/features.csv')


def _digest(folder: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(folder.rglob('*')):
        if p.is_file():
            h.update(p.name.encode())
            h.update(p.read_bytes())
    return h.hexdigest()


def test_gate_rejects_a_worse_model_and_keeps_the_champion(tmp_path):
    from ml.stage2_lib import feature_columns, holdout_split, load_portfolio
    from ml.train_stage2 import promote, save, train_ensemble

    champion = tmp_path / 'stage2-v1'
    shutil.copytree(V1, champion)
    before = _digest(champion)

    # A deliberately worse challenger: 60 training merchants, 30% of their labels flipped.
    df = load_portfolio()
    cols = feature_columns(df)
    train_i, test_i = holdout_split(df)
    small = df.iloc[train_i].sample(60, random_state=3).reset_index(drop=True)
    flip = np.random.default_rng(3).random(len(small)) < 0.3
    small.loc[flip, 'label'] = 1 - small.loc[flip, 'label']
    params = json.loads((V1 / 'ensemble.json').read_text())['params']
    weak = train_ensemble(small, cols, None, params, verbose=False)
    save(weak, cols, {'threshold': 0.7}, tmp_path / 'candidate')

    decision = promote(tmp_path / 'candidate', champion, tmp_path, verbose=False)

    assert decision['promoted'] is False
    assert decision['negLogLoss']['lo'] < -0.02 or decision['negBrier']['lo'] < -0.01 or decision['ap']['lo'] < -0.01
    assert _digest(champion) == before, 'a rejected candidate must not touch the champion'
    assert not (tmp_path / 'stage2-v1.previous').exists()
    logged = [json.loads(line) for line in (tmp_path / 'promotions.jsonl').read_text().splitlines()]
    assert len(logged) == 1 and logged[0]['promoted'] is False


def test_gate_promotes_an_equal_model_and_keeps_a_rollback_copy(tmp_path):
    from ml.train_stage2 import promote

    champion = tmp_path / 'stage2-v1'
    shutil.copytree(V1, champion)
    shutil.copytree(V1, tmp_path / 'candidate')
    before = _digest(champion)

    decision = promote(tmp_path / 'candidate', champion, tmp_path, verbose=False)

    assert decision['promoted'] is True
    assert (tmp_path / 'stage2-v1.previous').exists() and _digest(tmp_path / 'stage2-v1.previous') == before
    assert (champion / 'ensemble.json').exists()


def test_gate_catches_a_subtle_degradation_that_average_precision_alone_would_miss(tmp_path):
    """Full training data with 10% of labels wrong: ranking barely changes (AP ~0.995), calibration collapses."""
    from ml.stage2_lib import feature_columns, holdout_split, load_portfolio
    from ml.train_stage2 import promote, save, train_ensemble

    champion = tmp_path / 'stage2-v1'
    shutil.copytree(V1, champion)
    df = load_portfolio()
    cols = feature_columns(df)
    train_i, _ = holdout_split(df)
    noisy = df.iloc[train_i].reset_index(drop=True)
    flip = np.random.default_rng(5).random(len(noisy)) < 0.10
    noisy.loc[flip, 'label'] = 1 - noisy.loc[flip, 'label']
    params = json.loads((V1 / 'ensemble.json').read_text())['params']
    save(train_ensemble(noisy, cols, None, params, verbose=False), cols, {'threshold': 0.7}, tmp_path / 'candidate')

    decision = promote(tmp_path / 'candidate', champion, tmp_path, verbose=False)

    assert decision['promoted'] is False
    assert decision['ap']['delta'] > -0.02            # AP alone barely moves...
    assert decision['negLogLoss']['lo'] < -0.02       # ...log loss is what catches it
