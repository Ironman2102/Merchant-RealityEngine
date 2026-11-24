# M1-v0 model card

Purpose: second opinion on P(front). It does not choose the action.

Data: synthetic portfolio (`ml/data/features.csv`), SHA-256 e293df6af8fbbfe9d8d853f05e06bf7be87f18c85bb69cf63dbec0b0be3dd98b.

Features: 91 columns from the TypeScript engine. Monotone +1 on llr_* and fired_*.

Params: {"num_leaves": 7, "min_child_samples": 30, "learning_rate": 0.05, "n_estimators": 200, "reg_lambda": 1.0, "colsample_bytree": 0.5, "subsample": 0.8, "subsample_freq": 1, "max_depth": 4}. Cross-validated average precision 1.0000.

Limits: trained on synthetic data derived from nine hand-built samples. Not a measure of real-world accuracy. Second opinion only.
