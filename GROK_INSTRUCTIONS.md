# Instructions for the next AI assistant (Grok): build the hackathon version

> **Paste this into Grok:**
> "You are continuing work on the Merchant Reality Engine repo, branch `webapp-standalone`. Read `GROK_INSTRUCTIONS.md` top to bottom, then `IMPLEMENTATION_STATUS.md` and `MEASUREMENT_PLAN.md`. Do the tasks in order T1 → T16 (T13 is optional and can be skipped). For each task: make only the listed changes, run the listed checks, and commit with the given message. If a check fails twice, or anything is unclear or contradicts these instructions, STOP and report. Do not guess, and do not invent design. Never push. Never add a dependency that is not on the approved list."

---

## 0a. Deadline
The on-campus finale is on **26 Nov 2026** (IIM Bangalore × PayU "Follow the Money" challenge). It's an exhibition: judges visit stalls, and a **working prototype is mandatory**. The owner chose to run T1–T16 in order, knowing they will not all finish by then. So **every commit must leave the demo working** (`npm test && npm run build` green, and the console usable). The last fully passing commit is what gets demoed. Never leave the branch broken overnight.

## 0. Situation in one paragraph
The Merchant Reality Engine tells an Indian payment aggregator (PA) **how likely a merchant is a front for something else** (for example betting collections behind a bakery's UPI link). It says how sure it is and why, and what to do, with evidence a regulator can follow. Stages S1–S3 are built and tested on branch `mre-v2`: the statistical detectors, a Bayesian model, the trace, governance and security. We are entering a **hackathon judged by PayU's technical leadership, including the CTO**. Goals:
1. Make it a **standalone product**: an engine, a CLI, an API and an analyst console, separate from the marketing website.
2. Make it **fit any PA's existing workflow through configuration, not code**.
3. Add a **trained AI model** and show it clearly.

We do **not** know PayU's internal systems. Design for a typical PA. Never claim to integrate with a named PayU system. Never use PayU's name, logo or colours in the product UI.

## 1. Setup
```bash
git checkout webapp-standalone          # branch created from mre-v2 with these docs; do all work here
npm install
python3 -m venv .venv && .venv/bin/pip install -r ml/requirements.txt   # T9 creates ml/requirements.txt; before that: pip install scipy numpy
npm run dev:users                        # dev-only test users; passwords in backend/data/dev-users.txt (never print them anywhere)
npm test && npm run build                # must be green before you start; if not, STOP and report
```
**Approved dependencies (do not add anything else):**
- npm: what is in `package.json` today (including `@stdlib/*`).
- Python, pinned in `ml/requirements.txt`: `lightgbm==4.7.0`, `scikit-learn==1.9.1`, `shap==0.54.1`, `fastapi==0.165.0`, `uvicorn==0.54.0`, `pandas==3.1.1`, `pyarrow==26.0.1`, `numpy==2.5.5`, `scipy==1.18.1`, plus `pytest` for tests.

**Not approved:** `@anthropic-ai/sdk` (the owner said "not now"), any CSV library (write the small parser in T2), Kafka clients, OIDC libraries (T7 uses `fetch` + `node:crypto`).

## 2. Rules you must never break (the tests enforce most of them)
1. **Every number lives in `rules/*.json` or `workflow/*.json`.** Never inline a threshold.
2. **UNKNOWN evidence has LLR 0;** missing data never moves the probability.
3. **The merchant's own declaration is never a baseline.** It is only compared with the norm (detector K1).
4. **Determinism:** randomness only via `frontend/src/stats/rng.ts` with seeds derived from ids. Same input → byte-identical output.
5. **Security:**
   - Case ids come only from the server (`^INV-[0-9a-f]{8}$`).
   - Never trust approval, legal or label fields from a request body.
   - Never store raw uploads or raw payer/beneficiary IDs (HMAC them in adapters, with the PA's key).
   - Every state change goes through `appendAudit`.
6. **Guard-rails no config can disable:**
   - nobody approves their own proposal;
   - levels marked `restrictsFunds` need ≥ 1 distinct approver;
   - CONFIRMED_ILLICIT needs 2 distinct people;
   - the audit trail is always hash-chained;
   - raw IDs are never stored.
7. **No `scenario.id ===` / `sc.id ===`** (lint enforces it).
8. **The language model never decides.** AI text stays off.
9. **The trained ML model (M1) is a SECOND OPINION:** shown next to the Bayesian probability, never replacing it or changing the decision.
10. **Every numeric claim in docs or the pitch comes from a generated report file** (`reports/*.md`), using the metric definitions in `MEASUREMENT_PLAN.md` Part B (Q1–Q7, C1–C6, R1–R5, G1–G6, F1–F3, O1–O7, D1–D4). Synthetic results are always labelled "synthetic".
11. **Before every commit:** `npm test && npm run build` (plus `pytest ml/tests` once T9 exists).

## 3. Repo map (what exists; read only what a task needs)
- `rules/`: engine numbers. `frontend/src/stats/`: statistics. `frontend/src/engines/`: detectors, judge, fusion, decision, trace, volume model.
- `frontend/src/data/dataset.ts`: the `mre-dataset/v1` format and validation (`datasetToScenario`, `scenarioToDataset`, `toIst`).
- `backend/src/`:
  - `http.ts` (router), `auth.ts`, `db.ts` (node:sqlite), `store.ts` (cases + hash-chained audit), `workflow.ts` (maker/checker);
  - `trace.ts` (trace + evidence pack), `llm.ts` (template summary + verifier);
  - `adapters/canonicalDataset.ts` (HMAC pseudonymise + parse), `algorithms/analyze.ts`.
- `scripts/`: `adversarial.ts`, `security.ts`, `samples-report.ts`, `export-samples.ts` (has a `rebrand()` helper you will reuse), `user-add.ts`, `dev-users.ts`.
- `frontend/public/samples/0[1-9]-*.json`: 9 sample merchants. 01, 02, 03, 05 and 09 are fronts; 04, 06, 07 and 08 are genuine.
- `audit/IMPLEMENTATION_PLAN.md`: Part 0 is the hackathon design; Part III-B is the ML design.

---

## 4. Tasks (do them in this order)

### T1. Engine public entry point (no file moves)
**Create** `engine/index.ts`:
```ts
export { RULES } from '../rules/index';
export const ENGINE_VERSION: string;                       // = RULES.version
export { datasetToScenario, scenarioToDataset, toIst, DATASET_FORMAT, type MreDataset, type DatasetTransaction } from '../frontend/src/data/dataset';
export { runInvestigation } from '../frontend/src/engines/investigationEngine';
export { buildTrace, type Trace } from '../frontend/src/engines/traceEngine';
export { DETECTORS } from '../frontend/src/engines/detectors';
export function analyze(dataset: unknown): { ok: true; result: InvestigationResult; trace: Trace; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };
// analyze = datasetToScenario → runInvestigation → buildTrace. NO pseudonymisation here (that stays in adapters/backend).
export { buildPack } from './pack';
export { features, FEATURE_COLUMNS } from './features';
```
**Create** `engine/pack.ts`: move the pack-building body out of `backend/src/trace.ts` `evidencePack()`:
- signature `buildPack(result: InvestigationResult, meta: { caseId: string | null; createdAt: string; datasetSha256: string; generatedBy: string | null })`;
- it returns everything **except** `audit` and `auditVerification`.

`backend/src/trace.ts` then calls `buildPack` and adds `audit` + `auditVerification`. Behaviour must stay identical.
**Edit** `tsconfig.json` `include`: add `"engine", "adapters", "cli", "console", "workflow"`.
**Check:** `npm test && npm run build`. **Commit:** `T1: engine public entry point and reusable evidence pack`

### T2. Adapter: a PA export mapped by config
**Create** `adapters/csv.ts`:
- `parseCsv(text: string, delimiter = ','): string[][]`, RFC 4180: quotes, escaped quotes, CRLF, empty fields;
- `toCsv(rows: (string | number | null)[][]): string`.

**Create** `adapters/mappings/generic-pa-v1.json` exactly with this shape:
```json
{
  "name": "generic-pa-v1",
  "files": { "transactions": "transactions.csv", "merchants": "merchants.csv", "weekly": "weekly.csv" },
  "delimiter": ",",
  "amountUnit": "rupees",
  "timezone": "+05:30",
  "transactions": {
    "id": "txn_id", "merchantId": "merchant_id",
    "type": { "column": "txn_type", "map": { "PAYMENT": "SALE", "REFUND": "REFUND", "SETTLEMENT": "SETTLEMENT", "PAYOUT": "TRANSFER", "CHARGEBACK": "CHARGEBACK" } },
    "amount": "amount", "time": "txn_time", "settledAt": "settled_at",
    "payerId": "payer_vpa", "payerState": "payer_state", "payerMobile": "payer_mobile",
    "channel": { "column": "channel", "map": { "UPI_INTENT": "UPI_LINK", "UPI_COLLECT": "UPI_COLLECT", "QR": "POS", "POS": "POS", "CARD_ONLINE": "ONLINE", "NETBANKING": "ONLINE", "PAYOUT": "PAYOUT", "BANK": "BANK" } },
    "paymentLinkId": "link_id", "orderId": "order_id", "refundOfTransactionId": "original_txn_id",
    "paidTo": "refund_to", "destHolder": "refund_to_holder", "beneficiaryAccount": "beneficiary_account"
  },
  "merchants": {
    "id": "merchant_id", "name": "legal_name", "city": "city", "mcc": "mcc", "category": "category",
    "ticketMin": "declared_min_ticket", "ticketMax": "declared_max_ticket", "openHour": "open_hour", "closeHour": "close_hour",
    "homeState": "state", "catchment": "catchment", "baselineWeekly": "declared_weekly_volume",
    "onboardedOn": "onboarded_on", "declaredDomains": { "column": "domains", "split": "|" }
  },
  "weekly": { "merchantId": "merchant_id", "weekEnd": "week_end", "sales": "sales_value" }
}
```
Rules for `adapters/mapExport.ts`:
- `mapExport(dir: string, mappingPath: string, key: Buffer): { datasets: MreDataset[]; warnings: string[] }`, one dataset per merchant id in `merchants.csv`.
- Amount: if `amountUnit` is `"paise"`, divide by 100.
- Times: if a value has no offset, append the mapping's `timezone`.
- `accountAgeDays`: whole days from `onboardedOn` to the latest transaction of that merchant.
- `localStates = [homeState]`, `hours = [openHour, closeHour]`.
- `weekly.csv` present → `weeklySales` from it (`seasonalMultiplier: 1`). Absent → derive 7-day buckets ending at the merchant's last transaction (all weeks that have transactions), `seasonalMultiplier: 1`. (The engine ignores uploaded multipliers anyway.)
- Unmapped or empty source columns → field omitted (never invented).
- Unknown type or channel code → a warning, and the row is skipped.
- **Pseudonymise** `payerId`, `paidTo`, `beneficiaryAccount`, `payerMobile` and `destHolder` with `createHmac('sha256', key)`, using the same output format as `backend/src/adapters/canonicalDataset.ts` `pseudonym()`. Move that function into `adapters/pseudonym.ts` and import it from both places.

**Create** `adapters/mappings/alt-pa-example.json`: the same fields with **different** column names (prefix every column with `col_`, for example `col_txn_id`), `"delimiter": ";"`, `"amountUnit": "paise"`, and different type and channel codes (`"P"→SALE`, `"R"→REFUND`, `"S"→SETTLEMENT`, `"O"→TRANSFER`, `"C"→CHARGEBACK`).
**Create** `scripts/export-pa-files.ts`: converts each of the 9 samples into **both** layouts → `examples/generic-pa/` and `examples/alt-pa/` (folders with the 3 CSVs).
**Test** `tests/engine/adapters.test.ts` (default-export function returning a failure count, like the existing tests):
- the CSV round trip, quotes included;
- for each of the 9 samples, `mapExport(examples/generic-pa)` and `mapExport(examples/alt-pa)` give the **same decision and posterior (±1e-9)** as `analyze` on the original JSON after pseudonymisation;
- no raw `payerId` string appears in the mapped output.

**Check:** `npm test`. **Commit:** `T2: config-driven adapter for PA exports, two example layouts`

### T3. CLI with batch mode
**Create** `cli/mre.ts` using `node:util` `parseArgs`. Subcommands:
```
mre batch --in <dir> --mapping <file> --out <dir> [--ml]
mre features --in <dir> --mapping <file> --labels <truth.csv> --out <csv>      (T9)
mre serve [--port 8787]                                                      (T6)
mre demo                                                                     (T11)
mre validate-config --workflow <dir> --mapping <file> --in <dir>             (T5)
mre verify-audit --case <INV-id>
mre user:add <username> <role>
```
Batch output in `--out`:
- `scores.csv` columns: `merchant_id,name,mcc,decision,p_front,p_lo,p_hi,priority,recommended,mechanism,top_reasons,rules_version`. `top_reasons` = up to 3 fired detectors as `ID: observed`, joined by ` | `.
- `cases.jsonl`: one JSON object per OPEN_CASE: `{merchantId, posterior, ci, recommended, gateReason, fired:[{id,name,observed,llr}]}`.
- `packs/<merchant_id>.json` via `buildPack`.
- `run.json`: `{rulesVersion, mapping, inputSha256 per file, merchants, opened, startedAt, finishedAt, msTotal}`.

The HMAC key comes from `MRE_HASH_KEY` (refuse in production without it; dev uses the existing key file).
**Add** npm script `"mre": "tsx cli/mre.ts"`.
**Test:** running batch twice on `examples/generic-pa` gives byte-identical `scores.csv` and `cases.jsonl` (exclude `run.json` timings).
**Commit:** `T3: mre CLI with deterministic batch mode`

### T4. Versioned scoring API, service keys, webhooks, OpenAPI
**Create** `backend/openapi.yaml` (OpenAPI 3.1) describing exactly:
- `POST /v1/score`: body = one `mre-dataset/v1` → `{decision, posterior, ci, prior, recommended, mechanism, topEvidence:[{id,name,observed,llr}], rulesVersion, ml: object|null}`. Stateless; does not create a case.
- `POST /v1/cases`: same body; creates a case (as `openInvestigation`) and returns `{id, ...score}`.
- `GET /v1/cases/{id}`, `GET /v1/cases/{id}/trace`, `GET /v1/cases/{id}/pack`.
- `POST /v1/batches`: body `{files: {name: base64}, mapping: string}` → `{batchId}`; `GET /v1/batches/{id}` → status + results. Use an in-process queue, one batch at a time.
- `GET /v1/health`.

**Auth for `/v1`:** header `Authorization: Bearer <key>`.
- **Create** `backend/src/serviceKeys.ts` with SQLite table `service_keys(id, name, key_hash, scopes, created_at, revoked)`. Store only the SHA-256 of the key.
- Scopes: `score`, `cases`, `batch`, `read`.
- CLI `mre key:create <name> <scopes,comma>` prints the key **once**.

**Idempotency:** POST `/v1/cases` and `/v1/batches` honour an `Idempotency-Key` header: same key + same body hash → the same response, for 24 h (table `idempotency(key, body_sha256, response_json, created_at)`).
**Webhooks:** `backend/src/sinks/webhook.ts`:
- events `case.opened`, `case.response.proposed`, `case.response.approved`, `case.labelled`;
- body `{event, caseId, at, data}`; header `X-MRE-Signature: sha256=<hex HMAC of body with the secret from env named in config>`;
- 5 retries with exponential backoff (1 s, 2 s, 4 s, 8 s, 16 s); delivery log table `deliveries`.

Emit events from `workflow.ts` at the matching steps through a small `emit(event, caseId, data)` function in `backend/src/events.ts`, which calls every configured sink (T5).
**Security probes to add** to `scripts/security.ts`: `/v1` without a key → 401; a key without the `cases` scope cannot POST `/v1/cases` → 403; a revoked key → 401; an altered webhook body fails signature verification (verify with a tiny receiver in the test).
**Commit:** `T4: versioned scoring API, service keys, idempotency, signed webhooks`

### T5. Workflow-fit configuration
**Create** `workflow/` (defaults reproduce today's behaviour exactly):
- `responses.json`: `[{ "id": "L0", "label": "Watch and log", "auto": true, "restrictsFunds": false, "needsLegal": false }, ...]` for L0–L5. L3 has `restrictsFunds: true`; L4 and L5 have `restrictsFunds: true, needsLegal: true`. Labels come from `rules/costs.json`.
- `approvals.json`: `{ "actions": { "open": ["analyst","reviewer","admin"], "review": ["analyst","reviewer","admin"], "propose": ["analyst","reviewer","admin"], "labelBenign": ["analyst","reviewer","admin"] }, "levels": { "L3": { "approvers": 1, "approverRoles": ["reviewer","admin"] }, "L4": { "approvers": 1, "approverRoles": ["legal"] }, "L5": { "approvers": 1, "approverRoles": ["legal"] } }, "confirmedIllicit": { "people": 2, "confirmRoles": ["reviewer","admin","legal"] } }`.
- `statuses.json`: `{ "opened": "OPENED", "proposed": "PENDING_APPROVAL", "approved": "ACTION_TAKEN", "rejected": "PROPOSAL_REJECTED", "labelled": "LABELLED" }`.
- `labels.json`: `{ "CONFIRMED_ILLICIT": "CONFIRMED_ILLICIT", "ADJUDICATED_BENIGN": "ADJUDICATED_BENIGN", "UNRESOLVED": "UNRESOLVED" }` (keys are external codes, values are internal).
- `roles.json`: `{ "roles": ["analyst","reviewer","legal","admin"], "oidcGroups": {} }`.
- `outputs.json`: `{ "sinks": [ { "type": "file", "dir": "backend/data/events" } ] }` (webhook sinks look like `{ "type": "webhook", "url": "...", "secretEnv": "MRE_WEBHOOK_SECRET", "events": ["case.opened"] }`).

**Create** `engine/workflowConfig.ts`: typed loader `loadWorkflow(dir = 'workflow')` plus `validateWorkflow(cfg): string[]` (errors). **Guard-rails** (errors if broken):
- any level with `restrictsFunds` must have `approvers >= 1`;
- `needsLegal` levels must have only `legal` approver roles;
- `confirmedIllicit.people >= 2`;
- every role used must exist in `roles.json`.

Self-approval is forbidden in code, not config.
**Refactor** `backend/src/workflow.ts` to read roles, levels and approvers from the loaded config instead of the constants `WORKERS`, `needsLegal` and `needsApproval`. The status names in API responses come from `statuses.json`. Behaviour with the default config must be identical: the existing selfcheck and security tests must pass unchanged.
**Create** `examples/alt-pa/workflow/`: 3 response levels only (`MONITOR`, `QUERY_MERCHANT`, `RESTRICT_FLOW`, mapped onto L1, L2, L3 via an `"engineLevel"` field in `responses.json`, which you add to the schema), `RESTRICT_FLOW` needs 2 approvers, and its own status names.
`mre validate-config --workflow <dir> --mapping <file> --in <dir>`: load, validate, map the sample export, run 3 merchants, and print a short report; exit 1 on any error.
**Tests:** `tests/engine/workflow.test.ts`:
- both shipped configs validate;
- a config with `"L3": {"approvers": 0}` is rejected;
- the same merchant gets the **same posterior** under both configs;
- under the alt config, one person cannot complete `RESTRICT_FLOW`.

**Commit:** `T5: workflow-fit configuration with guard-rails and an alternative PA example`

### T6. Standalone server and analyst console
- **Create** `console/index.html`, `console/main.tsx`, `console/App.tsx`, `vite.console.config.ts` (root `console`, `build.outDir` `../dist-console`, dev port 5174, proxy `/api` and `/v1` to 8787).
- Console routes, reusing existing components from `frontend/src`:
  - `/` = the case list (move `AIEnginePage` content);
  - `/analyze` = `UploadPage`;
  - `/cases/:id` and `/cases/:id/:view` = `ServerCasePage` (the views it already supports, including `trace`);
  - `/portfolio` = T8 queue.
  - Wrap everything in `SignInGate` and `EngineShell`, with nav links rewritten to console paths. **No marketing pages.**
- **Website** (`frontend/`): remove the `/ai-engine/*` routes. Replace them with a single `/ai-engine` page that says the console is a separate app and links to `import.meta.env.VITE_CONSOLE_URL ?? 'http://localhost:5174'`. Keep `/`, `/architecture` and `/demo/*` unchanged.
- **`mre serve`:** starts the existing HTTP handler and also serves `dist-console/` static files at `/` (SPA fallback to `index.html`) on the same port, so one URL is the standalone app. Static files get `cache-control: no-cache` for `index.html` and long cache for hashed assets.
- `package.json` scripts: `"dev:console": "vite --config vite.console.config.ts"`, `"build:console": "vite build --config vite.console.config.ts"`; `build` also runs `build:console`.
- **Accessibility:** every input has a label; buttons have accessible names; visible focus outline; colour is not the only status signal (badges have text); charts in the trace have the table next to them (already true).

**Check:** `npm run build` produces `frontend/dist` and `dist-console`; `npm run mre -- serve` serves the console at http://localhost:8787 and sign-in works; the website at :5173 has no case data.
**Commit:** `T6: standalone analyst console served by mre serve; website separated`

### T7. Company login (OIDC). Optional, cut first if time is short
`backend/src/oidc.ts`: authorization-code flow with PKCE using `fetch` and `node:crypto`. Config via env:
- `MRE_OIDC_ISSUER`, `MRE_OIDC_CLIENT_ID`, `MRE_OIDC_CLIENT_SECRET`, `MRE_OIDC_REDIRECT`.
- Discovery from `/.well-known/openid-configuration`.
- Validate the `id_token` signature with the JWKS (RS256 via `crypto.verify`), and check `iss`, `aud`, `exp`, `nonce`.

Group claim → role via `workflow/roles.json` `oidcGroups`; no matching group → no access. Create or update a user row with an unusable password. Local login stays available.
**Test** with a tiny in-process mock IdP in `tests/engine/oidc.test.ts`: a valid token signs in; a bad signature, wrong audience or expired token is rejected.
**Commit:** `T7: optional OIDC sign-in with group-to-role mapping`

### T8. Portfolio generator, FDR queue, benchmark
**Create** `scripts/gen-portfolio.ts --n 1000 --seed 7 --out examples/portfolio`.
- Bases: the 9 sample datasets. For each new merchant:
  1. pick a base by target mix: **genuine ~94%** (04, 06, 07, 08) / **front ~6%** (01, 02, 03, 05, 09);
  2. rebrand it with `rebrand()` from `scripts/export-samples.ts` (export it): new id `M-PF-0001`…, name `Merchant 0001`…, city and home state picked from a fixed list of 12 (city, state) pairs, consistent with states.json;
  3. **jitter**: multiply every non-round amount by U(0.85, 1.15) and round to whole rupees; keep ₹500 multiples unchanged; shift every timestamp by the same random 0–30 days; keep a random 70–100% of sales (drop the others and their refunds);
  4. apply **one honest variation** to 30% of genuine merchants (chosen from: college-area payers, gift-box round amounts, one bank switch, late-night delivery). Copy the mutation code from the matching cases in `scripts/adversarial.ts` into exported functions in `scripts/mutations.ts`; do not duplicate it.
  5. apply **one evasion** to 50% of fronts (nudge round amounts, shift off-hours to 21:00, remove refunds/transfers, website missing, stable beneficiary).
- Write `truth.csv` (`merchant_id,label,typology`, label 1 = front) **in a separate folder** `examples/portfolio-truth/` (never inside the input folder).
- Write the merchants out in the `generic-pa-v1` layout.

**Create** `engine/portfolio.ts`: `scorePortfolio(results)`:
- `pValue = 1 − posterior`;
- Benjamini–Hochberg at q = `rules/engine.json` `portfolio.fdrQ` (add `"portfolio": {"fdrQ": 0.10}`);
- returns a queue sorted by expected loss, plus `{opened, expectedFalseAlarms}`.
- Add a comment that `1 − posterior` is used as a p-value proxy, which makes this posterior-based FDR, not classical BH. Name it "Bayesian FDR (expected false discoveries = Σ(1 − P) over opened cases)" and compute `expectedFalseAlarms` that way, **not** q × R.

**Create** `scripts/benchmark.ts --in examples/portfolio --truth examples/portfolio-truth/truth.csv` → `reports/benchmark.md`:
- precision, recall and genuine-merchant FP rate, each with a **Wilson 95% interval**;
- per-typology recall;
- the confusion table;
- the expected vs observed false alarms;
- a header saying "**Synthetic portfolio derived from 9 hand-built samples; this measures robustness to variation, not real-world accuracy.**"

**Also report** the fairness metrics F1–F3 (FP rate by city tier, MCC, account age, with Wilson CIs), C5 (expected vs observed false alarms), C6 (saturation rate) and Q7 (top-K precision) from `MEASUREMENT_PLAN.md`. Tag each portfolio merchant with a city tier (1/2/3) from the fixed city list.
**Console:** `/portfolio` page showing the queue (merchant, P(front) with interval, action, expected loss, link to the case) and the line "N cases · about M expected false alarms".
**Commit:** `T8: 1,000-merchant synthetic portfolio, Bayesian-FDR queue, benchmark report`

### T9. The trained AI model (M1): features, training, comparison
**Create** `engine/features.ts`. `FEATURE_COLUMNS` and `features(result): Record<string, number>`, exactly:
- for each detector id in `DETECTORS` order: `llr_<ID>`, `eff_<ID>` (effect or 0), `fired_<ID>` (1 if ILLICIT), `unk_<ID>` (1 if UNKNOWN);
- `posterior`, `prior`, `logodds_total`;
- `cov_<key>` (1 if not MISSING) for the 7 coverage keys;
- `n_sales`, `account_age_days`.

`mre features --in examples/portfolio --mapping adapters/mappings/generic-pa-v1.json --labels examples/portfolio-truth/truth.csv --out ml/data/features.csv` writes `merchant_id`, label, then `FEATURE_COLUMNS`.
**Create** `ml/requirements.txt` (approved pins), `ml/__init__.py`, and `ml/train_m1.py`:
1. Load the features. Split: stratified by label, 70% train / 30% test, `random_state=7`, by merchant. Save the test ids to `ml/data/test_ids.csv`.
2. LightGBM `LGBMClassifier`:
   - `objective='binary'`;
   - `monotone_constraints`: +1 for `llr_*` and `fired_*` columns, 0 for the rest;
   - `scale_pos_weight` = negatives / positives on train;
   - `random_state=7`, `deterministic=True`, `n_jobs=1`.
3. Random search, 30 trials (seed 7), over:
   - `num_leaves` {7, 15, 31};
   - `min_child_samples` {5, 10, 20};
   - `learning_rate` {0.03, 0.05, 0.1};
   - `n_estimators` {100, 200, 400};
   - `reg_lambda` {0, 1, 5}.
   
   Objective = mean stratified 5-fold CV average precision on train.
4. Refit the best model on all of train. Isotonic calibration (`IsotonicRegression(out_of_bounds='clip')`) fitted on 5-fold **out-of-fold** predictions.
5. TreeSHAP (`shap.TreeExplainer`) on test.
6. Save to `ml/models/m1-v0/`:
   - `model.txt` (`booster_.save_model`);
   - `calibrator.json` (isotonic `X_thresholds_` / `y_thresholds_`);
   - `features.json` (column order);
   - `metrics.json`;
   - `model_card.md` (purpose, data = synthetic portfolio, features, params, metrics with intervals, limits, "second opinion only", date, data SHA-256).

**Create** `ml/compare.py`. On the test ids, compare **M1 (calibrated)** with the **Bayesian `posterior` column**:
- AUC-PR with a bootstrap 95% CI (1,000 resamples, seed 7);
- recall and genuine-merchant FP rate at P ≥ 0.10 (the engine's opening bar), with Wilson CIs;
- ECE (10 bins);
- McNemar exact test on the two models' decisions at 0.10.

Write `reports/model-comparison.md`. **Report honestly whichever is better**; if M1 is not better, say so.
**Create** `ml/tests/test_m1.py` (pytest):
- the model files exist and load;
- predictions are deterministic;
- the calibrated output is in [0, 1];
- **leakage test**: training on shuffled labels gives a test AUC-PR within ±0.05 of the positive rate;
- monotonicity: raising any `llr_*` never lowers the prediction (check 50 random rows).

**Commit:** `T9: trained AI model M1 (LightGBM), calibration, SHAP, comparison with the Bayesian model`

### T10. Serve the AI model and show it
- `ml/score.py`: `python -m ml.score --features <csv> --model ml/models/m1-v0 --out <csv>` → `merchant_id, ml_p_raw, ml_p, ml_top_drivers` (top 5 SHAP features with sign, as `name:+0.42` joined by `|`).
- `ml/serve.py`: FastAPI app, `POST /score` with body `{features: {col: value}}` → `{p_raw, p, drivers: [{feature, shap}], modelVersion}`; `GET /health`. Run: `.venv/bin/uvicorn ml.serve:app --host 127.0.0.1 --port 8790`.
- `backend/src/ml.ts`:
  - `mlScore(result)` builds `features(result)`, POSTs to `MRE_ML_URL` (default `http://127.0.0.1:8790`) with a **500 ms timeout**;
  - on any error it returns `null` and logs once.
  - `/v1/score`, `/v1/cases` and the trace endpoint include `ml`.
- `mre batch --ml` calls `ml/score.py` once for the whole batch (spawned with `child_process.execFile`, the venv Python) and adds the `ml_p` and `ml_top_drivers` columns to `scores.csv`.
- **Trace page:** a new panel **"AI model (second opinion)"** (`frontend/src/components/trace/MlPanel.tsx`, used by `TracePage`). It shows:
  - the calibrated probability;
  - the top drivers translated to plain words (map `llr_A4` → "Round-number heaping weight", using detector names from `rules/detectors.json`; `fired_X` → "X fired"; …);
  - the model version;
  - a "Trained on synthetic data" badge;
  - **agreement** with the Bayesian model ("both above the 10% bar", or "they disagree: review both").
  
  If `ml` is null: "AI model offline. The decision does not depend on it."
- **Stretch (M3, only if time):** `ml/train_m3.py` IsolationForest (seed 7) on the same features for genuine merchants only → `ml/models/m3-v0/`; serve `anomaly_pct`; show it as "Unusual vs peers: 97th percentile".

**Check:**
- stopping the ML service → the trace still renders and the API returns `ml: null`;
- with the service running, the panel appears for a saved case.

**Commit:** `T10: serve the AI model (batch + API) and show it as a second opinion in the trace`

### T11. One-command start and the demo
- `deploy/Dockerfile`:
  - `FROM node:22-bookworm-slim`; install `python3 python3-venv`;
  - create `/app/.venv` and install `ml/requirements.txt`. If a pinned version does not exist for the image's Python, use the closest version that does, and **write the change in `deploy/README.md`**;
  - `npm ci && npm run build`;
  - non-root user `mre`; `VOLUME /app/backend/data`;
  - `EXPOSE 8787 8790`; `HEALTHCHECK` on `/v1/health`.
- `deploy/docker-compose.yml`: service `mre` (`mre serve`) and service `ml` (uvicorn) from the same image; env file `deploy/.env.example` (`MRE_HASH_KEY=change-me`, `NODE_ENV=production`, `MRE_ML_URL=http://ml:8790`).
- `mre demo`: in a fresh data directory:
  - create dev users (passwords to `backend/data/dev-users.txt`);
  - import `examples/portfolio` as cases (via the workflow functions, actor = dev-analyst);
  - make sure the three showcase cases exist (Telegram betting = sample 09, honest Diwali = 04, honest bank switch = the T8 bank-switch variant);
  - train M1 if `ml/models/m1-v0` is missing;
  - print the URLs.
  - **No network calls.**
- `scripts/perf.ts` → `reports/perf.md`: batch merchants/minute on the 1,000 portfolio, and `/v1/score` p50/p95 over 200 calls, on this machine (CPU model and core count recorded).

**Check:** `docker compose -f deploy/docker-compose.yml up` → the console works at :8787 and the trace shows the AI panel. Record the exact commands in `deploy/README.md`.
**Commit:** `T11: Docker image, compose, mre demo, performance report`

### T12. README and pitch material
(When T14–T16 are done, add a README section "How it improves itself, under human control" and a pitch beat for `mre demo:learn`.)
- Rewrite `README.md` for engineers:
  1. problem and the RBI clause;
  2. architecture diagram (ASCII or SVG in `docs/`);
  3. the four integration modes;
  4. the workflow-fit config table;
  5. **"Where the AI is"**, the 5-layer table from `audit/IMPLEMENTATION_PLAN.md` §0.3b;
  6. security model;
  7. how to run (dev, Docker, demo);
  8. **honest limits**;
  9. roadmap.
- `docs/PITCH.md`: the 5-minute script, following the order in `audit/IMPLEMENTATION_PLAN.md` H5, plus a Q&A sheet answering every row of §0.2. **Every number cites the `reports/*.md` file it comes from.**
- `docs/DATA.md`: what data the model was trained on, and the public benchmark (T13) if done (start from `MEASUREMENT_PLAN.md` Part C).
- `reports/metrics-summary.md`: one table with every metric from `MEASUREMENT_PLAN.md` Part B, its current value with CI, the source report and the status (measured / not yet). Generate it with `scripts/metrics-summary.ts`, which reads the other reports; do not type the numbers by hand.

**Commit:** `T12: README, pitch script and Q&A, data notes`

### T13. Optional: public AML benchmark (only if T1–T12 are done)
**Why:** judges will ask "did you test on anything recognised?". No public dataset of Indian merchants labelled as betting fronts exists, because that data is private to PAs. The recognised public synthetic AML benchmark is **IBM's "IBM Transactions for Anti Money Laundering (AML)"**: Altman et al., NeurIPS 2023 ("Realistic Synthetic Financial Transactions for Anti-Money Laundering Models"), Kaggle `ealtman2019/ibm-transactions-for-anti-money-laundering-aml`. Its data licence is **CDLA-Sharing-1.0** (per `github.com/IBM/AML-Data`).
- **The owner downloads it manually.** Do not create accounts or download it yourself. Put `HI-Small_Trans.csv` in `ml/data/raw/ibm-aml/` (git-ignored: add `ml/data/raw/` to `.gitignore`).
- `adapters/mappings/ibm-aml.json` + `scripts/ibm-aml-to-pa.ts`:
  - treat each **receiving account** as a "merchant";
  - payments to it = SALE (payer = sender account), payments from it = TRANSFER;
  - `amount` = `Amount Received` converted to INR with a fixed rate table in the mapping (USD only: keep only rows whose currency is USD and payment format is not Reinvestment);
  - MCC = `default`; no payer state (B6 → UNKNOWN), no website, no calendar;
  - label = 1 if the account received any `Is Laundering = 1` transaction.
- Run `mre features` + `ml/train_m1.py --tag ibm` + `ml/compare.py --tag ibm` → `reports/model-comparison-ibm.md`.
- **Write clearly in that report:** accounts are not merchants; most of our detectors (geography, hours, calendar, catalogue) have no data there; the result tests money-flow detectors (fan-in, fan-out, sweep, round amounts, repeat payers) and the training pipeline, not merchant-substance detection.
- Then BankSim (merchant × category data, Kaggle `ealaxi/banksim1`) for the category-norm detectors, **after the owner confirms its licence**, with the same "what this does and does not test" section.
- Also consider SAML-D (Kaggle `berkanoztas/synthetic-transaction-monitoring-dataset-aml`, 28 typologies) **only after the owner confirms its licence**. Do not use AMLNet (CC BY-NC, non-commercial).

**Commit:** `T13: public IBM AML benchmark for the training pipeline (with stated limits)`

---

## 4b. Self-improvement tasks ("the engine gets better, under human control")
These three tasks make the engine **learn from analyst decisions, attack itself to find blind spots, and propose its own fixes**. A named person must approve every fix before it takes effect. **It never changes itself without approval**: in a regulated decision, autonomous self-modification could be steered by the very fraudsters it judges, and RBI and FIU-IND expect every change to have an owner.

The headline demo is **"watch it learn"**:
1. The red team finds an evasion that slips past.
2. The engine proposes a rule change and backtests it on the portfolio.
3. An admin approves it.
4. The same evasion is now caught.
5. Honest merchants' false-alarm rate is unchanged within its confidence interval.

### T14. Learning from labels (Bayesian detector statistics)
**Goal:** every final label updates how much each detector is trusted, per merchant category, and new cases use the updated numbers.
- **SQLite** (`backend/src/db.ts` schema additions):
  - `label_events(case_id TEXT, detector TEXT, mcc TEXT, fired INTEGER, label TEXT, actor_id INTEGER, at TEXT)`, one row per non-UNKNOWN detector when a case gets a **final** label;
  - `learning_versions(version TEXT PRIMARY KEY, created_at TEXT, n_labels INTEGER, stats_sha256 TEXT)`.
- **`engine/learnedRates.ts`:**
  - `effectiveRates(detectorId: string, mcc: string, events: LabelEventSummary): { sensitivity: number; falsePositive: number; nPos: number; nNeg: number }`.
  - Priors from `rules/detectors.json`: `a1 = s·k, b1 = (1−s)·k, a0 = f·k, b0 = (1−f)·k`, with `k = rules/engine.json detectorPriorStrength` (20).
  - CONFIRMED_ILLICIT cases add to (a1, b1) by whether the detector fired; ADJUDICATED_BENIGN cases add to (a0, b0). **UNRESOLVED adds nothing.**
  - **Partial pooling across MCCs:** `s_mcc = (a1_mcc + κ·s_all) / (a1_mcc + b1_mcc + κ)`, with `κ = rules/engine.json learning.poolKappa` (add `"learning": {"poolKappa": 20, "analystCap": 0.2, "minLabelsToShow": 5}`). Same for f.
  - Floors and ceilings: `0.05 ≤ s ≤ 0.99`, `0.005 ≤ f ≤ 0.5`.
  - **Per-analyst cap:** one actor's events count with weight `min(1, analystCap · N_total / N_actor)` per detector, so no single person moves a detector by more than 20%.
- **Engine hook:** add an optional `rates?: (id: string) => { sensitivity: number; falsePositive: number }` to `Ctx`, `judge()`, `fuse()` and `traceEngine`.
  - When absent, behaviour is **byte-identical to today**; the existing tests must pass unchanged.
  - The server builds `rates` from SQLite when it opens a new case, and stores `learningVersion` on the result.
  - **Existing cases are never re-scored silently;** they keep the version they were decided with.
- **`workflow.ts` `labelInvestigation`:** on a final label, insert the `label_events`. Never insert them for the merchant's own disputes: add `"origin": "merchant_dispute"` handling and skip those.
- **Trace:** in the evidence table, each detector shows "sensitivity 0.60 → 0.66 (from 12 labels)" once `nPos + nNeg ≥ minLabelsToShow`. `learningEngine.ts`'s display-only numbers are replaced by these real ones.
- **Tests** in `tests/engine/learning.test.ts`:
  - simulate 400 labelled outcomes for one detector with true s = 0.8, f = 0.02 → the learned values lie inside their 90% Beta intervals around the truth;
  - UNRESOLVED changes nothing;
  - one analyst labelling 100 cases moves a detector by at most the cap;
  - with zero labels, the 9 samples' posteriors are unchanged (±1e-12).

**Commit:** `T14: learn detector sensitivity and false-positive rates from labels (Bayesian, pooled, capped)`

### T15. Red team: the engine attacks itself
**Goal:** systematically find the cheapest ways a fraudster could evade detection, measured on the T8 portfolio.
- **`scripts/mutations.ts`** (created in T8; extend it). Every operator is pure, seeded, and returns a **valid** `mre-dataset/v1`:
  - `nudgeRound` (round amounts ±₹37);
  - `spreadHours` (move off-hours sales to 20:00–21:30);
  - `blendGenuine(p)` (add a share p of sales copied from a genuine sample);
  - `slowRamp` (rewrite `weeklySales` to grow ≤ 8% per week);
  - `rotateLinks` (a new link id every 20 sales);
  - `localMules(p)` (set share p of payers to the home state);
  - `appOnly` (remove website data and mark it MISSING);
  - `dropCalendar`;
  - `bonusAmounts` (round amounts → nearest bonus tier);
  - `delaySweep` (onward transfers 30 h after settlement);
  - `splitMerchant(k)` (keep 1/k of sales, as if spread over k accounts);
  - `jitterTiming` (±10 min).
- **`rules/redteam.json`:** an attacker cost per operator, e.g. `{"nudgeRound":1,"spreadHours":2,"blendGenuine":10,"slowRamp":4,"rotateLinks":2,"localMules":6,"appOnly":3,"dropCalendar":1,"bonusAmounts":1,"delaySweep":2,"splitMerchant":5,"jitterTiming":1}`. For parameterised operators, cost × parameter (blendGenuine 10 × p·10; splitMerchant 5 × k).
- **`scripts/redteam.ts --portfolio examples/portfolio --truth examples/portfolio-truth/truth.csv --seed 7 --variants 500`:**
  - **Random search:** for each of up to 50 fronts, 10 random combinations of 1–3 operators.
  - **Greedy search:** from each front, repeatedly apply the single operator (with its parameter grid) that lowers P(front) most, up to 3 steps, stopping once P < the opening bar.
  - An evasion = a mutated front with `decision === 'NO_CASE'`.
- **Writes:**
  - `reports/redteam.md`:
    - overall evasion rate (Wilson CI);
    - per-detector **silencing rate** (share of variants where a detector that fired on the original no longer fires);
    - the 10 cheapest evasions with their operator lists;
    - **attacker cost to evade** per front (median, p10);
    - the share of fronts that could not be evaded within cost 20.
  - `examples/redteam/evasions.jsonl` (`{baseMerchantId, operators, cost, posterior, dataset}`).
- **Tests:** same seed → identical report; every operator output passes `datasetToScenario`; on genuine samples, operators never *raise* P above the bar (sanity check).

**Commit:** `T15: red-team search over evasion operators with attacker-cost and silencing reports`

### T16. Controlled improvement loop (propose → backtest → approve → shadow → promote, with rollback)
**Goal:** turn red-team findings into rule changes that a human approves.
- **Bands:** in `rules/detectors.json`, every detector gets `"bands": {"minEffect": [lo, hi], "alpha": [lo, hi]}`.
  - Defaults: minEffect ±40% of today's value, clipped to sensible ranges; alpha within [0.0005, 0.05].
  - Proposals may only move numbers **inside these bands**. They never touch costs, priors, guard-rails or code.
- **Rules override mechanism:** `rules/index.ts` gets `withDetectorOverrides(patch: Record<string, Partial<{minEffect: number; alpha: number}>>, fn: () => T): T`. It sets an override map that `RULES.detector()` reads, then restores it in `finally`. Synchronous only; document that it is not safe across awaits.
- **`engine/improver.ts`:** `propose(input: { portfolio: MreDataset[]; truth: Map<string, 0|1>; evasions: MreDataset[] }): Proposal | null`.
  1. Take the detectors most often silenced in `evasions`.
  2. For each, try 5 grid values of `minEffect` (and `alpha`) inside its band.
  3. For each candidate, **backtest** on portfolio + evasions: recall on evasions, overall recall and genuine FP rate, all with Wilson CIs, plus McNemar exact on champion vs challenger decisions.
  4. **Accept** a candidate only if: the genuine FP rate's 95% upper bound rises by ≤ 0.5 percentage points over the champion's; evasion recall improves; and McNemar p < 0.05 on the evasion set.
  5. Return the best, or `null` with the reason.
- **`Proposal`** = `{ id, createdAt, createdBy: 'mre-improver' | username, patch, rationale, backtest: { champion: Metrics, challenger: Metrics, mcnemarP }, status: 'proposed' | 'approved' | 'rejected' | 'shadow' | 'live' | 'rolled_back' }`. Saved to `rules/proposals/<id>.json`.
- **Versions:** approving writes the patched `rules/detectors.json`, bumps `rules/engine.json` `version` (patch number +1), and saves a full snapshot to `rules/history/<version>/`.
- **Audit:** a new table `rules_audit` with the **same hash-chain logic** as case audit. Refactor `appendAudit` / `verifyAudit` in `store.ts` to take the table name, or add a parallel pair; one entry per propose, approve, reject, shadow, promote and rollback.
- **API** (session auth; **admin role only**; **approver ≠ the user who triggered the proposal**; `mre-improver`-created proposals can be approved by any admin):
  - `POST /api/rules/proposals/run` (runs red team + improver on the loaded portfolio, returns the proposal);
  - `GET /api/rules/proposals`;
  - `POST /api/rules/proposals/:id/{approve,reject,promote}`;
  - `POST /api/rules/rollback {version}`;
  - `GET /api/rules/audit` (verification result).
- **Shadow:** an approved proposal enters `shadow` first. `mre batch` then writes both `decision` and `challenger_decision` columns. **Promote** makes it live. For the demo, promote can follow shadow immediately; in production the plan's rule is 14 days.
- **Console** `/rules` page (admin):
  - the proposal list;
  - the diff (old → new numbers, with the detector name in words);
  - the backtest table with CIs and the McNemar p;
  - Approve / Reject / Promote buttons;
  - the version history with Rollback;
  - the audit-chain status.
- **`mre demo:learn`** (scripted "watch it learn", also used as a test):
  1. score the portfolio with the champion rules;
  2. run the red team and print one evasion that slips through;
  3. run the improver and print the proposal and backtest;
  4. approve it (as dev-admin; create that user in `dev-users.ts`);
  5. promote it;
  6. re-score and print: the evasion is caught, and the genuine FP rate with its CI before vs after.
  
  It exits 1 if the improver finds no acceptable proposal (report why).
- **Tests** in `tests/engine/improver.test.ts`:
  - a proposal can never move a number outside its band;
  - the creator cannot approve their own proposal;
  - approve → promote → rollback restores byte-identical `rules/` files;
  - the rules audit chain verifies and tampering is detected;
  - with no proposals applied, the 9 samples are unchanged.

**Commit:** `T16: controlled improvement loop with backtests, admin approval, shadow, promote and rollback`

---

## 5. When to stop and ask the owner
- Any test that passed before your change now fails and you cannot fix it in 2 attempts.
- A task needs a dependency not on the approved list.
- Anything would push to GitHub, publish, deploy, download data, or create an external account.
- A change would make the default-config behaviour differ from today's (any change to the 9 samples' decisions or posteriors beyond ±1e-9). The only exceptions: learned rates once real labels exist (T14), and a rules version an admin explicitly approved and promoted (T16).
- You are about to put PayU's name or branding into the product UI.

## 6. Definition of done (hackathon)
- `npm test && npm run build && .venv/bin/pytest ml/tests` all pass.
- `npm run mre -- batch --in examples/generic-pa --mapping adapters/mappings/generic-pa-v1.json --out /tmp/out` and the same with `examples/alt-pa` + `alt-pa-example.json` give the same decisions.
- `docker compose up` → console at :8787: sign in, open the Telegram case, trace shows the Bayesian waterfall **and** the AI model panel, maker/checker works, evidence pack downloads.
- `reports/benchmark.md`, `reports/model-comparison.md`, `reports/perf.md` and `reports/redteam.md` exist, and the README/pitch numbers match them.
- `npm run mre -- demo:learn` shows an evasion found, a proposal backtested, approved and promoted, the evasion caught on re-run, and the genuine FP rate unchanged within its CI.
