# Detection patterns

The engine runs **28** detectors. That is the whole number: the old "113 patterns" was a design count with no list behind it
and has been withdrawn. A further 10 advisory checks (S1–S7, N1–N3) appear on the pattern board and do not vote.

A detector fires only when p ≤ alpha **and** the effect is at least `minEffect`. No data means UNKNOWN, weight 0.

| Id | Name | Class | Source | Level | Test |
|---|---|---|---|---|---|
| A1 | Ticket sizes vs category norm | profile | payments | account and streams | One-sample Kolmogorov–Smirnov vs the category's log-normal ticket shape, allowing the merchant's median to sit between one third and 1.8× of the category's; effect = KS distance D. |
| A4 | Round-number heaping | profile | payments | account and streams | Beta-binomial upper tail vs category round-amount rate; effect = excess share |
| A5 | Deposit / bonus-tier amounts | profile | payments | account and streams | Beta-binomial upper tail vs category rate of betting bonus-tier amounts; effect = excess share |
| B6 | Payers from outside the service area | profile | payments | account and streams | Beta-binomial upper tail of payers outside home + neighbouring states vs category rate; effect = excess share |
| B7 | Heavy repeat payers | profile | payments | account and streams | Beta-binomial upper tail: share of sales from payers paying >= 8 times in a week vs category rate |
| B8 | Repeat deposit-like payers | conduct | payments | account and streams | Category-free. Beta-binomial upper tail: share of sales that are ₹100-multiple payments of ₹200+ from payers making >= 4 of them within 14 days, vs 5% |
| B9 | Independent purchaser verification | conduct | panel | account only | Exact binomial lower tail of confirmations vs 80% for genuine merchants; effect = shortfall |
| B10 | Distant regulars | conduct | payments | account and streams | Category-free. Beta-binomial upper tail: share of sales from out-of-area payers who pay >= 4 times within 14 days, vs 4% |
| C2 | Sales outside category trading hours | profile | payments | account and streams | Beta-binomial upper tail of off-hours sales vs category rate; effect = excess share |
| C5 | Pre-match funding | profile (conduct with B6) | calendar | account and streams | Permutation test: in-window share on match days vs randomly chosen days (2,000 draws); effect = rate ratio. A profile signal on its own (shops are busy on match nights too); conduct when distant payers (B6) fire with it |
| C6 | Rapid rising top-ups | conduct | payments | account and streams | Category-free. Beta-binomial upper tail: share of sales inside a same-payer run of 3+ rising payments of ₹200+ within 2 hours, vs 1% |
| D7 | Refunds without an original sale | conduct | payments | account and streams | Beta-binomial upper tail of orphan refunds vs 2% norm; effect = excess share |
| D9 | Refunds paid to someone other than the payer | conduct | payments | account and streams | Beta-binomial upper tail vs 5% norm, excluding refunds to the payer's own other accounts; effect = excess share |
| D10 | Payments without an order | conduct | orders | account and streams | Exact binomial upper tail of unmatched payments vs 5%; effect = excess share |
| E1 | Payment link shared with other merchants | conduct | crawler | account and streams | Deterministic: number of other merchants with links on the same third-party host |
| E3 | Continuity with a dormant peer | conduct | network | account only | Hypergeometric test of payer overlap with the peer; effect = continuity score (needs a lifecycle hand-off) |
| F2 | Account opened as a similar one went quiet | conduct | network | account only | Deterministic: account < 45 days old and started within 7 days of a dormant peer's last sale |
| F5 | Settlement beneficiary changes | conduct | payments | account only | Poisson upper tail of beneficiary changes vs category rate per year; needs >= 2 changes or a beneficiary shared with a peer |
| F7 | Orders not delivered / reused tracking | conduct | fulfilment | account and streams | Exact binomial lower tail of delivered share vs 90%; reused tracking counts as undelivered; effect = shortfall |
| F8 | Settlements missing from bank credits | conduct | bank | account only | Exact binomial upper tail of unmatched settlements vs 2%; effect = excess share |
| G2 | Catalogue does not fit the category | conduct | crawler | account only | Exact binomial upper tail of off-category or reused-image items vs 5%; effect = excess share |
| G6 | Payment link on an undeclared site | conduct | crawler | account and streams | Deterministic: link embedded on an undeclared host (marketplaces are UNKNOWN; a known betting host also triggers override R-01) |
| H1 | Volume above seasonal expectation | profile | payments | account only | Log-normal weekly volume model with festival calendar offsets; Stouffer z over the last 4 weeks; effect = actual / expected |
| H2 | Recent change in behaviour | profile | payments | account only | Bayesian online changepoint: P(change in last 4 weeks); CUSUM with h set for one false alarm per merchant-year |
| H3 | Joint off-profile cluster | profile | payments | account and streams | Beta-binomial upper tail of sales with >= 2 off-profile traits vs what those traits' own rates predict if independent. It measures only the co-occurrence, not the traits again. |
| I2 | Onward payouts to many accounts | conduct | payments | account only | Poisson upper tail of distinct payout beneficiaries vs category norm; effect = ratio |
| I3 | Money swept out soon after settlement | conduct | payments | account only | Exact binomial upper tail of settlements followed by an onward payout within 24 h vs 10%; effect = excess share |
| K1 | Declared profile far from category norm | profile | kyc | account only | Chi-square on standardised gaps between the declared profile and the category norm (catchment, hours width, ticket ceiling, round share) |
