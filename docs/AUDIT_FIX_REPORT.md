# Merchant Reality Engine: what changed, and why

**Date:** 22 November 2026 · **Branch:** `fix/audit-issues`, cut from `hackathon-impl` at `ceaa331`

**State:** proposed on this branch, for team review before merge and deployment.

**Who did it:** Claude (an AI assistant), at a team member's request. See `AI_USAGE.md`.

> Security findings are summarised here without reproduction detail. The team holds the full report.

Status key: **Fixed** = changed and tested · **Partly** = better, with a stated limit · **You** = needs the team.

---

## 1. The short version

| | Before | After |
|---|---|---|
| Honest merchants wrongly opened as fraud | 426 of 1,300 | **0 of 1,300** |
| Honest merchants told to restrict payments | 333 of 1,300 | **0 of 1,300** |
| Same, when no payer location exists | 257 opened, 198 restricted | **0 and 0** |
| Fronts opened as a case | 653 of 1,000 | 653 of 1,000 |
| Same, when no payer location exists | 280 of 1,000 | 328 of 1,000 |
| Fronts opened or asked to explain | 653 of 1,000 (there was no "ask") | 932 of 1,000 |
| Price paid: honest merchants asked to explain | none | 229 of 1,300 |
| Security and approval controls | Had gaps | Hardened, with regression probes |
| AI model with one feed removed | Flags 928 of 928 honest merchants | Replaced by a model that cannot see that shortcut |

In one sentence: **honest shops are no longer punished for being different, overall detection did not drop, and some fronts
that used to become cases now become questions.** Section 4 lists exactly which.

All numbers are synthetic. None is real-world accuracy.

### The two ideas the fix is built on

1. **Score every QR, not the shop.** Betting hidden on one link no longer averages away, and only that link gets restricted.
2. **A change is a question. Misconduct is a case.** Unusual hours or prices lead to a Context Passport request. A case needs
   behaviour that a change of business cannot explain, such as the same distant people topping up again and again.

---

## 2. How it was tested

- **A locked exam.** 46 kinds of merchant, 50 of each, with and without payer location (4,600 files). It was written and hashed
  before any engine change (SHA-256 `ceccaf97…7861`) and run once the engine was finished. The rules were not tuned on it.
- **The limit of that exam.** The same assistant wrote the exam and the fix, knew what the exam contained, and all of it is
  synthetic. It shows regressions and direction. It is not an accuracy claim.
- **After the exam**, the engine got a speed option for backtests. The exam was re-run and the result was byte-identical.
- **Automated checks:** `npm test` passes (530 engine assertions, 35 security probes, 34 adversarial cases), as do the type
  check and the build.
- **By hand, in a browser:** the demo, the Context Passport, sign-in, a blocked single-person check followed by a second-person
  check, CSV mapping, the portfolio screen and a phone-width layout.
- **Security fixes** were re-tested. A database written by the old code opens under the new code.
- **The Netlify function** was bundled and called locally, across two simulated instances.

---

## 3. Every issue: before, change, why

### A. Security and approvals

Sign-in, sessions, two-person approvals, API input handling and audit-chain integrity were hardened. Each fix has a regression
probe in `npm run security` or was re-tested by hand. The item-by-item detail is in the team's copy of this report and can be
added here once the fixed version is deployed.

### B. Honest merchants were punished

| # | Before | What changed | Why | Status |
|---|---|---|---|---|
| B1 | Petrol pumps, temples, NGOs, online brands, hotels and coaching centres became fraud cases | A case needs at least one conduct signal | Being different is not wrongdoing | Fixed |
| B2 | A bakery adding midnight delivery was told to restrict payments | It gets a question and no restriction | The problem statement asks for exactly this | Fixed |
| B3 | Seven categories existed. Everything else was judged as a 9-to-9 local shop | About 40 categories. Unlisted ones abstain | A guess became an accusation | Fixed |
| B4 | H3 re-counted round, location and timing signals as a new independent family | It measures only their co-occurrence, is shrunk, and is not independent | Double counting pushed honest shops over the gate | Fixed |
| B5 | Volume growth and the declaration counted as independent evidence | They support but cannot open the gate | Growth is not fraud | Fixed |
| B6 | Match-time payments counted against sports bars | They count as conduct only with distant payers | A local match-night crowd is custom | Fixed |
| B7 | The weeks under test were part of their own baseline | Excluded | It hid real jumps and invented others | Fixed |
| B8 | With no suspect link, the busiest QR was disabled | No fallback. The recommendation stops at due diligence | That QR is an honest shop's whole income | Fixed |
| B9 | The Context Passport was a text toy that changed nothing | It changes the expectation for one QR, for up to 180 days, after a second person verifies it | Honest merchants need a way to answer | Fixed |
| B10 | Merchants with no case were still recommended "enhanced monitoring" by a cost formula | No case and nothing to explain means no contact | Unnecessary scrutiny | Fixed |

### C. The bakery that takes bets

| # | Before | What changed | Why | Status |
|---|---|---|---|---|
| C1 | Only the whole account was scored | Each QR or link with 30+ sales, and the repeat-payer group, is scored separately | A side business vanishes in an average | Fixed |
| C2 | A front could register as "furniture" and escape (0 of 50 caught) | Three category-free conduct tests (B8, B10, C6). Caught 50 of 50 with location | The declaration must not buy innocence | Partly: without location, a question |
| C3 | Looking normal for a self-chosen category earned full credit | A quarter of the credit | Same | Fixed |
| C4 | "Disable one link" had no real scope | Only identified links, and the rest keeps running | Proportionate response | Fixed |
| C5 | Small or mixed-in side businesses were missed | Many now become questions | Too few payments or repeat payers to prove conduct | Partly |
| C6 | A perfect mimic was invisible | Still invisible, and now stated | It needs test purchases, crawls or complaints | Partly |

### D. Missing data and data the PA does not have

| # | Before | What changed | Why | Status |
|---|---|---|---|---|
| D1 | No payout feed counted as proof of innocence (I2, I3) | UNKNOWN, weight 0 | A PA cannot see post-settlement payouts | Fixed |
| D2 | No crawl, no peers or no bank credits could count as calm or as a failure | UNKNOWN | Same principle | Fixed |
| D3 | A payment never checked against orders counted as "no order" | Only an explicit "none found" counts | Absence is not evidence | Fixed |
| D4 | A missing location counted as "out of state" on the pattern board | Ignored | UPI IDs carry no state | Fixed |
| D5 | Blank hours or catchment were tested as if the merchant had declared them | Marked undeclared and not tested | The engine put words in the merchant's mouth | Fixed |
| D6 | Any settlement above ₹10 lakh rejected the whole merchant | Limits are ₹2 crore per payment, ₹1,000 crore per settlement | Normal merchants were unscorable | Fixed |
| D7 | Weekly totals were never checked against the ledger | A mismatch over 25% makes volume evidence UNKNOWN | Typed numbers were treated as fact | Fixed |

### E. CSV upload

| # | Before | What changed | Why | Status |
|---|---|---|---|---|
| E1 | Six weeks of history were invented | History comes from complete ledger weeks only | Fabricated evidence | Fixed |
| E2 | FAILED payments were counted as sales | Only successful rows | Wrong money | Fixed |
| E3 | `payer_state` was used as the payer's identity | Exact column matching, one column per field | Every payer looked like one repeat payer | Fixed |
| E4 | 05/10/2026 was read as 10 May. Bad dates were invented | Day first. Unreadable rows are reported | It turned a steady bakery into a case | Fixed |
| E5 | Name and category were pre-filled for the user's file | Category must be chosen | A default became a claim | Fixed |
| E6 | Unknown transaction types became sales | Left out and reported | Same | Fixed |
| E7 | A partial first week created a false spike, and peers' sales were mixed in | Both fixed in the batch adapter | False volume alarms | Fixed |

### F. The AI, learning and the numbers

| # | Before | What changed | Why | Status |
|---|---|---|---|---|
| F1 | Account age, bank feed and purchaser panel each revealed the label perfectly | New generator, with a test that fails if they leak again | The model learned the answer sheet | Fixed |
| F2 | 1,000 merchants were copies of 9 samples | Every merchant is generated separately | Recall measured copying | Fixed |
| F3 | LightGBM put 99.84% of its weight on one feature. The neural network failed the same way | Both withdrawn. A constrained logistic model replaces them | It cannot use age, category or feed presence | Fixed |
| F4 | Labels changed nothing, though the screen said they did | 10+ merchants' labels can propose a calibration. Scores change after a backtest and a second person's approval | The claim is now true | Fixed |
| F5 | One merchant uploaded 12 times was 12 labels | One merchant, one label | Easy poisoning | Fixed |
| F6 | "Self-improvement" tested on the six identical frauds it trained on, and four shops | Separate design and holdout suites with small honest merchants | It had raised false alarms from 0 to 65 of 560 | Fixed. It currently finds no safe threshold change and says so |
| F7 | The learning demo wrote to `rules/` and printed a fake second approver | It edits nothing and approves nothing | A staged approval | Fixed |
| F8 | Promoted rules vanished on restart while the audit said "live" | Stored in the database | Audit and engine disagreed | Fixed |
| F9 | The red team had 2 distinct results from 24 "attacks" | 98 different fronts, 8 attacks, weaknesses printed | Honest robustness figures | Fixed |
| F10 | The backtest froze the server for 16 seconds | About 3 seconds | It would hang a live demo | Partly: still blocks for about 3 seconds |

### G. Screens, evidence and claims

| # | Before | What changed | Why | Status |
|---|---|---|---|---|
| G1 | The homepage claimed 12.4M+ transactions and 2.1M+ merchants | Deleted | Invented | Fixed |
| G2 | "113 patterns" (also 112) | 28 detectors, the real count | 88 did not exist | Fixed |
| G3 | The merchant letter named the signals, including "Pre-match funding" | One neutral letter for everyone | Tipping off is against RBI's KYC Direction | Fixed |
| G4 | The capacity slider showed 69.4% beside a 90.3% claim, with 15 cases missing | The whole queue, counted against the labels | It contradicted itself | Fixed |
| G5 | "GMV at risk", "protected" and "saves ~15 min" had no measurement behind them | Removed | Unsupported | Fixed |
| G6 | "Matches KYC" used different thresholds from the engine | Follows the engine's own tests | The screen contradicted the verdict | Fixed |
| G7 | Hero bakery: weekly ₹5.4 lakh against a ledger of ₹1.26 lakh | Every sample reconciles | Judges can add | Fixed |
| G8 | Two pairs of samples had identical payments | All distinct | Looked copied | Fixed |
| G9 | The evidence pack's "dataset hash" was a hash of the merchant ID | Hashes the dataset and says what was hashed | False integrity claim | Fixed |
| G10 | The trust ladder proposed delayed settlement on a score | Due diligence first, then an identified link with approval | It contradicted governance | Fixed |
| G11 | Saved cases were re-scored in the browser | They show the server's recorded decision | Two answers for one case | Fixed |
| G12 | Four demo merchants, none showing the hard problem | Six, adding betting on the side and an honest change | These are the pitch | Fixed |

### H. Repo, deployment and business

| # | Before | What changed | Why | Status |
|---|---|---|---|---|
| H1 | Docker's port could never answer (bound to loopback) | `HOST` setting, simpler image | Broken deployment | Partly: Docker not installed here, so not run |
| H2 | The README said Node 20. It needs 22.13 | Corrected and enforced | Crash on start | Fixed |
| H3 | `start.sh` silently used an old server already on port 8787 | Refuses with a message | You would demo old code without knowing | Fixed |
| H4 | Docs contradicted each other and the code | Rewritten | Judges read the repo | Fixed |
| H5 | AI instruction files sat in the repo root with no disclosure | Kept in `docs/history/`, disclosed in `AI_USAGE.md` | Disclosure, not deletion | Partly: team section to complete |
| H6 | No real case, stale law status, no business case, no Q&A | `PITCH.md`, `BUSINESS_CASE.md`, `JUDGE_QA.md`, `DEMO_GUIDE.md` | 40% of the finale is feasibility and innovation | Fixed (costs are labelled assumptions) |

---

### I. Found when this branch was re-tested, and fixed

The re-test found nine problems. Several came from this branch's own first fix, whose tests were too loose. Each area now has a
test of the rule itself (`tests/engine/retest.test.ts`), run first on the earlier commit to show that it failed.

| Area | What holds now | Status |
|---|---|---|
| Context Passport | Suspended whenever a conduct signal fires, limited in breadth, never trusted from a file | Fixed |
| Input | Malformed fields and unknown keys are refused. A score that is not a number is an error, never "no case" | Fixed |
| Scale | 260,000-row ledgers score without overflow, in about 1.2 seconds on a laptop | Fixed |
| Batch | Same promoted rules and verified passports as the server | Fixed |
| Approvals and labels | Two people to lift as well as to impose. Labels can be rejected or withdrawn | Fixed |
| Service clients and secrets | Records are scoped to the client. Weak secrets are refused | Fixed |

Limits that remain:

- A passport can quieten the question for a front that shows no conduct at all (240 of 2,400 synthetic fronts with the widest
  passports on every QR). In the same test of 6,000 merchants, no case and no conduct-bearing score moved.
- A passport cannot clear a false alarm that has a conduct signal. A person must (1 of 3,600 honest merchants in that test).
- A verified passport cannot yet be revoked. It expires within 180 days.
- A restriction belongs to a case, not to the merchant: a new case for the same merchant does not show it.

---

## 4. What got worse, stated plainly

These are the trade-offs. Know them before a judge finds them.

**In the locked exam**

| Front | Case before | Case after | What happens now |
|---|---|---|---|
| Thin split account | 50/50 | 0/50 | All 50 asked |
| Same, no location | 20/50 | 0/50 | 24 asked, the rest missed |
| Betting as petrol pump, NGO, rare category or D2C, **no location** | 50/50 each | 0/50 each | All asked |
| Non-round betting, whole account | 3/50 | 0/50 | All asked |

The old engine caught the camouflaged fronts by also flagging 50 of 50 honest petrol pumps and NGOs.

**In the first audit's smaller-shop suite** (about 8 sales a day, 14 days of ledger, no QR ids)

| Betting share | Case before | Case after | Asked after |
|---|---|---|---|
| 20% | 11/40 | 0/40 | 39/40 |
| 30% | 40/40 | 0/40 | 40/40 |
| 50% | 40/40 | 28/40 | 12/40 |
| 50%, with a QR id on the side link | not tested | 40/40 | 0 |

So per-QR scoring needs QR ids, enough payments on the link and returning payers. **Do not say "we catch 10% side betting".**
Say: "we question it, and we open a case when the link has enough evidence."

**Elsewhere**

- Restriction is recommended less often for fronts (614 to 248 of 1,000 with location). A single-QR front now gets due
  diligence, and people decide on a hold.
- One old adversarial test now expects a question instead of a case. The change is commented in `scripts/adversarial.ts`.
- Headline recall on the repo's benchmark is 40.7% (82.7% including questions), against the withdrawn 90.3%.
- Questions are 94% of the estimated operating cost (`docs/BUSINESS_CASE.md`).
- The red team avoids a case 94% of the time just by avoiding round amounts (all still questioned). Doing four evasions at once
  avoids a case 99% of the time, and 28 of 98 are not even questioned.

---

## 5. The exam, merchant by merchant (with payer location, out of 50)

| Honest merchant | Case before | Case after | Restrict before | Asked after |
|---|---|---|---|---|
| Ordinary bakery | 0 | 0 | 0 | 7 |
| Wedding-season surge | 0 | 0 | 0 | 7 |
| New pan-India gifting link | 8 | 0 | 0 | 50 |
| New midnight delivery | 1 | 0 | 0 | 50 |
| Catering advances | 0 | 0 | 0 | 50 |
| Second outlet, next state | 16 | 0 | 0 | 50 |
| Match-night snack combos | 0 | 0 | 0 | 5 |
| Highway petrol pump | 50 | 0 | 50 | 2 |
| Temple trust | 50 | 0 | 50 | 0 |
| NGO | 50 | 0 | 50 | 2 |
| D2C fashion | 50 | 0 | 50 | 0 |
| Coaching institute | 50 | 0 | 50 | 0 |
| Taxi operator | 50 | 0 | 6 | 0 |
| Hotel | 50 | 0 | 50 | 0 |
| Sports turf | 50 | 0 | 27 | 5 |
| 24-hour chemist | 1 | 0 | 0 | 0 |
| Ten others (kirana, tea stall, two restaurants, cinema, recharge, salon, jeweller, electronics, pet shop) | 0 | 0 | 0 | 0–1 |

| Front | Case before | Case after | Asked after |
|---|---|---|---|
| Whole-account betting | 50 | 50 | 0 |
| Takeover in last four weeks | 50 | 50 | 0 |
| Own link, 5% | 0 | 0 | 50 |
| Own link, 10% | 0 | 3 | 47 |
| Own link, 20% / 35% / 50% | 50 / 50 / 50 | 50 / 50 / 50 | 0 |
| Same QR, 10% | 0 | 0 | 21 |
| Same QR, 25% / 50% | 50 / 50 | 50 / 50 | 0 |
| Kirana, own link, 20% | 50 | 50 | 0 |
| Non-round, whole account | 3 | 0 | 50 |
| Non-round, own link, 30% | 0 | 0 | 50 |
| Registered as furniture | 0 | 50 | 0 |
| Registered as petrol pump / NGO / rare / D2C | 50 each | 50 each | 0 |
| Thin split account | 50 | 0 | 50 |
| Perfect mimic | 0 | 0 | 11 |

Without location, per-QR scoring is where the gain is: own link at 20%, 35% and 50% went from 0, 0, 0 cases to 40, 46, 49.

---

## 6. What only the team can do

1. **Review this branch, then merge and deploy it.** It touches about 185 files, many generated. See `deploy/README.md`, and use
   fresh secrets when deploying.
2. **Demo from a laptop.** The hosted database is temporary, so cases can disappear between requests.
3. **Match the stall story to the submitted deck and video.** Neither was reviewed. Any "90% recall", "1.000", "113 patterns"
   or "LightGBM and neural network" in them is now withdrawn, and you should say so if asked.
4. **Complete `AI_USAGE.md` in your own words.** The rules score your insight and your ability to defend it.

## 7. Not verified

- Real merchant data: none exists here. Category norms and detector rates are expert guesses.
- Docker, a Node 22 runtime (tested on 24, lightly on 26), and a real Netlify deployment.
- The older Python prototype in `prototype/`, which the app does not use.
- Legal correctness of the response ladder. It is a product proposal.
- A penetration test. The probes cover the holes that were found, not the ones that were not.

## 8. Run it

```bash
npm ci
npm test
npm run dev:users
./start.sh
```

Then open `http://localhost:5173/demo` and follow `docs/DEMO_GUIDE.md`.
