# Detection patterns

The homepage number **113** is a design count, not 113 named checks. It is the sum of the family sizes in `frontend/src/data/evidence.ts`. The engine runs **25** statistical detectors. Those 25 produce a log-likelihood ratio and vote in the Bayesian decision. A separate pack of **10** solution and betting patterns (S1–S7, N1–N3) is shown on the pattern board and does not cast that vote.

There is no list of 113 individual pattern names in the repo. The other **88** slots are counts only.

| Family | What the family is about | Designed | Live |
|---|---|---:|---:|
| A | Ticket size and menu fit | 12 | 3 |
| B | Payer behaviour and geography | 14 | 3 |
| C | Timing and seasonality | 12 | 2 |
| D | Money-flow shape and refunds | 14 | 3 |
| E | Cross-merchant cohorts and networks | 12 | 2 |
| F | Settlement and lifecycle | 12 | 4 |
| G | Catalogue, website and payment-link provenance | 14 | 2 |
| H | Drift, blending and rotation | 12 | 3 |
| I | Other abuse | 10 | 2 |
| K | Declared profile vs category norm | 1 | 1 |
| | | **113** | **25** |

A detector fires only when the p-value is at or below its alpha and the effect is at least `minEffect`. A missing feed is **UNKNOWN**. It is never treated as clean. The merchant’s own declaration is not the baseline. The baseline is the category norm in `rules/mcc.json`. The declaration is checked only by K1.

Names and tests below are taken from `rules/detectors.json` and `frontend/src/engines/detectors.ts`.

## A. Ticket size

**A1. Ticket sizes vs category norm.** Compares the whole ticket-size distribution with a log-normal category norm (Kolmogorov–Smirnov). Needs the acquiring feed and at least 30 sales. Menu prices are discrete, so a genuine shop already sits a bit away from a smooth curve. The practical bar is a KS distance of 0.20.

**A4. Round-number heaping.** Share of tickets on ₹500 multiples, against the category’s usual round-amount rate (beta-binomial). Real baskets rarely land on round values. Heaping suggests the payer chose the amount.

**A5. Deposit / bonus-tier amounts.** Share of tickets at deposit tiers such as ₹199, ₹999 and ₹1,999 that are not prices in the catalogue. Same kind of rate test as A4.

## B. Payers

**B6. Payers from outside the service area.** Share of payers outside the home state and its neighbours. Skipped as UNKNOWN when the category sells nationally, because geography is then not informative.

**B7. Heavy repeat payers.** Share of sales from payers who pay 8 or more times in a week. Betting depositors top up repeatedly. Regular shop customers usually do not.

**B9. Independent purchaser verification.** Of the people contacted, how many confirm they bought something, against an 80% bar for a genuine merchant. UNKNOWN when no sample was taken. A high confirmation rate is scored as supporting the genuine explanation.

## C. Timing

**C2. Sales outside category trading hours.** Share of sales outside the hours this kind of business is normally open. Overnight categories wrap past midnight.

**C5. Pre-match funding.** Share of match-day sales in the window before a fixture, compared with the same clock time on days without a match (2,000 permutations). UNKNOWN when the file has no fixtures, or when fixtures fall on every trading day or on none.

## D. Refunds and orders

**D7. Refunds without an original sale.** Share of refunds that do not link to a sale in the file, against a 2% norm. UNKNOWN when there are no refunds.

**D9. Refunds paid to someone other than the payer.** Linked refunds that go to a different person. A refund back to the payer’s own other account is not counted. The excess has to be worth at least ₹5,000 before it counts as a practical effect. UNKNOWN when no refund links to a sale.

**D10. Payments without an order.** Share of sales with no order id, against a 5% norm. Needs an orders feed.

## E. Networks

**E1. Payment link shared with other merchants.** Other merchants whose links sit on the same third-party host. A lead, not proof of common ownership. No third-party embed is scored as supporting the genuine explanation. A third-party embed that no other merchant shares is UNKNOWN.

**E3. Continuity with a dormant peer.** Shared payers with a monitored peer (hypergeometric), plus a continuity score. It carries weight when the new activity starts after the peer goes quiet. No monitored peers is UNKNOWN.

## F. Settlement and lifecycle

**F2. Account opened as a similar one went quiet.** A deterministic check: the account is under 45 days old and started within a few days of a similar peer’s last sale. A long account with no hand-off supports the genuine explanation. A young account with no clear hand-off is UNKNOWN.

**F5. Settlement beneficiary changes.** How often the settlement account changes, against the category’s yearly rate, and whether that account also settles another merchant. One change to a new account is treated as a possible bank switch and is not counted. Fewer than three settlements is UNKNOWN.

**F7. Orders not delivered / reused tracking.** Share of orders delivered with a unique tracking id, against a 90% bar. A reused tracking id counts as not delivered. Needs a fulfilment feed.

**F8. Settlements missing from bank credits.** Share of settlements that do not match a bank credit of the same amount to the same account, against a 2% norm. Needs a bank feed.

## G. Catalogue and website

**G2. Catalogue does not fit the category.** Share of catalogue items that are off-category or reuse an image, against 5%. A calm catalogue counts for little, because a catalogue is cheap to fake. No catalogue is UNKNOWN.

**G6. Payment link on an undeclared site.** A link embedded on a host the merchant did not declare. A known betting host is the stronger form of the same check. Links only on declared domains support the genuine explanation. No embeds is UNKNOWN.

## H. Drift and a hidden population

**H1. Volume above seasonal expectation.** Last four weeks of collections against a festival-adjusted weekly model. Volume alone is weak evidence. Too little weekly history is UNKNOWN.

**H2. Recent change in behaviour.** Probability of a change in the last four weeks, plus a CUSUM alarm tuned for about one false alarm per merchant-year. This is meant to ignore a single busy week. Too little history is UNKNOWN.

**H3. Joint off-profile cluster.** Share of sales that combine at least two of: round amount, out-of-area payer, and odd timing (off-hours or pre-match). The norm is about 1%. This is the “separate population inside the merchant” check.

## I. Other abuse

**I2. Onward payouts to many accounts.** Count of distinct payout beneficiaries against what this category normally pays. No onward payouts supports the genuine explanation.

**I3. Money swept out soon after settlement.** Share of settlements followed by an onward payout within 24 hours, against 10%. Fewer than three settlements is UNKNOWN.

## K. The declaration itself

**K1. Declared profile far from the category norm.** A chi-square on how far the declaration sits from the category: national catchment for a local category, unusually wide hours, a ticket ceiling above the category, and a declared round-amount share above the category. A merchant that declares an unusually wide profile switches ordinary checks off. The width of that declaration is itself a signal. A matching declaration supports the genuine explanation.

## Pattern pack (shown, not a fusion vote)

These run in `frontend/src/engines/patternPack.ts`. They add flags on the pattern board. They do not change the L4 probability. S5 reads the core verdict and these flags and suggests a step. The category prototypes in S1 are illustrative numbers, not a trained model.

**S1. Does this still look like the declared business?** Infers a type from ticket size, round amounts, payer spread, night share, repeat payers and refunds, then compares it with the declared MCC. UNKNOWN below 20 sales.

**S2. Peer-cohort drift.** Flags only when the merchant has moved from its own baseline and its shape (round share, out-of-state share) has moved away from active peers. A volume move that still matches the cohort is treated as explained.

**S3. Payer-network links to other merchants.** Shared payers (10 or more), the same third-party page, or the same settlement account. UNKNOWN when the file has no other merchants and no embeds.

**S4. Context Passport.** If core detectors fired, the merchant can offer a reason (festival, bulk order, new branch, delivery, new product). The pack checks which fired detectors that reason can explain and which it cannot. This is an input, not a score.

**S5. Graduated trust ladder.** Combines the core decision and the pattern flags into Low, Medium, High, Very high, or Confirmed. A confirmed-illicit label forces the top step. The actions are watch, ask, delay settlement, review, or suspend.

**S6. Business-reality cross-check.** Supplier payments and GST turnover against collections. A real shop spends a material share of sales on inputs. UNKNOWN without a `businessFootprint` feed.

**S7. Outside-in sightings.** Payment links found on a gambling or resale page, or advertised in a sighting. UNKNOWN when neither a crawl nor a sighting feed is present.

**N1. Loss-chasing sequences.** Three or more payers each make three rising payments within two hours. Flagged at three such payers.

**N2. Late-night collections.** Share of sales between 23:00 and 06:00. Flagged at 10% or more.

**N3. Rapid pass-through after settlement.** Payouts that leave within 24 hours of a settlement, to three or more accounts. UNKNOWN when there are no settlements.

## What is not in this document

The 88 catalogue slots that are not in the table above have no name, no test, and no code. They are not covered by the engine.
