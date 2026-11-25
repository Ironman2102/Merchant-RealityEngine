/**
 * Chart and graph colours read the shared theme tokens in styles/index.css, so Recharts and
 * React Flow follow the same palette as the rest of the app (and switch to light when printing).
 */
const token = (name: string) => `var(--color-${name})`;

export const C = {
  bg: token('bg'),
  panel: token('panel'),
  panel2: token('panel2'),
  grid: token('line'),
  axis: token('line2'),
  ink: token('ink'),
  mute: token('mute'),
  dim: token('dim'),
  ok: token('ok'),
  warn: token('warn'),
  bad: token('bad'),
  accent: token('accent'),
  quiet: token('quiet'),
  sky: token('sky'),
  green: token('viz-green'),
  amber: token('viz-amber'),
  red: token('viz-red'),
  violet: token('viz-violet'),
  blue: token('viz-blue'),
  cyan: token('viz-cyan'),
  orange: token('viz-orange'),
  teal: token('viz-teal'),
} as const;

/** A token colour at a given opacity, e.g. a tinted node background. */
export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export const chartTooltip = {
  contentStyle: { background: C.panel2, border: `1px solid ${C.axis}`, borderRadius: 6, fontSize: 12, color: C.ink },
  labelStyle: { color: C.mute, marginBottom: 2 },
  itemStyle: { color: C.ink },
} as const;
export const chartAxis = { stroke: C.dim, tick: { fill: C.mute }, fontSize: 11, tickLine: false, axisLine: { stroke: C.axis } } as const;
export const chartLegend = { wrapperStyle: { fontSize: 12, color: C.mute } } as const;
export const chartCursor = { fill: 'rgba(255, 255, 255, .04)' } as const;
