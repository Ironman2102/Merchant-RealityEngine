# Merchant Reality Engine: Final Implementation Plan (v2)

**Repo:** `dhruv11bhandari/Merchant-RealityEngine` · baseline `1d1d9a8` · 19 Nov 2026
**Supersedes:** the earlier plan in this file and `audit/PLAN.md` (kept for rationale).
**Inputs:** `audit/REPORT.md` (27 adversarial cases, security probe), `audit/market-research.md`, `audit/hardcoding-scan.md`.

---

## Part I: What we are building

### 1. Product in one sentence
An explainable, statistically grounded **merchant-substance engine for Indian payment aggregators**. For every merchant it answers *"what is the probability this merchant is not the business it claims to be, how sure are we, why, and what should we do?"*, with proof an RBI/FIU-IND reviewer can follow.

### 2. Why it wins (and what stops it being surface-level)
| Surface-level version (today) | This plan |
|---|---|
| 20 if/else rules with fixed cut-offs | 31 detectors (plus 2 portfolio-network detectors) that each run a **proper statistical test against the merchant's peer group**, giving a p-value, an effect size and a likelihood ratio |
| Hand-set weights, a "two families" gate | **Bayesian evidence fusion**: prior base rate × likelihood ratios → **posterior probability with a credible interval** |
| "HIGH / MEDIUM / LOW" | **Expected-cost decision**: the response level that minimises expected loss, shown with the numbers |
| Display-only learning | Detector **sensitivity and false-positive rate learned as Beta posteriors** from labels, de-biased with a random audit sample |
| Single merchant, self-declared baseline | Portfolio peer baselines with **empirical-Bayes shrinkage**, plus a network graph across merchants |
| No accuracy numbers | Calibrated probabilities (**Brier, ECE, reliability diagram**), precision/recall with **Wilson intervals**, champion/challenger with **McNemar tests** |
| Static | Red-team mutation search, threshold bands, **drift and displacement control charts**, an approved improvement loop |
| Demo-only UI for uploads | Saved cases use the same 7-layer UI as the demo, plus a full reasoning trace |

### 3. Definition of done (all must pass)
| # | Check | Command |
|---|---|---|
| D1 | Unit + integration tests green | `npm test` |
| D2 | Statistical test suite: every stats routine matches reference values (R/SciPy-generated fixtures) within 1e-6 | `npm run test:stats` |
| D3 | Adversarial suite 100% (incl. the 5 known weaknesses W1–W5) | `npm run adversarial` |
| D4 | Security + governance probes all blocked | `npm run security` |
| D5 | Benchmark: recall ≥ 0.80 (Wilson lower bound ≥ 0.65), genuine FP rate ≤ 3%, **ECE ≤ 0.05** | `npm run benchmark` |
| D6 | Red team ≥ 500 mutations; per-detector evasion rates reported; no evasion without a backstop | `npm run redteam` |
| D7 | Saved case at `/ai-engine/cases/:id` renders the same 7-layer views as `/demo` and survives reload | `npm run ui:parity` + manual |
| D8 | Every number in a case summary traces to a record id, a rules entry or a formula | `npm run trace:check` |
| D9 | A label updates detector posteriors used on the next run; no rules version ships without a backtest report and an approver | `npm run selfcheck:learning` |
| D10 | No scenario-scripted output (`scenario.id ===` / `sc.id ===`) | `npm run lint:noscript` |
| D11 | Trained model M1 registered with every §10B.5 gate passing; served nightly and on demand; SHAP shown in the trace | `pytest ml/tests && python -m ml.eval.gates --model m1` |

---

## Part II: Fixed decisions

| Topic | Decision | Upgrade path |
|---|---|---|
| Engine | TypeScript only; `prototype/` → `archive/` | n/a |
| Rules | Versioned `rules/*.json`, every threshold has `{value, band}` | n/a |
| Stats code | Own module `frontend/src/stats/` (shared by browser and server). Hand-written: Wilson, BH-FDR, bootstrap, permutation, isotonic, logistic, beta-binomial EB, CUSUM/ARL simulation, conformal. **One dependency** for special functions: `@stdlib/math-base-special-gammainc`, `-betainc`, `-erf` (or equivalent stdlib packages). Hand-rolled incomplete gamma/beta are a classic source of silent bugs | Python stats service only if a model truly needs it |
| Storage | Built-in `node:sqlite` (Node ≥ 22.5; repo runs Node 26) → `backend/data/mre.db` | Postgres free tier when > 1 writer or > 1 GB |
| Decision source | Detectors → Bayesian fusion → decision theory. **The LLM never decides** | n/a |
| LLM | Claude Haiku 4.5 (`claude-haiku-4-5`), optional, cached, output verified against the trace | n/a |
| Auth | Local users, scrypt, signed cookie; roles analyst / reviewer / legal / admin | Pilot PA's OIDC SSO |
| Runtime | Daily batch per portfolio on 1 VM; API disabled on Vercel until auth ships | Streaming only on customer demand |

---

## Part III: The statistical and probabilistic core

This is the heart of the product. Every formula below has a file, a test fixture and a place in the trace UI.

### 4. Probability model (the whole engine in one equation)

For merchant *m* with evidence *E = {e₁…e_k}* and hypothesis *H₁* = "not the declared business" (with mechanism *μ* ∈ {laundering, rotation, fabricated, other}):

```
log-odds(H₁ | E) = log-odds prior(MCC, city tier, account age)
                 + Σ_families  w_f · LLR_f          (family-level, correlation-corrected)
                 + Σ_overrides  hard rules            (only push up, logged)

LLR_f  = log [ P(evidence in family f | H₁) / P(evidence in family f | H₀) ]
P(H₁ | E) = σ(log-odds)          σ = logistic function
```

- **UNKNOWN = LLR 0.** Missing data leaves the odds unchanged. This is the existing principle, now made exact.
- **Correlation correction:** detectors in the same family share data, so within a family we do not add LLRs naively. We use `LLR_f = max_i LLR_i + ρ_f · Σ_{others} LLR_j`, with ρ_f ∈ [0, 1] estimated from the red-team and benchmark co-firing correlation (ρ = 0 → keep only the strongest, today's "collapse" rule). Across families we assume conditional independence and **test that assumption** (§8.4).
- **Fake-difficulty as tempered likelihood:** for benign evidence, `LLR_benign · τ`, where τ = fakeDifficulty ∈ [0.2, 1]. Evidence that is easy to fake moves the odds less. τ is learned from red-team evasion rates (§10.3).
- **Mechanism posterior:** `P(μ | E, H₁) ∝ π_μ · Π exp(LLR_i · affinity_iμ)`. This replaces today's `1 − exp(−0.5·Σ)` heuristic with a normalised distribution over the four mechanisms.
- **Credible interval:** detector LRs come from Beta posteriors (§7). We draw 2,000 Monte-Carlo samples of every LR and report **P(H₁|E) median with a 90% interval**. The UI shows e.g. "0.81 (0.68–0.90)".
- **Governance gate kept:** a case can only be *opened* if P(H₁|E) ≥ threshold **and** ≥ 2 independent provenances contribute ≥ 0.5 nats each. This is a deliberate non-statistical guard so a single data source can never condemn a merchant.

**File:** `frontend/src/engines/bayesFusion.ts` (replaces `evidenceFusion.ts`; the old one is kept as `legacyFusion.ts` for the comparison report in P5).

### 5. Priors (base rates)
- **Prior π(MCC, city tier, age band)** from a hierarchical Beta model. Start with expert priors in `rules/priors.json` (e.g. bakery 0.5%, gift/novelty 1.5%, electronics 2%, new account < 90 days ×2), each written as Beta(α, β) with a stated "worth N merchants" strength.
- **Update** with the **random audit sample** (§7.4), which is the only unbiased source of the base rate.
- Showing the prior in the trace matters: a 90% "suspicious-looking" pattern in a 0.5% base-rate category still gives a moderate posterior. This is Bayes' rule protecting honest merchants.

### 6. Detector statistics (every detector becomes a real test)
Each detector returns `{ statistic, pValue, effectSize, ci90, n, llr, status }`. `status` (ILLICIT / BENIGN / UNKNOWN) is derived from the LLR for the UI; scoring uses the LLR itself.

**Turning a p-value into an LLR:** calibrated per detector with **isotonic regression** on labelled + benchmark data: `LLR = log(f₁(p) / f₀(p))`, where f₀ ≈ Uniform under H₀ and f₁ is learned. Before enough labels exist, use the **Sellke–Bayarri–Berger bound** `LR ≤ 1/(−e·p·ln p)` as a conservative cap.

**Small merchants: empirical-Bayes shrinkage.** All rate statistics (round share, refund rate, off-hours share, out-of-area share) use a **beta-binomial** model fitted across the MCC peer group: `ratê_m = (x_m + α_peer) / (n_m + α_peer + β_peer)`. A shop with 20 sales and 4 round amounts is pulled towards the peer mean instead of flagging. Tests use the **beta-binomial tail** (it handles overdispersion), not the plain binomial.

| Id | Detector | Statistical method (replaces the fixed cut-off) |
|---|---|---|
| A1 | Ticket distribution vs peers | **Anderson–Darling k-sample test** of log-amounts vs pooled MCC peers; effect = Wasserstein-1 distance (₹); CI via bootstrap |
| A4 | Round-number heaping | **Beta-binomial upper-tail test** of the share at round values vs the peer rate; plus a **χ² last-digit uniformity** test on the rupee units digit (heaping shows up as excess 0s) |
| A5 (new) | Amount clustering | **Kernel density mode test** (Silverman bandwidth): multimodality at deposit amounts that the catalogue doesn't explain |
| B6 | Payer geography | **G-test** of the payer-state multinomial vs the peer distribution, with **adjacent states merged** (`rules/states.json`); effect = Jensen–Shannon divergence |
| B9 | Purchaser verification | **Beta posterior** on the confirmation rate; **SPRT** (Wald) tells the analyst when to stop contacting purchasers: H₀ rate ≥ 0.8 vs H₁ ≤ 0.5, α = β = 0.05, typically 8–15 calls instead of a fixed 12 |
| C2 | Hours profile | **Circular statistics**: von Mises fit of transaction hour vs the MCC profile; **Kuiper test** (a KS test for circular data) |
| C5 | Pre-match funding | **Permutation test**: shuffle match dates over non-match days 10,000×, giving an exact p for the in-window share; effect = Poisson **rate ratio** with an exact CI |
| C6 (new) | Burstiness | **Fano factor** / **Hawkes self-excitation** branching ratio of inter-arrival times; betting deposits cluster in bursts, bakery sales don't |
| D7 | Orphan refunds | Beta-binomial tail vs peer orphan-refund rate |
| D9 | Refunds to a different destination | Beta-binomial tail, with same-holder destinations excluded |
| D10 | Payment-to-order match | Beta posterior on the match rate vs peers |
| E3 | Cohort continuity | Payer-overlap significance with a **hypergeometric test** (overlap *k* between payer sets of sizes *n₁*, *n₂* drawn from *N* portfolio payers); time-gap via the empirical hand-off distribution |
| F2 | Account lifecycle | **Survival model** (Kaplan–Meier by MCC) for "new account starts within *t* days of a dormant similar account": how surprising is this gap |
| F5 | Beneficiary changes | **Poisson rate test** of changes per year vs peers; an extra LLR if a change is within 30 days of a changepoint (H1) |
| F8 | Bank reconciliation | Beta posterior on the matched share |
| G2 | Catalogue consistency | Share of payments at a catalogue price, **binomial vs a uniform-price null** |
| G6 / U6 | Link on betting host | Deterministic; LLR set by the analyst-validated precision of the host list |
| H1 | Volume vs expectation | **Negative-binomial GLM** per MCC: `log E[V_t] = β₀ + seasonal(week) + Σ festival_j + trend`, festival covariates from `rules/calendar.json`; residual = Pearson residual; **95% prediction interval** shown on the chart |
| H2 (new) | Changepoint | **CUSUM with ARL-calibrated (k, h)**: chosen by simulation so the in-control ARL₀ is 52 weeks (one false alarm per merchant-year); plus **Bayesian online changepoint detection** (Adams–MacKay) giving P(changepoint in last 4 weeks) |
| H3 | Joint off-profile cluster | **Fisher's method / Cauchy combination** of the per-transaction trait p-values. Cauchy combination is valid under dependence, so correlated traits don't over-count |
| I2 | Payout fan-out | **Gini coefficient** of payout destinations + **Shannon entropy**, vs peers via a permutation test |
| K1 (new) | Declared vs expected profile | **Mahalanobis distance** of the declared profile vector from the MCC distribution, with a χ² p-value |
| U1 (new) | Payer recurrence | Fit a **negative binomial** to payments-per-payer-per-week; test the excess of heavy repeaters vs peers (likelihood-ratio test) |
| U2 (new) | Fan-in / fan-out | Ratio of distinct payers to onward beneficiaries; **log-ratio z vs peers** |
| U3 (new) | Settlement-sweep velocity | **Survival curve** of time from settlement to onward transfer; **log-rank test** vs peers |
| U4 (new) | Bonus-tier amounts | Beta-binomial tail on the share at `rules/amounts.json` values |
| U5 (new) | Match-night intensity | **Poisson rate ratio** for the 3 h around every fixture vs the same hours on non-match days (exact conditional test) |
| U7 (new) | New PSP-handle surge | **Two-proportion test** (Newcombe CI) for the share of first-seen handles vs portfolio |
| N4/N5 (new, portfolio) | Shared-beneficiary rings; cross-merchant splitting | **Graph statistics**: shared-neighbour hypergeometric p; Louvain communities; a **configuration-model null** for "this many shared beneficiaries by chance" |

**Multiple testing.** One merchant runs ~31 tests, and a portfolio of 10,000 merchants runs ~310,000. Two controls:
1. **Within a merchant:** Bayesian fusion handles it, because LLRs near zero don't move the odds. For any *displayed* "significant" flag we also show the **Holm-adjusted** p.
2. **Across the portfolio:** open cases by **Benjamini–Hochberg FDR at q = 10%** on the posterior-derived p-values, or equivalently rank by posterior and cut at the **expected false discovery count**. The dashboard shows "Opening these 23 cases; expected false alarms ≈ 2.1".

### 7. Learning (probabilistic, not nudges)
#### 7.1 Detector performance as Beta posteriors
Per detector *i* and MCC group *g*:
- Sensitivity `s_ig = P(fires | H₁) ~ Beta(a₁ + TP, b₁ + FN)`
- False-positive rate `f_ig = P(fires | H₀) ~ Beta(a₀ + FP, b₀ + TN)`
- Then `LR⁺ = s/f`, `LR⁻ = (1−s)/(1−f)`. These feed §4 directly and replace today's `reliability ± 0.06`.
- **Hierarchical pooling** across MCC groups (partial pooling): small groups borrow strength from the global estimate.

#### 7.2 Fusion weights
**Bayesian logistic regression** over the family LLRs (Laplace approximation; prior N(1, 0.5²) on each weight, so the starting point is "trust the LLR"). Posterior weight means and SDs are shown in the trace. Fit nightly. ~40 features, which runs in seconds.

#### 7.3 Calibration
- **Isotonic** (≥ 200 labels) or **Platt** scaling (fewer labels) on the final posterior.
- Report **Brier score**, **ECE (10 bins)** and a **reliability diagram** on every release.
- **Conformal prediction** (split conformal, 90% coverage): each merchant gets a prediction *set* ⊂ {legit, illicit}. If the set is {legit, illicit}, the engine **abstains** → "UNRESOLVED: request clarification". That gives the existing L2 "ask the merchant" step a coverage guarantee.

#### 7.4 Label bias (the trap most fraud systems fall into)
Labels only exist for merchants we investigated, so learning from them alone inflates sensitivity and hides false negatives.
- **Random audit sample:** each month, review a stratified random **0.5% of merchants who were not flagged** (stratified by MCC). This gives an unbiased estimate of the base rate and the miss rate.
- **Inverse-propensity weighting:** each labelled case is weighted by 1/P(selected for review), with P from the decision log.
- **Unresolved** is never used as a negative (positive-unlabelled learning; Elkan–Noto correction for the unlabelled mass).
- **Label noise:** require a second reviewer for CONFIRMED_ILLICIT; Cohen's κ between reviewers is tracked on the dashboard.

#### 7.5 Poisoning resistance
- Per-analyst cap: no analyst contributes > 20% of any detector's counts.
- Labels are down-weighted for a merchant's own disputes.
- Beta posteriors have floors: s ≥ 0.05 and f ≥ 0.005, so no LR goes infinite.

### 8. Evaluation and statistical quality control
#### 8.1 Benchmark metrics
Precision, recall, FP rate and F₂ (recall-weighted), each with a **Wilson 95% interval**; per-typology recall; **AUC-PR** with a bootstrap CI; calibration (Brier, ECE).
Be honest about sample size: with 30 bad merchants, recall 0.80 has a Wilson CI of about 0.63–0.90. The report prints that interval and never the point estimate alone.

#### 8.2 Pilot sample size (power analysis)
- To show genuine-merchant FP ≤ 3% with a 95% upper bound, at a true rate of 2%: n ≈ **1,000 genuine merchants** (exact binomial).
- To estimate recall ±10 points: **≈ 60 confirmed bad merchants**, i.e. the pilot needs a PA portfolio big enough to contain them, or seeded red-team merchants.
- `scripts/power.ts` prints these numbers for any target.

#### 8.3 Champion vs challenger
Both rule versions score the same merchants. Use **McNemar's exact test** on discordant decisions, a **bootstrap CI on the recall and FP-rate differences**, and the **DeLong test** on AUC. Promote only if the challenger is non-inferior on FP (margin 0.5 pt) **and** better or non-inferior on recall.

#### 8.4 Model-assumption checks (run on every release)
- **Conditional independence across families:** χ² test of co-firing among genuine benchmark merchants. If two families are correlated (|φ| > 0.3), raise their ρ or merge them.
- **LR calibration per detector:** observed vs predicted firing rates in decile bins.
- **Prior sanity:** posterior predictive check. The simulated number of opened cases per month should match what was actually opened.

#### 8.5 Drift and displacement monitoring
- **Feature drift:** Population Stability Index (PSI > 0.25 = alarm) and KS tests on every detector's input distribution, weekly.
- **Detector firing rates:** **Poisson / u-charts** per detector per MCC. An unexpected *drop* (fraud moved) or rise (data broke) triggers an alarm.
- **New clusters:** a weekly **scan statistic** (Kulldorff-style) over (amount bucket × hour × PSP handle) finds emerging concentrations, e.g. a sudden ₹199 wave.

### 9. Decision theory (what to do, not just how likely)
- **Cost matrix** `rules/costs.json` (set with the PA's risk team):

| Action \ Truth | Legit | Illicit |
|---|---|---|
| L0 watch | 0 | C_miss (regulatory fine + losses, e.g. ₹5,00,000) |
| L2 ask clarification | C_ask (analyst 30 min + merchant friction, ₹1,500) | 0.6·C_miss |
| L3 restrict one flow | C_restrict (₹15,000 lost revenue + churn risk) | 0.2·C_miss |
| L5 terminate | C_terminate (₹2,00,000) | 0.05·C_miss |

- Choose `a* = argmin_a Σ_truth C(a, truth)·P(truth | E)`, using the posterior **interval**, not just the median. The chosen action must be optimal at the lower bound too; otherwise step down one level ("robust Bayes").
- **Value of information:** for each missing feed (orders, bank, purchaser panel), compute the expected reduction in loss if it were obtained (pre-posterior analysis using the detector's LR distribution). The trace says "Requesting the orders feed lowers expected loss by ₹42,000. Do this before restricting." That turns UNKNOWN into a concrete next step.
- L4/L5 still require human legal approval; decision theory recommends, people decide.

### 10. Adversarial statistics
#### 10.1 Red-team search
`scripts/redteam.ts` mutation operators: `nudgeRound`, `spreadHours`, `splitAcrossMerchants(k)`, `blendGenuine(p)`, `slowRamp(w)`, `rotateLinks`, `localMules`, `appOnly`, `bonusAmounts`, `delaySweep`, `jitterTiming`, `mimicPeer` (resample amounts and hours from the peer distribution while keeping the illicit volume). Run random search plus **greedy hill-climbing on the posterior** (the attacker minimises P(H₁|E) under a "cost to the attacker" budget). Report:
- **Evasion rate per detector** = share of mutations that silence it.
- **Attacker cost to evade** = minimum budget at which the posterior drops below threshold (e.g. "must blend ≥ 60% genuine sales and split across 4 merchants"). This is the real robustness metric.

#### 10.2 Workaround catalogue
`rules/workarounds.json`: for each detector, the cheapest evasion and its backstops. A test fails if any evasion found by the red team has no backstop detector with LLR > 0.5 nats.

#### 10.3 Fake-difficulty learned
τ_i = 1 − evasion rate_i, smoothed with a Beta prior, recomputed every release.

#### 10.4 Threshold bands
Every decision threshold is drawn per release, from a seeded RNG, inside its band. The seed is stored in the rules version. Attackers can't learn a fixed cut-off; reviewers see the exact value used.

#### 10.5 Mimicry ceiling (stated openly)
A launderer who perfectly mimics the peer distribution on *every* observable is statistically indistinguishable. The defence is **hard-to-fake evidence** (bank, orders, purchaser panel, network) and **attacker cost**. The product reports this ceiling rather than hiding it.

---

## Part III-B: Trained machine-learning models (Python)

The statistical engine in Part III is interpretable and works from day one with no labels. On top of it we **train real ML models in Python**, produce **versioned model files**, and serve them to the TypeScript product. The two work together as champion and challenger: the ML model becomes the champion only when it beats the Bayesian engine in a statistical backtest (§8.3).

### 10B.1 The models we train
| Id | Model | Learns | Algorithm | Training data | Needs labels? | When |
|---|---|---|---|---|---|---|
| **M1** | **Merchant risk classifier** (the main trained model) | P(front \| merchant-month features) | **LightGBM** gradient-boosted trees, monotonic constraints on evidence features, class weights; calibrated (isotonic) | Synthetic benchmark + red-team mutations (v0); pilot labels + random audit sample (v1+) | Yes | v0 at ML2, v1 in pilot |
| **M2** | **Typology classifier** | Which mechanism: betting front / rotation / fabricated / mule fan-out / split-merchant / other | LightGBM multiclass | Same, bad merchants only | Yes | ML2 |
| **M3** | **Peer anomaly model** | How unusual a merchant-week is vs its MCC peers | **Isolation Forest** per MCC group, plus a small **autoencoder** (PyTorch, 3 layers) on peer-normalised features; reconstruction error → percentile | Real **unlabelled** pilot data from day 1 (no labels needed) | No | ML3 |
| **M4** | **Sequence model** | Daily transaction-sequence patterns (deposit bursts, ramp-ups, sweep rhythm) | **GRU / small Transformer** over 90-day daily feature sequences per merchant | Pilot data; only when ≥ 1,000 labelled merchants | Yes | ML5 (gated) |
| **M5** | **Graph model** | Rings: merchants linked through payers, beneficiaries, devices and links | **GraphSAGE** (PyTorch Geometric) on the merchant–payer–beneficiary graph; node classification + link prediction | Portfolio graph + labels | Yes | ML5 (gated) |
| **M6** | **PU model** (positive-unlabelled) | Risk when only confirmed-bad labels exist and the rest are unlabelled | Elkan–Noto wrapper around M1 | Pilot | Partial | ML4 |

M1 (with M2, M3 and M6) is the core trained model and ships in the pilot. M4 and M5 are gated: they start only after the pilot has produced enough labels. Without that, deep models just memorise noise.

### 10B.2 Features (the feature store)
Built per **merchant × month** (and merchant × week for M3/M4) with **strict as-of cutoffs**: no feature may use data after the label date.

| Group | ~Count | Examples |
|---|---|---|
| Detector outputs | 62 | For each of the 31 detectors: statistic, LLR (p-values excluded, they duplicate LLR) |
| Peer-relative ratios | 40 | Ticket median / peer median, round share z, out-of-area share z, night share z, refund rate z, payer recurrence z |
| Distribution shape | 25 | Amount quantiles (p10…p99), entropy of amounts, hour entropy, Gini of payers, last-digit χ² |
| Velocity & dynamics | 20 | Volume growth 1/4/12 wk, NB-GLM residuals, CUSUM S, BOCPD P(change), Fano factor, Hawkes branching ratio |
| Money flow | 15 | Settlement-to-sweep median hours, fan-in/fan-out ratio, payout entropy, beneficiary changes |
| Lifecycle | 8 | Account age, days since KYC update, dormancy gaps, peer hand-off gap |
| Network (portfolio) | 12 | Shared-beneficiary degree, payer-overlap max Jaccard, community size, PageRank, neighbours' max risk (lagged one period to prevent leakage) |
| Coverage | 8 | Which feeds are present (missingness is informative and must be modelled explicitly) |
| **Total** | **~190** | |

**Not allowed as features:** anything produced by analysts (notes, actions, labels), the merchant's free-text declarations, raw identifiers, and any feature computed after the label timestamp.
Files: `ml/features/build.py` reads the same SQLite tables and `rules/` as the TS engine and writes `ml/data/features_<asof>.parquet`. **A parity test** checks that the detector outputs Python sees match what TypeScript computed, so the two can never drift apart.

### 10B.3 Training data plan
| Stage | Data | Labels | Model version |
|---|---|---|---|
| S0 (now) | `prototype/generate_data.py` extended into `ml/synth/` (reuses its calendar and merchant logic): 5,000 merchants × 120 days, 10 MCCs, 6 bad typologies at a 3% rate, parameters independent of `rules/` | Generator ground truth | **M1-v0 "synthetic-calibrated"**, demo only |
| S1 | S0 + red-team mutations (≥ 5,000 hard negatives/positives from §10.1) | Ground truth | M1-v0.1 (adversarially trained) |
| S2 (pilot wk 1+) | Pilot portfolio, unlabelled | None | **M3** anomaly (real data) |
| S3 (pilot wk 4+) | Pilot + analyst labels (second-reviewed) + random audit sample | Real, with IPW weights | **M1-v1** (real) + M6 PU |
| S4 (≥ 1,000 labels) | All of the above, ≥ 6 months | Real | M4, M5 candidates |

Real data always outranks synthetic: from S3 on, synthetic rows are kept only as down-weighted augmentation (weight 0.2) and red-team rows, never alone.

### 10B.4 Training procedure (M1)
1. **Split by time and by merchant:** train on months 1…t−2, validate on t−1, test on t. **GroupKFold by merchant** inside train, so no merchant appears in both train and test (prevents leakage through memorising merchants).
2. **Class imbalance:** fraud base rate ~1–3%. Use `scale_pos_weight` + IPW sample weights (§7.4); evaluate with **AUC-PR**, never accuracy.
3. **Monotonic constraints:** an illicit-direction LLR can only raise the risk; benign evidence can only lower it. This keeps the model explainable and blocks absurd behaviour.
4. **Hyperparameters:** **Optuna**, 100 trials, objective = AUC-PR on the time-split validation set; search num_leaves, min_data_in_leaf, feature_fraction, lambda_l1/l2, learning_rate, n_estimators (early stopping).
5. **Calibration:** isotonic on the validation month; check Brier and ECE.
6. **Adversarial training:** red-team mutations of training-set bad merchants are added as positives (S1). Report **robust recall** = recall on held-out mutated bad merchants.
7. **Explainability:** **TreeSHAP** values per merchant; the top 10 contributions go into the trace next to the Bayesian odds waterfall. Global SHAP summary in the model card.
8. **Uncertainty:** 20-model bootstrap ensemble → prediction interval; split-conformal sets on top (§7.3).
9. **Fairness check:** FP rate by city tier, MCC and account-age band with Wilson CIs; a gap > 2× blocks registration.

### 10B.5 Evaluation gates (a model can only be registered if all pass)
| Gate | Threshold |
|---|---|
| AUC-PR on the time-split test month | ≥ Bayesian engine's AUC-PR (DeLong / bootstrap CI not entirely below 0) |
| Recall at the operating point | ≥ 0.80 with Wilson lower bound ≥ 0.65 (synthetic); pilot target in §16 of the master plan |
| Genuine-merchant FP rate | ≤ 3% (95% upper bound) |
| Calibration | ECE ≤ 0.05 (synthetic) / ≤ 0.08 (real) |
| Robust recall (red-team held-out) | ≥ 0.70 |
| Feature parity TS ↔ Python | 100% of detector features equal within 1e-9 |
| Leakage test | Shuffling the label dates must collapse AUC to ~0.5 |
| Fairness | FP-rate ratio across segments ≤ 2× |
| Stability | Top-20 SHAP features overlap ≥ 70% with the previous version (otherwise a manual review is required) |

### 10B.6 Model registry, artifacts and versioning
- **MLflow** (local file backend, free) tracks every run: data snapshot hash, feature list, params, metrics, plots and the model file.
- **Artifacts:** `ml/models/m1/<version>/model.txt` (LightGBM native) + `model.onnx` + `calibrator.json` + `features.json` + `model_card.md`.
- **Data versioning:** each feature parquet is content-hashed; the hash is recorded in the run and in `model_versions`.
- **Model card** (auto-generated): purpose, data, period, metrics with CIs, fairness table, limits ("synthetic-calibrated" until S3), approver.
- New SQLite table: `model_versions(id, model, version, data_hash, metrics_json, card_path, status: candidate|shadow|live|retired, approved_by, approved_at)`.

### 10B.7 Serving: how the trained model reaches the product
- **Nightly batch (main path):** `python -m ml.score --asof <date>` loads the live M1/M2/M3, scores every merchant and writes `ml_scores(case/merchant, model_version, p, p_lo, p_hi, typology_probs, anomaly_pct, shap_top_json)` to SQLite. The TS engine reads it.
- **On-demand (single upload in the UI):** a small **FastAPI** service `ml/serve.py` (`POST /score`) on localhost. The Node backend calls it. If it is down, the UI shows the Bayesian result and marks "ML score unavailable", and nothing breaks.
- **Optional pure-Node path:** M1 exported to **ONNX** and run with `onnxruntime-node`, so a deployment can skip Python at inference. Python is then needed for training only.

### 10B.8 How the trained model combines with the statistical engine
1. **Phase 1 (synthetic, pre-pilot):** the Bayesian engine decides. M1 is shown as a **second opinion** in the trace ("ML model: 0.87, top drivers …"). Disagreements of > 0.4 are flagged for review.
2. **Phase 2 (pilot, shadow):** both score every merchant; McNemar + bootstrap compare them weekly on real labels.
3. **Phase 3 (promotion):** if M1 wins the §8.3 backtest, it is promoted as **champion for the probability**. The **governance gate stays** (≥ 2 independent provenances), decision theory still chooses the action, and the Bayesian trace stays the explanation alongside SHAP.
4. **Stacking option:** M1's calibrated output enters the Bayesian fusion as one evidence family with a capped weight (≤ 1.5 nats), so the ML model can never single-handedly open a case.

### 10B.9 Retraining and monitoring (MLOps)
| Trigger | Action |
|---|---|
| Weekly (scheduled) | Rebuild features; retrain M1/M2 candidates; full gate suite; register as `candidate` |
| Monthly | Best candidate → 14-day shadow → backtest → human approval → `live` |
| Feature PSI > 0.25, or the live model's weekly AUC-PR drops > 10% | Alarm; retrain early; consider rollback |
| Red team finds a new evasion | Add it to the training set (S1); retrain |
| Every promotion | Model card updated; audit-chained entry; rollback = one command (`ml registry rollback m1 <version>`) |

### 10B.10 Stack and repo layout
```
ml/
  pyproject.toml          # python ≥3.11: pandas, numpy, pyarrow, scikit-learn, lightgbm, optuna, shap,
                          # mlflow, fastapi, uvicorn, onnxmltools, torch (M3 AE / M4 / M5 only), torch-geometric (M5)
  synth/                  # S0 generator (extends prototype/generate_data.py logic)
  features/build.py       # as-of feature store → parquet
  features/parity_test.py # TS ↔ Python detector parity
  train/m1.py m2.py m3.py m6.py (m4.py m5.py gated)
  eval/gates.py           # §10B.5 gates, fairness, leakage, stability
  registry.py             # MLflow + model_versions table
  score.py                # nightly batch scorer → ml_scores
  serve.py                # FastAPI /score
  tests/                  # pytest: features, leakage, gates, serving contract
```
Compute: everything up to M3 trains on a laptop CPU in minutes (5,000 merchants × 190 features). M4/M5 need a single GPU only if the pilot data gets large (≥ 100k merchants); otherwise CPU.

---

## Part IV: Build phases

Effort is in dev-days for one experienced TypeScript developer. Each phase ends with its exit test.

| Phase | Name | Days | Depends on |
|---|---|---|---|
| P0 | Safety, validation, privacy | 3 | none |
| P1 | Single source of truth + stats module | 6 | P0 |
| P2 | AI Engine looks like the demo | 4 | P1 |
| P3 | Statistical detectors v1 (rewrite the 20 as tests) + peer baselines | 9 | P1 |
| P4 | Bayesian fusion + priors + decision theory | 7 | P3 |
| P5 | New detectors (UPI, burstiness, changepoint, K1) | 6 | P3 |
| P6 | Explainability trace, counterfactuals, VOI, LLM writer, evidence pack | 7 | P2, P4 |
| P7 | Governance, SQLite, auth, maker/checker, audit chain | 5 | P0 |
| P8 | Learning: Beta posteriors, logistic fusion, calibration, conformal, label-bias controls | 8 | P4, P7 |
| P9 | Portfolio mode + network statistics + FDR case opening | 6 | P4, P8 |
| P10 | Adversarial: red team, workaround catalogue, bands, drift/displacement charts | 7 | P5, P8 |
| P11 | Improvement loop: proposals, backtest (McNemar/DeLong), approval, shadow, rollback | 5 | P8, P10 |
| P12 | Benchmark generator, power analysis, pilot kit, docs, performance | 5 | all |
| ML1 | Python ML scaffold, synthetic data S0, feature store + TS parity | 6 | P3, P5 |
| ML2 | Train M1 + M2 (LightGBM), Optuna, calibration, SHAP, gates, MLflow registry, model card | 7 | ML1, P10 (red-team data) |
| ML3 | Serving: batch scorer, FastAPI, optional ONNX; trace shows ML second opinion + SHAP | 4 | ML2, P6 |
| ML4 | M3 anomaly (Isolation Forest + autoencoder), M6 PU, retraining schedule, drift, champion/challenger wiring | 6 | ML3, P8, P11 |
| ML5 | M4 sequence + M5 graph models (**gated: ≥ 1,000 real labels**) | 10 | pilot data |
| | **Total** | **≈ 101 dev-days before ML5** (+10 gated) → **~9–10 weeks with 3 devs** | |

**Three-dev split:** *Dev A (stats/engine):* P1-stats → P3 → P4 → P5 → P8 → P10. *Dev B (product/platform):* P0 → P1-rules → P2 → P7 → P6 → P9 → P11 → P12. *Dev C (ML engineer, Python):* ML1 → ML2 → ML3 → ML4 (starts in week 3 once the P3 detector outputs exist; builds the synthetic generator S0 in weeks 1–2). With only 2 devs, Dev A takes ML1–ML4 after P10 and the total becomes ~12–13 weeks.

### ML1–ML5 exit tests
- **ML1:** `pytest ml/tests` green; the parity test shows 100% of detector features match TS within 1e-9; the feature build is as-of safe (leakage test passes).
- **ML2:** M1-v0 registered with all §10B.5 gates passing on synthetic data; the model card is generated; `mlflow ui` shows the run with its data hash.
- **ML3:** the nightly scorer writes `ml_scores` for 10,000 merchants in < 5 min; a UI upload shows "ML model 0.87 (0.79–0.92), top drivers …"; stopping the FastAPI service degrades gracefully.
- **ML4:** M3 flags planted anomalies at ≥ 0.8 recall on synthetic peers; the weekly retrain → candidate → shadow → approve → live cycle runs end to end; rollback restores the previous version in one command.
- **ML5:** M4/M5 only promoted if they beat M1 on the real-data backtest (McNemar + ΔAUC-PR CI).

---

### P0. Safety, validation, privacy (3 d)
| # | File | Change |
|---|---|---|
| 0.1 | `backend/src/store.ts` | `ID = /^INV-[0-9a-f]{8}$/`; anything else → not found |
| 0.2 | `backend/src/workflow.ts` `ensure()` | Never create a case under a caller-supplied id |
| 0.3 | `backend/src/http.ts` | Validate `?id=` / body `id`; per-IP token bucket 60/min |
| 0.4 | `workflow.ts` `openInvestigation` | Store `datasetSha256` + the hashed scenario; never `dataset: raw` |
| 0.5 | `frontend/src/utils/hash.ts` | Server: HMAC-SHA256 with `MRE_HASH_KEY` (refuse to start without it unless `MRE_DEMO=1`); drop raw `payerRef` outside demo |
| 0.6 | `frontend/src/data/dataset.ts` | Validation: `0 ≤ confirmed ≤ contacted`; `ticketMin < ticketMax`; `0.2 ≤ seasonalMultiplier ≤ 6`; hours 0–24 (wrap allowed); amount ≤ ₹10 lakh; de-duplicate (payer, amount, time, type) with a warning; warn when calendar is AVAILABLE but empty |
| 0.7 | `detectors.ts:35` `offHours` | Overnight-safe: `open < close ? (h<open‖h≥close) : (h<open && h≥close)` |
| 0.8 | Retention | `scripts/retention.ts` deletes case data older than 180 days (configurable) |
**Exit:** `npm run security` all blocked; W5 → REJECT; overnight shop produces no C2 flag.

### P1. Single source of truth + stats module (6 d)
| # | File | Change |
|---|---|---|
| 1.1 | `rules/` (new) | `thresholds.json`, `priors.json`, `costs.json`, `mcc.json` (top 40 Indian MCCs: ticket quantiles, hours profile, round share, catchment, refund rate), `calendar.json` (festivals by state, salary days, cricket/IPL fixtures), `states.json` (adjacency), `amounts.json` (bonus tiers), `hosts.json`, `overrides.json`, `workarounds.json`. Each entry has `source` and `reviewedOn` |
| 1.2 | `rules/index.ts` | `loadRules(version)`; every result carries `rulesVersion` |
| 1.3 | `frontend/src/stats/` (new) | `dist.ts` (normal, binomial, beta, beta-binomial, Poisson, negative binomial, χ², gamma CDFs/quantiles via stdlib special functions), `tests.ts` (AD k-sample, G-test, Kuiper, permutation, Fisher/Cauchy combination, McNemar, log-rank, hypergeometric), `intervals.ts` (Wilson, Clopper–Pearson, Newcombe, bootstrap percentile/BCa), `multiple.ts` (Holm, BH), `eb.ts` (beta-binomial method-of-moments + ML fit), `glm.ts` (negative-binomial IRLS), `changepoint.ts` (CUSUM + ARL simulation, Adams–MacKay BOCPD), `calibrate.ts` (isotonic PAV, Platt), `logistic.ts` (Laplace-approximation Bayesian LR), `conformal.ts`, `circular.ts` (von Mises), `rng.ts` (seeded xoshiro128**; reuse `utils/prng.ts` if adequate) |
| 1.4 | `tests/stats/*.json` | Reference fixtures generated once with SciPy/R and committed (`scripts/gen-stats-fixtures.py`, run offline). `npm run test:stats` compares to 1e-6 |
| 1.5 | De-scripting | Remove `scenario.id ===` branches (`L5AnalystReview/index.tsx:54`, `DemoPage.tsx:41`, `learningEngine.ts:25`); HomePage numbers from a real run; measured layer timings; KYC/payer coverage computed |
| 1.6 | `prototype/` → `archive/prototype/` | README / `start.sh` updated |
**Exit:** D2, D10; snapshot of the 4 demo decisions unchanged.

### P2. AI Engine looks like the demo (4 d)
| # | File | Change |
|---|---|---|
| 2.1 | `workflow.ts` `view()` | Return the hashed `scenario`, `rulesVersion`, `posterior` |
| 2.2 | `services/pilotApi.ts` | Typed `getPilotCase` with scenario |
| 2.3 | `pages/ServerCasePage.tsx` | `loadCustom(scenario, false)` → render the same `InvestigationPage` + L1–L7 layers as the demo; the old summary becomes a "Case record" panel |
| 2.4 | `hooks/useInvestigation.tsx` | `caseId` mode: notes, response and label call `updatePilotCase` and adopt the server reply |
| 2.5 | `components/navigation/` | One `AppShell({mode})` replaces `DemoShell` + `EngineShell` |
| 2.6 | `App.tsx` | `/ai-engine/cases/:id/{investigations,graph,detection,patterns,analyst,response,audit,trace}` |
| 2.7 | `pages/UploadPage.tsx` | After analysis → navigate to `/ai-engine/cases/:id` with the same progressive layer reveal |
**Exit:** D7.

### P3. Statistical detectors v1 + peer baselines (9 d)
| # | File | Change |
|---|---|---|
| 3.1 | `types/evidence.ts` | `EvidenceItem` gains `{statistic, pValue, effect, ci90, n, llr, provenance}`; `system` → `provenance: 'payments'\|'settlement'\|'bank'\|'crawler'\|'panel'\|'orders'\|'calendar'\|'network'` (settlement and payouts both map to `payments`) |
| 3.2 | `engines/baselines.ts` (new) | Peer baseline per (MCC, city tier): from `rules/mcc.json` now, from the portfolio in P9. Exposes the distribution objects the tests need (amount sample, hour histogram, state multinomial, beta-binomial α/β per rate) |
| 3.3 | `engines/detectors/*.ts` | Split `detectors.ts` into one file per family; rewrite A1, A4, B6, B9, C2, C5, D7, D9, D10, E3, F2, F5, F8, G2, G6, H1, H3, I2 per the §6 table. **The self-declared profile is no longer used as the baseline** |
| 3.4 | `engines/volumeModel.ts` | Negative-binomial GLM with seasonality + festival covariates; the uploaded `seasonalMultiplier` is ignored for scoring |
| 3.5 | `engines/detectors/F.ts` F5 | Poisson change-rate test, plus an extra LLR only near a changepoint or for a shared beneficiary |
| 3.6 | `engines/detectors/D.ts` D9 | Same-holder destination exemption (`payerMobileHash`, `destHolderHash` optional fields in the dataset) |
| 3.7 | Interim LLR | `llr = clamp(−log(−e·p·ln p), 0, 4)` for ILLICIT direction (SBB bound), mirrored for BENIGN; replaced by learned LRs in P8 |
**Exit:** adversarial W3, W4 → NO_CASE; the "declared profile widened" case still fires; `test:stats` green; each detector has a unit test with a known-p fixture.

### P4. Bayesian fusion, priors, decision theory (7 d)
| # | File | Change |
|---|---|---|
| 4.1 | `engines/bayesFusion.ts` | §4: family LLR with ρ correction, tempered benign, overrides, logistic posterior, mechanism posterior, Monte-Carlo 90% interval (2,000 draws, seeded) |
| 4.2 | `engines/priors.ts` | Beta priors from `rules/priors.json` by MCC, city tier and age band |
| 4.3 | Gate | Open only if posterior ≥ `rules.openThreshold` **and** ≥ 2 provenances each contributing ≥ 0.5 nats |
| 4.4 | `engines/decision.ts` (new) | Cost-matrix argmin over L0–L5 with the robust lower-bound rule; replaces the `recommended` logic in `analystEngine.ts:55-59` |
| 4.5 | `engines/analystEngine.ts` | The two stories are now driven by LLR sign and size per chain link |
| 4.6 | `scripts/compare-fusion.ts` | Legacy vs Bayesian decisions on every sample + adversarial case → `reports/fusion-migration.md` |
**Exit:** W1, W2 → OPEN_CASE; demo bakery/rotation/fabricated open with posterior ≥ 0.8; Diwali posterior ≤ 0.1; D3 27/27.

### P5. New detectors (6 d)
A5 amount clustering, C6 burstiness (Fano + Hawkes branching ratio by EM), H2 changepoint (ARL-calibrated CUSUM + BOCPD), K1 declared-vs-expected (Mahalanobis), U1–U5, U7 per §6. Each detector ships with: a unit test with a fixture p-value, 2 adversarial cases (should fire; false-positive trap) and a `workarounds.json` entry.
New sample `09-telegram-betting-no-website.json`.
**Exit:** sample 09 → OPEN_CASE; samples 04, 06, 07, 08 → NO_CASE; the Hawkes fit recovers its branching ratio within ±0.05 on simulated data.

### P6. Show its working (7 d)
| # | File | Change |
|---|---|---|
| 6.1 | `engines/traceEngine.ts` | Builds the `Trace`: coverage → per-detector {expected + source, observed, test, statistic, p, effect, CI, n, LLR, records} → fusion {prior, family LLRs, ρ, overrides, posterior + interval, mechanisms} → gate → decision {expected loss per action, chosen action, robustness} → two stories → counterfactuals → VOI → rulesVersion/learningVersion |
| 6.2 | Counterfactuals | Re-run fusion with each UNKNOWN set to its LR⁺ and LR⁻, and with each ILLICIT item neutralised; report the posterior and action change |
| 6.3 | VOI | Pre-posterior expected-loss reduction for each missing feed (§9) |
| 6.4 | `pages/TracePage.tsx` + `components/trace/*` | Odds waterfall chart (prior → each family → posterior); a p-value/effect table with CIs; peer distribution vs merchant plots (histogram/ECDF, hour rose chart, state bars); negative-binomial prediction band on the volume chart; mechanism bars; expected-loss bars per action |
| 6.5 | `backend/src/llm.ts` (optional) | Haiku writes the summary + a clarification email from the trace; a verifier rejects any number or id not present in the trace; cache by trace hash |
| 6.6 | `backend/src/evidencePack.ts` | JSON + printable HTML: trace, approvals, rules version, mapping to the RBI PA-MD clause and FIU-IND STR fields |
| 6.7 | API | `GET /investigations/:id/trace`, `/pack` |
**Exit:** D8; the LLM verifier rejects an injected fake number in a test.

### P7. Governance and platform (5 d)
| # | File | Change |
|---|---|---|
| 7.1 | `backend/src/db.ts` | `node:sqlite` schema: `users, cases, case_events_hashed, evidence, labels, reviews, decisions, audit, rule_versions, detector_stats, priors, calibration, llm_cache, audit_sample`; migrations in `backend/migrations/*.sql` |
| 7.2 | `backend/src/auth.ts` | scrypt passwords, signed cookie, `requireRole()` |
| 7.3 | Maker/checker | Proposer ≠ approver for L3+; L4/L5 need `legal`; the labeller ≠ the executor; CONFIRMED_ILLICIT needs a second reviewer |
| 7.4 | Audit chain | `hash = sha256(prevHash ‖ canonicalJSON(row))`; `GET /audit/verify` |
**Exit:** D4 including "anonymous label + L5" blocked; tampering with any audit row fails `verify`.

### P8. Learning (8 d)
| # | File | Change |
|---|---|---|
| 8.1 | `engines/learning/detectorStats.ts` | Beta posteriors for sensitivity and FPR per (detector, MCC group), with hierarchical partial pooling; LR⁺/LR⁻ fed to fusion |
| 8.2 | `engines/learning/fusionWeights.ts` | Bayesian logistic regression (Laplace), nightly; posterior means and SDs in the trace |
| 8.3 | `engines/learning/calibration.ts` | Platt → isotonic at ≥ 200 labels; Brier, ECE, reliability diagram stored per version |
| 8.4 | `engines/learning/conformal.ts` | Split conformal at 90%; {legit, illicit} set → abstain → L2 clarification |
| 8.5 | `engines/learning/bias.ts` | Monthly stratified random audit sample (0.5% of unflagged merchants, by MCC) → `audit_sample`; inverse-propensity weights from the decision log; Elkan–Noto PU correction; Cohen's κ between reviewers |
| 8.6 | Poisoning caps | Per-analyst ≤ 20% share; floors s ≥ 0.05, f ≥ 0.005; self-dispute down-weighting |
| 8.7 | UI | Trace shows "A4 LR⁺ 6.2 (90% CI 3.9–9.8) from 41 labels; last change INV-…" |
**Exit:** D9; on simulated labels the learned LRs converge to the true generator LRs within their 90% CIs; ECE ≤ 0.05 on the benchmark.

### P9. Portfolio mode and network statistics (6 d)
| # | File | Change |
|---|---|---|
| 9.1 | `dataset.ts` | `mre-portfolio/v1` (many merchants in one file or zip) |
| 9.2 | `engines/baselines.ts` | Peer baselines computed from the portfolio when a group has ≥ 10 merchants (else fall back to `mcc.json`), with beta-binomial EB fitted per group |
| 9.3 | `engines/network.ts` | Bipartite graphs (merchant–beneficiary, merchant–payer, merchant–link/terminal); hypergeometric shared-neighbour p; configuration-model null; Louvain communities; N4/N5 detectors |
| 9.4 | `engines/portfolio.ts` | Score every merchant → BH-FDR at q = 0.10 → case queue with the expected false-discovery count |
| 9.5 | UI | Ranked queue, network view (reuses `EvidenceGraph`), peer-group explorer |
**Exit:** rotation found without `peers` in the file; FDR-controlled queue on the benchmark has an observed FDR within its bootstrap CI of the target.

### P10. Adversarial robustness and monitoring (7 d)
| # | File | Change |
|---|---|---|
| 10.1 | `scripts/redteam.ts` | §10.1 operators, random + greedy posterior-minimising search, ≥ 500 variants; per-detector evasion rate and attacker-cost-to-evade |
| 10.2 | `rules/workarounds.json` + `scripts/check-workarounds.ts` | Every evasion must have a backstop with LLR > 0.5 nats |
| 10.3 | τ learning | fakeDifficulty τ_i = Beta-smoothed (1 − evasion rate) per release |
| 10.4 | Threshold bands | Seeded draw within `band` per release; the seed is stored |
| 10.5 | `engines/monitoring.ts` | Weekly PSI + KS per detector input; Poisson u-charts of firing rate per detector × MCC; Kulldorff-style scan statistic for emerging clusters; alarms in the UI and audit |
| 10.6 | `scripts/refresh-lists.ts` + `check-freshness.ts` | Hosts, calendar, I4C feed (if granted); fail if > 90 days old |
| 10.7 | `tests/edge-cases/` | Every real false positive or miss becomes a permanent case with `expect` + explanation |
**Exit:** D6; a planted "fraud moved" pattern triggers a displacement alarm in one weekly batch; the attacker-cost report is generated.

### P11. Controlled improvement loop (5 d)
| # | File | Change |
|---|---|---|
| 11.1 | `engines/improver.ts` | Nightly: refit P8 models, sweep thresholds within bands, add red-team evasions as candidate rules → `rules/proposals/<date>.json` |
| 11.2 | `scripts/backtest.ts` | Champion vs challenger on benchmark + labelled real + adversarial + red team: McNemar exact, bootstrap Δrecall/ΔFP CIs, DeLong ΔAUC, calibration delta → `reports/backtest-<v>.md` |
| 11.3 | `pages/RulesPage.tsx` | Diff + report; `admin` approves (name, reason) → `rule_versions`; shadow mode N days (decisions stored, not shown); **Promote**; **Rollback** |
| 11.4 | Guard-rails | No auto-promote; promote only if non-inferior on FP (margin 0.5 pt) and non-inferior or better on recall |
**Exit:** D9 second half; a deliberately worse challenger is rejected by the backtest.

### P12. Benchmark, power, pilot kit, docs, performance (5 d)
| # | File | Change |
|---|---|---|
| 12.1 | `scripts/gen-benchmark.ts` | 1,000 merchants: ~940 genuine across 10 MCCs (festivals, bank switches, college areas, overnight, delivery apps, wholesalers, messy data, small merchants with < 30 sales), ~60 bad across 6 typologies (betting front, rotation, fabricated, mule fan-out, split-merchant, peer-mimic). **Generator parameters drawn independently of `rules/`** (separate seed and parameter file, written by a different person if possible) |
| 12.2 | `scripts/benchmark.ts` | Metrics with Wilson/bootstrap CIs, reliability diagram, per-typology recall, attacker-cost summary → `reports/benchmark.md`; CI fails below D5 |
| 12.3 | `scripts/power.ts` | Pilot sample-size calculator (§8.2) |
| 12.4 | Pilot kit | Read-only connector spec (CSV/SFTP daily drop), DPDP Act 2023 checklist (purpose, minimisation, 180-day retention, DPA template), 1-VM deployment guide, random-audit-sample procedure for the PA |
| 12.5 | Docs | README (Node ≥ 22.5), `docs/STATISTICS.md` (every formula, assumption and limit, incl. the mimicry ceiling), `docs/RULES.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md` |
| 12.6 | Performance | Code-split routes (< 500 kB per chunk); batch of 10,000 merchants × 90 days in < 10 min on 2 vCPU (permutation tests capped at 10,000 draws with early stopping) |
**Exit:** D1–D10 green; final demo (§13) runs end to end.

---

## Part V: Cross-cutting

### 11. Data model (SQLite, key tables)
```
cases(id PK, merchant_id, created_at, rules_version, learning_version, posterior, post_lo, post_hi,
      decision, action, dataset_sha256, scenario_json_hashed)
evidence(case_id, detector, family, provenance, statistic, p, effect, ci_lo, ci_hi, n, llr, status, records_json)
labels(case_id, label, by_user, second_reviewer, at, propensity)      -- propensity for IPW
detector_stats(detector, mcc_group, a1, b1, a0, b0, updated_at)       -- Beta posteriors
priors(mcc, city_tier, age_band, alpha, beta)
calibration(version, method, params_json, brier, ece)
rule_versions(version PK, parent, seed, diff_json, backtest_report, approved_by, reason, status)  -- proposed|shadow|live|retired
audit(seq PK, at, actor, action, detail, prev_hash, hash)
audit_sample(month, mcc, merchant_id, reviewed_label)
```

### 12. API (final)
`POST /investigations` (single or portfolio) · `GET /investigations[/:id]` · `GET /investigations/:id/{trace,pack}` · `POST /investigations/:id/{review,response,label,approve}` · `GET /portfolio/queue` · `GET /monitoring/alerts` · `GET|POST /rules/proposals` · `POST /rules/:version/{approve,shadow,promote,rollback}` · `GET /audit/verify` · `POST /auth/login`. Every write is role-checked and audit-chained.

### 13. Final demo script
1. Upload a 1,000-merchant portfolio → queue: "23 cases at FDR 10%, ≈ 2 expected false alarms".
2. Top case → the same 7-layer view as `/demo` → trace page: odds waterfall from a 0.5% prior to a 0.91 posterior (0.84–0.95); each detector's test, p, effect and CI against peer plots; the expected-loss bars choose L3; VOI says "get the orders feed first".
3. Diwali merchant → the negative-binomial band with festival covariate explains the spike; posterior 0.03.
4. Analyst + second reviewer label; the legal role approves; the audit chain verifies.
5. A similar merchant re-runs → A4 LR⁺ updated, with its CI and the label that moved it.
6. Rules page → tonight's proposal, McNemar p, Δrecall CI → approve → shadow.
7. Red-team report → evasion rates and attacker cost-to-evade; the displacement alarm fires on the planted shift.
8. Export the RBI-mapped evidence pack.

### 14. Testing strategy
| Layer | What | Where |
|---|---|---|
| Stats unit | Every routine vs SciPy/R fixtures | `tests/stats/` |
| Detector unit | Fixture data with a known statistic/p per detector | `tests/detectors/` |
| Property tests | Invariants: UNKNOWN never changes the posterior; adding benign evidence never raises it; the posterior is monotone in each LLR; permutation of event order gives identical output (seeded) | `tests/properties.ts` |
| Simulation recovery | Learned LRs/priors converge to the generator's truth; CUSUM ARL₀ ≈ 52 weeks in simulation; conformal coverage ≈ 90% | `tests/simulation/` |
| Adversarial + red team | §10 | `scripts/` |
| Snapshot | Demo decisions + posteriors (changes require a CHANGELOG note) | `tests/snapshot/` |
| API/security | Routes, roles, traversal, maker/checker, audit verify | `scripts/security.ts` |
| UI parity | Demo vs saved-case rendering | `scripts/ui-parity.ts` |

### 15. Risks and honest limits
| Risk / limit | Mitigation |
|---|---|
| Synthetic benchmark flatters the model | Independent generator + parameters; every metric labelled "synthetic-calibrated" until pilot labels exist; Wilson CIs printed |
| Selection bias in labels | Random audit sample + IPW + PU correction (§7.4) |
| Independence assumption across families wrong | Tested every release (§8.4); ρ correction; merge correlated families |
| Perfect mimicry is undetectable on transaction data alone | Stated in `docs/STATISTICS.md`; weight on hard-to-fake evidence; attacker-cost metric |
| Model or label poisoning | Caps, second reviewer, no auto-promote, rollback |
| LLM hallucination | Verifier + template fallback; LLM off by default |
| Statistical bugs | SciPy/R fixtures for every routine; property tests; one vetted special-functions dependency |
| Privacy (DPDP Act 2023) | HMAC, no raw storage, retention job, DPA in the pilot kit |
| Scope creep | Only the detectors in §6; anything else needs red-team or pilot evidence of a gap |

### 16. Out of scope (until evidence says otherwise)
Deep learning; real-time streaming; live payment-rail actions; multi-tenant SaaS; card-network (VAMP/BRAM) reporting; the remaining catalogued patterns not listed in §6.

### 17. Running cost
| Item | Pilot | 10× |
|---|---|---|
| Compute (1 VM, nightly batch) | ₹0–₹800/mo | ~₹2,500/mo |
| Storage | SQLite, ₹0 | Postgres free tier → ~₹2,000/mo |
| LLM writer (optional, cached) | ~₹0.10–0.30 per case (est.) | same per case |
| **Total** | **≈ ₹0–₹1,000/mo** | **≈ ₹5,000/mo (est.)** |

### 18. Glossary (for non-statistician readers)
- **Likelihood ratio (LR):** how many times more likely this evidence is if the merchant is a front than if it is genuine. LLR = its log.
- **Prior / posterior:** our belief before / after seeing the evidence.
- **Credible interval:** the range the true probability probably lies in (90%).
- **p-value:** how surprising the data would be if the merchant were like its peers.
- **FDR:** the expected share of opened cases that turn out to be false alarms.
- **Calibration:** when we say 30%, about 30% of those merchants really are fronts.
- **Conformal set:** a guaranteed-coverage answer; if it says "could be either", we ask the merchant instead of guessing.
- **ARL:** average run length, i.e. how many weeks until a false alarm on a normal merchant.
- **Empirical Bayes shrinkage:** small merchants' rates are pulled towards their peers' so a few odd sales don't trigger alarms.
