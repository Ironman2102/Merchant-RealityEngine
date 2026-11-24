# Model comparison (synthetic)

**Synthetic.** Held-out merchants from the portfolio generator. This is not real-world accuracy.

Whichever ranks better on average precision: **M1**.

| Model | AUC-PR | bootstrap 95% | Recall at 0.10 | Wilson 95% | Genuine FP rate | Wilson 95% | ECE |
|---|---|---|---|---|---|---|---|
| M1 calibrated | 1.000 | 1.000–1.000 | 22/22 | 0.851–1.000 | 0/278 | 0.000–0.014 | 0.000 |
| Bayesian posterior | 0.996 | 0.982–1.000 | 18/22 | 0.615–0.927 | 0/278 | 0.000–0.014 | 0.015 |

McNemar exact p on decisions at 0.10: 0.1250.

M1 stays a second opinion. It does not open or close a case.
