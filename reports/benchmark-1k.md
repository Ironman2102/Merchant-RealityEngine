# 1,200-Case Stress Benchmark Report

- **Runtime:** 10.14s for 1200 datasets (rules=mre-bayes-0.2.0)
- **Confusion:** TP=534, FP=0, FN=66, TN=600
- **Metrics:** Recall=0.8900, Precision=1.0000, FPR=0.0000, F1=0.9418
- **Bayesian FDR Queue (q=0.1):** opened=534, expectedFalseAlarms=40.30
- **Integrity:** parseErrors=0, nanErrors=0, ciViolations=0, verifySummaryFails=40
- **Cross-Merchant Ring Detector:** 0 ring links across 0 linked merchants

## By Difficulty
| Group | N | TP | FP | FN | TN | Rate |
|---|---:|---:|---:|---:|---:|---|
| front (hard) | 325 | 259 | 0 | 66 | 0 | Recall=0.797 (259/325) |
| front (standard) | 275 | 275 | 0 | 0 | 0 | Recall=1.000 (275/275) |
| genuine (hard) | 200 | 0 | 0 | 0 | 200 | FPR=0.000 (0/200) |
| genuine (standard) | 400 | 0 | 0 | 0 | 400 | FPR=0.000 (0/400) |

## By Category
| Category | N | TP | FP | FN | TN | Rate |
|---|---:|---:|---:|---:|---:|---|
| FRONT: Account Takeovers | 50 | 50 | 0 | 0 | 0 | Recall=1.000 (50/50) |
| FRONT: Betting & Gambling Fronts | 100 | 98 | 0 | 2 | 0 | Recall=0.980 (98/100) |
| FRONT: Evasion & Smurfing Fronts | 120 | 114 | 0 | 6 | 0 | Recall=0.950 (114/120) |
| FRONT: Fabricated Substance Shells | 50 | 50 | 0 | 0 | 0 | Recall=1.000 (50/50) |
| FRONT: Low-Intensity Hybrid Fronts | 100 | 73 | 0 | 27 | 0 | Recall=0.730 (73/100) |
| FRONT: Mule & Refund Laundering | 100 | 70 | 0 | 30 | 0 | Recall=0.700 (70/100) |
| FRONT: Rotation & Phoenix Fronts | 80 | 79 | 0 | 1 | 0 | Recall=0.988 (79/80) |
| GENUINE: Clean Diverse Shops | 220 | 0 | 0 | 0 | 220 | FPR=0.000 (0/220) |
| GENUINE: Genuine Festival Surges | 60 | 0 | 0 | 0 | 60 | FPR=0.000 (0/60) |
| GENUINE: Genuine Geo & Repeat Edge Cases | 80 | 0 | 0 | 0 | 80 | FPR=0.000 (0/80) |
| GENUINE: Genuine Messy & Edge Operations | 100 | 0 | 0 | 0 | 100 | FPR=0.000 (0/100) |
| GENUINE: Genuine Pricing, POS & Single-Signal Traps | 120 | 0 | 0 | 0 | 120 | FPR=0.000 (0/120) |
| GENUINE: Genuine Unlisted Local Event | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |

## By Typology
| Typology | N | TP | FP | FN | TN | Rate |
|---|---:|---:|---:|---:|---:|---|
| front: daytime-shift-evasion | 20 | 20 | 0 | 0 | 0 | Recall=1.000 (20/20) |
| front: delayed-sweep-30h | 20 | 18 | 0 | 2 | 0 | Recall=0.900 (18/20) |
| front: discrete-bet-tiers | 20 | 18 | 0 | 2 | 0 | Recall=0.900 (18/20) |
| front: hybrid-15pct | 20 | 5 | 0 | 15 | 0 | Recall=0.250 (5/20) |
| front: hybrid-21pct | 20 | 13 | 0 | 7 | 0 | Recall=0.650 (13/20) |
| front: hybrid-27pct | 20 | 18 | 0 | 2 | 0 | Recall=0.900 (18/20) |
| front: hybrid-33pct | 20 | 18 | 0 | 2 | 0 | Recall=0.900 (18/20) |
| front: hybrid-39pct | 20 | 19 | 0 | 1 | 0 | Recall=0.950 (19/20) |
| front: inplay-prematch | 20 | 20 | 0 | 0 | 0 | Recall=1.000 (20/20) |
| front: mule-ben-hopping | 20 | 20 | 0 | 0 | 0 | Recall=1.000 (20/20) |
| front: offline-99-tiers | 20 | 20 | 0 | 0 | 0 | Recall=1.000 (20/20) |
| front: orphan-refund-ring | 20 | 6 | 0 | 14 | 0 | Recall=0.300 (6/20) |
| front: payout-fanout | 20 | 20 | 0 | 0 | 0 | Recall=1.000 (20/20) |
| front: rotation-borderline-age | 20 | 19 | 0 | 1 | 0 | Recall=0.950 (19/20) |
| front: rotation-dormant-handoff | 60 | 60 | 0 | 0 | 0 | Recall=1.000 (60/60) |
| front: shadow-bank-gap | 20 | 20 | 0 | 0 | 0 | Recall=1.000 (20/20) |
| front: shared-hub-multi | 20 | 20 | 0 | 0 | 0 | Recall=1.000 (20/20) |
| front: shell-full-fake | 25 | 25 | 0 | 0 | 0 | Recall=1.000 (25/25) |
| front: shell-partial-fake | 25 | 25 | 0 | 0 | 0 | Recall=1.000 (25/25) |
| front: smurf-495-hug | 20 | 20 | 0 | 0 | 0 | Recall=1.000 (20/20) |
| front: split-payer-7wk | 20 | 18 | 0 | 2 | 0 | Recall=0.900 (18/20) |
| front: takeover-2wk-ramp | 25 | 25 | 0 | 0 | 0 | Recall=1.000 (25/25) |
| front: takeover-3wk-surge | 25 | 25 | 0 | 0 | 0 | Recall=1.000 (25/25) |
| front: telegram-no-web | 20 | 18 | 0 | 2 | 0 | Recall=0.900 (18/20) |
| front: thirdparty-refund-ring | 20 | 4 | 0 | 16 | 0 | Recall=0.200 (4/20) |
| front: upi-collect-repeat | 20 | 20 | 0 | 0 | 0 | Recall=1.000 (20/20) |
| front: web-gambling-embed | 20 | 20 | 0 | 0 | 0 | Recall=1.000 (20/20) |
| genuine: acquirer-only-missing | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: border-neighbours | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: calendar-festival-surge | 60 | 0 | 0 | 0 | 60 | FPR=0.000 (0/60) |
| genuine: clean-standard | 220 | 0 | 0 | 0 | 220 | FPR=0.000 (0/220) |
| genuine: college-30pct-outofstate | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: discrete-menu | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: local-wedding-fair-25x | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: mobile-self-refunds | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: monsoon-delivery-delay | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: offline-gift-99prices | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: overnight-kitchen | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: own-ca-sweep-single | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: partial-feeds | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: pos-counter-sales | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: regulars-5-7wk | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: single-bank-switch | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: small-n-under-minN | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |
| genuine: vip-regulars-9wk | 20 | 0 | 0 | 0 | 20 | FPR=0.000 (0/20) |

## By MCC
| MCC | N | TP | FP | FN | TN | Rate |
|---|---:|---:|---:|---:|---:|---|
| 5411 | 128 | 52 | 0 | 3 | 73 | Recall=0.945 (52/55) |
| 5462 | 122 | 56 | 0 | 3 | 63 | Recall=0.949 (56/59) |
| 5691 | 81 | 48 | 0 | 6 | 27 | Recall=0.889 (48/54) |
| 5712 | 113 | 33 | 0 | 21 | 59 | Recall=0.611 (33/54) |
| 5812 | 137 | 48 | 0 | 7 | 82 | Recall=0.873 (48/55) |
| 5814 | 124 | 50 | 0 | 4 | 70 | Recall=0.926 (50/54) |
| 5912 | 81 | 50 | 0 | 4 | 27 | Recall=0.926 (50/54) |
| 5943 | 107 | 50 | 0 | 4 | 53 | Recall=0.926 (50/54) |
| 5947 | 146 | 51 | 0 | 3 | 92 | Recall=0.944 (51/54) |
| 5999 | 81 | 48 | 0 | 6 | 27 | Recall=0.889 (48/54) |
| 7399 | 80 | 48 | 0 | 5 | 27 | Recall=0.906 (48/53) |
