# Model comparison (synthetic)

**Synthetic.** Held-out merchants from the portfolio generator. This is not real-world accuracy.

Whichever ranks better on average precision: **M1**.

| Model | AUC-PR | bootstrap 95% | Recall at 0.10 | Wilson 95% | Genuine FP rate | Wilson 95% | ECE |
|---|---|---|---|---|---|---|---|
| M1 calibrated | 0.999 | 0.997–1.000 | 60/60 | 0.940–1.000 | 8/120 | 0.034–0.126 | 0.023 |
| Bayesian posterior | 0.840 | 0.760–0.914 | 14/60 | 0.144–0.354 | 0/120 | 0.000–0.031 | 0.236 |

McNemar exact p on decisions at 0.10: 0.0000.

M1 stays a second opinion. It does not open or close a case.
