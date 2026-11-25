# 10,000-Case Exhaustive Stress Benchmark Report (mre-bayes-0.3.0)

- **Runtime:** 38.63s for 10000 unique datasets (p50=3.36ms, p95=4.75ms, p99=6.89ms, max=49.51ms)
- **Binary Confusion (OPEN_CASE):** TP=3368, FP=0, FN=1632, TN=5000 | **Recall=0.6736**, **Precision=1**, **FPR=0**, **F1=0.805**
- **3-Class Verdict Matrix (Expected → Actual):** case→{case:3368, ask:1151, clear:481} | ask→{case:0, ask:242, clear:8} | clear→{case:0, ask:234, clear:4516}
- **Calibration & Economics:** Brier=0.201, ECE=0.2113, Avg Expected Loss=₹118519.28/merchant
- **Integrity & Governance:** parseErrors=0, nanErrors=0, ciViolations=0, verifySummaryFails=0, waterfall=1000/1000, packIsolation=830/1000, outreachNoTipOff=200/200
- **Metamorphic (80):** shuffle=80/80, rename=32/80, tz=80/80, mono(G6/R-01)=80/80
- **TTD Replay (80 fronts):** median=3d, p90=3d, slippedVol=22.29%
- **Security Fuzzing:** 8/8 passed
- **Learning Poisoning (500 rogue + 200 dispute labels on B8):** honestFP=0.0198 → poisonedFP=0.3149 (bounded=true)
- **Ring Scaling:** N=1k: 57.8ms (0 rings) | N=5k: 244.5ms (541 rings) | N=10k: 382.5ms (541 rings, 475 linked)

## By Difficulty
| Group | N | TP | FP | FN | TN | ASK | Rate |
|---|---:|---:|---:|---:|---:|---:|---|
| front (hard) | 1950 | 987 | 0 | 963 | 0 | 713 | Recall=0.506 (987/1950) |
| front (redteam) | 1050 | 671 | 0 | 379 | 0 | 148 | Recall=0.639 (671/1050) |
| front (standard) | 2000 | 1710 | 0 | 290 | 0 | 290 | Recall=0.855 (1710/2000) |
| genuine (hard) | 2500 | 0 | 0 | 0 | 2500 | 187 | FPR=0.000 (0/2500), ASK=187 |
| genuine (standard) | 2000 | 0 | 0 | 0 | 2000 | 0 | FPR=0.000 (0/2000), ASK=0 |
| profile_shift (hard) | 500 | 0 | 0 | 0 | 500 | 289 | FPR=0.000 (0/500), ASK=289 |

## By Category
| Group | N | TP | FP | FN | TN | ASK | Rate |
|---|---:|---:|---:|---:|---:|---:|---|
| FRONT: Account Takeovers | 350 | 350 | 0 | 0 | 0 | 0 | Recall=1.000 (350/350) |
| FRONT: Betting & Gambling Fronts | 650 | 650 | 0 | 0 | 0 | 0 | Recall=1.000 (650/650) |
| FRONT: Cross-Merchant Rings | 500 | 209 | 0 | 291 | 0 | 191 | Recall=0.418 (209/500) |
| FRONT: Evasion & Smurfing Fronts | 300 | 300 | 0 | 0 | 0 | 0 | Recall=1.000 (300/300) |
| FRONT: Fabricated Substance Shells | 350 | 284 | 0 | 66 | 0 | 66 | Recall=0.811 (284/350) |
| FRONT: Low-Intensity Hybrid Fronts | 400 | 25 | 0 | 375 | 0 | 125 | Recall=0.063 (25/400) |
| FRONT: Mule & Payout Laundering | 350 | 350 | 0 | 0 | 0 | 0 | Recall=1.000 (350/350) |
| FRONT: Mule & Refund Laundering | 400 | 3 | 0 | 397 | 0 | 397 | Recall=0.007 (3/400) |
| FRONT: Multi-Stream Hiding | 250 | 250 | 0 | 0 | 0 | 0 | Recall=1.000 (250/250) |
| FRONT: Red-Team Adaptive Evasion | 950 | 671 | 0 | 279 | 0 | 148 | Recall=0.706 (671/950) |
| FRONT: Rotation & Phoenix Fronts | 300 | 76 | 0 | 224 | 0 | 224 | Recall=0.253 (76/300) |
| FRONT: Unknown-MCC Conduct Fronts | 200 | 200 | 0 | 0 | 0 | 0 | Recall=1.000 (200/200) |
| GENUINE: Clean Diverse Shops | 2000 | 0 | 0 | 0 | 2000 | 0 | FPR=0.000 (0/2000), ASK=0 |
| GENUINE: Genuine Festival & Local Surges | 300 | 0 | 0 | 0 | 300 | 0 | FPR=0.000 (0/300), ASK=0 |
| GENUINE: Genuine Geo & Repeat Edge Cases | 150 | 0 | 0 | 0 | 150 | 0 | FPR=0.000 (0/150), ASK=0 |
| GENUINE: Genuine Operational Edge Cases | 600 | 0 | 0 | 0 | 600 | 0 | FPR=0.000 (0/600), ASK=0 |
| GENUINE: Genuine Pricing & POS Traps | 150 | 0 | 0 | 0 | 150 | 10 | FPR=0.000 (0/150), ASK=10 |
| GENUINE: Genuine Timing & Calendar Traps | 150 | 0 | 0 | 0 | 150 | 1 | FPR=0.000 (0/150), ASK=1 |
| GENUINE: Indian Commerce Traps | 1000 | 0 | 0 | 0 | 1000 | 176 | FPR=0.000 (0/1000), ASK=176 |
| GENUINE: Messy Real-World Data | 150 | 0 | 0 | 0 | 150 | 0 | FPR=0.000 (0/150), ASK=0 |
| PROFILE_SHIFT: Honest Profile Shifts (ASK) | 250 | 0 | 0 | 0 | 250 | 242 | FPR=0.000 (0/250), ASK=242 |
| PROFILE_SHIFT: Honest Profile Shifts (Passport) | 250 | 0 | 0 | 0 | 250 | 47 | FPR=0.000 (0/250), ASK=47 |

## By Typology
| Group | N | TP | FP | FN | TN | ASK | Rate |
|---|---:|---:|---:|---:|---:|---:|---|
| front: b8-deposit-conduct | 300 | 300 | 0 | 0 | 0 | 0 | Recall=1.000 (300/300) |
| front: benign-padding-camouflage | 200 | 191 | 0 | 9 | 0 | 9 | Recall=0.955 (191/200) |
| front: hybrid-15pct | 200 | 0 | 0 | 200 | 0 | 5 | Recall=0.000 (0/200) |
| front: hybrid-25pct | 200 | 25 | 0 | 175 | 0 | 120 | Recall=0.125 (25/200) |
| front: k1-kyc-lie-and-r01 | 150 | 150 | 0 | 0 | 0 | 0 | Recall=1.000 (150/150) |
| front: orphan-refund-ring | 200 | 3 | 0 | 197 | 0 | 197 | Recall=0.015 (3/200) |
| front: passport-abuse-front | 200 | 200 | 0 | 0 | 0 | 0 | Recall=1.000 (200/200) |
| front: payout-fanout-sweep | 350 | 350 | 0 | 0 | 0 | 0 | Recall=1.000 (350/350) |
| front: ring-bipartite-hub | 100 | 99 | 0 | 1 | 0 | 1 | Recall=0.990 (99/100) |
| front: ring-clique-payers | 100 | 17 | 0 | 83 | 0 | 83 | Recall=0.170 (17/100) |
| front: ring-phoenix-chain | 100 | 0 | 0 | 100 | 0 | 100 | Recall=0.000 (0/100) |
| front: ring-quiet-individual | 100 | 0 | 0 | 100 | 0 | 0 | Recall=0.000 (0/100) |
| front: ring-star-ben | 100 | 93 | 0 | 7 | 0 | 7 | Recall=0.930 (93/100) |
| front: rotation-dormant-handoff | 300 | 76 | 0 | 224 | 0 | 224 | Recall=0.253 (76/300) |
| front: shell-full-fake | 350 | 284 | 0 | 66 | 0 | 66 | Recall=0.811 (284/350) |
| front: slow-boil-takeover | 200 | 80 | 0 | 120 | 0 | 120 | Recall=0.400 (80/200) |
| front: sub-minsales-shard | 200 | 200 | 0 | 0 | 0 | 0 | Recall=1.000 (200/200) |
| front: sub-qr-stream-hide | 250 | 250 | 0 | 0 | 0 | 0 | Recall=1.000 (250/250) |
| front: takeover-3wk-surge | 350 | 350 | 0 | 0 | 0 | 0 | Recall=1.000 (350/350) |
| front: telegram-no-web-c6 | 150 | 150 | 0 | 0 | 0 | 0 | Recall=1.000 (150/150) |
| front: thirdparty-refund-ring | 200 | 0 | 0 | 200 | 0 | 200 | Recall=0.000 (0/200) |
| front: threshold-hug-epsilon | 150 | 0 | 0 | 150 | 0 | 19 | Recall=0.000 (0/150) |
| front: unknown-mcc-conduct-front | 200 | 200 | 0 | 0 | 0 | 0 | Recall=1.000 (200/200) |
| front: web-gambling-embed | 350 | 350 | 0 | 0 | 0 | 0 | Recall=1.000 (350/350) |
| genuine: acquirer-only-and-partial | 150 | 0 | 0 | 0 | 150 | 0 | FPR=0.000 (0/150), ASK=0 |
| genuine: border-neighbours | 150 | 0 | 0 | 0 | 150 | 0 | FPR=0.000 (0/150), ASK=0 |
| genuine: calendar-festival-surge | 150 | 0 | 0 | 0 | 150 | 0 | FPR=0.000 (0/150), ASK=0 |
| genuine: clean-known-mcc | 1700 | 0 | 0 | 0 | 1700 | 0 | FPR=0.000 (0/1700), ASK=0 |
| genuine: clean-unknown-mcc | 300 | 0 | 0 | 0 | 300 | 0 | FPR=0.000 (0/300), ASK=0 |
| genuine: discrete-menu-99-pos | 150 | 0 | 0 | 0 | 150 | 10 | FPR=0.000 (0/150), ASK=10 |
| genuine: indian-airport-pilgrim-hub | 200 | 0 | 0 | 0 | 200 | 0 | FPR=0.000 (0/200), ASK=0 |
| genuine: indian-b2b-wholesale | 200 | 0 | 0 | 0 | 200 | 176 | FPR=0.000 (0/200), ASK=176 |
| genuine: indian-franchise-shared-ben | 100 | 0 | 0 | 0 | 100 | 0 | FPR=0.000 (0/100), ASK=0 |
| genuine: indian-recurring-emi-tiffin | 200 | 0 | 0 | 0 | 200 | 0 | FPR=0.000 (0/200), ASK=0 |
| genuine: indian-salary-fee-spike | 200 | 0 | 0 | 0 | 200 | 0 | FPR=0.000 (0/200), ASK=0 |
| genuine: indian-techpark-shared-payers | 100 | 0 | 0 | 0 | 100 | 0 | FPR=0.000 (0/100), ASK=0 |
| genuine: messy-tz-paise-dups-anon | 150 | 0 | 0 | 0 | 150 | 0 | FPR=0.000 (0/150), ASK=0 |
| genuine: mobile-self-refunds-bank-switch | 150 | 0 | 0 | 0 | 150 | 0 | FPR=0.000 (0/150), ASK=0 |
| genuine: monsoon-delay-and-overnight | 150 | 0 | 0 | 0 | 150 | 0 | FPR=0.000 (0/150), ASK=0 |
| genuine: small-n-under-minN | 150 | 0 | 0 | 0 | 150 | 0 | FPR=0.000 (0/150), ASK=0 |
| genuine: sports-bar-local-match | 150 | 0 | 0 | 0 | 150 | 1 | FPR=0.000 (0/150), ASK=1 |
| genuine: unlisted-local-fair | 150 | 0 | 0 | 0 | 150 | 0 | FPR=0.000 (0/150), ASK=0 |
| profile_shift: ask-profile-shift-no-passport | 250 | 0 | 0 | 0 | 250 | 242 | FPR=0.000 (0/250), ASK=242 |
| profile_shift: genuine-with-valid-passport | 250 | 0 | 0 | 0 | 250 | 47 | FPR=0.000 (0/250), ASK=47 |

## Known vs Unknown MCC
| Group | N | TP | FP | FN | TN | ASK | Rate |
|---|---:|---:|---:|---:|---:|---:|---|
| known-mcc (39) | 8264 | 2520 | 0 | 1298 | 4446 | 1403 | Rec=0.660 (2520/3818), FPR=0.000 (0/4446) |
| unknown-mcc (10) | 1736 | 848 | 0 | 334 | 554 | 224 | Rec=0.717 (848/1182), FPR=0.000 (0/554) |

## Fairness — Region
| Group | N | TP | FP | FN | TN | ASK | Rate |
|---|---:|---:|---:|---:|---:|---:|---|
| metro | 4617 | 1549 | 0 | 759 | 2309 | 762 | Rec=0.671 (1549/2308), FPR=0.000 (0/2309) |
| nonmetro | 5383 | 1819 | 0 | 873 | 2691 | 865 | Rec=0.676 (1819/2692), FPR=0.000 (0/2691) |

## Fairness — Size Band
| Group | N | TP | FP | FN | TN | ASK | Rate |
|---|---:|---:|---:|---:|---:|---:|---|
| enterprise | 556 | 91 | 0 | 67 | 398 | 243 | Rec=0.576 (91/158), FPR=0.000 (0/398) |
| micro | 5838 | 1678 | 0 | 1085 | 3075 | 849 | Rec=0.607 (1678/2763), FPR=0.000 (0/3075) |
| mid | 3606 | 1599 | 0 | 480 | 1527 | 535 | Rec=0.769 (1599/2079), FPR=0.000 (0/1527) |

## Fairness — Age Band
| Group | N | TP | FP | FN | TN | ASK | Rate |
|---|---:|---:|---:|---:|---:|---:|---|
| established | 2397 | 781 | 0 | 374 | 1242 | 339 | Rec=0.676 (781/1155), FPR=0.000 (0/1242) |
| mid | 4756 | 1674 | 0 | 608 | 2474 | 643 | Rec=0.734 (1674/2282), FPR=0.000 (0/2474) |
| new | 2847 | 913 | 0 | 650 | 1284 | 645 | Rec=0.584 (913/1563), FPR=0.000 (0/1284) |

## Fairness — Channel Mix
| Group | N | TP | FP | FN | TN | ASK | Rate |
|---|---:|---:|---:|---:|---:|---:|---|
| mixed | 3905 | 1390 | 0 | 624 | 1891 | 625 | Rec=0.690 (1390/2014), FPR=0.000 (0/1891) |
| pos | 873 | 238 | 0 | 104 | 531 | 132 | Rec=0.696 (238/342), FPR=0.000 (0/531) |
| upi | 5222 | 1740 | 0 | 904 | 2578 | 870 | Rec=0.658 (1740/2644), FPR=0.000 (0/2578) |

## Context Passport & ASK Slice
| Group | N | TP | FP | FN | TN | ASK | Rate |
|---|---:|---:|---:|---:|---:|---:|---|
| ask-profile-shift-no-passport | 250 | 0 | 0 | 0 | 250 | 242 | FPR=0.000 (0/250), ASK=242 |
| genuine-with-valid-passport | 250 | 0 | 0 | 0 | 250 | 47 | FPR=0.000 (0/250), ASK=47 |
| passport-abuse-front | 200 | 200 | 0 | 0 | 0 | 0 | Recall=1.000 (200/200) |

## By Quarter (Temporal Drift)
| Group | N | TP | FP | FN | TN | ASK | Rate |
|---|---:|---:|---:|---:|---:|---:|---|
| Q1 | 2367 | 762 | 0 | 355 | 1250 | 387 | Rec=0.682 (762/1117), FPR=0.000 (0/1250) |
| Q2 | 2373 | 754 | 0 | 369 | 1250 | 391 | Rec=0.671 (754/1123), FPR=0.000 (0/1250) |
| Q3 | 2642 | 936 | 0 | 456 | 1250 | 437 | Rec=0.672 (936/1392), FPR=0.000 (0/1250) |
| Q4 | 2618 | 916 | 0 | 452 | 1250 | 412 | Rec=0.670 (916/1368), FPR=0.000 (0/1250) |
