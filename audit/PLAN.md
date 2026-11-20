# Plan: get the full Merchant Reality Engine working, and make it show its working

Goal: someone at a PA uploads (or connects) real merchant data. The engine runs all 7 layers on that data alone, with nothing scripted per scenario. Every verdict is traced to records, rules and weights the user can click through. We can show measured accuracy, not just a demo.

"AI model" here means four parts: **rules engine + calibrated scorer + learning loop + LLM explainer**. That is the honest version that ships. A black-box ML model comes later, once there are ~200 labelled cases.

Each phase has an **exit test**. We don't move on until it passes.

---

## Phase 0: Safe foundation (week 1)
Make it safe to run on anyone's data.
- Only server-minted case ids (`^INV-[0-9a-f]{8}$`); `ensure()` can't create a case under a caller-chosen id.
- Stop storing the raw upload; HMAC-SHA256 payer ids with a key from env.
- Validation: `confirmed ≤ contacted`, `ticketMin < ticketMax`, seasonal 0.2–6, overnight hours, de-duplicate events, warn on an empty calendar.
- Fix `offHours` for overnight shops.
- **Exit test:** `audit/security-probe.ts` prints "blocked" for every probe; adversarial case W5 → REJECT.

## Phase 1: One engine, no scripting (week 1–2)
Every number on screen comes from the run.
- Delete the `scenario.id === …` branches (L5 callout, DemoPage, learningEngine) and generate the text from the evidence ids that fired.
- Homepage figures, live-detector count and layer timings come from a real `runInvestigation` call (or are removed).
- Pick the TypeScript engine as the only engine. Archive `prototype/` or make it read the same rules file.
- Move every threshold into `rules/thresholds.json` (one place, versioned, shown in the UI).
- **Exit test:** grep for `sc.id ===` / `scenario.id ===` in `frontend/src` → 0 hits; the 4 demo scenarios still give their documented outcomes.

## Phase 2: Fix the decision logic (week 2–3)
The engine catches the quiet launderer and leaves the honest merchant alone.
- Replace "systems" with real data provenance. Open a case on ≥2 independent families, **or** ≥3 payment-feed families with combined mass ≥ 1.2.
- F5: only flag ≥2 beneficiary changes, an account shared with a peer, or a change near a volume spike.
- D9: treat refunds to the same mobile or account holder as benign.
- Baselines from an **MCC reference table** (`rules/mcc.json`, top 40 Indian MCCs) and the **festival + cricket calendars** (`rules/calendar.json`), not from the uploaded file. The merchant's own declaration only feeds a new *declared-vs-expected mismatch* detector.
- **Exit test:** `audit/adversarial.ts` 27/27. W1, W2 → OPEN_CASE; W3, W4 → NO_CASE; the 22 current survivors still pass.

## Phase 3: UPI-native detectors (week 3–4)
Catch what the market misses: betting money with no website to crawl.
- Payer recurrence (the same payer 5–30×/week at varying amounts).
- Fan-in/fan-out (many payers → few onward beneficiaries).
- Settlement-sweep velocity (money out within hours of settling).
- Bonus-tier amounts (₹199/₹299/₹999 …).
- Night-of-match intensity using the shipped fixture calendar.
- Known betting-host lookup (`rules/betting-hosts.json`).
- Each new detector follows the existing `Def` shape in `detectors.ts` and gets ≥2 adversarial cases (one should-fire, one false-positive trap).
- **Exit test:** a new sample "Telegram-link betting, no website, clean refunds" → OPEN_CASE; all genuine samples (04, 06, 07, 08) stay NO_CASE.

## Phase 4: Show its working (week 4–5): the explainability layer
This is what "show its working" means on screen. Each case gets a **reasoning trace**:
1. **Data in:** which feeds were present, missing (UNKNOWN) or partial, with record counts.
2. **Expected vs observed:** for each detector, the expected value and its source (MCC table / calendar / peer cohort), the observed value, the threshold and the status.
3. **Click-through to records:** every ILLICIT item links to the transaction ids that caused it (already in `records[]`; surface it).
4. **Fusion maths, step by step:** what was excluded as UNKNOWN, what was collapsed as correlated, weight = strength × reliability × fake-difficulty, family masses, gate pass/fail and why, and mechanism scores.
5. **Two competing stories:** "legitimate business" vs "front", each link marked supported / failed / unverified.
6. **What would change the verdict:** "If orders feed were connected and ≥90% matched, D10 would turn BENIGN and the priority would fall to LOW." Compute this by re-running fusion with each UNKNOWN flipped.
7. **LLM explainer (optional, cheap):** Claude Haiku turns the trace JSON into a 150-word analyst summary. It *only* restates the trace, has no decision power, and is cached per case. The verdict never comes from the LLM.
- Export the same trace as a JSON + PDF **evidence pack** mapped to the RBI PA-MD clause ("monitor … in line with business profile").
- **Exit test:** for any case, every number in the summary can be traced to a record id, a rules-file entry or a formula on the trace page (manual check on 5 cases).

## Phase 5: Make learning real (week 5)
- Persist detector reliability per MCC (Beta(α, β) counts) when an analyst labels a case; the next run reads them.
- Show "reliability before → after" on the trace, plus which past cases moved it.
- Auth + maker/checker: the labeller can't execute L4/L5; `legalVerified` only from a legal-role user; hash-chained audit rows.
- **Exit test:** label a case CONFIRMED_ILLICIT → re-run a similar merchant → that detector's weight has gone up and the trace shows why.

## Phase 6: Prove it works (week 6)
- **Portfolio mode:** upload many merchants at once; shared-beneficiary and payer-overlap graph across them (rotation detection without `peers` in the file).
- **Benchmark suite:** 200 generated merchants (≈170 genuine across 8 MCCs with festivals and messy data, ≈30 bad across 5 typologies, *generated with different parameters than the engine is tuned on*). Report precision, recall and false-positive rate on every build.
- **Shadow pilot** with one PA: run on their portfolio read-only and measure alert rate and analyst-confirmed precision.
- **Exit test:** benchmark at ≥ 0.8 recall with ≤ 3% false-positive rate on genuine merchants, printed by `npm run benchmark`.

---

## The AI model, layer by layer
| Layer | What it is | Trained? | When |
|---|---|---|---|
| 1. Detectors | 20 rules today, about 26 after Phase 3. Each one turns raw transactions into ILLICIT / BENIGN / UNKNOWN with a strength | No. Thresholds live in `rules/*.json` | Now |
| 2. Fusion scorer | Today: hand-set weights and the two-family gate. Next: logistic regression over the detector outputs (≈26 inputs → probability), with weights shown per case | Yes: first on the 200-merchant benchmark (Phase 6), then refit on real labels | Phase 6 |
| 3. Learning loop | Beta(α, β) reliability per detector per MCC, updated by every analyst label | Online, from labels | Phase 5 |
| 4. Anomaly model (optional) | Isolation Forest on a merchant's weekly feature vector against its MCC peers. It only *raises* items for review and never decides | Unsupervised, no labels needed | After portfolio mode |
| 5. LLM analyst | Claude Haiku writes the case summary and the merchant-clarification email from the trace JSON. Its output is checked: every number it cites must appear in the trace, or the draft is rejected | No. Prompted and cached | Phase 4 |

Rules: the verdict always comes from layers 1–3, never from the LLM. A trained weight is never shown without the reason it moved. A model trained only on synthetic data only learns our own data generator, so the fitted scorer stays labelled "synthetic-calibrated" until real labels exist.

## Self-improvement ("RSI") and staying ahead of evolving fraud

**What exists today (checked on `main`, `feature/portfolio-demo` and `mre-prototype`):** there is no RSI or self-improvement code on any branch. The L7 flowchart describes a "keeps improving" loop, and `learningEngine.ts` computes reliability nudges, but they are display-only and never saved or applied. If the RSI work lives on someone's laptop, it needs to be pushed before I can review it.

### A. The improvement loop (controlled, not fully autonomous)
Fully autonomous self-modification is the wrong design for a regulated risk decision: a model that rewrites its own rules can be steered by the fraudsters it is judging (by feeding it data), and RBI/FIU-IND expect every change to have an owner. The engine should therefore **propose its own improvements automatically, and a human approves them**:

1. **Collect:** every analyst label, merchant clarification and later outcome (chargeback, police complaint, termination) is stored per case.
2. **Learn:** nightly, update each detector's trust per category (Beta counts) and refit the fusion scorer on all labels so far.
3. **Propose:** the engine writes a *challenger* rule set. Examples: "move A4 threshold 20% → 16% for MCC 5462", "new rule: payer recurrence ≥ 8/week". Proposals come from (a) the refit weights, (b) threshold sweeps on the benchmark, and (c) the red-team results in B.
4. **Backtest:** champion vs challenger on the benchmark + every labelled real case + the adversarial suite. The challenger must catch at least as much, flag no more genuine merchants (within a set margin), and pass every regression case.
5. **Approve:** a human risk owner approves the diff. It ships as a new `rules/` version with a changelog entry: who approved, why, and the before/after numbers.
6. **Shadow, then promote:** the challenger runs silently next to the champion for 2 weeks, and is promoted only if live alert precision holds.
7. **Roll back:** any version can be restored in one step; every case records which rules version decided it.

Guard-rails: labels from a merchant's own disputes are never used to retrain on that merchant; no single analyst's labels can move a weight by more than X% (stops one bad or bribed analyst poisoning the model); weights have floors and ceilings.

### B. Assume fraudsters adapt: "round-abouts" and edge cases
Once fraudsters learn what gets caught, they route around it. Plan for that from day one:

1. **Automated red team.** Grow `audit/adversarial.ts` into a generator that takes every known bad pattern and mutates it the way a smart launderer would: amounts nudged off round numbers, payments spread across hours, splitting across several merchant accounts, mixing real sales in as cover ("blending"), slowing growth to stay under the drift alarm, using a different link per payer, and moving to app-only or Telegram links. Run it on every rules change. Any mutation that slips through becomes a new regression case and a proposal for step A3.
2. **Workaround catalogue.** For every detector, write down the cheapest way to beat it and which other detector should still catch that. If nothing catches it, that's a gap to fix. Examples: beat A4 by avoiding round amounts → caught by payer recurrence; beat B6 with local mules → caught by fan-in/fan-out; beat G6 by hiding the website → caught by UPI-only detectors.
3. **Lean on evidence that is hard to fake.** Bank reconciliation, delivered orders, independent purchaser checks and network links cost a fraudster real money to fake, so they should carry more weight as cheap signals get gamed. The `fakeDifficulty` field already exists; tie it to the red-team results, so a detector that is easy to beat in testing loses weight automatically.
4. **Don't publish exact thresholds.** Keep internal thresholds inside a small band per category and per release (for example A4 between 16% and 22%). The trace still shows the exact value used for that case. Fraudsters can't learn a moving target, and reviewers still see the reasons.
5. **Displacement alarms.** If a detector that used to fire across the portfolio suddenly goes quiet, or a new pattern grows (a jump in ₹199 payments, a jump in a new UPI handle), alert the risk team. Fraud doesn't vanish; it moves, and silence is a signal.
6. **Cross-merchant view.** Splitting money across accounts is the main way around a single-merchant check. Portfolio mode (shared beneficiaries, overlapping payers, devices) is how we catch it.
7. **Edge-case library.** Every real false positive and every miss becomes a permanent test case with its explanation: overnight shops, festival spikes, college-area shops, bank switches, delivery apps, wholesalers with round invoices.
8. **External feeds.** Refresh the betting-domain list, I4C suspect registry (if access is granted) and festival/match calendars on a schedule, with a test that fails if any list is older than 90 days.

### C. Exit tests
- A label on one case changes the weights used on the next run; the trace shows the change and which cases caused it.
- A rules change cannot go live without a passing backtest report and a named approver.
- The red-team generator runs ≥ 500 mutations per release; anything that gets through is listed in the release notes and becomes a test case.
- A planted "fraud moved" pattern in the benchmark raises a displacement alarm within one batch.

## Make the AI Engine look like the demo
What I saw running both locally:
- After an upload, the AI Engine already reuses the demo's 7-layer views (same `InvestigationPage`, the layer components and the 7-item sidebar). That view is held **only in browser memory**, so it is lost on reload.
- A **saved case** (`/ai-engine/cases/:id`, `ServerCasePage.tsx`) is a plain text summary with no layer stepper, charts, graph or pattern board.
- Before an upload, the AI Engine sidebar shows 3 items; the demo shows 10.

Changes:
1. API `GET /investigations/:id` also returns the parsed scenario (with payer ids hashed, never the raw upload).
2. `ServerCasePage` calls `loadCustom(scenario)` and renders the same `InvestigationPage` + layers as the demo, with the server's saved analyst notes, response and label shown over it.
3. Analyst actions in the layer views (L5 notes, L6 response, L7 label) save through `updatePilotCase` instead of local state, so they persist.
4. Upload runs the same progressive layer-by-layer reveal as the demo, and the result card has the same layout.
5. One shared shell, with the nav switched by mode, instead of two copies (`DemoShell` / `EngineShell`).
- **Exit test:** upload sample 05 → reload `/ai-engine/cases/<id>` → you see the same 7-layer view, graph and pattern board as `/demo` with the analyst notes still there; screenshots of the two match in layout.

## The demo at the end (what we show)
1. Upload a 200-merchant portfolio → dashboard: 9 cases opened, ranked.
2. Open the top case → reasoning trace: data in → expected vs observed → records → fusion maths → two stories → "what would change this".
3. Open a genuine Diwali merchant → see *why* the volume alarm was explained.
4. Label a case → watch the reliability update land on the next run.
5. Show the benchmark number and the RBI-mapped evidence pack.

## Not doing (yet)
- No deep-learning model until ~200 real labelled cases exist. After that, a calibrated logistic layer over the detector outputs keeps it explainable.
- No real-time streaming. Daily batch meets the RBI requirement.
- Not all 92 remaining catalogued patterns. Phase 3's UPI set first.

## Running cost
Phase 0–6 runs on the current stack. Local or free-tier hosting, JSON → SQLite for cases (Postgres free tier when there is more than one writer), rules as JSON files. The optional Haiku explainer costs roughly a fraction of a rupee per case when cached (est.). Approximately ₹0/month at pilot scale.
