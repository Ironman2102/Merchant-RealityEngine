# Merchant Reality Engine (MRE)

A merchant-intelligence prototype for Payment Aggregators and payment-risk teams.
It asks one question: **does this merchant behave like the business it claims to be?**

The workspace provides three connected views plus a Python Stage 2 scorer:

- **Public overview** (`/`, `/architecture`): the product story, seven-layer architecture, and governance model.
- **Guided demo** (`/demo/*`): prebuilt deterministic merchant scenarios, per-QR stream scoring, and Context Passport walkthroughs across L1–L7.
- **AI Engine & Ops Console** (`/ai-engine/*`): bulk/single CSV & JSON upload, cross-merchant N4/N5 ring detection, server-side SQLite persistence, two-person Context Passports, maker/checker response & label workflow, calibration governance, and Stage 2 ML ensemble comparison.

> **Everything is synthetic.** Merchants, transactions, websites, crawler snapshots, and benchmark figures are fabricated and deterministic. Nothing is verified real-world accuracy, and nothing executes live payment holds or regulatory filings.

## Measured on synthetic suites

All figures below were measured locally against synthetic generators (`engine/synthetic.ts` and `tests/datasets-1k/`). They are regression and direction benchmarks, not real-world accuracy.

| Metric | Measured | Source / Command |
|---|---|---|
| Synthetic benchmark (`n = 1,000`, `seed = 7`) | Recall `33/81` (`0.407`), Opened/Asked `67/81` (`0.827`), Precision `33/33` (`1.000`), Honest FP `0/919` (`0.000`) | `npm run benchmark` |
| 1,200-case stress benchmark (`rules=mre-bayes-0.3.0`) | TP `457`, FP `0`, TN `600`, Recall `0.7617`, Precision `1.0000`, FPR `0.0000`, `0` integrity errors | `npx tsx scripts/benchmark-1k.ts` -> `reports/benchmark-1k.md` |
| One-shot multi-dataset verification (`100` datasets) | `57/60` multi-source fronts opened (single-source fronts routed to `ASK`), `0/40` genuine FPs | `npm run test:stats` (`one-shot-portfolio`) |
| Stage 2 M1 vs Bayesian on leak-free `engine/synthetic.ts` | M1 AUC-PR `0.997` (`ECE 0.017`, `129/131` at `0.10`, FP `7/256`); Bayesian AUC-PR `0.936` (`0/256` FP). Stage 2 v1 stacked ensemble (served): AP `0.999`, Brier `0.011`, ECE `0.017` on 387 held-out merchants (`reports/stage2-v1-evaluation.json`). On the 11 demo samples, never used for training, v1 flags all 6 fronts and none of the 5 honest merchants | `.venv/bin/python -m ml.compare` |

ML models (`m1-v0`, `nn-v0`, `classical-v0`) are second opinions only and never open cases or override the independent Bayesian conduct gate.

## Run it

Requires **Node.js `>=22.13`** and (for Stage 2 ML) Python 3 with packages in `ml/requirements.txt`.

```bash
npm install
npm run dev        # Vite frontend (http://localhost:5173)
npm run build      # Bundle Netlify/API adapter + tsc --noEmit + frontend & console builds
npm test           # Engine stats, selftest, API check, dataset import, 35 security probes, 34 adversarial cases, lint
```

Optional benchmark & ML commands:

```bash
npm run benchmark                                # 1,000-merchant leak-free synthetic benchmark
npm run redteam                                  # 8 evasion operators across 98 caught fronts
.venv/bin/pytest ml/tests/                       # 18 Python Stage 2 ML & FastAPI tests
npx tsx ml/generate_synthetic_features.ts        # Regenerate leak-free ml/data/features.csv (1,288 merchants)
```

> **Note on upgrading an existing local SQLite DB:** databases created prior to table HMAC sealing require running `npm run mre -- seal-db --reason "initial seal"` once, or using `MRE_CASE_STORE=memory` in test runs.

## Core capabilities

- **Conduct vs. Change Separation (`rules/engine.json` v0.3.0)**: Unusual hours, ticket shifts, or volume changes without misconduct trigger `followUp: ASK` (no case, no restriction) rather than false-positive freezes.
- **Per-QR Stream Scoring & Scoped Actions**: Scores every payment link/QR (`30+` sales) and repeat-payer sub-cohort individually so side betting cannot hide inside shop averages; isolates restriction recommendations to identified suspect links.
- **Two-Person Context Passports**: Merchants can document legitimate operational changes per QR for up to 180 days, requiring human maker + distinct reviewer verification. Any fired conduct signal automatically suspends passport relief, and revocation reopens affected cases.
- **Multi-Dataset Upload & Ring Detection (`N4`/`N5`)**: Batch CSV/JSON ingestion with shared settlement beneficiary (`N4`) and shared payer-cohort (`N5`) detection, calibration drift (`PSI`), empirical peer baselines, and interval-based uncertainty flagging (Stage 2 ML adds true split-conformal sets).
- **Stage 2 ML Ensemble & Explainability**: Calibrated LightGBM (`TreeSHAP`), MLP neural network, Logistic Regression, Decision Tree, and Random Forest trained strictly on `BEHAVIORAL_FEATURE_COLUMNS` (no age, prior, or coverage leakage — verified by `tests/engine/leakage.test.ts`).
- **Hardened Auth, Service Keys, & Tamper-Evident Audit**: Strong `scrypt` passwords, OIDC PKCE support, `/v1` client-isolated service keys, HMAC-sealed tables, hash-chained audit logs, and two-person approval for label changes, downgrades, lifts, and rule promotions/rollbacks.

## Project layout

```text
package.json, tsconfig.json, vite.config.ts, start.sh
frontend/src/    React 18 + Vite + Tailwind CSS v4 app (components, data, engines, layers, pages, stats, utils)
engine/          Shared pure modules (features, portfolio FDR, ringDetector, driftMonitor, peerBaselines, synthetic, pack, outreach, improver)
rules/           Versioned declarative priors, 28 detectors, ~40 MCC norms, overrides, hosts, workflow rules
adapters/        PA CSV/JSON mappers, pseudonymisation, privacy scrubbing
backend/         HTTP API, SQLite + memory store, auth, OIDC, service keys, passports, workflow, HMAC integrity seals
cli/             `mre` CLI (analyze, batch, verify-db, seal-db, features)
ml/              Python LightGBM (`m1-v0`), MLP (`nn-v0`), classical ensemble, FastAPI scorer (`serve.py`), pytest suite
tests/engine/    20+ deterministic engine, security, leakage, regression, and 100-dataset end-to-end suites
api/             Vercel / Netlify serverless entry point (`netlify/functions/api.mts`)
```
