# Architecture

## Seven layers

| Layer | Job | Code |
|---|---|---|
| L1 Ingest & Lineage | Normalise feeds into `PaymentEvent`, classify, separate timestamps, link refunds, HMAC-pseudonymise identifiers, build the coverage map | `adapters/`, `frontend/src/data/dataset.ts`, `frontend/src/engines/investigationEngine.ts` (`layer1`), `frontend/src/layers/L1Ingestion.tsx` |
| L2 Merchant Profile | Declared profile and three baselines (anchored, seasonal, rolling), BOCPD + CUSUM | `frontend/src/engines/residualEngine.ts`, `frontend/src/engines/cusumEngine.ts`, `frontend/src/layers/L2MerchantProfile.tsx` |
| L3 Detection | 28 statistical detectors across families `A`–`K`, including category-free conduct checks (`B8`, `B10`, `C6`), peer cohort continuity, and per-QR stream splitting | `frontend/src/engines/detectors.ts`, `frontend/src/engines/cohortContinuity.ts`, `frontend/src/engines/streams.ts` |
| L4 Evidence Fusion | Within-family shrinkage (`ρ`), exclude `UNKNOWN`, logit-normal Monte-Carlo CIs, conformal uncertainty sets, multi-source conduct gate, `ASK` vs `OPEN_CASE` routing, Bayesian FDR queue, cross-merchant N4/N5 rings, PSI drift | `frontend/src/engines/evidenceFusion.ts`, `frontend/src/engines/passport.ts`, `engine/portfolio.ts`, `engine/ringDetector.ts`, `engine/driftMonitor.ts` |
| L5 Analyst Review | Traceable waterfall, legitimate-business vs front comparison, counterfactuals, VOI, verified template summary | `frontend/src/engines/traceEngine.ts`, `frontend/src/engines/analystEngine.ts`, `backend/src/llm.ts` |
| L6 Governed Response | Six response levels (`L0`–`L5`), scoped link actions, legal/escrow gate, `HoldRecord`, maker-checker enforcement | `frontend/src/engines/responseEngine.ts`, `backend/src/workflow.ts`, `backend/src/passports.ts` |
| L7 Audit, Labels & Learning | Two-person Context Passports, two-person adjudicated labels, calibration proposals with holdout checks, HMAC-sealed hash-chained SQLite audit | `backend/src/passports.ts`, `backend/src/improverApi.ts`, `backend/src/integrity.ts`, `backend/src/store.ts` |

## Two-stage analysis inside the seven layers

Stage 1 is the deterministic statistical Bayesian evidence engine in L1–L4, paired with per-QR stream scoring (`engines/streams.ts`) and two-person verified Context Passports (`engines/passport.ts`). When only profile departures fire (`followUp: ASK`), no case opens and nothing is restricted; if any conduct signal fires (`B8`, `B10`, `C6`, `D7`, `D9`, `D10`, `E1`, `E3`, `F2`, `F5`, `F7`, `F8`, `G2`, `G6`, `I2`, `I3`), verified passports are suspended so a document cannot override misconduct.

Stage 2 (`ml/serve.py`) provides a separate, non-decisional second opinion combining:
- `m1-v0` (LightGBM with monotone constraints on `llr_*` and `fired_*`, Platt calibration, and TreeSHAP attributions),
- `nn-v0` (calibrated `32 -> 16` ReLU MLP),
- `classical-v0` (calibrated Logistic Regression, Decision Tree, Random Forest), and
- an optional lazy zero-shot text encoder (`valhalla/distilbart-mnli-12-1`) for uncertain reviews.

Models are trained on leakage-free synthetic cohorts generated from `engine/synthetic.ts` (payment-only merchants, plus a training-only context portfolio with website crawls, orders, deliveries and purchaser panels attached independently of the label, and fabricated-store fronts) using `BEHAVIORAL_FEATURE_COLUMNS` (explicitly excluding `account_age_days`, `prior`, `posterior`, `logodds_total`, `cov_*`, and `unk_*`, enforced by `tests/engine/leakage.test.ts`). Every scorer call sends `modelFeatures()`, the same row the models are trained on. Stage 2 never opens, closes, or overrides the Bayesian conduct gate.

## Governance & Security Controls

- **Sessions & Auth**: Password hashing (`scrypt`), signed boot-account cookies, revocable API service keys (`/v1` client isolation), optional OIDC with PKCE (`backend/src/oidc.ts`), 6 MB HTTP body limit, path/CSV formula injection guards.
- **Two-person workflow**: Proposing L0–L2 below recommendation, lifting an active restriction, confirming/changing adjudicated labels, verifying Context Passports, and rolling back live rules all require a distinct reviewer/admin approving what was proposed (`proposedAt` + `level`).
- **Tamper-evident storage**: Critical tables carry HMAC seals (`backend/src/seal.ts`, `backend/src/integrity.ts`) alongside an append-only hash-chained audit trail (`mre verify-db` / `mre seal-db`).
