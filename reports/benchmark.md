# Benchmark (synthetic)

**Synthetic portfolio derived from 9 hand-built samples; this measures robustness to variation, not real-world accuracy.**

Merchants 1000. Opened 65. Expected false alarms 1.68 (sum of 1−P over the opened queue).

| Metric | Value | Wilson 95% |
|---|---|---|
| Recall | 0.903 (65/72) | 0.813–0.952 |
| Precision | 1.000 (65/65) | 0.944–1.000 |
| Genuine-merchant false-positive rate | 0.000 (0/928) | 0.000–0.004 |

## Per-typology recall

- betting: 0.917 (11/12), Wilson 0.646–0.985
- fabricated: 1.000 (10/10), Wilson 0.722–1.000
- night-betting: 0.850 (17/20), Wilson 0.640–0.948
- rotation: 0.938 (15/16), Wilson 0.717–0.989
- telegram: 0.857 (12/14), Wilson 0.601–0.960

## Confusion

| | opened | not opened |
|---|---|---|
| front | 65 | 7 |
| genuine | 0 | 928 |

## Other synthetic measurements

- Saturation (posterior > 0.999): 0.043 (43/1000).
- Top-10 precision: 1.000 (10/10), Wilson 0.722–1.000.
- Top-50 precision: 1.000 (50/50), Wilson 0.929–1.000.

### False-positive rate by MCC
- 5411: 0.000 (0/222), Wilson 0.000–0.017
- 5462: 0.000 (0/454), Wilson 0.000–0.008
- 5814: 0.000 (0/252), Wilson 0.000–0.015

### False-positive rate by Account age
- ≥365d: 0.000 (0/928), Wilson 0.000–0.004

### False-positive rate by City tier
- 1: 0.000 (0/374), Wilson 0.000–0.010
- 2: 0.000 (0/392), Wilson 0.000–0.010
- 3: 0.000 (0/162), Wilson 0.000–0.023
