import { useInvestigation } from '../hooks/useInvestigation';
import { EvidenceGraph } from '../components/graphs/EvidenceGraph';
import { Callout } from '../components/ui/ui';

export function EvidenceGraphPage() {
  const { result, scenario, done } = useInvestigation();
  return (
    <>
      <div><h1 className="text-2xl font-semibold tracking-tight">Evidence relationship diagram</h1><p className="mt-1 text-sm text-mute">{scenario.profile.name} · staged Mermaid-style flow across payers, websites, payment links, merchant entity, payout accounts and peers.</p></div>
      {!done(3) && <Callout tone="info" title="Run the investigation to attach evidence">The structure is shown below. Detector evidence appears on each edge once L3 completes.</Callout>}
      <EvidenceGraph scenario={scenario} evidence={done(3) ? result.evidence : []} />
    </>
  );
}
