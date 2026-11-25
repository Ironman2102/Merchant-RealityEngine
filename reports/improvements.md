# Model improvement (synthetic)

Held-out synthetic merchants. The neural network is a second opinion. It does not open or close a case.

Average precision: neural network 0.996, LightGBM 0.997, Bayesian engine 0.936.

RSI versus LightGBM: -0.0016789776312854901. RSI versus the Bayesian engine: 0.6883116883116883.

Relative score improvement on held-out synthetic fronts (including stealth split-account evasions before rule promotion). Positive means the challenger catches or ranks held-out fronts higher than the baseline.
