# Business case

Every input marked *assumption* must be replaced with the PA's own figure. None is a measurement.

## Who pays, and for what

The payment aggregator's risk and compliance budget pays, per merchant monitored per month. It gets a ranked case queue, questions
in place of blunt holds, and an evidence pack a regulator can read.

## Cost of a first scan of 10,000 merchants

| Input | Value | Source |
|---|---|---|
| Prevalence of fronts | 0.5% (50 merchants) | assumption |
| Fronts opened as cases | 40.7% | synthetic benchmark |
| Fronts asked to explain | 42.0% | synthetic benchmark |
| Honest merchants asked to explain | 14.4% | synthetic benchmark; the generator is deliberately rich in changed merchants |
| Analyst time per case | 45 minutes | assumption |
| Analyst time per question | 10 minutes | assumption |
| Loaded analyst cost | ₹800 per hour | assumption |

- Cases: about 20, so 15 hours.
- Questions: about 1,433 honest + 21 fronts, so 242 hours.
- Total: about 257 hours, about **₹2.06 lakh, or ₹21 per merchant for the first scan**. Compute is negligible beside this.
- **Questions are 94% of the cost.** The number to drive down in a pilot is the question rate. A verified passport lasts up to
  180 days, and automatic document intake would cut the ten minutes.
- Break-even: at the ₹5 lakh cost of a missed front in `rules/costs.json` (assumption), the scan pays for itself if it stops
  one front that existing controls missed.

Price should be set only after the pilot measures the real question rate.

## 90-day shadow pilot

| Days | Work | Exit test |
|---|---|---|
| 1–15 | Map the daily export; agree categories and costs; privacy review | 95%+ of rows mapped |
| 16–45 | Shadow scoring with no merchant contact; analysts label the queue and a random 0.5% sample | Honest case rate ≤ 3% (95% upper bound) |
| 46–75 | Calibrate from labels through two-person approval; send questions for a small cohort | Question rate and minutes per question measured |
| 76–90 | Compare with existing rules | Confirmed fronts that existing rules missed; go / no-go |

Sizing: about 1,000 honest merchants are needed to bound a 2% false-alarm rate under 3%, and about 60 confirmed fronts to
measure recall within ±10 points.

## Success measures

Confirmed fronts missed by existing rules; honest merchants restricted (target zero); questions per 1,000 merchants; analyst
minutes per case; days from first suspicious payment to case.

## Partners needed

The PA (data, analysts, Principal Officer); optionally a crawl or test-purchase provider for the mimic gap; the acquiring bank for
any hold. None is in place.
