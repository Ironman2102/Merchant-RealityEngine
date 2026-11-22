# Merchant Reality Engine: Implementation Status and Handoff

**Purpose:** give the next engineer or AI assistant everything it needs to continue the build without re-reading the whole history. Read this file first, then `audit/IMPLEMENTATION_PLAN.md` for the full design.

- **Repo:** `dhruv11bhandari/Merchant-RealityEngine`
- **Working branch:** `mre-v2` (local only; **nothing has been pushed**)
- **Base commit:** `1d1d9a8` ("improving backend", upstream `main`)
- **Commits on `mre-v2`:**
  - `442b315` S1: safety fixes, rules data, stats module, saved cases use the demo's 7-layer views
  - `d8c6174` S2: statistical detectors, Bayesian fusion, decision theory
  - `96054a8` S3: reasoning trace, evidence pack, sign-in and maker/checker governance
- **Status date:** 20 Nov 2026 · **Current priority:** GROK_INSTRUCTIONS.md T1–T16 in order (finale 26 Nov 2026; every commit must keep the demo working), then S4–S7

---

## 1. Quick start

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install scipy numpy   # only needed to regenerate stats fixtures (and for the later ML stage)
npm run dev:users          # dev only: creates dev-analyst / dev-reviewer / dev-legal; passwords in backend/data/dev-users.txt (git-ignored, 0600)
npm run api                # API on http://127.0.0.1:8787
npm run dev                # web app on http://localhost:5173 (proxies /api to 8787)
npm test                   # must stay green (see §6)
npm run build              # must stay green
```

Useful extras: `npx tsx scripts/samples-report.ts -v` (every sample with each detector's p, effect and weight) and `npm run user:add -- <username> <analyst|reviewer|legal|admin>`.

**Environment variables**

| Variable | Meaning |
|---|---|
| `MRE_HASH_KEY` | HMAC key for pseudonymising payer and beneficiary IDs. **Required when `NODE_ENV=production`.** In dev a random key is kept in `backend/data/.hashkey` |
| `MRE_CASE_STORE=memory` | In-memory SQLite (tests) |
| `MRE_DB_FILE` | SQLite file path (default `backend/data/mre.db`) |
| `MRE_ENTITY_NAME` | Reporting-entity name printed in the evidence pack's STR draft |
| `NODE_ENV=production` | Secure cookies; refuses to run without `MRE_HASH_KEY`; `dev:users` refuses to run |

The Vercel API adapter (`api/[...path].js`) still returns 503 on purpose. Do not enable hosted deployment until the pilot hardening in S7 is done.

---

## 2. Architecture map (what lives where)

```
rules/                      ALL numbers the engine uses (versioned data, read via rules/index.ts → RULES)
  engine.json                 gate, priority bands, family shrinkage ρ, CUSUM k/h, volume model settings, rules version
  detectors.json              one row per detector: sensitivity, false-positive rate, alpha, minEffect, effectFull,
                              minN, fakeDifficulty, family, provenance, affinity, test description
  mcc.json                    category norms (ticket lognormal, hours, round/off-area/off-hours shares, ...) EXPERT PRIORS
  priors.json, costs.json     base rates by MCC and account age; rupee costs for the expected-loss decision
  calendar.json               festivals + sector ramps (some dates marked verified:false), cricket fixtures (empty)
  states.json, amounts.json, hosts.json, overrides.json
frontend/src/stats/         hand-written statistics (dist, intervals, multiple, eb, tests, changepoint, rng)
                              special functions come from @stdlib packages
frontend/src/engines/
  detectors.ts                25 detectors: statistical tests vs category norm / calendar / independent sources
  judge.ts                    p + effect → status + log-likelihood ratio (LLR, nats)
  residualEngine.ts           log-normal weekly volume model with festival-calendar offsets
  cusumEngine.ts              ARL-calibrated CUSUM on standardised residuals
  evidenceFusion.ts           Bayesian fusion: prior + family LLRs (ρ shrinkage) → posterior, Monte-Carlo 90% interval,
                              governance gate, mechanism posterior
  decision.ts                 expected-loss response choice with a robust step-down
  traceEngine.ts              reasoning trace: waterfall, detector table, counterfactuals, value of information
  analystEngine.ts, responseEngine.ts, learningEngine.ts, cohortContinuity.ts, investigationEngine.ts (pipeline)
frontend/src/pages/          TracePage.tsx (new), ServerCasePage.tsx (saved case = demo's 7-layer views), UploadPage.tsx, ...
frontend/src/hooks/useInvestigation.tsx   demo mode (local state) and saved-case mode (caseId: writes go to the server)
backend/src/
  http.ts                     router, auth, CSRF (JSON-only writes), rate limits
  auth.ts                     scrypt passwords, sessions (token SHA-256 stored), roles
  db.ts                       node:sqlite schema (users, sessions, cases, audit, llm_cache)
  store.ts                    case store + hash-chained audit (appendAudit / verifyAudit)
  workflow.ts                 open / review / respond / approve / label with maker/checker rules
  trace.ts                    GET trace, GET evidence pack (RBI mapping + STR draft)
  llm.ts                      template summary + verifier; AI drafting OFF (llmEnabled() = false)
  adapters/canonicalDataset.ts  HMAC pseudonymisation BEFORE parsing; dataset SHA-256
scripts/                    adversarial.ts (34 cases), security.ts (14 HTTP probes), samples-report.ts, user tools, selftest
tests/                      run.ts (runner), stats/ (38 SciPy fixtures + simulation tests), engine/ (invariants, trace)
audit/                      REPORT.md (original audit), IMPLEMENTATION_PLAN.md (full design), END_TO_END_PLAN.md (business plan),
                            CONTEXT.md (agent rules), routing-log.md, market-research.md, hardcoding-scan.md
prototype/                  old Python engine: NOT used, scheduled to move to archive/ (see §5)
```

**API routes** (all under `/api`; everything except `/health` and `/auth/*` needs a session):
`POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `GET /health` ·
`GET|POST /investigations` · `GET /investigations/:id` ·
`POST /investigations/:id/{review,response,approve,label,summary}` ·
`GET /investigations/:id/{trace,pack,audit}`

---

## 3. Rules every contributor must follow

1. **Never inline a threshold.** Every number goes in `rules/*.json` and is read through `RULES`.
2. **UNKNOWN evidence has LLR 0.** Missing data must never move the probability. Positive LLR means towards "front", negative towards "genuine".
3. **The merchant's own declaration is never a baseline.** Declared profile and uploaded `seasonalMultiplier` are only compared with the norm (detector K1). Do not reintroduce them as expectations.
4. **A detector fires only if p ≤ alpha AND effect ≥ minEffect** (practical significance). New detectors return `Obs` and go through `judge()`.
5. **Determinism.** All randomness uses `frontend/src/stats/rng.ts` with seeds derived from the merchant id. Same input → same output.
6. **Security:**
   - Case ids are minted by the server (`^INV-[0-9a-f]{8}$`).
   - Never trust user, approval or legal fields from the request body.
   - Never store raw uploads or raw payer/beneficiary IDs.
   - Every state change goes through `appendAudit`.
7. **Maker/checker stays:**
   - Nobody approves their own proposal.
   - L3 needs a different reviewer or admin.
   - L4/L5 need a different `legal` user.
   - CONFIRMED_ILLICIT needs two people.
   - Automatic recommendations stop at L3.
8. **The LLM never decides.** Any AI text must pass `verifySummary()` (every number and detector id must exist in the trace), or the template is used instead.
9. **No scenario-specific code** (`scenario.id ===` / `sc.id ===` is blocked by `npm run lint:noscript`).
10. **Statistics changes need reference values.** Add SciPy fixtures to `tests/stats/gen_fixtures.py`, regenerate with `.venv/bin/python tests/stats/gen_fixtures.py`, and check whether the right reference is exact or asymptotic.
11. **Dependencies:** the approved list is the `@stdlib` special functions (installed). For the Python ML stage: lightgbm, scikit-learn, shap, fastapi, uvicorn, pyarrow, pandas, numpy. **Anything else needs the owner's approval.** That includes `@anthropic-ai/sdk`, which the owner declined for now.
12. Small, readable functions. Prefer deleting code to adding it. Keep each commit's tests green.

---

## 4. What is DONE

### S1: Foundation (`442b315`)
- **Security fixes:**
  - The path-traversal read and write via case id are closed.
  - Cases are never rebuilt under a caller id, and client-sent user state is ignored.
  - The raw upload is never stored (SHA-256 only); HMAC pseudonyms for payer, beneficiary, mobile and holder IDs.
- **Input validation:**
  - Rejects `confirmed > contacted`, `ticketMin ≥ ticketMax`, invalid hours (overnight such as `[22, 6]` is allowed), seasonal multipliers outside 0.2–6, and amounts over ₹10 lakh.
  - Exact duplicate payments (same payer, amount and time) are dropped.
  - Warns when the calendar is marked available but has no fixtures.
  - Per-client rate limit.
- Rules files and the typed loader.
- **Stats module:** distributions, Wilson / Clopper–Pearson / Newcombe / bootstrap intervals, Holm and Benjamini–Hochberg, empirical-Bayes beta-binomial, G-test, KS (one- and two-sample), permutation, Mann–Whitney, Fisher / Cauchy combination, McNemar, Sellke–Bayarri–Berger bound, CUSUM + ARL calibration, Bayesian online changepoint.
- Scenario-scripted UI text removed.
- **UI parity:** `/ai-engine/cases/:id[/:view]` shows the demo's 7-layer screens for a saved case and survives a reload. Uploads open the saved case with the layer-by-layer reveal.

### S2: Statistical engine (`d8c6174`)
- **25 detectors** (A1, A4, A5, B6, B7, B9, C2, C5, D7, D9, D10, E1, E3, F2, F5, F7, F8, G2, G6, H1, H2, H3, I2, I3, K1) as statistical tests. Notable choices:
  - Neighbouring states count as local.
  - A single beneficiary change is not suspicious (bank switch).
  - Refunds to the payer's own other account are not counted.
  - Pre-match funding uses a permutation test over days.
- **Volume:** log-normal model with festival offsets from the calendar, ARL-calibrated CUSUM (h = 2.35 for one false alarm per merchant-year), and a changepoint probability.
- **Fusion:**
  - Base rate by MCC × account age, plus family LLRs with ρ = 0.3 shrinkage, plus overrides.
  - Monte-Carlo 90% interval and a mechanism posterior.
  - Gate: P ≥ 10% **and** (≥ 2 independent sources **or** ≥ 3 families). The 10% bar is documented in `rules/engine.json`.
- **Decision theory:** the expected-loss action, with a step-down if the low end of the interval prefers a milder action.
- New sample `09-telegram-betting-no-website.json`, which opens a case at P ≈ 0.78 with no crawler data.
- The 5 weaknesses from the original audit are all fixed.
- **Results:** 34/34 adversarial cases pass. Samples 01/02/03/05/09 open cases; 04/06/07/08 do not.

### S3: Explainability + governance (`96054a8`)
- SQLite store (`node:sqlite`) with a hash-chained audit trail and a verify endpoint.
- Sign-in (scrypt, HttpOnly SameSite=Strict cookie, login rate limit), four roles, maker/checker (see §3.7).
- Trace engine and the Trace page:
  - log-odds waterfall;
  - per-test p, effect, interval and expectation source;
  - counterfactuals, value of information and expected-loss table.
- The L4 screen was rewritten for the Bayesian engine. L6 has a propose/approve panel; L7 shows pending labels and the audit-chain status.
- **Evidence pack (JSON):** RBI PA Master Direction mapping, FIU-IND STR **draft** facts, trace, audit with hashes and verification.
- Template case summary plus a verifier. The verifier caught and fixed a rounding false-reject.
- **Browser-verified:**
  - sign-in, uploading sample 09, the trace page;
  - self-approval refused, then approval by a second user;
  - the evidence pack;
  - mobile layout at 375 px, with sign-out available.

**Test status at `96054a8`:**
- `npm test` passes: 43/43 stats and engine checks, 14/14 security probes, the governed-workflow selfcheck, the dataset import, 34/34 adversarial cases, and the no-scripting lint.
- `npm run build` passes.

---

## 5. Known deviations, limitations and loose ends (be honest about these)

| Item | Detail | Suggested fix |
|---|---|---|
| Deviations from `IMPLEMENTATION_PLAN.md` | KS used instead of Anderson–Darling. Log-normal volume model instead of a negative-binomial GLM (the GLM was deleted as unused). Off-hours uses beta-binomial, not von Mises / Kuiper. Burstiness (C6), match-night intensity (U5) and a separate U4 are not built: A5 covers bonus tiers and C5 covers matches. DemoShell and EngineShell were not merged | Acceptable; revisit only with evidence |
| Overconfident posteriors | With many firing families the posterior saturates (shown as "> 99.9%"). Families are treated as independent given the truth | S4 calibration (Platt/isotonic, conformal) and cross-family dependence checks |
| Expert priors | `mcc.json`, `priors.json` and the detector sensitivity / false-positive rates are estimates, not learned | S4 learning loop and S7 benchmark |
| Synthetic data only | Every sample comes from the repo's own generator, so there are no real accuracy numbers | S7 benchmark plus a real pilot |
| Calendar | Several 2026 festival dates are marked `verified:false`; `cricketFixtures` is empty | Verify the dates; add `scripts/refresh-calendar.ts` |
| Learning | `learningEngine.ts` updates are still display-only | S4 (P8) |
| AI summary | Off. Needs the owner's approval for `@anthropic-ai/sdk` and a model choice; the owner said "not now" | Leave off |
| Python prototype | `prototype/` is still present and unused, with different rules | Move to `archive/prototype/` and update README / `start.sh` |
| Legacy code | `UploadPage.tsx` still has unused state (`legalVerified`, `serverError`, ...); `ENGINE_VERSION` constant vs `rules.version`; `HomePage.tsx` illustration figures are still typed in | Small cleanup |
| Old JSON cases | Cases saved as JSON files before S3 (`backend/src/data/*.json`) are not migrated into SQLite | Dev data only; ignore or write a one-off importer |
| STR format | The evidence pack holds STR *facts*, not FIU-IND's portal format | Needs the FINnet spec |
| Bundle size | ~1.24 MB single JS chunk | Code-split routes (S7) |
| Audit anchoring | The chain head lives in the same database | External daily signed digest (later) |
| README | Still describes the old engine | Update in S7 |

---

## 6. Definition of done for every future commit

```bash
npm test          # stats/engine checks, selfcheck, dataset import, security probes, adversarial, no-scripting lint
npm run build     # typecheck + vite build
```

Also:
- `npx tsx scripts/samples-report.ts`: genuine samples (04, 06, 07, 08) must stay NO_CASE, and suspicious ones (01, 02, 03, 05, 09) must stay OPEN_CASE, unless a change is deliberate and explained in the commit message.
- When adding a detector, add 2 adversarial cases: one that should fire and one false-positive trap.
- When changing the API, add a probe to `scripts/security.ts` if the change touches auth, ids or approvals.

---

## 7. What is LEFT

### NEXT: Hackathon track (do this before S4) — full detail in `audit/IMPLEMENTATION_PLAN.md` Part 0
**Context:** a hackathon judged by PayU's technical leadership (including the CTO). Goals:
- the product becomes **standalone**, separate from the marketing website;
- a payment aggregator can **fit it to its existing workflow with configuration, not code**.

We do not know PayU's internal systems. Design for a typical PA, never claim to integrate with a named PayU system, and never use PayU branding in the UI.

| Phase | What | Days |
|---|---|---|
| H1 | `engine/index.ts` public API (no file moves), `adapters/` (column-mapping JSON → `mre-dataset/v1`), `cli/mre batch` (folder in → `scores.csv`, `cases.jsonl`, evidence packs out) | 3 |
| H2 | One Docker image; OpenAPI 3.1 `/v1/score`, `/v1/batches`; service API keys; signed webhooks; measured performance report | 3 |
| H2b | Workflow-fit layer: `workflow/*.json` (outputs/sinks, response levels, approvals, statuses, roles, labels); `mre validate-config`; guard-rails config cannot switch off; second example config `examples/alt-pa/` switched live in the demo | 3 |
| H3 | Standalone analyst console (`console/`, own Vite build served by `mre serve`) separate from the website (`frontend/`); generic OIDC SSO; accessibility pass | 3 |
| H4 | 1,000-merchant synthetic portfolio in a PA-style export; Benjamini–Hochberg queue showing expected false alarms; benchmark with Wilson intervals | 3 |
| H6 | **Trained AI model M1 (LightGBM) on the portfolio: calibrated, SHAP, compared with the Bayesian model, served by FastAPI, shown as "AI model (second opinion)" in the trace** | 4 |
| H7 | **Self-improvement under human control** (GROK_INSTRUCTIONS T14–T16): learning from labels, red team with attacker cost, propose → backtest → admin approve → shadow → promote → rollback, `mre demo:learn` | 6 |
| H5 | `docker compose up` + `mre demo`; offline-safe; README for engineers; `docs/PITCH.md` (5-minute script + CTO Q&A sheet) | 2 |

**Order:** H1 → H2 → H2b → H3 → H4 → H6 → H5. **Cut order if time is short:** H3 SSO → H2 webhooks → extra sinks → M3 stretch.
**Never cut:** H1, the API, the config-based workflow fit with its live switch, the trained AI model M1, the one-command start, or the honest-limits slide.
**Guard-rails that must survive any config:**
- nobody approves their own proposal;
- actions that restrict funds need a distinct approver;
- the audit trail is always hash-chained;
- raw identifiers are never stored;
- missing data never moves the score.

### After the hackathon: stages S4–S7 (plan phase numbers in brackets)

### S4: Learning and portfolio mode [P8, P9]
1. **Detector statistics from labels** (`frontend/src/engines/learning/detectorStats.ts` + SQLite `detector_stats`):
   - A Beta posterior for sensitivity (fires on confirmed fronts) and for the false-positive rate (fires on adjudicated-benign cases), per detector × MCC group.
   - Hierarchical pooling across groups.
   - Floors of s ≥ 0.05 and f ≥ 0.005.
   - `judge()` and fusion read these instead of the `rules/detectors.json` priors once enough labels exist.
2. **Fusion weights:** Bayesian logistic regression (Laplace approximation) over the family LLRs, refit nightly, with weights and SDs shown in the trace.
3. **Calibration:** Platt, then isotonic once there are ≥ 200 labels. Brier, ECE and a reliability diagram stored per version.
4. **Conformal prediction** (split, 90%): if the prediction set is {genuine, front}, abstain and recommend L2 (ask the merchant).
5. **Label-bias controls:**
   - a monthly stratified random audit sample (0.5% of unflagged merchants);
   - inverse-propensity weights from the decision log;
   - UNRESOLVED never counts as a negative;
   - Cohen's κ between reviewers;
   - no analyst contributes more than 20% of any detector's counts;
   - no training on a merchant's own disputes.
6. **Portfolio mode:**
   - an `mre-portfolio/v1` upload with many merchants;
   - peer baselines from the portfolio when a group has ≥ 10 merchants (falling back to `mcc.json`);
   - a network graph (shared beneficiaries, payer overlap with a hypergeometric test, Louvain communities) with new detectors N4 (beneficiary rings) and N5 (splitting across merchants);
   - Benjamini–Hochberg FDR at q = 0.10 for opening cases, with the expected false-alarm count shown.
7. **Exit tests:**
   - On simulated labels, learned LRs converge to the generator's truth.
   - ECE ≤ 0.05 on the benchmark.
   - Rotation is detected without `peers` in the file.
   - The FDR queue's observed FDR is within its bootstrap CI.

### S5: Adversarial robustness and the controlled improvement loop [P10, P11]
1. **`scripts/redteam.ts`:**
   - Mutation operators: nudgeRound, spreadHours, splitAcrossMerchants, blendGenuine, slowRamp, rotateLinks, localMules, appOnly, bonusAmounts, delaySweep, jitterTiming, mimicPeer.
   - ≥ 500 variants per run, plus a greedy attacker that minimises the posterior.
   - Reports the evasion rate per detector and the attacker's cost to evade.
2. **`rules/workarounds.json` + a check:** every evasion needs a backstop detector with LLR > 0.5, or the build fails.
3. **Learned fake-difficulty:** τ = 1 − (Beta-smoothed) evasion rate.
4. **Threshold bands:** each threshold is drawn per release within its band, from a recorded seed.
5. **Monitoring:** weekly PSI / KS drift checks, Poisson u-charts of firing rates per detector × MCC, and a scan statistic for emerging clusters ("fraud moved" alarms).
6. **Improvement loop** (`engines/improver.ts`, `scripts/backtest.ts`, `pages/RulesPage.tsx`):
   - nightly challenger proposals;
   - a backtest with McNemar, bootstrap Δrecall/ΔFP and DeLong ΔAUC;
   - approval by a named person;
   - 14-day shadow running, then promote, with one-step rollback.
   - **Never auto-promote.**
7. List freshness: a test fails if any list in `rules/` is more than 90 days old.

### S6: Trained ML models in Python [ML1–ML4]
- An `ml/` package:
  - an S0 synthetic generator extending `prototype/generate_data.py` (5,000 merchants, 6 typologies, parameters independent of `rules/`);
  - an as-of feature store of about 190 features in parquet, with a **TypeScript ↔ Python detector parity test**.
- **M1:** LightGBM risk classifier with monotonic constraints, isotonic calibration, TreeSHAP, a bootstrap ensemble interval and seeded random search.
- **M2:** typology classifier.
- **M3:** Isolation Forest plus a scikit-learn `MLPRegressor` autoencoder on unlabelled data.
- **M6:** positive-unlabelled correction.
- **Registration gates:** must beat the Bayesian engine on AUC-PR; recall ≥ 0.80; genuine false-positive rate ≤ 3%; ECE ≤ 0.05; robust recall ≥ 0.70; parity; leakage, fairness and stability checks.
- **Registry:** a JSON registry plus a SQLite `model_versions` table (no MLflow).
- **Serving:** a nightly batch scorer writing `ml_scores`, plus a FastAPI `/score` for single uploads, with a graceful fallback to the Bayesian engine.
- The ML score is first shown as a **second opinion** in the trace, with its fusion weight capped at ≤ 1.5 nats.
- M4 (sequence) and M5 (graph) models are **gated on ≥ 1,000 real labels**.

### S7: Benchmark, pilot kit, docs, performance [P12]
- A benchmark generator (1,000 merchants: about 940 genuine across 10 MCCs, about 60 bad across 6 typologies), plus `npm run benchmark` reporting Wilson / bootstrap CIs and a reliability diagram. CI fails if recall < 0.80, genuine false-positive rate > 3% or ECE > 0.05.
- `scripts/power.ts` pilot sample-size calculator. Already checked numerically: about 1,000 genuine merchants to show a false-positive rate ≤ 3%, and about 60 bad merchants for recall ±10 points.
- **Pilot kit:**
  - a read-only connector spec (daily CSV/SFTP);
  - a DPDP checklist and DPA template;
  - a one-VM deployment guide;
  - the audit-sample procedure.
- **Docs:** README (Node ≥ 22.5), `docs/STATISTICS.md` (every formula and limit, including the mimicry ceiling), `docs/RULES.md`, `CHANGELOG.md`.
- **Performance:** code-split routes; a batch of 10,000 merchants × 90 days in under 10 minutes on 2 vCPU.
- A pen-test before any hosted deployment; then enable the Vercel / API deployment.

---

## 8. Decisions still open (ask the owner; do not decide alone)
1. Add `@anthropic-ai/sdk` for AI-written summaries, and which model to use? **Owner: "not now".**
2. Cost values in `rules/costs.json` (₹5 lakh per missed front, etc.) need a PA risk advisor's input.
3. Pricing, pilot partner and team: see `audit/END_TO_END_PLAN.md` §22 and §24.
4. Archive the Python prototype (recommended).
5. Push `mre-v2` and open a PR to `main`? Nothing has been pushed yet.

## 9. Reference documents
- `audit/IMPLEMENTATION_PLAN.md`: full technical design (Parts I–V, phases P0–P12, ML1–ML5).
- `audit/END_TO_END_PLAN.md`: product, regulatory, pilot and business plan, including the open gaps (§24).
- `audit/REPORT.md`: the original audit and its findings, all fixed in S1–S2.
- `audit/CONTEXT.md`: short rules for assistants working in this repo.
- `audit/market-research.md`: cited market and regulatory notes. The RBI PA Master Direction "business profile" clause was verified on rbi.org.in.
