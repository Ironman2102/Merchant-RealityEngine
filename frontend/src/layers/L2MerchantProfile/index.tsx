import { useInvestigation } from '../../hooks/useInvestigation';
import { useQuantMode } from '../../hooks/useQuantMode';
import { LayerFrame } from '../../components/common/LayerFrame';
import { Badge, Callout, Panel, Td, Th, rowCls, tableCls } from '../../components/ui/ui';
import { BaselineChart } from '../../components/charts/charts';
import { inr, inrK, pct } from '../../utils/format';
import type { InvestigationResult } from '../../types/investigation';

export function ProfileCard({ r }: { r: InvestigationResult }) {
  const p = r.l2.profile;
  const rows: [string, string][] = [['Business category', `${p.category} (MCC ${p.mcc})`], ['Location', p.city], ['Products', p.products.join(', ')], ['Declared activity', p.declaredActivity.join(', ')],
    ['Expected ticket size', `${inr(p.ticketMin)}–${inr(p.ticketMax)}`], ['Operating hours', p.hours[1] === 24 ? '24 hours (online)' : `${p.hours[0]}:00–${p.hours[1]}:00`], ['Customer geography', p.catchment === 'LOCAL' ? `Local service area (${p.localStates.join(', ')})` : 'National'],
    ['Expected weekly volume', inrK(p.baselineWeekly)], ['Seasonal expectation', p.seasonalPeak > 1 ? `${p.seasonalPeak.toFixed(1)}× in peak season` : 'No strong seasonality'], ['Declared domains', p.declaredDomains.join(', ')], ['Account age', `${p.accountAgeDays} days`]];
  return <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-line py-1.5 text-[13px]"><dt className="text-mute">{k}</dt><dd className="text-right">{v}</dd></div>)}</dl>;
}

export function L2Body({ r }: { r: InvestigationResult }) {
  const { quant } = useQuantMode();
  const { rows, peak, cusum } = r.l2, p = r.l2.profile, alarm = cusum.find(c => c.alarm);
  return (
    <>
      <Panel title="What the merchant declared at onboarding" subtitle="Their KYC profile—used to see what they claim to sell, NOT blindly trusted as the only rulebook."><ProfileCard r={r} /></Panel>
      <div className="grid gap-4 lg:grid-cols-3">
        {[['Onboarding baseline', 'Their normal weekly volume when they first signed up. Catches slow, steady drift over months.', 'bg-slate-500'], ['Festival-adjusted expectation', `Raises expected sales during festivals (from the category calendar, not the merchant’s claim) so genuine holiday rushes don't look like fraud.`, 'bg-stone-400'], ['Recent 4-week trend', 'Rolling average of the last 4 weeks. Helps spot sudden jumps vs gradual organic growth.', 'bg-zinc-400']].map(([t, d, c]) => (
          <div key={t} className="rounded-md border border-line bg-panel p-4"><div className="flex items-center gap-2 text-sm font-semibold"><span className={`h-2 w-2 rounded-full ${c}`} />{t}</div><p className="mt-1.5 text-[13px] text-mute">{d}</p></div>))}
      </div>
      <Panel title="Expected versus actual weekly collections" subtitle="Comparing actual money collected each week against what is normal for this season.">
        <BaselineChart rows={rows} />
        {peak && peak.actual !== null && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Callout tone="mute" title={`Vs onboarding baseline: ${pct(peak.rAnchored!)}`}>{inrK(peak.actual)} collected vs {inrK(peak.anchored)} normal week (ignores festivals).</Callout>
            <Callout tone={Math.abs(peak.rSeasonal ?? 0) > 0.35 ? 'warn' : 'ok'} title={`Vs festival-adjusted norm: ${pct(peak.rSeasonal!)}`}>{inrK(peak.actual)} collected vs {inrK(peak.seasonal)} expected this season. This is the real gap.</Callout>
            <Callout tone="mute" title={`Vs last 4 weeks: ${pct(peak.rRolling!)}`}>{inrK(peak.actual)} collected vs {inrK(peak.rolling)} recent average.</Callout>
          </div>)}
      </Panel>
      {quant && (
        <Panel title="Quant working: weekly residuals table" subtitle="Exact weekly actuals, expected baselines, and relative residuals R = (V − E) / E." bodyClass="p-0 overflow-x-auto">
          <table className={tableCls}><thead><tr><Th>Week</Th><Th>Actual</Th><Th>Anchored E</Th><Th>Seasonal E</Th><Th>Rolling E</Th><Th>R (anchored)</Th><Th>R (seasonal)</Th><Th>R (rolling)</Th></tr></thead>
            <tbody>{rows.slice(-6).map(w => <tr key={w.week} className={rowCls}><Td>{w.week}</Td><Td className="tabular-nums">{w.actual === null ? <span className="text-dim">not active</span> : inrK(w.actual)}</Td><Td className="tabular-nums">{inrK(w.anchored)}</Td><Td className="tabular-nums">{inrK(w.seasonal)}</Td><Td className="tabular-nums">{inrK(w.rolling)}</Td>
              {[w.rAnchored, w.rSeasonal, w.rRolling].map((x, i) => <Td key={i} className="tabular-nums">{x === null ? '—' : <span className={Math.abs(x) > 0.3 ? 'text-stone-300' : ''}>{pct(x)}</span>}</Td>)}</tr>)}</tbody></table>
        </Panel>
      )}
      <Callout tone="info" title="Why a busy festival week is NOT automatically suspicious">
        Festival weeks raise what is expected for {p.category.toLowerCase()}, and high volume alone never opens a case{alarm ? `. Here, sustained drift triggered the CUSUM tracker in ${alarm.week}` : '. No sustained drift alarm fired here'}. Volume must be backed up by independent red flags in L3 (such as ticket sizes, customer states, or payment-link evidence).
      </Callout>
      <div className="text-xs text-dim">Profile status: <Badge tone="ok">Approved</Badge> Nothing in L2 opens a case by itself.</div>
    </>
  );
}
export function L2View() {
  const { result: r } = useInvestigation();
  const { peak, cusum, profile: p } = r.l2;
  const alarm = cusum.find(c => c.alarm);
  return (
    <LayerFrame
      n={2}
      brief={{
        checks: 'Turns the merchant’s business category and festival calendar into expected weekly sales, ticket sizes, hours, and customer geography—without blindly trusting self-declared limits.',
        happened: peak && peak.actual !== null ? (
          <>
            Latest active week ({peak.week}): collected <b>{inrK(peak.actual)}</b> vs <b>{inrK(peak.seasonal)}</b> expected for this season (<b>{pct(peak.rSeasonal ?? 0)}</b> gap).{' '}
            {alarm ? <>Sustained volume drift alarmed in <b>{alarm.week}</b>.</> : 'No sustained volume drift alarm.'}
          </>
        ) : <>Loaded baseline profile for <b>{p.name}</b> ({p.category}, {inrK(p.baselineWeekly)}/week).</>,
        whyItMatters: 'This prevents false alarms during genuine festival rushes (like Diwali). Next, L3 runs its checks, comparing actual customer behaviour against what is normal for this category.',
      }}
    >
      <L2Body r={r} />
    </LayerFrame>
  );
}
