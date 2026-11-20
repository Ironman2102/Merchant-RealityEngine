# Model improvement (synthetic)

Held-out synthetic merchants. The neural network is a second opinion. It does not open or close a case.

Average precision: neural network 1.000, LightGBM 1.000, Bayesian engine 0.915.

RSI versus LightGBM: 0.0. RSI versus the Bayesian engine: 0.09319593715827611.

Relative score improvement: (neural-network average precision − comparison average precision) / comparison average precision. Positive means the network ranks the held-out synthetic fronts higher.
