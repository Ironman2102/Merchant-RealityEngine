# Benchmark (synthetic)

**Synthetic merchants from engine/synthetic.ts, written by the same people as the rules. Not real-world accuracy.**
Account age, feeds and format are drawn the same way for honest merchants and fronts, so behaviour is the only difference.

Merchants 1000 (seed 7). Opened 33. Expected false alarms 3.27; actual 0.

| Metric | Measured | Wilson 95% |
|---|---|---|
| Recall: fronts in the case queue | 33/81 = 0.407 | 0.307–0.516 |
| Fronts opened or asked to explain | 67/81 = 0.827 | 0.731–0.894 |
| Precision of the queue | 33/33 = 1.000 | 0.896–1.000 |
| Honest merchants wrongly opened | 0/919 = 0.000 | 0.000–0.004 |
| Honest merchants recommended for restriction | 0/919 = 0.000 | 0.000–0.004 |
| Honest merchants asked to explain | 132/919 = 0.144 | 0.122–0.168 |

"Asked to explain" restricts nothing, but it is still scrutiny, so it is reported.

## By kind of front (location present for about 60%)

| Kind | Case opened | Asked to explain | Nothing |
|---|---|---|---|
| obvious deposits | 19/20 | 1/20 | 0/20 |
| small side-stream | 6/20 | 14/20 | 0/20 |
| large side-stream | 17/20 | 3/20 | 0/20 |
| grocer side-stream | 15/20 | 5/20 | 0/20 |
| same-QR blend | 14/20 | 6/20 | 0/20 |
| non-round deposits | 0/20 | 10/20 | 10/20 |
| camouflage: fuel | 16/20 | 4/20 | 0/20 |
| camouflage: charity | 9/20 | 11/20 | 0/20 |
| camouflage: furniture | 10/20 | 10/20 | 0/20 |
| uncatalogued category front | 9/20 | 11/20 | 0/20 |
| low-volume split | 0/20 | 10/20 | 10/20 |
| perfect mimic | 0/20 | 0/20 | 20/20 |

## By kind of honest merchant

| Kind | Case opened | Asked to explain | Nothing |
|---|---|---|---|
| steady bakery | 0/20 | 0/20 | 20/20 |
| bakery festival surge | 0/20 | 1/20 | 19/20 |
| bakery midnight delivery | 0/20 | 16/20 | 4/20 |
| bakery national gifting | 0/20 | 13/20 | 7/20 |
| bakery catering advances | 1/20 | 19/20 | 0/20 |
| grocer with regulars | 0/20 | 0/20 | 20/20 |
| wholesale grocer | 0/20 | 1/20 | 19/20 |
| tea stall | 0/20 | 0/20 | 20/20 |
| restaurant | 0/20 | 0/20 | 20/20 |
| fuel station | 0/20 | 0/20 | 20/20 |
| temple trust | 0/20 | 0/20 | 20/20 |
| charity | 0/20 | 0/20 | 20/20 |
| online apparel | 0/20 | 0/20 | 20/20 |
| coaching fees | 0/20 | 0/20 | 20/20 |
| chemist | 0/20 | 0/20 | 20/20 |
| salon | 0/20 | 0/20 | 20/20 |
| hotel | 0/20 | 0/20 | 20/20 |
| uncatalogued category | 0/20 | 1/20 | 19/20 |

## Fronts when no payer location exists (a UPI ID does not carry one)

| Kind | Case opened | Asked to explain | Nothing |
|---|---|---|---|
| obvious deposits | 12/20 | 8/20 | 0/20 |
| small side-stream | 4/20 | 16/20 | 0/20 |
| large side-stream | 17/20 | 3/20 | 0/20 |
| grocer side-stream | 7/20 | 13/20 | 0/20 |
| same-QR blend | 9/20 | 11/20 | 0/20 |
| non-round deposits | 0/20 | 0/20 | 20/20 |
| camouflage: fuel | 0/20 | 20/20 | 0/20 |
| camouflage: charity | 0/20 | 20/20 | 0/20 |
| camouflage: furniture | 0/20 | 20/20 | 0/20 |
| uncatalogued category front | 0/20 | 20/20 | 0/20 |
| low-volume split | 0/20 | 10/20 | 10/20 |
| perfect mimic | 0/20 | 0/20 | 20/20 |

## What it does not catch

- A perfect mimic of the shop's amounts, hours, places and payer mix. Payment data alone cannot find this; it needs outside-in
  evidence such as test purchases, crawls, sightings or complaints.
- Small side-streams and thin split accounts mostly become a question to the merchant, not a case.
- Without payer location, several camouflage categories become a question, not a case.
