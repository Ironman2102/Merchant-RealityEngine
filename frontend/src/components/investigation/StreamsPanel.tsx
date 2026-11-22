import { useInvestigation } from '../../hooks/useInvestigation';
import { Badge, Mono, Panel, Td, Th, rowCls, tableCls } from '../ui/ui';
import { fmtProb, pct } from '../../utils/format';

/** The average hides a side business. This shows the account and each of its streams next to each other. */
export function StreamsPanel() {
  const { result: r } = useInvestigation();
  if (!r.streams.length) return null;
  return (
    <Panel title="Scored QR by QR" subtitle="A shop that takes bets on the side looks normal on average, so every QR, link and group of repeat payers is also scored on its own." bodyClass="p-0 overflow-x-auto">
      <table className={tableCls}>
        <thead><tr><Th>Stream</Th><Th>Share of sales</Th><Th>P(front)</Th><Th>Result</Th><Th>Signals</Th></tr></thead>
        <tbody>{r.streams.map(s => (
          <tr key={s.scope.id} className={rowCls}>
            <Td className="font-medium">{s.scope.label}{r.suspectLinks.includes(s.scope.id) && <span className="ml-2"><Badge tone="bad">Only this flow would be restricted</Badge></span>}</Td>
            <Td className="tabular-nums">{pct(s.scope.share)} <span className="text-dim">({s.scope.sales})</span></Td>
            <Td className="font-mono">{fmtProb(s.posterior)}</Td>
            <Td><Badge tone={s.decision === 'OPEN_CASE' ? 'bad' : s.followUp === 'ASK' ? 'warn' : 'ok'}>{s.decision === 'OPEN_CASE' ? 'Opens a case' : s.followUp === 'ASK' ? 'Needs explaining' : 'Normal'}</Badge></Td>
            <Td><Mono>{s.fired.join(', ') || 'none'}</Mono></Td>
          </tr>))}</tbody>
      </table>
      <p className="border-t border-line px-4 py-2.5 text-xs text-mute">The headline evidence refers to: <b>{r.scope.label}</b>.</p>
    </Panel>
  );
}
