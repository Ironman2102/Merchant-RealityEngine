# Merchant Reality Engine (MRE)

https://merchant-reality-engine.netlify.app

**Does this merchant behave like the business it claims to be, on every QR it owns?**

A bakery can pass KYC with genuine papers and then collect betting deposits. MRE is a prototype for payment-aggregator risk teams
that finds that mismatch without punishing a bakery that has simply changed.

1. **Every QR is scored on its own.** A side business disappears in a shop's average. On its own link it stands out,
   once that link has enough payments (30 at the very least) and returning payers.
2. **A change is a question. Misconduct is a case.** Unusual hours, prices or places get a Context Passport request. A case needs
   independent evidence that includes conduct a change cannot explain.
3. **The Context Passport updates the engine.** The merchant names the QR, the date and a document; a second person verifies it;
   the expectation for that QR changes. If any conduct signal fires, passports are set aside and the score is the one without them.
4. **The response is narrow.** Only an identified link can be recommended for restriction, and never the main QR by default.
   A second person approves, and a second person is needed to lift it.

> **Everything is synthetic.** Merchants, transactions, pages and portfolio figures are fabricated. There are no customers,
> partners or real-world accuracy figures. The response design is a proposal, not legal advice, and nothing freezes real money.

## Measured, on synthetic data

Copied from `reports/benchmark.md` (1,000 generated merchants, seed 7).

| Figure | Value |
|---|---|
| Fronts opened as a case | 33/81 (0.407) |
| Fronts opened **or** asked to explain | 67/81 (0.827) |
| Honest merchants wrongly opened | 0/919 (Wilson upper bound 0.004) |
| Honest merchants recommended for restriction | 0/919 |
| Honest merchants asked to explain | 132/919 (0.144) |

Case recall is lower than the 0.903 this README used to show. That figure came from data that gave away the label and has been
withdrawn. See `docs/AUDIT_FIX_REPORT.md`.

## What it cannot do

- Find betting that copies a shop's amounts, hours, places and payer mix. That needs outside-in evidence: test purchases, crawls,
  sightings, complaints.
- Open a case on every small, thin or mixed-in front. A side business with few payments or few returning payers, or mixed into
  the main QR, often becomes a question where a cruder rule would have opened a case. Many become a question only (`reports/benchmark.md`, `reports/redteam.md`).
- Locate a payer from a UPI ID. Without payer location several camouflage categories become a question, not a case.
- Claim calibrated probabilities. Category norms and detector rates are expert priors until a shadow pilot supplies labels.

## Run it

Node.js **22.13 or later**.

```bash
npm ci
npm run dev:users   # local test accounts; random passwords in backend/data/dev-users.txt
./start.sh          # API on 127.0.0.1:8787, web app on localhost:5173
```

The guided demo at `/demo` needs no account. The AI Engine at `/ai-engine` needs a sign-in, and an approval needs a second
person's account (use a second browser profile).

```bash
npm test            # engine, leakage, audit regressions, security, adversarial
npm run build
npm run benchmark   # rewrites reports/benchmark.md and the console's queue
npm run train       # rewrites the second-opinion model and its report
npm run redteam     # rewrites reports/redteam.md
npm run mre -- batch --in examples/generic-pa --mapping adapters/mappings/generic-pa-v1.json --out out
```

## Demo merchants

| Merchant | Expected |
|---|---|
| Sweet Crumbs Bakery | Case. Betting link found by crawl, refunds and timing |
| Golden Oven Bakery | Case on one link, from payments alone. The counter QR stays live |
| Moonlight Bakes | No case. Asked about midnight delivery; a verified passport clears it |
| Anand Sweets | No case, no question. Diwali is expected |
| Nova Gift Emporium | Case. Rotation from a dormant account |
| Aarav Home Decor | Case, due diligence only. Sales cannot be substantiated |

## How a decision is made

1. 28 detectors run on the whole account, on each QR or link with 30+ sales, and on the group of repeat payers.
2. Each detector that is both statistically significant and large adds log-likelihood. Missing data adds zero.
3. A case opens when P(front) ≥ 10%, at least one **conduct** signal fired, and the evidence is independent (two sources, three
   families, or two different behaviours). Volume, the declaration and derived signals do not count towards independence.
4. Otherwise a departure from normal becomes **ASK**: a Context Passport request, with nothing restricted.
5. Labels can propose a calibration. It goes live only after a holdout backtest and approval by a different person.

The trained model (`engine/model.ts`) is a second opinion. It never chooses the action.

## Why it matters now

- [RBI's PA Master Direction](https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12896) requires monitoring merchants' transactions against their business profile.
- The [Online Gaming Act](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2254606&reg=3&lang=1) has been in force since 1 May 2026 and bars payment systems from processing money-game payments.

## Layout

```text
engine/      public entry, model, synthetic generator, improver, evidence pack, merchant letter
rules/       every number the engine uses
frontend/    website, guided demo, analyst screens, and the engine's detectors and fusion
backend/     API, sign-in, maker/checker, passports, audit
adapters/    PA export mapping     cli/  batch and admin commands
scripts/     benchmark, training, red team, checks
docs/        pitch, judge Q&A, business case, audit report
prototype/   an older, separate Python experiment; not used by the app and not maintained
```

How AI tools were used: [AI_USAGE.md](AI_USAGE.md).
