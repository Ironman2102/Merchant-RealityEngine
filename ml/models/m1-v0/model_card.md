# M1-v0 model card

Purpose: second opinion on P(front). It does not choose the action.

Data: synthetic portfolio (`ml/data/features.csv`), SHA-256 cbaf3f8a81f842c20f07358f9a697285924e873382fefe7dd41ebc5fc5700d5b.

Features: 112 columns from the TypeScript engine. Monotone +1 on llr_* and fired_*.

Params: {"num_leaves": 7, "min_child_samples": 20, "learning_rate": 0.05, "n_estimators": 100, "reg_lambda": 5.0}. Cross-validated average precision 1.0000.

Limits: trained on synthetic data derived from nine hand-built samples. Not a measure of real-world accuracy. Second opinion only.
