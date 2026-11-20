# Model comparison (synthetic)

**Synthetic.** Held-out merchants from the portfolio generator. This is not real-world accuracy.

Whichever ranks better on average precision: **M1**.

| Model | AUC-PR | bootstrap 95% | Recall at 0.10 | Wilson 95% | Genuine FP rate | Wilson 95% | ECE |
|---|---|---|---|---|---|---|---|
| M1 calibrated | 1.000 | 1.000–1.000 | 17/17 | 0.816–1.000 | 0/283 | 0.000–0.013 | 0.000 |
| Bayesian posterior | 0.915 | 0.805–1.000 | 17/17 | 0.816–1.000 | 34/283 | 0.087–0.163 | 0.098 |

McNemar exact p on decisions at 0.10: 0.0000.

M1 stays a second opinion. It does not open or close a case.
