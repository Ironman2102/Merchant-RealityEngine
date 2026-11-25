"""Additivity and correctness of the stacked-ensemble explanations in ml/explain.py."""
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pytest
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

from ml.explain import LOGIT_CAP, EnsembleExplainer, TreeAttr, _logit, logistic_attr, mlp_attr

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def toy():
    rng = np.random.default_rng(0)
    X = rng.normal(0, 1, (400, 6))
    y = (X[:, 0] + 0.8 * X[:, 1] - 0.5 * X[:, 2] + rng.normal(0, 0.7, 400) > 0).astype(int)
    models = {
        'logistic_regression': make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)).fit(X, y),
        'decision_tree': DecisionTreeClassifier(max_depth=4, random_state=0).fit(X, y),
        'random_forest': RandomForestClassifier(n_estimators=40, max_depth=5, random_state=0, n_jobs=1).fit(X, y),
        'lightgbm': lgb.LGBMClassifier(n_estimators=60, num_leaves=7, verbosity=-1, random_state=0).fit(X, y),
        'neural_net': make_pipeline(StandardScaler(), MLPClassifier((16, 8), max_iter=800, random_state=0)).fit(X, y),
    }
    return X, y, models


def test_linear_shap_is_exact_and_centred(toy):
    X, _, m = toy
    pipe = m['logistic_regression']
    bg = X.mean(axis=0)
    for x in X[:20]:
        base, phi = logistic_attr(pipe, x, bg)
        assert base + phi.sum() == pytest.approx(pipe.decision_function(x.reshape(1, -1))[0], abs=1e-10)
    _, phi_bg = logistic_attr(pipe, bg, bg)
    assert np.allclose(phi_bg, 0)  # the baseline gets no attribution


def test_integrated_gradients_completeness_improves_with_steps(toy):
    X, _, m = toy
    bg = X.mean(axis=0)
    coarse = [abs(mlp_attr(m['neural_net'], x, bg, steps=8)[2]) for x in X[:30]]
    fine = [abs(mlp_attr(m['neural_net'], x, bg, steps=512)[2]) for x in X[:30]]
    assert max(fine) < 0.02 and np.mean(fine) < np.mean(coarse)
    # Endpoints match the network: base is the logit at the baseline.
    scaler, mlp = m['neural_net'].steps[0][1], m['neural_net'].steps[-1][1]
    base, phi, res = mlp_attr(m['neural_net'], X[0], bg)
    p = mlp.predict_proba(scaler.transform(X[:1]))[0, 1]
    assert base + phi.sum() + res == pytest.approx(float(_logit(p)), abs=1e-6)


def test_tree_rescaling_keeps_the_sum_exact_and_the_signs(toy):
    X, _, m = toy
    for name in ('decision_tree', 'random_forest'):
        ta = TreeAttr(m[name])
        for x in X[:15]:
            p = m[name].predict_proba(x.reshape(1, -1))[0, 1]
            base, phi = ta(x, p)
            assert base + phi.sum() == pytest.approx(float(_logit(p)), abs=1e-9)
            sv = ta.explainer.shap_values(x.reshape(1, -1), check_additivity=False)
            phi_p = np.asarray(sv[1])[0] if isinstance(sv, list) else np.asarray(sv)[0, :, 1]
            assert np.all(np.sign(phi[np.abs(phi_p) > 1e-12]) == np.sign(phi_p[np.abs(phi_p) > 1e-12]))


def test_ensemble_attributions_add_up_to_the_stacked_logit(toy):
    X, _, m = toy
    names = list(m)
    stacker = {'intercept': 0.2, 'weights': {'logistic_regression': 0.1, 'decision_tree': 0.15, 'random_forest': 0.3,
                                             'lightgbm': 0.25, 'neural_net': 0.2}}
    ex = EnsembleExplainer(m, names, stacker, X.mean(axis=0), [f'f{i}' for i in range(6)])
    for x in X[:25]:
        r = ex.explain(x)
        e = r['explanation']
        logits = {n: float(_logit(m[n].predict_proba(x.reshape(1, -1))[0, 1])) for n in names}
        stacked = 0.2 + sum(stacker['weights'][n] * logits[n] for n in names)
        assert e['stackedLogit'] == pytest.approx(stacked, abs=1e-9)
        assert abs(e['residual']) < 0.01
        assert e['baseLogit'] + e['sumOfAttributions'] + e['residual'] == pytest.approx(stacked, abs=1e-9)
        assert len(r['drivers']) == 5 and abs(r['drivers'][0]['shap']) >= abs(r['drivers'][-1]['shap'])
    # The planted signal: features 0 and 1 matter most on average.
    mean_abs = np.mean([np.abs(ex.explain(x)['attributions']) for x in X[:60]], axis=0)
    assert set(np.argsort(-mean_abs)[:2]) == {0, 1}


def test_saturated_logits_are_mapped_onto_the_clipped_logit(toy):
    X, _, m = toy
    ex = EnsembleExplainer(m, ['logistic_regression'], {'intercept': 0.0, 'weights': {'logistic_regression': 1.0}},
                           X.mean(axis=0), [f'f{i}' for i in range(6)])
    far = X.mean(axis=0) + 40 * np.sign(m['logistic_regression'].steps[-1][1].coef_.ravel())
    r = ex.model_attr('logistic_regression', far)
    assert r['saturated'] and r['logit'] == pytest.approx(LOGIT_CAP)
    assert abs(r['completenessError']) < 1e-9


V1 = ROOT / 'ml' / 'models' / 'stage2-v1'


@pytest.mark.skipif(not (V1 / 'ensemble.json').exists(), reason='Stage 2 v1 not trained')
def test_service_returns_ensemble_drivers_and_falls_back_without_a_background():
    import json
    import ml.serve as serve
    serve._v1 = None
    assert serve.v1_ready()
    feats = {'n_sales': 600, 'weekend_share': 0.28, 'ticket_cv': 0.6, 'sweep_lag_median_h': 30, 'prior': 0.012}
    meta = serve._v1['meta']
    saved = meta.get('explain')
    try:
        meta.pop('explain', None)
        serve._v1.pop('_explainer', None)
        old = serve.score(serve.ScoreIn(features=feats))
        assert 'explanation' not in old and len(old['drivers']) == 5      # LightGBM-only fallback for older bundles

        from ml.stage2_lib import load_portfolio, matrix
        meta['explain'] = {'backgroundMean': matrix(load_portfolio(), serve._v1['features']).mean(axis=0).tolist()}
        serve._v1.pop('_explainer', None)
        new = serve.score(serve.ScoreIn(features=feats))
        e = new['explanation']
        assert len(new['drivers']) == 5 and all(set(d) == {'feature', 'shap'} for d in new['drivers'])
        assert abs(e['residual']) < 0.05
        assert e['baseLogit'] + e['sumOfAttributions'] + e['residual'] == pytest.approx(e['stackedLogit'], abs=1e-9)
        assert set(e['perModel']) == set(meta['baseModels'])
        json.dumps(new)  # serialisable
    finally:
        if saved is None:
            meta.pop('explain', None)
        else:
            meta['explain'] = saved
        serve._v1.pop('_explainer', None)
