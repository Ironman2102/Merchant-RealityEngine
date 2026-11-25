# Model comparison (synthetic)

**Synthetic.** Held-out merchants from the portfolio generator. This is not real-world accuracy.

Whichever ranks better on average precision: **M1**.

| Model | AUC-PR | bootstrap 95% | Recall at 0.10 | Wilson 95% | Genuine FP rate | Wilson 95% | ECE |
|---|---|---|---|---|---|---|---|
| M1 calibrated | 0.997 | 0.993–0.999 | 130/131 | 0.958–0.999 | 8/256 | 0.016–0.060 | 0.014 |
| Bayesian posterior | 0.936 | 0.905–0.961 | 77/131 | 0.502–0.668 | 0/256 | 0.000–0.015 | 0.155 |

McNemar exact p on decisions at 0.10: 0.0000.

M1 stays a second opinion. It does not open or close a case.
