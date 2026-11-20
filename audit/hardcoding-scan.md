# Hard-coded and synthetic output scan

Scope: frontend/src/pages, layers, engines (responseEngine, patternPack, detectors and the engines they call), data/*.ts, plus components that render verdict text. Read-only. Paths are relative to the repo root.

Type key: **a** = hard-coded constant or text; **b** = depends on scenario id or on a per-scenario hard-coded input; **c** = computed from the loaded data (the threshold or mapping applied may still be a constant, noted in the row).

Global greps: `Math.random` 0 hits. `TODO`, `mock`, `fixture` (as a code word) 0 hits. `placeholder` only appears as input hints in pages/ServerCasePage.tsx:72. `scenario.id ===` / `sc.id ===` branches: layers/L5AnalystReview/index.tsx:54 (bakery-only callout), engines/learningEngine.ts:25 (rotation-only text), pages/DemoPage.tsx:41 (bakery-only callout), and engines/responseEngine.ts:32 (hold ID prefix only). Scenario-keyed builders are in data/scenarios.ts:17-54.

## Table

| path:line | shown | type |
|---|---|---|
| frontend/src/pages/HomePage.tsx:28 | "Expected ticket sizes (₹150–1,200)" with fixed bar heights [3,8,14,18,15,10,6,3] | a |
| frontend/src/pages/HomePage.tsx:29 | Profile cards "1 state", "7–22 hours", "2× Diwali peak" (bakery profile values) | a |
| frontend/src/pages/HomePage.tsx:31 | "Actual ticket sizes: heaped at ₹500, ₹1,000, ₹2,000", bars [3,2,22,3,24,2,25,1] | a |
| frontend/src/pages/HomePage.tsx:32 | "9 other states", "Pre-match funding peaks", "3× collections" | a |
| frontend/src/pages/HomePage.tsx:46 | "112 detection patterns, nine families" (from TOTAL_PATTERNS) | a |
| frontend/src/pages/HomePage.tsx:134 | "The demo runs a subset of 21 as live detectors" (code has 20, see table row 13 and Step 3) | a |
| frontend/src/pages/HomePage.tsx:140 | Rotation use case: "gap: 2 days" | a |
| frontend/src/pages/HomePage.tsx:144 | Fabricated-substance bars: Payments 100, Orders 41, Delivered 22, Confirmed 25 (%) | a |
| frontend/src/components/graphs/HeroGraphic.tsx:2 and :21 | Hero nodes labelled "contradicts profile" / "unknown" (status values s:0/1/2 typed in) | a |
| frontend/src/components/graphs/HeroVisual.tsx:33 | Hero text "payers from nine other states light up in amber" | a |
| frontend/src/components/graphs/HeroMap3D.tsx:54 | Hero facts (declared bakery, out-of-state share, round share, verdict): always runs the bakery scenario | b |
| frontend/src/data/evidence.ts:4-15 | Per-family pattern counts 12/14/12/14/12/12/14/12/10 (sum 112), shown as catalogue size | a |
| frontend/src/layers/L3Detection/index.tsx:38 | "The full design catalogues 112 patterns. This prototype runs N of them as live detectors" | c |
| frontend/src/components/common/PatternBoard.tsx:106 | "N live detectors across nine evidence families" (N = evidence.length) | c |
| frontend/src/pages/CasePage.tsx:234-235 | "All N patterns checked"; "S1–S7 and N1–N3" text | c |
| frontend/src/pages/PortfolioPage.tsx:60 | Flag fraction "x / 29": denominator is evidence + pattern results minus a literal 1 (drops S5) | c |
| frontend/src/pages/PortfolioPage.tsx:41 | "Asked to explain" = count of merchants on trust-ladder MEDIUM | c |
| frontend/src/pages/PortfolioPage.tsx:67 | "These four merchants and transactions are synthetic demo records" | a |
| frontend/src/pages/CasePage.tsx:48 | "Prototypes are illustrative, not trained." note under the S1 category bars | a |
| frontend/src/engines/patternPack.ts:62-68 | S1 category prototypes (median, round share, out-of-state, etc.): the % confidence shown on CasePage:49 comes from these constants | a |
| frontend/src/engines/patternPack.ts:135-137 | S2 comparison values used when no peer data: round = declared share, outState 0.05 (local) or 0.8 | a |
| frontend/src/engines/patternPack.ts:181 and :184 | S6 FLAGGED thresholds (supplier share < 15%, GST ratio > 1.5) and "roughly 25–60% of sales" expectation | a |
| frontend/src/pages/CasePage.tsx:123 | "Business footprint (synthetic feed)" label above S6 result | a |
| frontend/src/engines/patternPack.ts:212-214 | N2 "NN% of sales between 23:00 and 06:00", FLAGGED at ≥10%; expected "under 2% at night" | c |
| frontend/src/engines/patternPack.ts:204 | N1 flag when ≥3 payers show rising 2-hour sequences | a |
| frontend/src/engines/patternPack.ts:223 | N3 status: ≥3 payouts within 24h of settlement and ≥3 destination accounts | a |
| frontend/src/engines/patternPack.ts:85-90 | Context Passport: which flagged signals each reason "explains" (drives "Explained / Not explained") | a |
| frontend/src/engines/evidenceFusion.ts:5-6 and :37 | OPEN_CASE gate: ≥2 families with mass ≥0.25 and ≥2 systems; shown as "Suspicious" (PortfolioPage:15) | c |
| frontend/src/engines/evidenceFusion.ts:49-50 | "HIGH / MEDIUM / LOW priority" from score cutoffs 0.6 / 0.4 (shown on CasePage:208) | c |
| frontend/src/engines/detectors.ts:42-44 | A1 "NN% of tickets outside band (n of m)"; thresholds 12% / 4% | c |
| frontend/src/engines/detectors.ts:87 | C5 "NN% of match-day sales land in the 45 min before start (N× control)"; ILLICIT needs lift ≥3 and z ≥3 | c |
| frontend/src/engines/detectors.ts:66 with frontend/src/data/scenarios.ts:41 and :50 | B9 "3 of 12 sampled purchasers confirm buying": input is a per-scenario literal for built-ins | b |
| frontend/src/engines/detectors.ts:173-175 | G2 "Inconsistency x.xx: NN% off-category, NN% reused images" (input catalogue is hard-coded in merchants.ts:43-51) | c |
| frontend/src/engines/detectors.ts:184 | G6 "Link PL-SCB-07 embedded on stakearena.example/wallet/deposit" (input embed records are hard-coded in merchants.ts:57-59) | c |
| frontend/src/data/merchants.ts:57-59 | Embed records: link IDs, betting host, "gambling" category, all typed in; feeds G6, E1 and CasePage links table | a |
| frontend/src/data/merchants.ts:43-51 | Catalogue items and prices per built-in merchant; feeds G2 and L5 | a |
| frontend/src/data/merchants.ts:37-38 | Peer status "Gift Galaxy Retail · DORMANT" and ages; drives handoff in cohortContinuity.ts:34 and CasePage:131 | a |
| frontend/src/data/merchants.ts:8, 14, 20, 26 | Declared profile values (ticket band, hours, localStates, seasonalPeak, account age) shown on the L2 profile card (layers/L2MerchantProfile/index.tsx:10-12) | a |
| frontend/src/data/dataset.ts:166 | Defaults for omitted profile fields: expectedRoundShare 0.06, seasonalPeak 1, catchment LOCAL; shown on the L2 card and used by A4, C2 and B6 | a |
| frontend/src/data/dataset.ts:223 | Coverage defaults: acquiring AVAILABLE; website, orders, bank, fulfillment, verification MISSING; shown in L1 sources | a |
| frontend/src/engines/investigationEngine.ts:22 and :24 | L1 source rows "Merchant KYC: AVAILABLE" and "Payer identifiers: AVAILABLE" (constants, not checked against data) | a |
| frontend/src/engines/investigationEngine.ts:30-38 | Layer timelines in ms: shown as "Complete · N ms simulated" and per-step bars (components/common/LayerFrame.tsx:12, :29) | a |
| frontend/src/data/scenarios.ts:20-21, :30-31, :38-39, :47-48 | Scenario title, blurb ("threefold rise … from nine states") and expectedOutcome, shown on DemoPage:35-36 and InvestigationPage:45 | b |
| frontend/src/data/scenarios.ts:21, :31, :39, :48 | scriptedLabel applied by the L7 button "Apply the scripted outcome for this scenario" (layers/L7AuditLearning/index.tsx:29) | b |
| frontend/src/data/scenarios.ts:22, :32, :40, :49 | Weekly series with hard-coded multipliers (e.g. 1.25, 1.8, 2.9, 3.0); drive H1 and the baseline charts | b |
| frontend/src/data/transactions.ts:74-187 with frontend/src/data/scenarios.ts:18, :28, :36, :45 | Every built-in transaction comes from one generator per scenario id, with fixed seeds | b |
| frontend/src/data/scenarios.ts:25 | External sighting "IPL Sure Win 24×7 (synthetic)" with note "deposit here, instant ID", shown on CasePage:84 | a |
| frontend/src/data/graphs.ts:15 and :34 | Per-scenario evidence graph labels, e.g. "Category assigned by the synthetic crawler fixture" | b |
| frontend/src/layers/L5AnalystReview/index.tsx:54 | Callout "Why the legitimate chain fails here" (cites G6, D9), shown only when scenario.id is 'bakery' and legit chain FAILED | b |
| frontend/src/layers/L5AnalystReview/index.tsx:65 and :74 | "replays the stored synthetic crawler snapshot. No external site is contacted." and "Domain categories come from the synthetic crawler fixture" | a |
| frontend/src/engines/learningEngine.ts:25 | L7 learning text "Link beneficiary BEN_GGR_OLD to the cohort watchlist" shown only for scenario id 'rotation' | b |
| frontend/src/engines/learningEngine.ts:11 and :20-21 | Reliability update step sizes (+0.06, −0.08, −0.04) and "Seasonal peak expectation updated X× → Y×" (display only, never persisted) | a |
| frontend/src/engines/analystEngine.ts:5-22 | Legitimate and potential-front chain labels and the evidence IDs each link tests (shown on L5) | a |
| frontend/src/engines/analystEngine.ts:45 | "Legitimate chain FAILED / HOLDS / INCONCLUSIVE" rule: ≥2 failed links across ≥2 families, or ≥3 supported links | c |
| frontend/src/engines/analystEngine.ts:55-59 | "Recommended L0–L3" mapping from fusion state (never L4 or L5); shown on CasePage:195 and UploadPage:120 | c |
| frontend/src/engines/responseEngine.ts:32 | Hold record text: approver "Risk committee (two of three)", basis "Simulated: contractual reserve clause plus verified authority" (ID prefix uses scenario id) | a |
| frontend/src/engines/responseEngine.ts:33-40 | Action lists for L0–L5 shown as "Proposed response" (layers/L6Response/index.tsx:35) | a |
| frontend/src/engines/cohortContinuity.ts:36 | Cohort continuity score shown on CasePage:131; weights .35/.20/.15/.20/.10 are constants | c |
| frontend/src/data/evidence.ts:66-73 | Response level names, blurbs and needsAuthority flags (L4, L5 true) shown on L6 | a |

Row counts: a = 35, b = 9, c = 15 (59 rows).

## Step 3: patternPack.ts liveness

- The file has no live or catalogue-only marker. Each result carries only `status` (FLAGGED / CLEAR / UNKNOWN / INPUT), defined at frontend/src/engines/patternPack.ts:15-20.
- It returns 10 distinct results: S1, S2, S3, S4, S6, S7 (pushed at lines 124, 140, 159, 168, 182/187, 194), N1, N2, N3 (203, 211, 222), and S5 spliced in at line 238. All 10 are computed on every run. Counted live = 10; catalogue-only = 0.
- What "live" means in practice: a result is UNKNOWN when its input is absent. S1 needs at least 20 sales (line 125). S3 needs other merchants or embeds (line 160). S6 needs a footprint feed (line 187). S7 needs embeds or sightings (line 195). N3 needs settlements (line 223). Five results can therefore show UNKNOWN; N1 and N2 never do.
- The header (lines 1-9) says the pack holds "two newer betting patterns (N1–N2)". The code has three (N3 at line 222).
- Core detectors (the L3 set): 20 live in the DETECTORS array (frontend/src/engines/detectors.ts:37-216; ids A1 A4 B6 B9 C2 C5 D7 D9 D10 E1 E3 F2 F5 F7 F8 G2 G6 H1 H3 I2). Catalogue-only: 112 − 20 = 92, recorded only as per-family counts at frontend/src/data/evidence.ts:4-15, with no per-pattern list.
- Live per family vs catalogue per family: A 2/12, B 2/14, C 2/12, D 3/14, E 2/12, F 4/12, G 2/14, H 2/12, I 1/10.
- HomePage:134 says 21 live detectors. The array has 20, and detectors.ts:3 also says 20.

## Step 4: prototype/engine.py

- Scope and rules: six families A, B, C, D, F, G (engine.py:47-54). Not the nine families of the web app, and no shared code with detectors.ts. Docstring (lines 1-22) sets three rules: missing data = UNKNOWN; correlated signals in one family count once; escalation needs 2+ families and restrictive action needs 3+ including a hard-to-fake one plus human sign-off.
- Baselines: anchor = Jul–Aug 2025 daily average (engine.py:37, 224-233). Expected volume = anchor × median of same-group peers when ≥3 peers exist (lines 234-242), otherwise a festival multiplier from SEASONAL_PEAK (lines 42-44, 192-199). Bakery peak here is 3.5, against the web app's profile value 2.0 (merchants.ts:8).
- Volume trigger (residual_trigger, lines 245-270): residual r > 0.3 with a two-week step ≥ 1.6 gives UNEXPLAINED; r > 0.3 with a gradual rise gives ORGANIC_GROWTH; raw growth > 0.5 gives EXPLAINED; otherwise IN_LINE.
- Family thresholds: A off-band share > 0.05 or round-lump uplift > 0.12 (line 280). B out-of-state share > 0.30 and uplift > 0.20 (line 298). C ratio > 2.0 and share > 0.15 (line 320). D at least 5 untraceable refunds and bad share > 0.2 (line 345). F fast-withdrawal share > 0.5 and uplift > 0.4 (line 363). G foreign checkout share > 0.10 (line 380). Missing feed → UNKNOWN; history under 30 days (MIN_HISTORY_DAYS, line 443) switches off A, B and F.
- Fusion (fuse_and_respond, lines 388-425): level 3 if ≥3 illicit families including a hard one (D, F, G); level 2 if exactly 2; level 1 if 1 family or the trigger is UNEXPLAINED; else level 0. Mechanism is picked by family pairs: C with D or F (gambling collection); G with A (transaction laundering).
- Shared with detectors.ts: no code, and no thresholds. Examples of divergence: TS A1 is ILLICIT at ≥12% off-band against Python > 5%; TS C5 needs lift ≥3 and z ≥3 against Python ratio > 2.0 with share > 0.15; TS fusion needs ≥2 families with mass ≥0.25 and two systems, against Python's 3-family rule for L3.

## Step 5: response levels (responseEngine.ts)

Levels are defined in frontend/src/data/evidence.ts:66-73. responseEngine.ts has the gates.

- L0 Observe and log (evidence.ts:67, needsAuthority false). No gate (responseEngine.ts:34). Recommended when there is no case and the legitimate chain is not HOLDS (analystEngine.ts:56).
- L1 Profile refresh and clarification (evidence.ts:68, false). No gate (responseEngine.ts:35). Recommended when no case and the legitimate chain HOLDS (analystEngine.ts:56), or low priority (analystEngine.ts:59).
- L2 Enhanced Due Diligence (evidence.ts:69, false). No gate (responseEngine.ts:36). Recommended when the legitimate chain is INCONCLUSIVE, or the top mechanism is FABRICATED_SUBSTANCE, or medium priority (analystEngine.ts:57-59).
- L3 Restrict a defined prospective flow (evidence.ts:70, false). No gate at all: the blocked branch only runs for L4 and L5 (responseEngine.ts:26). Recommended for HIGH priority (analystEngine.ts:59).
- L4 Time-boxed fund restriction (evidence.ts:71, needsAuthority true; responseEngine.ts:23). Blocked unless legalVerified (line 27), escrowConfirmed (line 28), and holdCandidate > 0 (line 29). A hold record is created only when nothing blocks (line 32). Not recommended by analystEngine.
- L5 Terminate and report (evidence.ts:72, needsAuthority true). Blocked unless legalVerified (line 27) and label is CONFIRMED_ILLICIT (line 30). No hold record. Not recommended by analystEngine.
- The active level is `user.chosenLevel ?? res.review.recommended` (responseEngine.ts:13), so the user can pick any level. The only checks are the L4 and L5 blocks above.
- responseEngine.ts:11 says "Nothing is hard-coded per scenario", but the hold ID prefix comes from the scenario id (line 32).

## Unclear or not verified

- ServerCasePage and the backend analyse path were not traced. The scan covered frontend only, as asked.
- L7 "reliability" and "profile" updates are display-only per CONTEXT.md. This scan did not confirm that nothing writes them back.
