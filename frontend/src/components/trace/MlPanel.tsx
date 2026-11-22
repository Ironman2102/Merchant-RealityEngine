/** Second opinion from the small linear model. The decision on this page does not use it. */
import { useInvestigation } from '../../hooks/useInvestigation';
import { secondOpinion } from '../../../../engine/model';
import { RULES } from '../../../../rules/index';
import { Badge, Panel } from '../ui/ui';
import { fmtProb } from '../../utils/format';

export function MlPanel() {
  const { result } = useInvestigation();
  const ml = secondOpinion(result), flags = ml.p >= ml.threshold, engine = result.fusion.decision === 'OPEN_CASE';
  return (
    <Panel title="Trained model (second opinion)" subtitle="Logistic regression on payment signals, with weights that cannot be negative. It cannot see account age, category or which feeds exist. It never changes the decision.">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xl">{fmtProb(ml.p)}</span>
        <Badge tone="info">Trained on synthetic data</Badge>
        <Badge tone={flags === engine ? 'mute' : 'warn'}>{flags === engine ? 'Agrees with the engine' : 'Disagrees: look at the evidence'}</Badge>
      </div>
      <ul className="mt-2 space-y-0.5 text-[12px] text-mute">
        {ml.drivers.map(d => <li key={d.feature}>{d.feature} {RULES.detector(d.feature).name}: <span className="font-mono text-ink">+{d.weight.toFixed(2)}</span></li>)}
      </ul>
    </Panel>
  );
}
