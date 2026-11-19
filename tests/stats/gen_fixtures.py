"""Reference values for frontend/src/stats, computed with SciPy. Run: .venv/bin/python tests/stats/gen_fixtures.py
Each case: {"fn": <name of the TS export>, "args": [...], "expect": <number or [lo, hi]>, "tol": <abs tolerance>}"""
import json, math
from scipy import stats, special

cases = []
def add(fn, args, expect, tol=1e-9):
    cases.append({"fn": fn, "args": args, "expect": expect, "tol": tol})

# --- pattern: distribution functions ---
add("normalCdf", [1.2], float(stats.norm.cdf(1.2)))
add("chi2Sf", [7.3, 3], float(stats.chi2.sf(7.3, 3)))
add("binomSf", [7, 20, 0.2], float(stats.binom.sf(6, 20, 0.2)))  # P(X >= 7)
add("normalCdf", [-2.5], float(stats.norm.cdf(-2.5)))
add("normalCdf", [3.1], float(stats.norm.cdf(3.1)))
add("normalSf", [1.96], float(stats.norm.sf(1.96)))
add("normalQuantile", [0.975], float(stats.norm.ppf(0.975)), 1e-8)
add("normalQuantile", [0.01], float(stats.norm.ppf(0.01)), 1e-8)
add("chi2Sf", [0.5, 1], float(stats.chi2.sf(0.5, 1)))
add("chi2Sf", [30, 10], float(stats.chi2.sf(30, 10)))
add("chi2Sf", [120, 100], float(stats.chi2.sf(120, 100)))
add("betaCdf", [0.3, 2, 5], float(stats.beta.cdf(0.3, 2, 5)))
add("betaCdf", [0.9, 0.5, 0.5], float(stats.beta.cdf(0.9, 0.5, 0.5)))
add("betaQuantile", [0.05, 3, 9], float(stats.beta.ppf(0.05, 3, 9)), 1e-8)
add("binomSf", [0, 10, 0.3], 1.0)
add("binomSf", [11, 10, 0.3], 0.0)
add("binomSf", [15, 100, 0.1], float(stats.binom.sf(14, 100, 0.1)))
add("binomCdf", [3, 10, 0.5], float(stats.binom.cdf(3, 10, 0.5)))
add("poissonSf", [5, 2.5], float(stats.poisson.sf(4, 2.5)))
add("poissonSf", [20, 12], float(stats.poisson.sf(19, 12)))
add("hypergeomSf", [3, 50, 10, 8], float(stats.hypergeom.sf(2, 50, 10, 8)))
add("betaBinomSf", [5, 20, 2, 8], float(stats.betabinom.sf(4, 20, 2, 8)), 1e-8)
add("betaBinomSf", [0, 20, 2, 8], 1.0)
add("negBinomLnPmf", [7, 5, 2], float(stats.nbinom.logpmf(7, 2, 2/7)), 1e-8)
add("wilson", [24, 30], list(map(float, stats.binomtest(24, 30).proportion_ci(confidence_level=0.95, method='wilson'))), 1e-6)
add("clopperPearson", [24, 30], list(map(float, stats.binomtest(24, 30).proportion_ci(confidence_level=0.95, method='exact'))), 1e-6)
add("clopperPearson", [0, 12], list(map(float, stats.binomtest(0, 12).proportion_ci(confidence_level=0.95, method='exact'))), 1e-6)
add("bhQValues", [[0.01, 0.04, 0.03, 0.2]], list(map(float, stats.false_discovery_control([0.01, 0.04, 0.03, 0.2], method='bh'))), 1e-9)
add("holm", [[0.01, 0.04, 0.03, 0.2]], [0.04, 0.09, 0.09, 0.2], 1e-12)
add("gTest", [[30, 10, 10], [0.5, 0.25, 0.25]], float(stats.power_divergence([30, 10, 10], f_exp=[25, 12.5, 12.5], lambda_='log-likelihood').pvalue))
add("ksTwoSample", [[1.1,2.3,3.0,4.8,5.5,6.1,7.7,8.2,9.0,10.4],[3.3,4.1,5.0,6.6,7.2,8.8,9.9,11.5,12.0,13.3,14.1,15.6]], float(stats.ks_2samp([1.1,2.3,3.0,4.8,5.5,6.1,7.7,8.2,9.0,10.4],[3.3,4.1,5.0,6.6,7.2,8.8,9.9,11.5,12.0,13.3,14.1,15.6], method='exact').pvalue), 0.01)
add("poissonRateRatio", [30, 10, 20, 20], float(stats.binom.sf(29, 50, 1/3)))
add("mcnemarExact", [2, 10], float(stats.binomtest(2, 12, 0.5).pvalue))
add("fisherCombine", [[0.01, 0.2, 0.5]], float(stats.combine_pvalues([0.01, 0.2, 0.5], method='fisher').pvalue))
add("mannWhitneyLess", [[1,2,3,4],[3,5,6,7,8]], float(stats.mannwhitneyu([1,2,3,4],[3,5,6,7,8], alternative='less', method='asymptotic', use_continuity=True).pvalue))
add("binomUpper", [8, 20, 0.2], float(stats.binom.sf(7, 20, 0.2)))
add("sbbLlr", [0.01], -math.log(-math.e * 0.01 * math.log(0.01)))
add("sbbLlr", [0.5], 0.0)
# ADD MORE CASES BELOW (same shape)

json.dump(cases, open("tests/stats/fixtures/reference.json", "w"), indent=1)
print(len(cases), "cases written")
