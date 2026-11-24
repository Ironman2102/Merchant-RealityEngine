# Merchant Reality Engine: End-to-End Master Plan

**Version:** 1.0 · 19 Nov 2026 · repo `dhruv11bhandari/Merchant-RealityEngine` @ `1d1d9a8`
**This is the single master document.** It covers everything from problem to paid customer. File-level engineering detail lives in **Appendix A: `audit/IMPLEMENTATION_PLAN.md`**. Test evidence lives in **Appendix B: `audit/REPORT.md`**.

Items marked **[verify]** are believed correct but need a primary-source check before they go in a pitch or contract.

---

## Contents
1. Executive summary
2. Where we are today (audited)
3. Problem, customer and why now
4. Market and positioning
5. Product: what the customer gets
6. Users, jobs and end-to-end flows
7. Data strategy
8. The intelligence: statistical and probabilistic engine
9. Learning, self-improvement and adversary evolution
10. Explainability and evidence
11. Architecture and platform
12. Security, privacy and regulatory compliance
13. Model governance and risk management
14. Quality: testing and validation
15. Delivery plan: phases, timeline, team
16. Pilot plan
17. Go-to-market, pricing and business model
18. Operations and support
19. KPIs and success criteria
20. Risk register
21. Budget
22. Decisions needed from the founders
23. Appendices
24. What this plan does not yet cover (open gaps)

---

## 1. Executive summary

**What:** an explainable engine that tells an Indian payment aggregator (PA) **how likely it is that a merchant is not the business it claims to be**. It also says how sure it is, why, and what to do next, in a form an RBI or FIU-IND reviewer can follow.

**Why now:** RBI's Payment Aggregator Master Direction (updated 11 Nov 2026, verified) requires PAs to *"monitor transactions subsequently undertaken by the merchants to ensure that these transactions are in line with latter's business profile."* Merchants onboarded before 31 Dec 2025 must be re-diligenced within a year. Since the Online Gaming Act 2025 banned real-money gaming, betting money moves through disguised merchants and mule accounts **[verify enforcement status]**.

**Where we are:** a working, honest prototype. 7 layers, 20 rule detectors, a good demo, and all existing tests pass. Our adversarial testing found 5 failures in 27 cases (it misses betting fronts without a website, and flags honest bank switches), 2 security holes, and display-only learning. The details are in §2.

**Where we're going (about 6 months):**
- **Weeks 0–10:** build the real engine. It covers statistical detectors, Bayesian fusion, decision theory, **trained ML models (LightGBM risk and typology classifiers, anomaly model) with a training pipeline, registry and serving**, learning, a red team and governance, behind the same UI as the demo.
- **Weeks 8–20:** a shadow pilot with one PA, measuring false-positive rate and precision on real merchants.
- **Week ~24:** the first paid contract.

**What we need:** 3 engineers (stats/engine, product/platform, ML in Python), or 2 with about 3 weeks added,, 1 founder on PA sales and regulatory work, about ₹0–₹1,000/month infrastructure until the pilot, a pilot PA willing to share 90 days of hashed data for ≥ 1,000 merchants, and a part-time compliance advisor.

---

## 2. Where we are today (audited 19 Nov 2026)

| Area | Status | Evidence |
|---|---|---|
| Existing tests (selftest, API, dataset, build, Python) | ✅ All pass (Python needs a venv) | REPORT §2 |
| Adversarial robustness | ⚠️ 22/27. Misses a betting front with no crawlable site (W1, W2); flags an honest bank change (W3, W4); accepts impossible inputs (W5) | REPORT §3, `audit/adversarial.ts` |
| Baselines | ❌ Self-declared by the merchant, so a fraudster can widen its own profile | REPORT §4.1 |
| Learning | ❌ Computed but never saved or applied | REPORT §4.5 |
| Security | ❌ Path traversal read and write; anonymous label + terminate; raw payer IDs stored | REPORT §5, `audit/security-probe.ts` |
| UI | ⚠️ Uploads use demo screens only in memory; saved cases show a plain page | PLAN, browser check |
| Hardcoded output | ⚠️ 35 constants and 9 scenario-dependent values on screen | `audit/hardcoding-scan.md` |
| Two engines | ⚠️ Python and TypeScript use different rules | hardcoding-scan §4 |
| Accuracy claims | ❌ None possible; synthetic data only | REPORT §4.7 |
| "RSI" / self-improvement | ❌ Not in any branch; concept only (L7 flowchart) | branch search |

**Strengths to keep:** UNKNOWN is never treated as clean or suspicious; correlated signals are collapsed; benign evidence is discounted by how easy it is to fake; the engine tests a legitimate story against a front story; humans approve actions; the code is small and readable.

---

## 3. Problem, customer and why now

### 3.1 The problem
A merchant onboarded as "Sweet Crumbs Bakery" uses its UPI link or QR code to collect money for illegal betting, or for another undeclared business. The PA carries the regulatory, reputational and scheme risk. Current controls are mostly checks at onboarding plus velocity rules. They miss merchants that *look* normal on paper but *behave* differently. G2 Risk Solutions says 85% of transaction-laundering cases come from merchants that appear low-risk (vendor claim).

### 3.2 The customer
| Segment | Who | Pain | Buyer |
|---|---|---|---|
| **Primary (ICP)** | RBI-authorised online PAs (PA-O / PA-CB) with ≥ 5,000 small merchants, heavy UPI | RBI ongoing-monitoring requirement, FIU-IND STR quality, partner-bank pressure, analyst overload | Chief Risk Officer / Head of Merchant Risk; Principal Officer (FIU) |
| Secondary | Offline PAs (PA-P) / POS + QR acquirers | Same, with QR-heavy small merchants | Same |
| Tertiary | Sponsor banks of PAs, large marketplaces | Third-party risk oversight | Bank risk / compliance |

### 3.3 Why now
1. The RBI PA Master Direction (2025, updated Nov 2026) puts the "transactions in line with business profile" duty in writing.
2. The re-diligence deadline for legacy merchants falls within a year of the MD.
3. The 2025 Gaming Act pushes betting money into disguised channels; section 7 pressures payment systems not to process it **[verify]**.
4. RBIH MuleHunter.AI covers mule *accounts* at banks, not the merchant-substance side at PAs.
5. RBI's FREE-AI framework (Aug 2025 committee report) expects explainable, governed AI in regulated entities **[verify]**. That suits an explainable product over a black box.

---

## 4. Market and positioning

**Map (cited in `audit/market-research.md`):**
- Card-scheme transaction-laundering vendors: LegitScript, G2, EverC; Mastercard BRAM/MMP; Visa VIRP. Built around websites and cards, with no India-specific focus found.
- Indian onboarding/KYB: IDfy, Signzy, Cashfree RiskShield, Razorpay Thirdwatch. Strong at onboarding, thin on post-onboarding behaviour vs. declared business.
- AML/graph platforms: Quantexa, Featurespace/Visa, Feedzai, Sardine, Unit21, Hawk AI, Flagright. Generic; the PA must build its own merchant-substance logic.
- Public infrastructure: RBIH MuleHunter.AI, I4C, MeitY blocking. Bank-side and person-level.

**Our position:** *the explainable, UPI-first merchant-substance layer for Indian PAs.* It complements onboarding/KYB vendors and generic AML tools; it does not replace them.

**Defensible advantages, in order:**
1. UPI-native detectors (repeat payers, bonus-tier amounts, match-night intensity, sweep velocity, fan-in/fan-out).
2. Calibrated probabilities with intervals and an RBI-mapped evidence pack (regulators get reasons, not scores).
3. Honest handling of missing data (UNKNOWN), plus value-of-information ("request this feed next").
4. Over time: cross-merchant network data across a PA's portfolio (and across PAs, if a consortium forms).

**What we will not claim:** that we replace KYC/KYB, that we freeze money, or that we catch perfect mimics from transaction data alone.

---

## 5. Product: what the customer gets

| Module | What it does | Built in |
|---|---|---|
| **Ingest** | Daily file drop (CSV/JSON/SFTP) or API; validates, de-duplicates and HMAC-hashes payer data; coverage map | P0, P9 |
| **Portfolio scan** | Scores every merchant nightly against peer baselines; opens cases at a target false-alarm rate (FDR); ranked queue | P3–P4, P9 |
| **Case workspace** | The same 7-layer UI as the demo: ingest → profile → detection → fusion → analyst review → response → audit | P2 |
| **Reasoning trace** | Odds waterfall (prior → each evidence family → posterior with a 90% range); every test with p, effect and CI against peer plots; two competing stories; counterfactuals; value of information | P6 |
| **Response & governance** | Expected-cost recommendation L0–L5; maker/checker; legal gate for L4/L5; hash-chained audit | P4, P7 |
| **Evidence pack** | JSON + PDF mapped to the RBI PA-MD clause and FIU-IND STR fields | P6 |
| **AI summary (optional)** | Claude Haiku drafts the case summary and the merchant clarification email; every number is verified against the trace | P6 |
| **Learning & rules** | Labels update detector statistics; nightly proposals; backtest; human approval; shadow; promote; rollback | P8, P11 |
| **Monitoring** | Drift (PSI/KS), detector firing-rate control charts, emerging-cluster scan, list freshness | P10 |
| **Guided demo** | The current four-scenario demo, kept for sales | exists |

---

## 6. Users, jobs and end-to-end flows

### 6.1 Personas
| Persona | Job | Main screens |
|---|---|---|
| **Risk analyst** | Work the case queue, gather facts, propose a response | Queue, case workspace, trace |
| **Reviewer / team lead** | Approve L3+ responses and second-review labels | Approvals, trace |
| **Legal / compliance** | Approve L4/L5, file STRs, answer regulators | Evidence pack, audit |
| **Risk head (buyer)** | Portfolio exposure, alert volume, accuracy | Portfolio dashboard, monitoring |
| **Model owner (admin)** | Approve rule versions, watch drift | Rules page, backtest reports |
| **Auditor / regulator** (read-only) | Check decisions and controls | Evidence pack, audit verify |

### 6.2 Flow A: nightly portfolio run
`file drop 02:00 → validate + hash → peer baselines refresh → 31 detectors per merchant (+2 network detectors) → Bayesian fusion → FDR cut → queue (with expected false alarms) → drift/displacement checks → morning digest email`

### 6.3 Flow B: one case, open to close
1. Analyst opens the top case and sees the posterior, range, leading mechanism and recommended action.
2. Reads the trace: which evidence moved the odds, the peer plots, what's missing, and which feed is worth requesting.
3. Action L2: the engine drafts a clarification request, and the analyst edits and sends it outside the system. Or requests the missing feed.
4. Merchant replies; the analyst records it and the engine re-runs.
5. Analyst proposes L3, the reviewer approves (maker/checker), and the PA restricts the suspect flow in its own systems.
6. The label is second-reviewed. Detector statistics update. The evidence pack is exported; an STR is filed if required.
7. The case is closed; the audit chain verifies.

### 6.4 Flow C: rules change
`nightly improver → proposal (diff + expected metrics) → backtest (McNemar, ΔCI) → admin approves with a reason → shadow 14 days → promote, or roll back`

### 6.5 Flow D: monitoring alarm
`a detector's firing rate drops > 50% in an MCC, or a new amount cluster appears → alert → model owner investigates → new red-team case or rule proposal`

---

## 7. Data strategy

### 7.1 Sources (by pilot priority)
| Source | Fields | Who provides | Needed for |
|---|---|---|---|
| **Acquiring ledger** (sales, refunds, chargebacks) | id, merchant, amount, time, channel, payer token, payer state, link/terminal, order id | PA (must have) | Families A–D, H, U |
| **Settlements & payouts** | beneficiary account (hashed), amount, time | PA (must have) | F, I, U2, U3 |
| **Merchant KYC profile** | MCC, city, declared category, onboarding date, declared domains/channels | PA (must have) | Priors, K1 |
| Merchant website crawl | link embeds, catalogue | Our crawler or PA vendor (nice to have) | E, G |
| Orders / fulfilment | order status, tracking | Merchant via PA (when requested) | D10, F7 |
| Bank credits | settlement matches | Sponsor bank (rare) | F8 |
| Purchaser verification | contacted / confirmed | PA ops, via SPRT stopping rule | B9 |
| Public / reference | festival calendar, cricket fixtures, MeitY blocked hosts, MCC norms | Us (`rules/`) | Baselines, U5, U6 |
| I4C suspect registry | flagged identifiers | Only if the PA has access | Payer-side signal |

### 7.2 Minimisation and handling
- Hash payer and beneficiary identifiers at the **PA's side** with an HMAC key the PA holds. We never see raw VPAs or account numbers.
- Retain data for 180 days by default (configurable); keep only the dataset hash, not the raw file.
- On-premises or PA-cloud deployment for the pilot (one VM). No data leaves the PA.

### 7.3 Synthetic data (until real data arrives)
- Benchmark generator: 1,000 merchants (~940 genuine across 10 MCCs, ~60 bad across 6 typologies), **with parameters set independently of the rules**.
- Red-team mutations (≥ 500 per release).
- Everything trained or measured on synthetic data is labelled "synthetic-calibrated".

### 7.4 Labels
- Analyst labels (CONFIRMED_ILLICIT needs a second reviewer), merchant clarifications, downstream outcomes (termination, LEA request, STR filed).
- A **random audit sample**: 0.5% of unflagged merchants per month, stratified by MCC. This is the only unbiased source for the base rate and the miss rate.
- Selection-bias correction by inverse-propensity weighting; UNRESOLVED never counts as negative.

---

## 8. The intelligence: statistical and probabilistic engine
*(Full formulas, file names and tests: Appendix A, Part III.)*

**One equation:**
`log-odds(front | evidence) = prior(MCC, city, age) + Σ_family w_f · LLR_f (+ hard overrides)` → posterior probability with a 90% Monte-Carlo interval.

| Component | Method |
|---|---|
| Priors | Hierarchical Beta by MCC × city tier × account age; updated from the random audit sample |
| Detectors (31 + 2 network) | Each is a statistical test against MCC peers: Anderson–Darling (tickets), beta-binomial (rates, with empirical-Bayes shrinkage for small merchants), G-test (geography, adjacency-aware), Kuiper/von Mises (hours), permutation test (pre-match), negative-binomial GLM with festival covariates (volume), ARL-calibrated CUSUM + Bayesian online changepoint, Hawkes/Fano (bursts), hypergeometric (payer overlap), survival/log-rank (lifecycle, sweep speed), Mahalanobis (declared-vs-expected), graph nulls (rings) |
| p → evidence weight | Isotonic-calibrated likelihood ratios per detector; Sellke–Bayarri–Berger bound until labels exist |
| Fusion | Bayesian log-odds; correlation correction within a family; tempered benign evidence (fake-difficulty); UNKNOWN = no change |
| Mechanism | Normalised posterior over laundering / rotation / fabricated / other |
| Governance gate | Open only if the posterior ≥ threshold **and** ≥ 2 independent data provenances contribute |
| Portfolio | Benjamini–Hochberg FDR at 10%; the expected false-alarm count is shown |
| Decision | Cost-matrix expected loss; robust to the lower end of the interval; value-of-information for missing feeds |
| Uncertainty | Credible intervals; conformal prediction sets → abstain to "ask the merchant" with a 90% coverage guarantee |

**Honest limit:** a launderer who perfectly mimics peers on every observable is indistinguishable on transaction data alone. Defences are hard-to-fake evidence (bank, orders, purchaser panel, network) and raising the attacker's cost. We report this limit openly.

### 8.1 The trained ML models (Python)
*(Full detail: Appendix A, Part III-B and phases ML1–ML5.)*

The statistical engine above works from day one with no labels. On top of it we **train real ML models in Python**, save them as versioned model files, and serve them to the product.

| Model | What it is | Trained on | Ships |
|---|---|---|---|
| **M1 Merchant risk classifier** (main model) | LightGBM over ~190 features (detector outputs, peer-relative ratios, distribution shape, velocity, money flow, lifecycle, network, coverage), with monotonic constraints, isotonic calibration, TreeSHAP explanations and a bootstrap-ensemble interval | v0: 5,000-merchant synthetic set + red-team mutations · v1: pilot labels + random audit sample | v0 before the pilot (as a second opinion); v1 during the pilot |
| **M2 Typology classifier** | LightGBM multiclass: betting front / rotation / fabricated / mule fan-out / split-merchant | Same | With M1 |
| **M3 Peer anomaly model** | Isolation Forest + small autoencoder per MCC group | Real **unlabelled** pilot data from day 1 | Pilot week 1 |
| **M6 PU model** | Positive-unlabelled correction around M1 | Pilot | Pilot week 4+ |
| **M4 Sequence model / M5 Graph model** | GRU/Transformer on daily sequences; GraphSAGE on the merchant–payer–beneficiary graph | Pilot labels | **Gated: ≥ 1,000 real labels** |

**Training pipeline:** as-of feature store (no leakage) → time-split + group-by-merchant validation → Optuna tuning on AUC-PR → isotonic calibration → adversarial training with red-team mutations → TreeSHAP → gates → MLflow registry + model card.

**Registration gates:** must beat the Bayesian engine on AUC-PR; recall ≥ 0.80; genuine FP ≤ 3%; ECE ≤ 0.05; robust recall on red-team ≥ 0.70; TS↔Python feature parity 100%; leakage test; fairness ratio ≤ 2×; SHAP stability.

**Serving:** a nightly Python batch scorer writes scores, ranges, typology and SHAP into SQLite; a FastAPI `/score` service handles single uploads (the product falls back to the Bayesian engine if it is down); optional ONNX export to run inside Node.

**How it combines with the statistics:** first as a second opinion in the trace. In the pilot it runs in shadow against the Bayesian engine. It becomes **champion for the probability** only if it wins the statistical backtest. Even then the two-provenance governance gate, the decision theory and the human approvals stay, and its weight inside fusion is capped so it can never open a case alone.

**Retraining:** weekly candidate → monthly shadow, backtest, human approval → live; early retrain on drift (PSI > 0.25) or a performance drop; one-command rollback.

---

## 9. Learning, self-improvement and adversary evolution
*(Appendix A: §7, §10, P8, P10, P11.)*

**Learning:** Beta posteriors for each detector's hit rate on bad merchants and false-alarm rate on genuine ones, per MCC group, pooled hierarchically. Bayesian logistic fusion weights, refit nightly. Platt → isotonic calibration. Per-analyst influence cap (20%), second reviewer, no training on a merchant's own disputes.

**Controlled self-improvement ("RSI" done safely):** the engine *proposes*; people *approve*.
`collect labels → refit → propose challenger rules → backtest (McNemar, bootstrap Δ, DeLong) → named approval → 14-day shadow → promote / rollback`. Every case stores the rules version that decided it. No auto-promotion; this is non-negotiable in a regulated decision.

**Adversary evolution:**
- Red team with 12 mutation operators (nudge amounts, spread hours, split across merchants, blend genuine sales, slow ramp, rotate links, local mules, app-only, bonus amounts, delayed sweeps, timing jitter, peer mimicry), plus a greedy attacker that minimises our posterior. Reports **evasion rate per detector** and **attacker cost-to-evade**.
- Workaround catalogue: every evasion needs a backstop detector, or the build fails.
- Fake-difficulty learned from evasion rates.
- Threshold bands drawn per release (seeded; exact values shown per case).
- Displacement monitoring: firing-rate control charts and an emerging-cluster scan ("fraud moved" alarms).
- Edge-case library: every real false positive or miss becomes a permanent test.
- External lists refreshed on schedule; the build fails if any list is > 90 days old.

---

## 10. Explainability and evidence
Every case has a **reasoning trace**:
1. Data in: what was available, partial or missing.
2. Per detector: expected (and where that came from), observed, test, statistic, p, effect, CI, n, evidence weight, source records.
3. Odds waterfall: prior → each family → posterior with range.
4. Gate and portfolio FDR context.
5. Decision: expected loss of each action, chosen action, and whether it is robust.
6. Two stories: legitimate vs front, link by link.
7. Counterfactuals and value of information: "with the orders feed, the posterior would likely move to 0.4–0.9; requesting it lowers expected loss by ₹42,000".
8. Versions: rules, learning, calibration.

The **AI summary** restates the trace only; a verifier rejects any number or id not in it. The **evidence pack** maps the case to the RBI PA-MD clause and FIU-IND STR fields.

---

## 11. Architecture and platform
| Layer | Choice | Upgrade when |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind (existing), one shared shell for demo and engine, code-split routes | n/a |
| Engine | TypeScript, shared by browser (demo) and server (batch); `frontend/src/stats/` module | Python service only if a needed model has no sane TS implementation |
| API | Existing Node HTTP router (`backend/src/http.ts`), extended | n/a |
| Storage | Built-in `node:sqlite` (Node ≥ 22.5) | Postgres when > 1 writer or > 1 GB |
| Batch | Nightly job on the same VM (cron) | Queue workers at > 100k merchants |
| Rules | Versioned `rules/*.json` in git + `rule_versions` table | n/a |
| LLM (optional) | Claude Haiku 4.5, cached, behind a flag | n/a |
| Deployment | 1 VM in the PA's cloud or on premises (pilot); Docker image | Kubernetes only at multi-tenant SaaS stage |
| Performance target | 10,000 merchants × 90 days in < 10 min on 2 vCPU | Parallelise per MCC group |

Data flow, schema and API list: Appendix A §2, §11, §12.

---

## 12. Security, privacy and regulatory compliance

### 12.1 Security (built in P0 and P7)
- Server-minted case ids only (fixes traversal); input validation; rate limits.
- Auth with roles; maker/checker; legal gate; hash-chained audit with a verify endpoint.
- HMAC payer hashing with a PA-held key; no raw upload stored.
- Secrets from env/secret manager; TLS everywhere; dependency audit in CI.
- A pen-test before the paid launch (external, ~₹1–2 lakh **[est.]**).

### 12.2 Privacy: DPDP Act 2023 (+ DPDP Rules) **[verify current Rules status]**
- We act as the PA's data processor; a Data Processing Agreement is part of the pilot kit.
- Purpose limitation (merchant risk monitoring), minimisation (hashed ids), retention (180 days), deletion on request, breach notification clauses.

### 12.3 Regulatory mapping
| Requirement | Source | How the product supports it |
|---|---|---|
| Ongoing monitoring of merchant transactions vs business profile | RBI PA Master Direction (verified) | Core product; evidence pack cites the clause |
| Merchant due diligence; re-diligence of legacy merchants | RBI PA MD | K1 declared-vs-expected detector; portfolio re-scan report |
| STR filing quality | PMLA / FIU-IND | Evidence pack mapped to STR fields |
| Explainable, governed AI | RBI FREE-AI framework **[verify]** | Trace, model register, approvals, monitoring |
| Cyber incident reporting within 6 hours | CERT-In Directions 2022 **[verify applicability to us as vendor]** | Incident runbook (§18) |
| No processing of money-gaming funds | Online Gaming Act 2025 s.7 **[verify]** | Betting-host list, U-detectors, overrides |

---

## 13. Model governance and risk management
- **Model register:** every rules/learning/calibration version with owner, purpose, data, metrics, limits and approval.
- **Validation:** independent review of each release's backtest report (founder, or a part-time advisor at first).
- **Monitoring:** calibration (ECE), drift (PSI), firing-rate charts, analyst override rate, appeal outcomes.
- **Human oversight:** the engine recommends; humans decide L3+; legal decides L4/L5.
- **Fairness checks:** compare false-positive rates across city tiers, MCCs and account-age bands with intervals. An unexplained gap > 2× triggers a review. Small and rural merchants must not carry the false alarms.
- **Merchant recourse:** every L2+ action comes with a plain-language reason and a channel to respond; responses re-run the engine.

---

## 14. Quality: testing and validation
| Level | What | Gate |
|---|---|---|
| Stats unit | Every routine vs SciPy/R reference fixtures (1e-6) | CI |
| Detector unit | Known-p fixtures per detector | CI |
| Properties | UNKNOWN never moves the posterior; added benign evidence never raises it; monotone in each LLR; order-invariant | CI |
| Simulation | Learned LRs recover the truth; CUSUM ARL₀ ≈ 52 weeks; conformal coverage ≈ 90% | CI (nightly) |
| Adversarial | 27+ cases, 100% | CI |
| Red team | ≥ 500 mutations; evasion and attacker-cost report; workaround backstops | Release |
| Benchmark | Recall ≥ 0.80 (Wilson lower bound ≥ 0.65), genuine FP ≤ 3%, ECE ≤ 0.05 | Release |
| Snapshot | Demo decisions and posteriors | CI |
| Security | Traversal, roles, maker/checker, audit verify | CI |
| UI parity | Saved case = demo layout; survives reload | Release |
| Pilot | Real-data FP rate and precision with CIs (§16) | Go/no-go |

---

## 15. Delivery plan: phases, timeline, team

### 15.1 Phases (detail in Appendix A, Part IV)
| Phase | Scope | Days |
|---|---|---|
| P0 | Safety, validation, privacy | 3 |
| P1 | Rules files, stats module, de-scripting, one engine | 6 |
| P2 | AI Engine looks like the demo | 4 |
| P3 | Statistical detectors + peer baselines | 9 |
| P4 | Bayesian fusion, priors, decision theory | 7 |
| P5 | New detectors (UPI, bursts, changepoint, declared-vs-expected) | 6 |
| P6 | Trace, counterfactuals, VOI, AI summary, evidence pack | 7 |
| P7 | SQLite, auth, maker/checker, audit chain | 5 |
| P8 | Learning: Beta posteriors, logistic fusion, calibration, conformal, bias control | 8 |
| P9 | Portfolio mode, network statistics, FDR queue | 6 |
| P10 | Red team, workarounds, bands, drift/displacement | 7 |
| P11 | Controlled improvement loop | 5 |
| P12 | Benchmark, power analysis, pilot kit, docs, performance | 5 |
| ML1 | Python ML scaffold, synthetic data, feature store + TS parity | 6 |
| ML2 | Train M1 + M2 (LightGBM), tuning, calibration, SHAP, gates, registry, model card | 7 |
| ML3 | Serving: batch scorer, FastAPI, ONNX; ML second opinion + SHAP in the trace | 4 |
| ML4 | M3 anomaly, M6 PU, retraining schedule, drift, champion/challenger | 6 |
| ML5 | M4 sequence + M5 graph (**gated on ≥ 1,000 real labels**) | 10 |
| | **Total** | **101 dev-days** (+10 gated) |

### 15.2 Timeline (3 engineers + 1 founder)
| Weeks | Dev A: stats/engine · Dev B: product/platform · Dev C: ML (Python) | Founder / business |
|---|---|---|
| 1–2 | A: P1 stats module · B: P0, P1 rules, P2 · C: ML synthetic generator (S0) | Shortlist 10 PAs; warm intros; compliance advisor |
| 3–4 | A: P3 · B: P7 · C: ML1 feature store + parity | 5 discovery calls; pilot LOI template; DPA draft |
| 5–6 | A: P4, P5 · B: P6 · C: ML2 train M1/M2 v0 | Demo the trace + ML second opinion to 3 PAs; pick a pilot partner |
| 7–8 | A: P8 · B: P9 (with A) · C: ML3 serving | Pilot LOI signed; data-sharing setup; security questionnaire |
| 9–10 | A: P10 · B: P11, P12 · C: ML4 anomaly, PU, retraining loop | Pilot kickoff; random-audit-sample procedure agreed |
| 11–18 | Pilot: M3 anomaly on real data from wk 11; M1-v1 trained on real labels from ~wk 14; weekly candidates through the loop | Weekly pilot reviews; second pilot pipeline |
| 19–20 | Pilot report with CIs (Bayesian vs M1-v1 backtest); hardening; pen-test | Go/no-go; commercial proposal |
| 21–24 | Production at the pilot PA; ML5 only if ≥ 1,000 labels | First paid contract |

**Milestones** (MS, so they are not confused with model names):
- **MS1** (wk 2): safe + UI parity.
- **MS2** (wk 6): Bayesian engine + trace demo-ready; **M1-v0 trained model registered**.
- **MS3** (wk 10): full engine at D1–D11 green on synthetic data; trained models served nightly and on demand.
- **MS4** (wk 18): pilot results, including the first **real-data trained model (M1-v1)**.
- **MS5** (wk 24): paid.

With only 2 engineers, Dev A takes ML1–ML4 after P10 and engineering runs to about week 13, which pushes the pilot start by about 3 weeks.

### 15.3 Team
| Role | Load | Owns |
|---|---|---|
| Dev A (stats/engine) | full-time | `stats/`, detectors, fusion, learning, red team |
| Dev B (product/platform) | full-time | UI, API, DB, auth, trace UI, evidence pack, deployment |
| Dev C (ML engineer, Python) | full-time | `ml/`: synthetic data, features, training, tuning, calibration, SHAP, registry, serving, retraining |
| Founder (business) | full-time | PA sales, pilot management, pricing, regulatory relationships |
| Compliance advisor | ~4 h/week | RBI/FIU mapping, DPA, evidence-pack review |
| Ex-PA risk analyst (advisor) | ~4 h/week | Workflow validation, cost matrix, label quality |

---

## 16. Pilot plan

| Item | Plan |
|---|---|
| Partner profile | RBI-authorised PA, ≥ 5,000 merchants, UPI-heavy, with a merchant-risk team of ≥ 2 analysts |
| Data | 90 days history + daily drops; ≥ 1,000 genuine merchants and as many confirmed bad as available; hashed at the PA |
| Deployment | One VM in the PA's environment; read-only; no rail actions |
| Mode | **Shadow:** we score; their analysts review our top-N plus the random audit sample; their existing process continues |
| Sample size | ≥ 1,000 genuine merchants to show FP ≤ 3% (if the true rate is 2%); ≥ ~60 confirmed bad to estimate recall ±10 pts (checked numerically) |
| Success criteria | (1) genuine-merchant FP ≤ 3% (95% upper bound); (2) precision of the top-50 queue ≥ 30% (vs their current baseline); (3) ≥ 1 confirmed case their current rules missed; (4) analyst time per case down ≥ 30%; (5) calibration ECE ≤ 0.08 on real labels |
| Cadence | Weekly review; fortnightly model release through the approval loop |
| Exit | Pilot report with CIs → go/no-go → commercial proposal |
| Commercials | Free or low-fee pilot (e.g. ₹1–2 lakh to cover effort) in exchange for a case study and reference |

---

## 17. Go-to-market, pricing and business model

### 17.1 Motion
Founder-led sales to the merchant-risk and compliance heads of PAs, through warm intros (IIMB network, ex-PA operators, sponsor-bank risk teams). Lead with the **RBI clause + evidence pack + reasoning trace**. That is a compliance buy with an efficiency benefit.

### 17.2 Pricing hypotheses (to test in discovery, not yet validated)
| Model | Shape | Note |
|---|---|---|
| **Per active merchant monitored / month** (preferred) | e.g. ₹2–₹10 per merchant-month, tiered by volume | Matches how PAs think about portfolio cost |
| Platform fee + per case | Annual platform fee + per opened case | Predictable, but punishes good precision |
| Pilot | ₹1–2 lakh fixed | Covers effort; signals seriousness |

Validate willingness to pay in ≥ 5 discovery calls before committing.

### 17.3 Expansion
1. More PAs.
2. Sponsor banks overseeing their PAs.
3. Consortium network data across PAs (shared beneficiary/device intelligence, hashed), which is the long-term moat.
4. Adjacent: marketplace seller risk, offline QR acquirers.

---

## 18. Operations and support
- **Runbooks:** nightly-job failure, data-feed gap, drift alarm, model rollback, security incident (6-hour CERT-In reporting path **[verify]**), data-deletion request.
- **Support:** named engineer during the pilot; response within 1 business day; weekly release notes.
- **Observability:** job duration, feed completeness, detector firing rates, queue size, API errors; alerts to email/Slack.
- **Backups:** nightly SQLite backup (encrypted) with a tested restore.
- **Change management:** every rules change goes through §9's loop; code changes through PR review + CI.

---

## 19. KPIs and success criteria
| Category | KPI | Target (pilot) |
|---|---|---|
| Accuracy | Genuine-merchant FP rate (95% UB) | ≤ 3% |
| Accuracy | Top-50 queue precision | ≥ 30% |
| Accuracy | Recall on confirmed bad (with Wilson CI) | ≥ 0.70 |
| Calibration | ECE | ≤ 0.08 |
| Efficiency | Analyst minutes per case | −30% vs baseline |
| Robustness | Red-team attacker cost-to-evade | Rising release on release |
| Coverage | Merchants with ≥ 2 data provenances | ≥ 90% |
| Governance | Rules changes with an approved backtest | 100% |
| Fairness | FP-rate ratio across city tiers | ≤ 2× |
| Business | Pilot → paid conversion | 1 by week 24 |
| Business | Qualified PA pipeline | ≥ 5 by week 12 |

---

## 20. Risk register
| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | No PA shares data | Med | High | DPA + on-prem + hashed-at-source; start with a smaller PA; synthetic benchmark as a demo | Founder |
| R2 | Real FP rate too high | Med | High | Shrinkage, FDR, conformal abstention, cost-based actions; tune in shadow | Dev A |
| R3 | Few confirmed bad cases in the pilot | High | Med | Random audit sample; seeded red-team merchants; longer pilot | Founder |
| R4 | Label selection bias | High | Med | IPW + audit sample + PU correction | Dev A |
| R5 | Fraudsters adapt | High | Med | Red team, bands, displacement alarms, network evidence | Dev A |
| R6 | Security incident | Low | High | P0/P7 fixes, pen-test, on-prem, minimal data | Dev B |
| R7 | Regulatory change | Med | Med | Rules-as-data; advisor; evidence-pack mapping updates | Advisor |
| R8 | Incumbent (KYB vendor or PA in-house) builds it | Med | Med | Speed, UPI-native depth, explainability, consortium data | Founder |
| R9 | Statistical bugs | Med | High | Reference fixtures, property and simulation tests | Dev A |
| R10 | Over-scoping | High | Med | Phase gates; out-of-scope list; ponytail rules | All |
| R11 | Unfair impact on small/rural merchants | Med | High | Fairness KPI, recourse, shrinkage | Dev A + Advisor |

---

## 21. Budget (first 6 months, est.)
| Item | Cost |
|---|---|
| Infrastructure (VM, storage, backups) | ₹0–₹6,000 total |
| LLM summaries (optional, cached) | < ₹5,000 total |
| Pen-test before the paid launch | ₹1–2 lakh |
| Compliance advisor (part-time) | ₹30–60k/month **[est.]** |
| Legal (DPA, pilot and contract templates) | ₹50k–1 lakh |
| Engineering salaries/stipends | Founder decision |
| **Non-salary total** | **≈ ₹4–6 lakh** |

---

## 22. Decisions needed from the founders
1. **Positioning:** "explainable UPI-first merchant-substance layer for PAs". Agree?
2. **First pilot target:** which 3 PAs do we approach first, and through whom?
3. **Cost matrix values** for decision theory (cost of a miss vs a false alarm), set with an ex-PA risk advisor.
4. **Pricing hypothesis** to test (per merchant-month vs platform + case).
5. **Team:** who is Dev A (stats) and who is Dev B (platform)? Do we need a hire?
6. **"RSI" scope:** confirm *controlled* self-improvement (propose → approve) rather than autonomous rewriting.
7. **LLM summary:** ship it in the pilot, or keep it off until trust is established?
8. **Python prototype:** archive it (recommended)?
9. **Open source or closed:** the demo can stay public; should the engine and rules stay private?

---

## 23. Appendices
- **A. Engineering implementation plan:** `audit/IMPLEMENTATION_PLAN.md`. File-level tasks, formulas, schemas, API, tests and exit criteria for P0–P12 and ML1–ML5.
- **B. Audit report:** `audit/REPORT.md`. What was run, the 27 adversarial cases, security findings, failure modes and market gaps.
- **C. Market research (cited):** `audit/market-research.md`.
- **D. Hardcoded-output scan:** `audit/hardcoding-scan.md`.
- **E. Rationale notes:** `audit/PLAN.md`. **Superseded** by this document and Appendix A; kept only for the reasoning history. Where they differ, this document wins.
- **F. Reproduce:** `npx tsx audit/adversarial.ts`; `npx tsx audit/security-probe.ts`; `npm run selftest && npm run check:api && npm run test:dataset && npm run build`.

---

## 24. What this plan does NOT yet cover (open gaps)

This plan is complete **as an engineering and pilot plan**. It is not final: three kinds of things are still open.

### 24.1 Assumptions only customers can confirm
None of these have been checked with a payment aggregator yet. Each one could change the plan.
| Assumption | How to close it | Changes if wrong |
|---|---|---|
| PAs feel this pain enough to buy (not just "nice to have") | 5–10 discovery calls with merchant-risk heads | Positioning, maybe the whole product |
| PAs will share payer-level (hashed) transaction data for a pilot | Ask for it explicitly in discovery; offer on-prem + hashing at source | Data strategy (§7); possibly aggregate-only features |
| The data fields we assume exist (payer state, link id, order id, beneficiary) are actually in PA exports | Get one real export schema (even with dummy values) | Detector list; several detectors may become UNKNOWN |
| Price per merchant-month is acceptable | Pricing questions in discovery | §17 |
| Analysts will actually read a reasoning trace | Show the trace mock to 3 analysts | §10 UI design |

### 24.2 Topics not yet designed
| Gap | Why it matters | Proposed owner / when |
|---|---|---|
| **Accessibility** (WCAG 2.2 AA: keyboard use, screen readers, contrast, charts with text alternatives) | Analysts use this tool all day; also a procurement checkbox | Dev B, in P2 and P6 |
| **Language** (Hindi + regional labels for merchant-facing clarification messages) | Small merchants in tier-2/3 cities | Founder + Dev B, before the pilot |
| **STR filing integration** (FIU-IND's FINnet 2.0 format) | The evidence pack maps fields, but doesn't produce a file FIU-IND accepts | Advisor + Dev B, during the pilot |
| **Analyst SOPs and training** (how to work a case, what to ask merchants, when to escalate) | Without them, label quality is poor and learning suffers | Ex-PA advisor, before the pilot |
| **Disaster recovery and SLAs** (backup restore target, uptime, support hours) | Asked in every security questionnaire | Dev B, in P12 |
| **Independent model validation** (someone not on the team reviews the models) | Expected for AI in regulated entities | Advisor or external, before the paid launch |
| **UPI / NPCI field specifics** (PSP handle formats, collect vs intent vs QR flags) | The UPI-native detectors depend on them | Dev A, once a real schema arrives |
| **KYB vendor integration** (pulling IDfy/Signzy onboarding data in as features) | Better priors, and a partnership channel | After the pilot |
| **Cross-PA consortium** (legal basis, governance, hashing scheme) | The long-term moat | After 2 paying PAs |
| **Company, IP and funding** (entity, founder agreements, IP assignment, fundraising plan) | Needed before hiring Dev C or signing a pilot | Founders, now |

### 24.3 Claims still to verify
Every item marked **[verify]** in this document: Gaming Act enforcement status, RBI FREE-AI framework, DPDP Rules status, CERT-In applicability, and the cost estimates. All plan numbers (performance targets, pricing, costs) are **targets or estimates, not measurements**.

### 24.4 What would make this plan "final"
1. Five discovery calls are done and §24.1 is answered.
2. One real PA export schema has been received and the detector list checked against it.
3. The founders have answered §22.
4. The §24.2 items have an owner and a date.
5. The [verify] items have been checked against primary sources.

After that, this document becomes v2.0 and the build starts at P0 + ML1.
