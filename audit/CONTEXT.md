# Build context (branch mre-v2) — every agent reads this first

Repo root: /Users/devarsheejmude/IIMB/Merchant-RealityEngine. Plan: audit/IMPLEMENTATION_PLAN.md (§ refs below).
Stack: Node 26 (TS via tsx, no build step for scripts), React 18 + Vite 8 + Tailwind 4, TypeScript 7 (`npx tsc --noEmit`),
Python 3.15 venv at `.venv/` (ml/ only). Storage: built-in `node:sqlite`. Commit = one per stage, never push.

## Conventions
- Small, plain functions. No new deps beyond: @stdlib special functions (npm); lightgbm, scikit-learn, shap, fastapi, uvicorn, pyarrow, pandas, numpy (py).
- Engine code is pure + deterministic (seeded RNG `frontend/src/stats/rng.ts`). Same input → same output.
- Every threshold/number lives in `rules/*.json` and is read via `rules/index.ts` (`RULES`). Never inline a cut-off.
- UNKNOWN evidence has llr = 0. Positive llr = towards "front" (H1). Natural log (nats).
- Tests are plain `node:assert` scripts under `tests/` run by `npm test`. No test framework.

## Layout (owner in brackets: S = lead session only)
- `rules/*.json`, `rules/index.ts` [S]                         thresholds, priors, costs, mcc, calendar, states, amounts, hosts, overrides
- `frontend/src/stats/` [S writes core; agents may add tests]  dist, intervals, multiple, eb, tests, glm, changepoint, calibrate, logistic, conformal, circular, rng
- `frontend/src/engines/detectors/` [S writes pattern + 3; agents copy]  one file per family, each exports `Def[]`
- `frontend/src/engines/bayesFusion.ts`, `decision.ts`, `priors.ts`, `traceEngine.ts` [S]
- `backend/src/` [S: security, db, auth, workflow]
- `ml/` (Python) [S: features, train, gates; agents: synth, serve, scorer]
- `scripts/` CLIs (adversarial, security, redteam, benchmark, backtest)
- `tests/` node:assert tests; `tests/stats/fixtures/*.json` from scipy

## Do not touch (agents)
`backend/src/store.ts`, `backend/src/http.ts`, `backend/src/auth.ts`, `backend/src/db.ts`, `frontend/src/stats/*` (except tests),
`frontend/src/engines/bayesFusion.ts`, `rules/index.ts`, `package.json` (ask lead), `archive/`.

## Frugal decisions
| Need | Chosen | Skipped | Upgrade when |
|---|---|---|---|
| DB | node:sqlite | Postgres | >1 writer or >1 GB |
| Stats | hand-written + @stdlib special fns | full stats lib | n/a |
| Registry | JSON + sqlite model_versions | MLflow | >1 data scientist |
| Tuning | seeded random search | Optuna | tuning is bottleneck |
| Autoencoder | sklearn MLPRegressor | PyTorch | gated M4/M5 start |
| Serving | nightly batch + FastAPI | ONNX in Node | no Python at deploy |
| LLM summary | off by default, Haiku, cached, verified | always-on big model | users ask |
Budget: ₹0/mo local; ~₹2,500/mo at 10× (1 VM). Good-enough bar: correct, explainable probabilities + no false alarm on honest merchants.
