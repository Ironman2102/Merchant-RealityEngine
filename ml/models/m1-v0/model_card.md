# M1-v0 model card

Purpose: second opinion on P(front). It does not choose the action.

Data: synthetic portfolio (`ml/data/features.csv`), SHA-256 e72a157e63317e6c5f00ecc425004871f4284701762c1b12860876a92717aef1.

Features: 112 columns from the TypeScript engine. Monotone +1 on llr_* and fired_*.

Params: {"num_leaves": 7, "min_child_samples": 20, "learning_rate": 0.05, "n_estimators": 100, "reg_lambda": 5.0}. Cross-validated average precision 1.0000.

Limits: trained on synthetic data derived from nine hand-built samples. Not a measure of real-world accuracy. Second opinion only.
