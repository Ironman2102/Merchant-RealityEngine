# Model improvement (synthetic)

Held-out synthetic merchants. The neural network is a second opinion. It does not open or close a case.

Average precision: neural network 0.997, LightGBM 0.999, Bayesian engine 0.840.

RSI versus LightGBM: -0.0023950680347335713. RSI versus the Bayesian engine: 3.2857142857142856.

Relative score improvement on held-out synthetic fronts (including stealth split-account evasions before rule promotion). Positive means the challenger catches or ranks held-out fronts higher than the baseline.
