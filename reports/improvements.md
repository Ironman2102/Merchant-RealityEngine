# Model improvement (synthetic)

Held-out synthetic merchants. The neural network is a second opinion. It does not open or close a case.

Average precision: neural network 0.994, LightGBM 0.997, Bayesian engine 0.936.

RSI versus LightGBM: -0.0033817842318259327. RSI versus the Bayesian engine: 0.6753246753246753.

Relative score improvement on held-out synthetic fronts (including stealth split-account evasions before rule promotion). Positive means the challenger catches or ranks held-out fronts higher than the baseline.
