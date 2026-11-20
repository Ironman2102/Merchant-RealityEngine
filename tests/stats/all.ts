/** Every stats export, so fixtures can call functions by name. */
export * from '../../frontend/src/stats/dist';
export * from '../../frontend/src/stats/intervals';
export * from '../../frontend/src/stats/multiple';
export * from '../../frontend/src/stats/tests';
export * from '../../frontend/src/stats/eb';
import { ksOneSample as _ks } from '../../frontend/src/stats/tests';
import { lognormalCdf as _ln } from '../../frontend/src/stats/dist';
/** Fixture adapter: KS against a lognormal(median, sigma). */
export const ksOneSample_lognorm = (xs: number[], median: number, sigma: number) => _ks(xs, x => _ln(x, median, sigma));
