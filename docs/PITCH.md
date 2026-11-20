# Five-minute pitch

Every number below is from a file in `reports/`. The portfolio is synthetic. Say that out loud.

1. The question is whether the merchant behaves like the business it declared. The RBI payment-aggregator direction asks aggregators to monitor transactions against that profile.
2. A folder of exports, or `POST /v1/score`, runs the same engine. Two column layouts are configuration.
3. On 1,000 synthetic merchants the false-discovery queue opened 40 cases, with about 0.02 expected false alarms (`reports/benchmark.md`).
4. Recall 0.684 (Wilson 0.555–0.790). Precision 0.975 (Wilson 0.871–0.996). Genuine-merchant false-positive rate 0.001 (Wilson 0.000–0.006). Same file.
5. Telegram betting in that portfolio was not opened by the queue (0/14). The per-merchant engine still scores the hand-built Telegram sample as a case. Thinning its sales is an evasion the red team records (`reports/redteam.md`).
6. The trace shows the Bayesian waterfall. The trained model is a second opinion: AUC-PR 1.000 versus the Bayesian posterior 0.915 on the synthetic hold-out (`reports/model-comparison.md`). M1 does not decide.
7. A second person approves any restriction. The evidence pack is a draft for the principal officer, not a filing.
8. One process serves the API on port 8787. Docker is in `deploy/`. If the model process stops, the score still returns and `ml` is null.
9. Limits: norms are expert priors, probabilities can saturate, and nothing here was measured on a real portfolio. `mre demo:learn` shows a proposal that a different admin must promote. The engine does not promote itself.

## Questions a technical judge will ask

- Does the data leave the building? The process runs in the aggregator's network. Identifiers are HMAC pseudonyms. The key stays with them.
- How do we plug this in? Daily files, a versioned score API, the analyst screens, or the evidence pack attached to a case they already have.
- Can we change the workflow without a fork? `workflow/*.json`. A config that drops the second approver for a funds restriction is rejected.
- What happens when the pattern moves? The red-team note and the controlled proposal loop. No automatic promotion.
