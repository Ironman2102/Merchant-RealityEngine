# Stage 2 ML, v1: what changed, why, and the measured effect

Stage 2 is a second opinion. It never opens or closes a case: the Stage 1 statistical conduct gate does that.
Everything below was trained and measured on **synthetic** merchants from `engine/synthetic.ts`. These are not
real-world accuracy figures.

## Problems found in v0

| # | Problem | Effect |
|---|---|---|
| 1 | **Train/serve skew.** The backend sent `features()` only; six behavioural columns the models were trained on (night, weekend, refund ratio, payer concentration, ticket variation, sweep lag) arrived as 0. A zero sweep lag reads as "swept instantly". | On held-out fronts, the v0 neural net caught 40% instead of 100%, LightGBM 75%. The ensemble caught 45% at a cost-based bar. |
| 2 | **Leaky validation.** Each merchant was copied (coverage dropout) and *then* split into CV folds, so copies of one merchant sat on both sides. Calibration was fitted on those leaky scores. | Optimistic CV scores and calibration. |
| 3 | **Plain average + max−min "confidence"** with hand-picked cut-offs (0.05 / 0.15). | Weak models count as much as strong ones; "HIGH confidence" on a fraud type never seen (the fake online store: 0.01, HIGH). |
| 4 | **Wrong base rate.** Training data is 1/3 fronts; the engine's prior is about 1.2%. `workflow.ts` blended the two as if they were on the same scale. | ML probabilities overstated relative to the engine. |
| 5 | **Arbitrary 0.10 bar**, no drift reference, no route for analyst labels back into training. | 8–25% of honest merchants above the bar. |
| 6 | **Windows line endings** corrupted the LightGBM text model on checkout (git autocrlf). | The ML server crashed on Windows. Fixed with `.gitattributes`. |

## What v1 does, and the published method behind each piece

| Piece | Formula / method | Where |
|---|---|---|
| Grouped cross-validation | `StratifiedGroupKFold`, group = merchant id, so a merchant and its augmented copy share a fold | `ml/train_stage2.py` |
| Hyperparameter choice | Minimise grouped-CV **log loss** (a proper scoring rule, Gneiting & Raftery 2007) | `train_ensemble` |
| Base models | Logistic regression, decision tree, random forest, monotone LightGBM, MLP 32×16 | `make_model` |
| **Stacked ensemble** (Wolpert 1992) | p = σ(a + Σₖ wₖ · logit(pₖ)), wₖ ≥ 0, fitted by L-BFGS-B on out-of-fold predictions with L2 penalty | `fit_stacker` |
| **Prior-shift correction** (Saerens et al. 2002) | logit(p′) = logit(p) − logit(π_train) + logit(π_engine) | `ml/serve.py` `_v1_score` |
| **Cost-sensitive threshold** (Elkan 2001) | flag when p′ ≥ C_FP / (C_FP + C_FN); default C_FN/C_FP = 20 ⇒ 0.048 | `bayes_threshold` |
| **Mondrian split-conformal** (Vovk et al. 2005) | per class c: q_c = ⌈(n_c+1)(1−α)⌉/n_c quantile of 1 − p(c); include c if 1 − p(c) ≤ q_c; α = 0.1 | `conformal_quantiles` |
| **Novelty detection** (Ledoit & Wolf 2004) | quantile-normal transform, clip ±5.2, d = √(zᵀ Σ̂⁻¹ z) with shrunk Σ̂; threshold = 99.5th percentile of out-of-fold d | `ml/stage2_lib.py` `Novelty` |
| Confidence | LOW if novel or the conformal set is not a single class; MEDIUM if base models spread > 0.3; else HIGH | `_v1_score` |
| **Drift** | PSI = Σ (aᵢ − eᵢ) ln(aᵢ / eᵢ) over training score deciles; <0.1 OK, 0.1–0.25 moderate, >0.25 significant | `POST /drift` |
| Evaluation | AP, ROC-AUC, Brier, log loss, ECE (Guo et al. 2017), 95% bootstrap CIs, leave-one-fraud-type-out | `evaluate`, `leave_one_kind_out` |
| **Champion/challenger** | promote only if the paired-bootstrap 95% lower bound of ΔAP and Δ(−Brier) ≥ −0.01 on the fixed held-out set; old model kept for rollback; every decision logged | `promote`, `ml/models/promotions.jsonl` |

## Statistical depth (`ml/stage2_math.py`, each formula tested in `ml/tests/test_stage2_math.py`)

| Area | Method | Formula | How it is verified |
|---|---|---|---|
| Calibration choice | Identity vs **beta calibration** (Kull et al. 2017) vs **isotonic** (Zadrozny & Elkan 2002), picked by cross-fitted log loss | beta: logit(q) = a ln p − b ln(1−p) + c, a, b ≥ 0 | repairs a known distortion; recovers identity on calibrated data |
| Calibration diagnosis | **Murphy decomposition** of the Brier score; **Brier skill score**; reliability curve with **Wilson** intervals | BS = REL − RES + UNC; BSS = 1 − BS / (ō(1−ō)) | the identity holds exactly; reference Wilson values |
| Model comparison | **DeLong test** for correlated AUCs (fast midrank form, Sun & Xu 2014); exact **McNemar**; paired bootstrap | z = ΔAUC / √(Var₁ + Var₂ − 2Cov) | AUC equals sklearn's; SE within 15% of a 2,000-draw bootstrap; size ≈ 5% under the null |
| Unbiased estimate | **Nested cross-validation** (Varma & Simon 2006): search, stacking and calibration refit inside each outer fold | — | each merchant scored once by a pipeline that never saw it |
| Uncertainty | **Entropy decomposition** of the stacked ensemble (Depeweg et al. 2018; BALD) | H(Σwₖpₖ) = Σwₖ H(pₖ) + I(y; k) | exact identities on agreeing, disagreeing and noisy members |
| Per-merchant evidence | **Conformal p-values** per class and for novelty (Vovk et al. 2005) | p = (#{sᵢ ≥ s} + 1) / (n + 1) | uniform under exchangeability (KS test) |
| Guaranteed false alarms | **Neyman–Pearson umbrella** threshold (Tong, Feng & Li 2018) | smallest k with Σⱼ₌ₖⁿ C(n,j)(1−α)ʲαⁿ⁻ʲ ≤ δ | 300 simulations: violation rate ≤ δ |
| Cost | **Expected cost curve** at deployment prevalence | C_FN·π·(1−TPR) + C_FP·(1−π)·FPR | minimum at 1/(1+C_FN/C_FP) for calibrated scores |
| Real fraud rate | **EM prevalence estimation** under label shift (Saerens et al. 2002) | πₜ₊₁ = mean of p′ᵢ, p′ᵢ ∝ (π/π₀)pᵢ | recovers a true 5% from scores calibrated at 33% |
| Drift | Score and per-feature **PSI** and **Kolmogorov–Smirnov**, **Benjamini–Hochberg** q-values | PSI = Σ(a−e)ln(a/e); qᵢ = pᵢ·m / rank | quiet on unshifted data, loud on a 0.5σ shift |

Why the Mondrian conformal sets stay valid after the prior shift: each class is calibrated only against its own
members, so the per-class coverage guarantee does not depend on how common that class is (label shift leaves
P(x | y) unchanged).

### Rigorous results

| Test | Result |
|---|---|
| Calibration chosen by cross-fitted log loss | identity 0.067, beta 0.074, isotonic 0.092: the stacker is already calibrated, so no extra layer |
| Brier decomposition (held-out) | 0.0100 = reliability 0.0062 − resolution 0.2185 + uncertainty 0.2222; skill 0.955 |
| **Nested CV, stacked vs plain average** | log loss 0.051 vs 0.071; stacked better in **5 of 5** outer folds; reduction **0.0198, 95% CI [0.011, 0.028]** |
| Nested CV, unbiased average precision | 0.9966 (the single hold-out's 1.000 was optimistic) |
| DeLong, stacked vs plain average AUC | p = 1.0: ranking is saturated on this data; the gain from stacking is calibration, not ordering |
| Neyman–Pearson bar (α = 5%, δ = 5%) | threshold 0.191; held-out recall 100%, false alarms 5.8%, Wilson CI [2.9%, 11.6%] |
| Cost-optimal threshold, measured vs theory | 0.67 measured vs 0.70 from prior shift + Bayes rule: independent confirmation of the prior-shift maths |
| Model disagreement on unseen fraud types | 0.14 bits on non-round deposits vs 0.002 on obvious deposits (perfect mimics: 0.004, confidently missed) |
| EM fraud-rate estimate, fresh batch of 250 | true 10.0%, **EM 10.4%**, naive score mean 12.7% |

## Measured effect (180 held-out synthetic merchants)

| | v0 ensemble as served | v0 ensemble, all features | **v1 stacked** |
|---|---|---|---|
| Average precision | 0.995 | 1.000 | **1.000** |
| Brier score (lower is better) | 0.076 | 0.012 | **0.010** |
| Log loss (lower is better) | 0.228 | 0.058 | **0.034** |
| Calibration error, ECE | 0.131 | 0.040 | **0.019** |
| Fronts caught at the cost bar (0.70 on the training scale) | 45% | 93% | **97%** |
| Honest merchants flagged at that bar | 0% | 0% | **0%** |
| Conformal coverage, fronts / honest (target 90%) | n/a | n/a | **97% / 89%** |

**Fraud types the models never saw** (retrain without one type, then score that type):

| Unseen type | Plain average | v1 stacked | v1 caught or flagged unfamiliar |
|---|---|---|---|
| small side-stream | 53% | **95%** | 95% |
| same-QR blend | 89% | **100%** | 100% |
| low-volume split | 100% | 100% | 100% (73% also flagged unfamiliar) |
| non-round deposits | 0% | 6% | 6% |
| perfect mimic | 0% | 0% | 0% |
| the other seven types | 100% | 100% | 100% |

The fake online store from the demo samples is a type the generator never produces. v1 still scores it low, but now
marks it **unfamiliar, LOW confidence**, naming the never-seen website detectors (B9, G2) that drove it. v0 said 0.01
with HIGH confidence.

Full numbers: `reports/stage2-v1-evaluation.json` and `reports/stage2-v0-baseline.json`.

## Limits that remain

- **Synthetic data only.** Near-perfect in-distribution scores mean the generated fronts are easy, not that real fronts will be.
- **Training data gaps.** Some features never vary in the generator (for example detector K1, and the website detectors),
  so the models cannot use them. Real-looking merchants are therefore often flagged unfamiliar (8 of 11 demo samples).
  Broadening `engine/synthetic.ts`, or analyst labels, fixes this.
- **Non-round deposits and perfect mimics** are not caught: payment features cannot separate them.

## Round 3: four parallel improvements, measured

| Track | What was added | Measured effect | Merged? |
|---|---|---|---|
| Fraud-statistics features (`engine/fraudMath.ts`) | Benford χ², p-value and Nigrini MAD; daily index of dispersion; gap burstiness B = (σ−μ)/(σ+μ) and CV; payer Shannon entropy and Gini; returning-payer share; repeat-gap regularity | Unseen **non-round deposits 6% → 83%** [61%, 94%] (fragile: 22% without three of the features, n = 18); nested ECE 0.017 → **0.009**; epistemic AUROC for errors 0.70 → **0.93**; perfect mimics still 0% | **Yes** |
| Exact SHAP explanations (`ml/explain.py`) | Ensemble attributions in stacked-logit space: φ = Σ wₖφₖ. TreeSHAP for LightGBM; linear SHAP for LR; TreeSHAP for the tree and forest rescaled to log-odds (exact sum); integrated gradients for the MLP | base + Σφ equals the stacked logit to about 0.005 (exact for the tree models and LR) | **Yes** |
| Deep-ensemble MLP (`ml/deep_ensemble.py`) | 5 seeds averaged; member logit spread as extra uncertainty | Neutral: stacked log loss 0.034 → 0.035; no clear uncertainty gain; 5× slower NN training | Opt-in: `MRE_DEEP_ENSEMBLE=1` |
| Pruning and focal loss (`ml/focal.py`) | Cost-complexity pruning R_α(T) = R(T) + α\|T\|; RF bootstrap fraction; focal-loss LightGBM with derived gradient and Hessian (checked by finite differences) | Neutral: CV re-selected the v1 settings; focal loss hurt calibration (LightGBM log loss 0.043 → 0.081 → 0.138 for γ = 0, 1, 2) | Opt-in: `MRE_EXTENDED_TREES=1` |

**Combined model (features + SHAP), promoted by the gate.** Held-out change vs the previous champion, 95% CI:
AP −0.001 [−0.004, 0.000], Brier −0.002 [−0.006, +0.003], log loss −0.006 [−0.017, +0.004]: non-inferior.

| | Previous v1 | With round 3 |
|---|---|---|
| Nested CV log loss / ECE | 0.051 / 0.017 | 0.0505 / **0.009** |
| Unseen non-round deposits | 6% | **83%** |
| Unseen small side-stream | 95% | 84% (intervals overlap) |
| Held-out log loss / false alarms | 0.034 / 0% | 0.041 / 0.8% (1 merchant) |
| Epistemic AUROC for errors | 0.70 | 0.93 |

**Side effect:** on the hand-built demo shops, the new payer features look unlike the generator's merchants, so honest
demo shops now get an empty conformal set (LOW confidence, review suggested) although none is flagged. SHAP shows
`payer_entropy`, `payer_gini` and `returning_share` (and earlier `weekend_share`) as the drivers. The fix is a more
realistic payer model in `engine/synthetic.ts`.

## Continuous learning, verified end to end

**Labels teach the model a new pattern.** "Small side-stream" fronts were removed from the synthetic training data, so
the model had never seen them. Analysts then opened and labelled 80 cases (40 fronts, 40 honest) through the real
workflow (`openInvestigation`, `labelInvestigation`; 47 needed a second reviewer) in a scratch database. After export
and retraining, both models were scored on 120 fresh merchants nobody labelled (`ml/experiment_continuous_learning.py`,
`reports/continuous-learning-experiment.json`):

| | A: no labels | B: with 80 labels |
|---|---|---|
| Fronts caught at the bar | 88.3% [78%, 94%] | **100%** [94%, 100%] |
| False alarms | 0% | 0% |
| Log loss | 0.078 | **0.005** |

Recall gain +11.7 points, 95% CI [+4.5, +20.3]; McNemar 7–0, p = 0.016. Other kinds were not harmed: log loss on 178
held-out merchants went from 0.050 to 0.030, false alarms stayed at 0. The real gate promoted B.

**The gate rejects worse models** (`ml/tests/test_promotion_gate.py`):

| Challenger | AP Δ [95% CI] | Brier Δ (negated) | Log loss Δ (negated) | Decision |
|---|---|---|---|---|
| 60 merchants, 30% labels wrong | −0.666 [−0.733, −0.599] | −0.235 | −0.648 | rejected, champion unchanged |
| all merchants, 10% labels wrong | −0.005 [−0.014, −0.000] | −0.042 [−0.053, −0.032] | −0.195 [−0.221, −0.171] | rejected |
| identical model | 0 | 0 | 0 | promoted, rollback copy kept |

The second row is why log loss is in the gate: ranking barely moved (AP 0.995), but calibration collapsed.

Reproduce:

```
MRE_DB_FILE=<scratch.db> npx tsx ml/simulate_analyst_labels.ts "small side-stream" 40 60
MRE_DB_FILE=<scratch.db> npx tsx ml/export_labels.ts <labels.csv>
python -m ml.experiment_continuous_learning --labels <labels.csv> --kind "small side-stream" --work <dir>
```

## Continuous learning loop

```
npm run ml:labels      # 1. export analyst-labelled cases (final labels only, merchant ids hashed)
npm run ml:features    # 2. regenerate the synthetic training data from the engine
npm run ml:train       # 3. train a candidate: analyst labels weigh 5x a synthetic row
npm run ml:promote     # 4. champion/challenger gate; promotes only if not worse, keeps the old model for rollback
npm run ml:baseline    # optional: re-score the v0 models for comparison
```

Restart the ML server after a promotion. `ml/serve.py` uses `ml/models/stage2-v1` when present and falls back to v0.
