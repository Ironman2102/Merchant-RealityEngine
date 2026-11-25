import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import type { CusumPoint, WeeklyRow } from '../../types/investigation';
import type { PaymentEvent } from '../../types/payment';
import type { MerchantProfile } from '../../types/merchant';
import { istDayKey, istHour, istMinuteOfDay, inrK } from '../../utils/format';
import { CUSUM_H } from '../../engines/cusumEngine';

import { C, chartAxis as axis, chartCursor, chartLegend, chartTooltip as tip } from './theme';

export function BaselineChart({ rows, height = 280 }: { rows: WeeklyRow[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="week" {...axis} /><YAxis {...axis} tickFormatter={inrK} width={56} />
        <Tooltip {...tip} formatter={(v: number) => inrK(v)} />
        <Legend {...chartLegend} />
        <Line name="Actual" dataKey="actual" stroke={C.ok} strokeWidth={2.5} dot={{ r: 2.5, fill: C.panel }} connectNulls={false} />
        <Line name="Anchored baseline" dataKey="anchored" stroke={C.quiet} strokeDasharray="5 4" dot={false} />
        <Line name="Seasonal expectation" dataKey="seasonal" stroke={C.sky} strokeWidth={1.8} dot={false} />
        <Line name="Rolling challenger" dataKey="rolling" stroke={C.warn} strokeWidth={1.4} strokeDasharray="2 3" dot={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
export function CusumChart({ points, height = 200 }: { points: CusumPoint[]; height?: number }) {
  const d = points.map(p => ({ week: p.week, S: +p.s.toFixed(3), R: p.r === null ? null : +p.r.toFixed(3) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={d} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="week" {...axis} /><YAxis {...axis} width={40} />
        <Tooltip {...tip} /><Legend {...chartLegend} />
        <ReferenceLine y={CUSUM_H} stroke={C.bad} strokeDasharray="4 3" label={{ value: `h = ${CUSUM_H}`, fill: C.bad, fontSize: 11, position: 'insideTopLeft' }} />
        <Line name="Residual R (seasonal)" dataKey="R" stroke={C.sky} dot={{ r: 2, fill: C.panel }} connectNulls={false} />
        <Line name="CUSUM S" dataKey="S" stroke={C.orange} strokeWidth={2.2} dot={{ r: 2.5, fill: C.panel }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

const BREAKS = [500, 1000, 2000, 5000];
export function TicketHistogram({ sales, profile, height = 230 }: { sales: PaymentEvent[]; profile: MerchantProfile; height?: number }) {
  const buckets: { label: string; n: number; round: boolean }[] = [];
  let lo = 0;
  BREAKS.forEach(b => {
    buckets.push({ label: lo === 0 ? `< ₹${b}` : `₹${lo + 1}–${b - 1}`, n: sales.filter(s => s.amount > lo && s.amount < b).length, round: false });
    buckets.push({ label: `₹${b.toLocaleString('en-IN')}`, n: sales.filter(s => s.amount === b).length, round: true });
    lo = b;
  });
  buckets.push({ label: `> ₹${lo.toLocaleString('en-IN')}`, n: sales.filter(s => s.amount > lo).length, round: false });
  const data = buckets.filter(b => b.n > 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="label" {...axis} interval={0} fontSize={10} /><YAxis {...axis} width={32} />
        <Tooltip {...tip} cursor={chartCursor} formatter={(v: number) => [`${v} sales`, '']} />
        <Bar dataKey="n" radius={[3, 3, 0, 0]}>{data.map((d, i) => <Cell key={i} fill={d.round ? C.bad : C.quiet} fillOpacity={d.round ? 0.9 : 0.8} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HourChart({ sales, fixtures, profile, height = 230 }: { sales: PaymentEvent[]; fixtures: number[]; profile: MerchantProfile; height?: number }) {
  const fixDays = new Set(fixtures.map(istDayKey)), wins = fixtures.map(f => [istMinuteOfDay(f) - 45, istMinuteOfDay(f)]);
  const data = Array.from({ length: 24 }, (_, h) => ({ h: `${h}`, normal: 0, prematch: 0 }));
  sales.forEach(s => {
    const m = istMinuteOfDay(s.eventTime), pre = fixDays.has(istDayKey(s.eventTime)) && wins.some(([a, b]) => m >= a && m < b);
    data[istHour(s.eventTime)][pre ? 'prematch' : 'normal']++;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="h" {...axis} /><YAxis {...axis} width={32} />
        <Tooltip {...tip} cursor={chartCursor} /><Legend {...chartLegend} />
        <ReferenceLine x={`${profile.hours[0]}`} stroke={C.ok} strokeDasharray="3 3" />
        {profile.hours[1] < 24 && <ReferenceLine x={`${profile.hours[1]}`} stroke={C.ok} strokeDasharray="3 3" label={{ value: 'closes', fill: C.accent, fontSize: 10 }} />}
        <Bar name="Sales (hour of day, IST)" dataKey="normal" stackId="a" fill={C.ok} fillOpacity={0.7} />
        {fixtures.length > 0 && <Bar name="In 45 min before a match start" dataKey="prematch" stackId="a" fill={C.bad} radius={[3, 3, 0, 0]} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StateBars({ sales, local, height = 230 }: { sales: PaymentEvent[]; local: string[]; height?: number }) {
  const m = new Map<string, number>();
  sales.forEach(s => m.set(s.payerState, (m.get(s.payerState) ?? 0) + 1));
  const data = [...m.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 10);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" {...axis} /><YAxis type="category" dataKey="k" {...axis} width={30} />
        <Tooltip {...tip} cursor={chartCursor} />
        <Bar dataKey="n" name="Sales" radius={[0, 3, 3, 0]}>{data.map(d => <Cell key={d.k} fill={local.includes(d.k) || !local.length ? C.ok : C.bad} fillOpacity={0.8} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ReliabilityBars({ data, height = 260 }: { data: { id: string; before: number; after: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="id" {...axis} /><YAxis {...axis} domain={[0, 1]} width={32} />
        <Tooltip {...tip} cursor={chartCursor} formatter={(v: number) => v.toFixed(3)} /><Legend {...chartLegend} />
        <Bar name="Before" dataKey="before" fill={C.bad} radius={[2, 2, 0, 0]} /><Bar name="After" dataKey="after" fill={C.ok} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
