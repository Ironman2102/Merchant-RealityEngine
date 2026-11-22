# Second-opinion model (synthetic)

**Synthetic, and written by the same people as the rules. Not real-world accuracy.**

linear-v1 replaces m1-v0 (LightGBM) and nn-v0 (neural network), which were withdrawn: their training data gave away the label
(account age, bank feed and purchaser-verification presence each separated the classes perfectly), and with purchaser
verification removed the tree model flagged 928 of 928 honest merchants.

The new model is logistic regression with non-negative weights on fired payment signals. It cannot read account age, feed
availability or the category, and a missing feed is a zero. Trained on seed 101, tested on seed 202, bar 0.5 fixed in advance.

| Test | Measured | Wilson 95% |
|---|---|---|
| Fronts flagged by the model | 187/240 = 0.779 | 0.723–0.827 |
| Honest flagged by the model | 1/360 = 0.003 | 0.000–0.016 |
| Fronts opened by the engine | 112/240 = 0.467 | 0.405–0.530 |
| Honest opened by the engine | 1/360 = 0.003 | 0.000–0.016 |
| No payer location: fronts flagged | 147/240 = 0.613 | 0.550–0.672 |
| No payer location: honest flagged | 0/360 = 0.000 | 0.000–0.011 |
| No location or payer id: fronts flagged | 2/240 = 0.008 | 0.002–0.030 |
| No location or payer id: honest flagged | 0/360 = 0.000 | 0.000–0.011 |

## A kind of front it never saw in training

| Kind left out | Flagged | Wilson 95% |
|---|---|---|
| obvious deposits | 20/20 = 1.000 | 0.839–1.000 |
| small side-stream | 12/20 = 0.600 | 0.387–0.781 |
| large side-stream | 20/20 = 1.000 | 0.839–1.000 |
| grocer side-stream | 18/20 = 0.900 | 0.699–0.972 |
| same-QR blend | 14/20 = 0.700 | 0.481–0.855 |
| non-round deposits | 11/20 = 0.550 | 0.342–0.742 |
| camouflage: fuel | 20/20 = 1.000 | 0.839–1.000 |
| camouflage: charity | 20/20 = 1.000 | 0.839–1.000 |
| camouflage: furniture | 20/20 = 1.000 | 0.839–1.000 |
| uncatalogued category front | 20/20 = 1.000 | 0.839–1.000 |
| low-volume split | 11/20 = 0.550 | 0.342–0.742 |
| perfect mimic | 0/20 = 0.000 | 0.000–0.161 |

It does not choose the action.
