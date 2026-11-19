# Merchant Reality Engine: Stress-Test Audit and Strengthening Plan

Repo audited: `dhruv11bhandari/Merchant-RealityEngine` @ `1d1d9a8` ("improving backend"), 19 Nov 2026.
Everything here is reproducible from the `audit/` folder.

---

## 1. Verdict in one paragraph

The engine is a **clean, honest, explainable rules prototype**. Its thinking is unusually good: UNKNOWN is kept apart from clean, correlated signals are collapsed, benign evidence is discounted by how easy it is to fake, and the engine tests a competing "legitimate business" story before it recommends anything. All existing tests pass. But it is **tuned to its own synthetic scenarios**. Those scenarios are over-determined (the betting front sets off 12 of 20 detectors at once), so the demo never shows the engine's real weakness. Under adversarial testing, a launderer who simply **avoids leaving crawlable website evidence** and **keeps refunds and payouts clean** gets `NO_CASE`. That happens even though ticket-heaping, out-of-area payers, volume drift and joint off-profile clustering all fire. Meanwhile, **an honest merchant who changes bank accounts once** gets `OPEN_CASE`. On the backend there are two real security bugs (path traversal read and write) and a response workflow that one anonymous caller can push all the way to "terminate merchant".

---

## 2. What was run

| Suite | Command | Result |
|---|---|---|
| Engine self-test (4 scenarios, determinism) | `npm run selftest` | PASS: bakery/rotation/fabricated → OPEN_CASE; Diwali → NO_CASE; deterministic |
| API self-check | `npm run check:api` | PASS |
| Dataset import | `npm run test:dataset` | PASS (template → NO_CASE) |
| Production build (tsc + vite) | `npm run build` | PASS, but 1.24 MB single JS chunk (367 kB gzip) |
| Python prototype | `python prototype/tests.py` | PASS (scenario + messy-data), **only after** creating a venv; README's `pip install` fails on a system Python without pandas |
| **New: adversarial harness (27 cases)** | `npx tsx audit/adversarial.ts` | **22 robust, 5 weaknesses** (below) |
| **New: security probe** | `npx tsx audit/security-probe.ts` | **2 confirmed vulnerabilities, 1 governance gap** |

Scale: 50,000 extra sales ran in **0.7 s total** for the whole harness. Performance is not a problem at a single-merchant scale.

---

## 3. Adversarial test results

### 3.1 Cases that broke the engine

| # | Case | Should | Got | Why it matters |
|---|---|---|---|---|
| W1 | Betting front, refunds and payouts removed, one stable beneficiary, **website feed missing** | OPEN_CASE | **NO_CASE** | Families A, B, C, H all fire (round heaping, 5+ non-local states, pre-match lift, volume drift, joint cluster), but every one is tagged system `acquirer`, so the "≥2 source systems" gate fails. Most real transaction laundering has **no crawlable website**: app-only betting, Telegram/WhatsApp-distributed UPI links, QR codes in DMs. This is the main real-world path, and the engine misses it. |
| W2 | Same, and **no match calendar** | OPEN_CASE | **NO_CASE** | Families A, B, H still fire. Same cause. |
| W3 | Genuine sweet shop **switches bank account once** mid-period | NO_CASE | **OPEN_CASE (LOW)** | F5 fires on *any* beneficiary change (`detectors.ts:148`, `ch >= 1`), and F8 (bank reconciliation) fails with it. Two "systems" (settlement + bank), so the gate passes. Honest merchants change banks all the time. |
| W4 | Genuine Diwali shop + one bank change + 3 refunds to a UPI wallet | NO_CASE | **OPEN_CASE (LOW)** | D9 + F5 + F8 combine. Refunds to a wallet or a different VPA are common in UPI (the customer asks for the refund to another app). |
| W5 | `purchaserVerification` with confirmed (50) > contacted (10) | REJECT | accepted, NO_CASE | Impossible input is not validated (`dataset.ts`). The rate becomes 5.0 and is read as "benign, 500% confirmed". |

### 3.2 Cases it survived (keep these as regression tests)

- Fraudster widens its own declared profile (NATIONAL catchment, 0–24 h, ₹1–₹1,00,000 band): still OPEN_CASE, because C/D/E/F/G/I carry it. **But** A1, A4, B6 and C2 all go silent. See section 4.1.
- Fraudster sets `seasonalMultiplier = actual/baseline`: H1 disappears, the case still opens on the other families.
- Off-hours sales shifted to 21:00 and round amounts nudged by ₹37: still opens. C5 pre-match lift and B6 geography carry it.
- Acquirer-only data with refunds and payouts kept: opens MEDIUM. Note that it passes the "independent systems" gate only because settlement and payout ledgers are labelled as separate systems even though they come from the same acquirer.
- False-positive traps (college-area payers from 5 states, gift-box ₹500/₹1000 season, late-night delivery orders) each trigger only one family → NO_CASE. Good.
- Malformed inputs (no sales, negative amount, ticketMin > ticketMax, overnight hours [22,6], all-null weeks, zero seasonal multiplier, one sale, ₹1 split payments): no crashes, no NaN.

### 3.3 Silent wrongness found while testing (no crash, wrong meaning)

- **Overnight hours `[22, 6]`**: `offHours` (`detectors.ts:35`) computes `h < 22 || h >= 6`, so *every* hour counts as closed. C2 fires on 100% of sales. It was hidden in this test only because one family isn't enough to open a case.
- **ticketMin > ticketMax** is accepted. A1 then marks every sale as outside the band.
- **Betting front with fixtures = [] and calendar marked AVAILABLE**: C5 returns UNKNOWN. That is correct, but nothing warns that the calendar is empty.
- **50k duplicated sales at the same timestamp**: C5 flips to ILLICIT. Exact-duplicate events are not de-duplicated by (payer, amount, time).

---

## 4. What can make this useless (failure modes, ranked)

### 4.1 The merchant writes its own baseline (critical design flaw)
The ticket band, hours, local states, catchment, expected round-number share, baseline weekly volume and **weekly seasonal multipliers** are all read from the uploaded file (`dataset.ts:datasetToScenario`). Four detectors (A1, A4, B6, C2) judge the merchant against those declarations. In production, those values come from KYC forms the merchant fills in. A launderer who declares "national online sweets, 24×7, ₹1–₹1 lakh" switches off a third of the detector library. **Baselines must come from MCC peer cohorts the PA computes itself, never from the merchant.**

### 4.2 The independence gate measures labels, not independence
`systems` is the set of `system` strings on detectors (`evidenceFusion.ts:263`). Settlement, payouts and the refund ledger all come from the same acquirer, yet "settlement" and "payouts" count as separate systems, while acquirer-derived families A/B/C/H count as one. The result is backwards: the gate blocks strong behavioural evidence (W1/W2) and lets a single bank-account change through (W3).

### 4.3 It depends on a crawler hit that real launderers avoid
G6 (link on a gambling page, strength 0.92) and E1 (shared link host) carry the bakery case. Real betting operators cloak and geo-fence, rotate domains, use app-only flows, and spread links through Telegram/WhatsApp. Crawl-based TL vendors already struggle with this (see section 6). If the engine's winning cases need a crawler hit, it will look strong in demos and weak in production.

### 4.4 Fixed thresholds that a fraudster can learn
Every cut-off is public and constant: 12% out-of-band, 20% round share, 25% off-hours, lift ≥ 3 with z ≥ 3, 25% orphan refunds. Once someone knows them, they stay at 11%, 19% and 24%. There is no per-MCC calibration, no peer percentile and no randomness.

### 4.5 "Learning" does not learn
`learningEngine.ts` computes reliability updates for display. Nothing persists them or feeds them back into `DETECTORS` (`store.ts` saves them on the case only). A labelled case today changes nothing tomorrow.

### 4.6 Single-merchant view, no network
Rotation detection (E3/F2) only compares against `peers` **supplied in the same file**. Real rotation, mule rings and shared-beneficiary rings only show up across the PA's whole portfolio, and across PAs. One file, one merchant, cannot find them.

### 4.7 Synthetic data proves nothing about accuracy
All eight samples come from the same generator that the thresholds were tuned against. There is no precision/recall number, no false-positive rate on real merchants and no out-of-sample test. A PA risk head's first question will be "what is your false-positive rate on 10,000 of our merchants?", and right now there is no answer.

### 4.8 Regulatory and product-market risk
After the **Promotion and Regulation of Online Gaming Act, 2025** banned real-money gaming in India, betting money shifted further into exactly the channels this engine cannot see: offshore apps, mule accounts and personal UPI IDs rather than merchant accounts. If PAs and NPCI already do this monitoring, or if RBIH's MuleHunter.AI becomes the default, MRE has to be the *merchant-substance layer* those tools lack. Being another anomaly detector will not be enough.

---

## 5. Security and governance findings (verified by running exploit code)

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| **High** | **Path traversal write.** A case id taken from the request body or URL is joined into a file path. POST `{action:'review', id:'../../../audit/PWNED', dataset}` wrote a file outside the case store. | `store.ts:30` `join(root, \`${id}.json\`)`; reached via `workflow.ts:ensure` → `openInvestigation(dataset, id)`. Probe step 1: *FILE WRITTEN OUTSIDE STORE* | Accept only server-minted ids: `if (!/^INV-[0-9a-f]{8}$/.test(id)) return 400`. Never let `ensure` create a case under a caller-chosen id. |
| **High** | **Path traversal read.** `GET /api/investigations?id=../../x` reads any `.json` file the process can reach. | Probe step 2: 200 | Same regex guard in `getCase`. |
| **High** (governance) | **One anonymous caller can label CONFIRMED_ILLICIT and then execute L5 termination**, setting `legalVerified: true` in the body. The audit actor reads "MRE response engine", not a person. | Probe step 4: EXECUTED | Real auth; role separation (maker ≠ checker); `legalVerified` set only by a legal-role user; signed actor on every audit row. |
| Med | **Raw payer identifiers are stored.** The full uploaded dataset (raw VPAs like `cust001@upi`) is persisted in every case (`workflow.ts` `dataset: raw`), which contradicts "hashed on entry". Hashing is unsalted FNV with a public salt `'mre-demo'` (`utils/hash.ts`), which can be reversed by enumerating VPAs. | `store.ts` CaseRecord.dataset | Drop `dataset` from the record (store a content hash) and use HMAC-SHA256 with a managed key. This matters under DPDP Act 2023. |
| Med | **"Hash-chained audit" is claimed in the UI but not implemented.** The audit is a plain mutable array in a JSON file. | `investigationEngine.ts` timeline text vs `workflow.ts` | Add `prevHash = sha256(prev + row)` per entry, or stop claiming it. |
| Low | No rate limit. 2 MB body limit only. The Vercel API is correctly disabled (`api/[...path].js` returns 503). | | Keep it disabled until auth is in place. |

---
## 6. Market: what exists, and where everyone (including MRE) has gaps

Full cited notes: `audit/market-research.md`. Key facts:

**Regulatory pull (why this product should exist).** The RBI *Master Direction on Regulation of Payment Aggregators* (updated 11 Nov 2026) says: *"The PA must also monitor transactions subsequently undertaken by the merchants to ensure that these transactions are in line with latter's business profile."* (verified on rbi.org.in). Merchants onboarded before 31 Dec 2025 must be re-diligenced within a year. **That sentence is MRE's product.** Every Indian PA needs to show "transactions vs. business profile" monitoring to RBI and FIU-IND, and most do it today with velocity rules.

| Segment | Who | Method | Gap MRE can fill |
|---|---|---|---|
| Card-scheme TL detection | LegitScript, G2 Risk Solutions, EverC, Mastercard BRAM/MMP, Visa VIRP | Web crawling + test transactions + analysts | Built for **cards and websites**. Weak on UPI, QR and app-only flows; no India-specific focus found. G2 itself says 85% of TL cases come from merchants that *look low-risk* (vendor claim), which is the case crawlers miss. |
| Scheme monitoring programmes | Visa VAMP (fraud+dispute ratio, 220 bps), MATCH code 03 | Ratios and blacklists after the fact | Lagging. Betting fronts have **no chargebacks**, because payers want the deposit to land. |
| Indian onboarding/KYB | IDfy (claims PA-MD-2025 compliance, shop-image checks), Signzy, Cashfree RiskShield, Razorpay Thirdwatch | Docs, images and databases at onboarding; buyer-fraud scoring | Strong **at onboarding**, thin on **post-onboarding behaviour vs. declared business**. Thirdwatch scores buyers, not merchants. |
| AML / graph platforms | Quantexa, Featurespace (Visa), Feedzai, Sardine, Unit21, Hawk AI, Flagright, SEON | Entity resolution, behavioural ML, rules engines | Generic AML. They need the PA to define merchant-substance features, and they do not ship "does this bakery behave like a bakery" out of the box. |
| Indian public infra | RBIH **MuleHunter.AI** (~28–30 banks, I4C suspect-registry feed), I4C, MeitY blocking (Online Gaming Act 2025, ss. 5, 7, 14) | Mule *accounts* at banks; URL blocking | Bank-side and person-level. **Nobody owns the merchant-side substance check at the PA.** Section 7 of the Gaming Act also puts direct legal pressure on payment systems not to process money-gaming funds. |

**Gaps across the whole market (MRE included):**
1. **UPI-native TL.** Most tools assume card + website. In India the money moves as UPI collect requests, static QR codes and payment links shared on Telegram. Nobody publishes good UPI-native merchant-substance features.
2. **Cross-PA visibility.** A launderer rotates across PAs, and no one shares beneficiary or device intel between PAs (MuleHunter does this only for banks).
3. **Explainability for regulators.** ML vendors give scores. RBI and FIU-IND want *reasons*. MRE's evidence-chain approach is a real differentiator here. Keep it.
4. **Validated accuracy.** No vendor publishes independent precision/recall for TL. Whoever shows audited numbers on a real PA portfolio wins trust.
5. **The source-coverage problem.** Every vendor is blind where data is missing. MRE's explicit UNKNOWN handling is ahead of the market here, but the gate then penalises missing data (W1/W2).

**Where MRE should position:** the *explainable merchant-substance layer for Indian PAs*, built UPI-first. It produces RBI/FIU-ready evidence packs and plugs into MuleHunter-style account intel and IDfy/Signzy onboarding data, instead of competing with them.

---

## 7. How to make it stronger (prioritised)

### P0: fix before anyone outside the team sees the API (1–2 days)
1. **Path traversal**: in `store.ts` `fileFor` and `getCase`, reject any id not matching `^INV-[0-9a-f]{8}$`. In `workflow.ts:ensure`, never create a case under a caller-supplied id.
2. **Don't persist raw datasets** (`workflow.ts` `dataset: raw`). Store a SHA-256 of the file, and HMAC payer ids with a secret from env.
3. **Validate impossible inputs** in `dataset.ts`: `confirmed ≤ contacted`, `ticketMin < ticketMax`, `0 < seasonalMultiplier ≤ 10`, `hours` allowed to wrap (overnight), de-duplicate exact (payer, amount, time) events, and warn when the calendar is AVAILABLE but empty.
4. **Fix `offHours` for overnight businesses**: `open < close ? (h < open || h >= close) : (h < open && h >= close)`.
5. **Auth + maker/checker**: the labeller must not be the executor; `legalVerified` only from a legal-role user; signed actor on every audit row; implement the claimed hash chain.

### P1: fix the decision logic (1–2 weeks). These change outcomes W1–W4.
6. **Replace "systems" with real data provenance.** Give each detector `source: 'acquirer-txn' | 'acquirer-settlement' | 'bank' | 'crawler' | 'panel' | 'orders' | 'calendar'` and require ≥2 independent **families** *or* ≥3 acquirer families with combined mass above a higher bar (e.g. ≥1.2). W1/W2 then open; W3 does not.
7. **F5 beneficiary change: count suspicious changes only.** A single change to an account in the merchant's own (KYC-verified) name is benign. Flag ≥2 changes, a change to an account shared with a peer, or a change within 30 days of a volume spike.
8. **D9 refunds to a different destination**: exempt same-bank-name / same-mobile destinations. Treat only ≥25% *and* ≥₹X value as illicit.
9. **Stop trusting self-declared baselines.** Compute ticket band, hours, round-share and catchment from **the MCC peer cohort in the PA's own portfolio** (median and p95 of similar merchants in the same city tier). Use the merchant's declaration only to measure the *gap* between what was declared and what is observed. A large gap is itself a signal (new detector: *declared-vs-peer mismatch*).
10. **Seasonality from data, not the file**: derive multipliers from the peer cohort plus a festival calendar (Diwali, Eid, Christmas, wedding season, IPL), never from the uploaded `seasonalMultiplier`.
11. **Make learning real**: persist reliability updates per detector per MCC, and apply them on the next run (Beta(α, β) per detector is enough; no ML needed).

### P2: product strength (1–3 months)
12. **Portfolio graph**: run across all merchants of a PA. Shared beneficiaries, payer-set Jaccard and device/terminal overlap become rotation and ring detection that works without peers in the upload.
13. **UPI-native detectors** (the market gap):
    - *Payer-recurrence shape*: betting depositors pay the same merchant 5–30×/week at varying amounts; a bakery's regulars do not.
    - *Collect-request vs. QR mix* compared with the MCC norm.
    - *Payer-VPA handle mix*: a spike in new or rarely-seen PSP handles.
    - *Night-of-match intensity* across **all** IPL/cricket fixtures (a hardcoded calendar, below).
    - *Inbound-to-settlement velocity*: money settled and swept out within hours.
    - *Many payers → few onward beneficiaries* (fan-in/fan-out ratio).
14. **Replay-based backtest harness**: grow `audit/adversarial.ts` into a scored suite (precision/recall on labelled synthetic + any real labelled cases). Gate releases on it.
15. **Evidence pack export**: a PDF/JSON pack mapped to the RBI PA-MD clause and FIU-IND STR fields. This is what a compliance head will pay for.
16. **Shadow mode** with a PA: run on their portfolio, measure alert rate and analyst-confirmed precision, and publish the number.

### What NOT to build (yet)
- No deep learning model. There are no labels, and explainability is the moat. A calibrated logistic model over the existing 20 detector outputs, once ~200 labelled cases exist, beats a black box.
- No real-time streaming. Daily batch per merchant fully covers the RBI requirement.
- Don't implement all 112 catalogued patterns. Implement the UPI-native six above first.

---

## 8. Hardcoding that would make it stronger

"Hardcoding" here means **curated domain knowledge shipped as data files**. That is cheap, explainable, auditable and fast. Keep each list in a versioned `rules/*.json` with a source and a review date.

| Hardcode this | Why | Shape |
|---|---|---|
| **MCC → expected behaviour table** for the top ~40 Indian MCCs (bakery 5462, kirana 5411, restaurant 5812, electronics 5732…) | Replaces self-declared baselines (fix #9) until peer data exists | `{mcc, ticketP50, ticketP95, openHour, closeHour, roundShareMax, catchment, refundRateMax, nightShareMax}` |
| **Festival and seasonal calendar** (Diwali, Holi, Eid, Christmas, Durga Puja, Onam, Pongal, wedding season, end-of-month salary days), by state | Explains genuine spikes (avoids Diwali-type false positives) without trusting the file | `{name, states[], start, end, mccMultiplier{}}` |
| **Cricket/IPL/major-sports fixture calendar** | C5 currently needs fixtures in the upload. Ship it, refreshed weekly | `{matchId, startIST, tournament}` |
| **Known betting/gaming domain and app list** (from MeitY blocking orders under Gaming Act s.14, public blocklists) | G6/E1 get a lookup, not just a crawler | `{host, source, addedOn}` |
| **High-risk PSP handle / VPA-pattern list**, plus the I4C suspect registry if a PA can access it | Payer-side mule signal | `{handlePattern, reason}` |
| **Round-amount sets for India**: ₹500/1,000/2,000/5,000/10,000 plus "deposit ladders" (₹199, ₹299, ₹999 bonus tiers seen on betting apps) | A4 checks only ₹500 multiples now; betting uses bonus-tier amounts | `number[]` |
| **State adjacency map** | B6 counts any non-local state; a Bengaluru shop paid from Hosur (TN) is local | `{KA:['TN','AP','TS','KL','GA','MH']}` |
| **Hard business rules (non-negotiable overrides)** | Some facts need no fusion | e.g. payment link found on a blocked-gambling host → always OPEN_CASE HIGH; beneficiary shared with a MATCH-listed / terminated merchant → always OPEN_CASE |
| **Per-MCC threshold table** for A1/A4/B6/C2 | Fixed global cut-offs are easy to game and wrong for many MCCs | `{detector, mcc, illicitAt, benignAt}` |
| **Plausibility bounds** used at validation | Rejects poisoned or impossible uploads | e.g. ticket ≤ ₹10 lakh, `seasonalMultiplier` 0.2–6, `accountAgeDays` ≥ 0 |

Guard-rails for hardcoding: every list item needs a source and an expiry; add a test that fails when a list is older than 90 days; never hardcode a verdict for a *specific merchant id* (that is what `sc.id === 'rotation'` in `learningEngine.ts` does; remove it).

---
## 9. Hardcoded or synthetic output in the current app (the bad kind)

Full table (59 rows): `audit/hardcoding-scan.md`. Of the result-bearing values on screen, **35 are constants, 9 depend on which scenario is loaded, and 15 are computed from data**. The ones that would hurt credibility with a PA risk team:

| Where | Problem | Fix |
|---|---|---|
| `HomePage.tsx:28-32, 140, 144` | Homepage "expected vs actual" bars, "9 other states", "3× collections" are typed-in numbers | Render them from `runInvestigation(bakery)` output |
| `HomePage.tsx:134` | Says **21** live detectors; the code has **20** (`detectors.ts:37-216`) | Derive from `DETECTORS.length` |
| `L5AnalystReview/index.tsx:54`, `DemoPage.tsx:41`, `learningEngine.ts:25` | Text branches on `scenario.id === 'bakery' / 'rotation'` | Generate the text from evidence ids that fired, so uploads get the same treatment |
| `investigationEngine.ts:22,24` | "Merchant KYC: AVAILABLE" and "Payer identifiers: AVAILABLE" are constants, not checks | Compute them from the data (payerId present on ≥X% of sales) |
| `investigationEngine.ts:30-38` | Per-layer "N ms" timings are scripted | Measure with `performance.now()` or drop them |
| `analystEngine.ts:55-59` | Recommendation never goes above L3, while the UI offers L4/L5 | Document this, or gate L4/L5 explicitly |
| `data/evidence.ts:4-15` | "112 patterns" is a per-family count with no pattern list behind it (92 not implemented) | Say "20 live, 92 designed", or publish the list |
| `patternPack.ts` header | Says N1–N2; code has N3 too | Doc fix |
| **Two engines disagree** (`prototype/engine.py` vs `detectors.ts`) | Different families (6 vs 9), thresholds (A1 5% vs 12%), fusion (3-family vs 2-family) and bakery seasonal peak (3.5 vs 2.0). They share no code | Pick one. Keep the TS engine and archive the Python one, or make Python read the same `rules/*.json` |

---

## 10. Suggested 6-week roadmap

| Week | Deliverable | Proof it's done |
|---|---|---|
| 1 | P0 fixes (traversal, raw-data storage, validation, overnight hours) | `audit/security-probe.ts` prints "blocked" ×3; W5 → REJECT |
| 2 | Provenance-based gate + F5/D9 refinements | W1, W2 → OPEN_CASE; W3, W4 → NO_CASE; all 22 survivors still pass |
| 3 | `rules/*.json`: MCC table, festival + cricket calendar, betting host list, state adjacency, bonus-tier amounts | Baselines no longer read from upload; adversarial case "declared profile widened" still fires A/B/C |
| 4 | UPI-native detectors (payer recurrence, fan-in/fan-out, settlement-sweep velocity) | New quiet-launderer variants open without any crawler data |
| 5 | Portfolio mode (multi-merchant upload, shared beneficiary/payer graph) and persisted learning | Rotation detected without `peers` in the file |
| 6 | Evidence pack (RBI PA-MD clause mapping, FIU STR fields), auth + maker/checker | Demo to one PA in shadow mode |

---

## 11. Reproduce everything

```bash
cd Merchant-RealityEngine && npm install
npm run selftest && npm run check:api && npm run test:dataset && npm run build
python3 -m venv .venv && .venv/bin/pip install -r prototype/requirements.txt && .venv/bin/python prototype/tests.py
npx tsx audit/adversarial.ts      # 27 cases, prints PASS/WEAK per case
npx tsx audit/security-probe.ts   # path traversal + governance probe (local only; cleans up after itself)
```

Files in `audit/`: `REPORT.md` (this), `adversarial.ts` + `adversarial-output.txt`, `security-probe.ts`, `market-research.md` (cited), `hardcoding-scan.md` (59-row table), `CONTEXT.md`.

**Caveats.** All test data is the repo's own synthetic generator, mutated by hand, so these are robustness tests, not accuracy measurements. Market facts marked "vendor claim" are unverified marketing. The Online Gaming Act's enforcement status as of Nov 2026 was not confirmed from a primary source.
