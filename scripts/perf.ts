/** Time the engine on this machine. The figure is synthetic-sample throughput, not a hosted SLA. */
import { cpus } from 'node:os';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { analyze } from '../engine/index';

const raw = JSON.parse(readFileSync('frontend/public/samples/04-anand-sweets-diwali-genuine.json', 'utf8'));
const n = 40;
const times: number[] = [];
for (let i = 0; i < n; i++) {
  const t = performance.now();
  const ran = analyze(raw);
  if (!ran.ok) throw new Error('sample failed');
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
const mean = times.reduce((s, x) => s + x, 0) / n;
const p50 = times[Math.floor(n * 0.5)];
const p95 = times[Math.floor(n * 0.95)];
const perMin = 60000 / mean;
const cpu = cpus()[0]?.model ?? 'unknown';
const text = `# Performance (this machine)

**Synthetic.** ${n} repeats of one genuine sample, in process, not a network round trip.

- CPU: ${cpu} (${cpus().length} cores)
- Mean ${mean.toFixed(1)} ms per merchant, about ${perMin.toFixed(0)} merchants per minute on one core
- p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms

The 1,000-merchant benchmark that wrote reports/benchmark.md is the batch measurement. Quote these figures only.
`;
mkdirSync('reports', { recursive: true });
writeFileSync('reports/perf.md', text);
console.log(text);
