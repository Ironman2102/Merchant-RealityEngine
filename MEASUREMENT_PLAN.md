# Merchant Reality Engine: What We Measure, and What We Test It On

**Purpose:** a single list of every number this product must be able to show, how each is computed, the target, the script that produces it, and its current status. It also lists the datasets to test on and what each one can and cannot prove.

**Rule:** a number may appear in the README, the pitch or a slide **only if a script in this repo produced it into `reports/`**, with its confidence interval and the dataset named. Synthetic results are always labelled "synthetic".

Status key: ✅ measured now · 🟡 partly measured · ⬜ not measured yet (script planned; T-numbers refer to `GROK_INSTRUCTIONS.md`)

---

## Part A. Honest answers first

### A1. How big is the AI?
| Part | Size | Speed | Notes |
|---|---|---|---|
| Statistical detectors + Bayesian model (built) | About 200 numbers in `rules/*.json` (25 detectors × ~10 settings, plus norms, priors and costs). Code is ~2,000 lines of TypeScript | One merchant analysed in milliseconds. All 34 adversarial cases plus the 50k-sale stress case run in under 1 s together on a laptop (measured earlier) | Not a neural network. Every weight can be read and explained |
| Trained model M1 (LightGBM, task T9) | **Estimate:** ~112 input features, 100–400 trees of ≤ 31 leaves → a model file of roughly 0.1–2 MB | **Estimate:** trains in seconds to a minute on a laptop CPU for 1,000–5,000 merchants; scores in well under 1 ms per merchant | Real size and speed go in `reports/perf.md` once trained |
| Anomaly model M3 (stretch) | **Estimate:** Isolation Forest, a few MB | Milliseconds | Needs no labels |
| Language model | **None in the product.** AI-written summaries are off (owner decision) | n/a | The template summary plus the verifier is used instead |

It is deliberately small: it runs on one modest machine inside a PA's network, with no GPU and no external API calls.

### A2. Is the rest of the app accurate?
"Accurate" means four different things. Only the first three can be shown today.

| Kind of accuracy | Status | Evidence |
|---|---|---|
| **The maths is computed correctly** | ✅ | 38 statistical routines match SciPy reference values; simulation tests recover known truths (CUSUM run length, empirical-Bayes rates, interval coverage) |
| **The engine behaves sensibly on hand-built hard cases** | ✅ | 34/34 adversarial cases (evasions caught, honest edge cases left alone); 8 engine invariants; all 9 samples classified as intended |
| **The software is safe and governed** | ✅ | 14/14 security and approval probes against the real API; tamper-evident audit trail verified |
| **It finds real fronts in a real portfolio without drowning analysts** | ⬜ **unknown** | Needs labelled real data. Every input so far is synthetic, and the category norms and detector sensitivities are expert guesses. Probabilities are overconfident when many signals fire (shown as "> 99.9%") |

The honest one-liner for judges: *"The code and the statistics are verified, and the behaviour holds up against 34 adversarial cases. Real-world precision and recall can only be measured in a shadow pilot on your labelled merchants, and the system is built to measure exactly that."*

---

## Part B. Every number we need to measure

### B1. Detection quality (is it right?)
| # | Metric | Definition | Target | Produced by | Status |
|---|---|---|---|---|---|
| Q1 | **Recall** (fronts caught) | caught fronts ÷ all fronts, with a Wilson 95% CI | ≥ 0.80 (lower bound ≥ 0.65) | `scripts/benchmark.ts` (T8) | ⬜ |
| Q2 | **Precision** (opened cases that are real) | true cases ÷ opened cases, with a Wilson CI | ≥ 0.30 in the top-50 queue | T8 | ⬜ |
| Q3 | **Genuine-merchant false-positive rate** | genuine merchants opened ÷ all genuine, with a Wilson CI | ≤ 3% (95% upper bound) | T8 | ⬜ |
| Q4 | **AUC-PR** (ranking quality under imbalance) | area under the precision–recall curve, bootstrap 95% CI | > the base rate by a wide margin; M1 vs Bayesian compared | `ml/compare.py` (T9) | ⬜ |
| Q5 | **Per-typology recall** | recall separately for betting front, rotation, fabricated, mule fan-out, Telegram (no website) | each ≥ 0.70 | T8 | ⬜ |
| Q6 | **Recall with missing data** | recall when the website / calendar / orders feeds are absent | ≤ 10 points below Q1 | T8 (feed-ablation run) | 🟡 adversarial cases only |
| Q7 | **Top-K precision** | precision in the K highest-ranked merchants (K = 10, 50) | ≥ 0.5 at K = 10 | T8 | ⬜ |

### B2. Probability quality (can P(front) be trusted?)
| # | Metric | Definition | Target | Produced by | Status |
|---|---|---|---|---|---|
| C1 | **ECE** (expected calibration error) | 10-bin mean of \|predicted − observed\| | ≤ 0.05 synthetic, ≤ 0.08 real | T9 | ⬜ |
| C2 | **Brier score** | mean (P − outcome)² | lower than the base-rate-only model | T9 | ⬜ |
| C3 | **Reliability diagram** | predicted vs observed per bin | visibly near the diagonal | T9 | ⬜ |
| C4 | **Interval coverage** | share of merchants whose 90% interval contains the truth (via calibration bins) | ≈ 90% | S4 | ⬜ |
| C5 | **Expected vs observed false alarms** | Σ(1 − P) over opened cases vs actual false alarms | within the bootstrap CI | T8 | ⬜ |
| C6 | **Saturation rate** | share of cases shown as "> 99.9%" | report it; reduce after calibration | T8 | ⬜ |

### B3. Robustness (does it survive adaptation?)
| # | Metric | Definition | Target | Produced by | Status |
|---|---|---|---|---|---|
| R1 | **Adversarial suite pass rate** | hand-built evasions + honest edge cases | 100% | `npm run adversarial` | ✅ 34/34 |
| R2 | **Evasion rate per detector** | share of red-team mutations that silence each detector | report all; backstop exists for every one | red team (S5) | ⬜ |
| R3 | **Attacker cost to evade** | smallest mutation budget that pushes P below the opening bar | rising release on release | S5 | ⬜ |
| R4 | **Robust recall** | recall on held-out mutated fronts | ≥ 0.70 | S5 / T9 | ⬜ |
| R5 | **Engine invariants** | UNKNOWN neutral, monotone, order-invariant, deterministic, uploaded multiplier ignored | all pass | `tests/engine` | ✅ |

### B4. Explainability and governance
| # | Metric | Definition | Target | Produced by | Status |
|---|---|---|---|---|---|
| G1 | **Traceability** | share of numbers in case summaries found in the trace | 100% | `tests/engine/trace.test.ts` | ✅ all 9 samples |
| G2 | **Waterfall consistency** | last waterfall step = posterior | exact (1e-9) | trace test | ✅ |
| G3 | **Audit integrity** | chains that verify | 100%; tampering always detected | selfcheck, security probe | ✅ |
| G4 | **Maker/checker violations** | self-approvals or single-person confirmations that succeeded | 0 | security probe | ✅ 0 |
| G5 | **Time to decision** | case opened → response approved (median, p90) | pilot baseline −30% | pilot | ⬜ |
| G6 | **Analyst agreement** | Cohen's κ between two reviewers on the same cases | ≥ 0.6 | pilot | ⬜ |

### B5. Fairness (who carries the false alarms?)
| # | Metric | Definition | Target | Produced by | Status |
|---|---|---|---|---|---|
| F1 | FP rate by **city tier** | Q3 per tier, with Wilson CIs | max/min ratio ≤ 2× | T8 | ⬜ |
| F2 | FP rate by **MCC** | Q3 per category | ≤ 2× | T8 | ⬜ |
| F3 | FP rate by **account age / size** | Q3 for new or small merchants vs established | ≤ 2× | T8 | ⬜ |

### B6. Operations and scale
| # | Metric | Definition | Target | Produced by | Status |
|---|---|---|---|---|---|
| O1 | **Batch throughput** | merchants analysed per minute (machine stated) | 10,000 × 90 days in < 10 min on 2 vCPU | `scripts/perf.ts` (T11) | ⬜ |
| O2 | **API latency** | `/v1/score` p50 / p95 / p99 over 200 calls | p95 < 500 ms for one merchant | T11 | ⬜ |
| O3 | **ML scoring latency** | FastAPI `/score` p95 | < 50 ms | T11 | ⬜ |
| O4 | **Memory** | peak RSS during a 1,000-merchant batch | < 1 GB | T11 | ⬜ |
| O5 | **Determinism** | same input → byte-identical batch output | always | T3 test | ⬜ |
| O6 | **Degradation** | ML service down → decisions unchanged, API still answers | always | T10 check | ⬜ |
| O7 | **Alert volume** | cases opened per 1,000 merchants per day | set by the PA's analyst capacity | T8 / pilot | ⬜ |

### B7. Data quality and drift
| # | Metric | Definition | Target | Produced by | Status |
|---|---|---|---|---|---|
| D1 | **Feed coverage** | share of merchants with each feed present | report; ≥ 90% with ≥ 2 independent sources | T8 | ⬜ |
| D2 | **Rejected rows** | rows rejected or warned by validation, by reason | report | T3 `run.json` | ⬜ |
| D3 | **Feature drift (PSI)** | population stability per detector input, week on week | alarm > 0.25 | S5 | ⬜ |
| D4 | **Detector firing-rate shift** | firing rate per detector × MCC vs a control chart | alarm on breach | S5 | ⬜ |

### B8. Business value (pilot only)
| # | Metric | Definition | Produced by |
|---|---|---|---|
| V1 | Confirmed fronts found that existing rules missed | count | pilot |
| V2 | Analyst minutes per case | median, vs the PA's current baseline | pilot |
| V3 | Expected loss avoided | Σ P × miss cost for confirmed cases (rules/costs.json) | pilot |
| V4 | Running cost | ₹ per month per 10,000 merchants | T11 + infra bill |

### B9. Sample sizes needed (so the numbers mean something)
These are checked numerically; see `audit/IMPLEMENTATION_PLAN.md` §8.2.
- **Genuine FP ≤ 3%** at 95% confidence, when the true rate is 2%: about **1,000 genuine merchants**.
- **Recall ±10 points:** about **60 confirmed fronts**.
- **With only 30 fronts,** a measured recall of 0.80 really means about **0.63–0.90**. Always print the interval.

---

## Part C. Datasets to test on

No public dataset contains **Indian merchants labelled as betting or laundering fronts**; that data is private to PAs and card schemes. Each public set below tests a *part* of the system. Licences were checked on the source pages; **[verify]** means the licence wasn't visible in what was read. Check it on the dataset page before use.

**The owner downloads datasets manually** (Kaggle needs an account). Assistants must not download them or create accounts.

### C1. Our own data (primary, labels by construction)
| Dataset | What it tests | Limits |
|---|---|---|
| The 9 hand-built samples (`frontend/public/samples`) | Every detector and the end-to-end flow | Built by us; tuned alongside the rules |
| 1,000-merchant portfolio (T8, derived from the 9 samples) | Q1–Q7, C1–C6, F1–F3, O1–O7 | Variations of the same 9 bases: measures robustness to variation, **not** real-world accuracy |
| Red-team mutations (S5) | R2–R4 | Only the evasions we thought of |

### C2. Public money-laundering benchmarks (test the money-flow detectors and the training pipeline)
| Dataset | Source | Size / labels | Licence | Use for |
|---|---|---|---|---|
| **IBM Transactions for Anti Money Laundering (AML), "IT-AML"** (Altman et al., NeurIPS 2023) | Kaggle `ealtman2019/ibm-transactions-for-anti-money-laundering-aml`; github.com/IBM/AML-Data | Several sizes (HI/LI × Small/Medium/Large); every laundering transaction labelled; models fan-in, fan-out, cycles and other patterns | **CDLA-Sharing-1.0** (stated on the IBM GitHub) | **Main public benchmark (T13).** Treat receiving accounts as "merchants" to test fan-in/fan-out (I2), sweep (I3), round amounts (A4), repeat payers (B7) and the M1 pipeline |
| **SAML-D** (Oztas et al., 2023, IEEE) | Kaggle `berkanoztas/synthetic-transaction-monitoring-dataset-aml` | ~9.5M transactions, 28 labelled typologies (11 normal, 17 suspicious) | **[verify]** | Per-typology recall; typology labels map well onto our "mechanism" output |
| **AMLSim** (IBM) | github.com/IBM/AMLSim | ~12.5M transfers, 0.14% suspicious | Apache-2.0 for the code **[verify the data terms]** | Generator: create our own laundering graphs at chosen rates |
| AMLNet v2 | Zenodo record 21237971 | ~1.09M transactions, structuring/layering/integration | **CC BY-NC 4.0: non-commercial** | **Avoid** for a company hackathon unless permission is obtained |

### C3. Public payment-fraud benchmarks (test the pipeline and calibration, not merchant substance)
| Dataset | Source | Size / labels | Licence | Use for |
|---|---|---|---|---|
| **PaySim** (mobile money, derived from a real African operator's aggregates) | Kaggle `ealaxi/paysim1` | ~6.36M transactions, 0.13% fraud; has a merchant ("M…") destination type | **[verify]** | Cash-out / transfer fraud patterns; tests I2/I3-style flow features |
| **BankSim** (Spanish bank, agent-based) | Kaggle `ealaxi/banksim1` | ~600k payments **with merchant ids and merchant categories**, fraud labels | **[verify]** | The closest public match to "merchant × category" data: test category-norm logic (A1 ticket, C2 hours) and per-merchant aggregation |
| **Sparkov simulated card transactions** | Kaggle `kartik2112/fraud-detection` | ~1.3M train + test, ~5.7% fraud (per Amazon's FDB table); merchant name, category, location, time | **[verify]** | Merchant/category/geo features at scale; latency and throughput tests (O1–O4) |
| **ULB Credit Card Fraud** (real European cards, PCA-anonymised) | Kaggle `mlg-ulb/creditcardfraud` | 284,807 transactions, 492 frauds (0.172%) | **DbCL 1.0** (stated on Kaggle) | Calibration and imbalance handling only (no merchant fields) |
| **IEEE-CIS Fraud Detection** (Vesta, real e-commerce) | Kaggle competition `ieee-fraud-detection` | ~590k transactions, ~3.5% fraud | **Competition rules: restrictive [verify before any use]** | Probably skip: buyer fraud, licence risk |
| **Amazon Fraud Dataset Benchmark (FDB)** | github.com/amazon-science/fraud-dataset-benchmark | Wraps several of the above with fixed train/test splits | Per-dataset licences | A standard harness if we report results on public sets |
| Mobile-money labelled synthetic dataset (Azamuke et al., 2025) | PMC article PMC12036017 | ~1.72M records, 10.2% fraud | **[verify]** | Mobile-money flows; an alternative to PaySim |

### C4. Real Indian aggregate statistics (to calibrate category norms, no labels)
| Source | What it has | Use for |
|---|---|---|
| **NPCI UPI merchant-category statistics** (volume and value by MCC, monthly), also compiled on dataful.in ("Year, Month and Merchant Category wise Volume and Value of UPI") | Real aggregate volume and value per MCC | **Replace guessed ticket medians in `rules/mcc.json`** with average ticket = value ÷ volume per MCC (a real, citable anchor). Verify on NPCI's own site before quoting |
| Kaggle synthetic "UPI transactions 2024/2025", "UPI Transaction Insights", "Digital Wallet Transactions" | Small synthetic Indian-flavoured sets (thousands of rows), some with merchant categories | Format and UI testing only; too small and unvalidated to measure accuracy |

### C5. The only dataset that answers "is it accurate?"
**A shadow pilot on a PA's own merchants:**
- ≥ 1,000 genuine merchants and as many confirmed fronts as exist;
- a 0.5% monthly random audit sample for an unbiased miss rate;
- run inside the PA's network in daily-file mode (integration mode A).

Everything above prepares for it; nothing above replaces it.

### C6. What to run, in order
1. Our portfolio (T8) → Q, C, F and O metrics, labelled synthetic.
2. IBM AML (T13) → money-flow detectors and the M1 pipeline on a recognised benchmark, with the limits stated.
3. BankSim → category-norm logic on merchant × category data.
4. NPCI MCC statistics → recalibrate `rules/mcc.json` ticket norms, citing the source.
5. Pilot → the real numbers.
