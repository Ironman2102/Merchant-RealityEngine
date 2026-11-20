# Benchmark (synthetic)

**Synthetic portfolio derived from 9 hand-built samples; this measures robustness to variation, not real-world accuracy.**

Merchants 1000. Opened 40. Expected false alarms 0.02 (sum of 1−P over the opened queue).

| Metric | Value | Wilson 95% |
|---|---|---|
| Recall | 0.684 (39/57) | 0.555–0.790 |
| Precision | 0.975 (39/40) | 0.871–0.996 |
| Genuine-merchant false-positive rate | 0.001 (1/943) | 0.000–0.006 |

## Per-typology recall

- betting: 0.786 (11/14), Wilson 0.524–0.924
- fabricated: 0.889 (8/9), Wilson 0.565–0.980
- night-betting: 1.000 (9/9), Wilson 0.701–1.000
- rotation: 1.000 (11/11), Wilson 0.741–1.000
- telegram: 0.000 (0/14), Wilson 0.000–0.215

## Confusion

| | opened | not opened |
|---|---|---|
| front | 39 | 18 |
| genuine | 1 | 942 |

## Other synthetic measurements

- Saturation (posterior > 0.999): 0.033 (33/1000).
- Top-10 precision: 1.000 (10/10), Wilson 0.722–1.000.
- Top-50 precision: 0.940 (47/50), Wilson 0.838–0.979.

### False-positive rate by MCC
- 5411: 0.004 (1/235), Wilson 0.001–0.024
- 5462: 0.000 (0/470), Wilson 0.000–0.008
- 5814: 0.000 (0/238), Wilson 0.000–0.016

### False-positive rate by Account age
- ≥365d: 0.001 (1/943), Wilson 0.000–0.006

### False-positive rate by City tier
- 1: 0.000 (0/396), Wilson 0.000–0.010
- 2: 0.000 (0/396), Wilson 0.000–0.010
- 3: 0.007 (1/151), Wilson 0.001–0.037
