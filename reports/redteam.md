# Red team (synthetic)

**Synthetic.** 98 different fronts that the engine catches, each attacked with 8 operators. Not a live attacker.

| Attack | Case avoided | Wilson 95% | Not even asked |
|---|---|---|---|
| nudge round amounts | 92/98 = 0.939 | 0.873–0.972 | 0/98 |
| move into shop hours | 1/98 = 0.010 | 0.002–0.056 | 0/98 |
| use local mules | 73/98 = 0.745 | 0.650–0.821 | 0/98 |
| never reuse a payer | 54/98 = 0.551 | 0.452–0.646 | 8/98 |
| hide in the main QR | 1/98 = 0.010 | 0.002–0.056 | 0/98 |
| rotate links every 20 payments | 2/98 = 0.020 | 0.006–0.071 | 0/98 |
| thin to a tenth | 98/98 = 1.000 | 0.962–1.000 | 61/98 |
| all of the first four | 97/98 = 0.990 | 0.944–0.998 | 28/98 |

These are open weaknesses. An attacker who does everything at once looks like a shop in payment data and needs outside-in
evidence to find. A threshold fix is proposed only if it passes the honest-merchant holdout in engine/improver.ts.
