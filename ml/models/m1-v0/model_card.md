# M1-v0 model card

Purpose: second opinion on P(front). It does not choose the action.

Data: synthetic portfolio (`ml/data/features.csv`), SHA-256 fcccb6e56489e2255567ae7acf46879544fdd2fd2c912bd196202f59cda4093b.

Features: 101 columns from the TypeScript engine. Monotone +1 on llr_* and fired_*.

Params: {"num_leaves": 15, "min_child_samples": 20, "learning_rate": 0.1, "n_estimators": 200, "reg_lambda": 1.0, "colsample_bytree": 0.5, "subsample": 0.8, "subsample_freq": 1, "max_depth": 4}. Cross-validated average precision 0.9998.

Limits: trained on synthetic merchants from engine/synthetic.ts, never on the demo samples. Not a measure of real-world accuracy. Second opinion only.
