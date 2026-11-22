import { useState } from 'react';
import { Check, Copy, FileText, Mail, Printer } from 'lucide-react';
import type { InvestigationResult } from '../../types/investigation';
import { MECHANISMS, RESPONSE_LEVELS } from '../../data/evidence';
import { merchantLetter } from '../../../../engine/outreach';
import { verdictKind, VERDICT_TEXT } from '../../engines/verdict';
import { computeMerchantReality } from './ClaimedVsReality';
import { Badge, Btn, Card } from '../ui/ui';
import { fmtInterval, fmtProb, inr, pct } from '../../utils/format';

function buildStrSummary(result: InvestigationResult): string {
  const p = result.scenario.profile;
  const r = computeMerchantReality(result);
  const open = result.fusion.decision === 'OPEN_CASE';
  const level = RESPONSE_LEVELS.find(l => l.id === result.review.recommended);
  const topMech = MECHANISMS.find(m => m.id === result.fusion.mechanisms[0]?.id);
  const fired = [...result.evidence].filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr);

  return [
    `# INTERNAL: merchant risk note (draft facts for the Principal Officer)`,
    `Do not share with the merchant: not these reasons, and not the fact of any report.`,
    `- **Evidence scope:** ${result.scope.label}`,
    ``,
    `- **Merchant:** ${p.name} (MID: \`${p.id}\`)`,
    `- **Declared Business:** ${p.category} · MCC ${p.mcc} · ${p.city} (${p.catchment})`,
    `- **Verdict:** ${open ? `ESCALATE — OPEN CASE (${result.fusion.priority} Priority)` : VERDICT_TEXT[verdictKind(result)].badge}`,
    `- **Bayesian Front Likelihood:** ${fmtProb(result.fusion.posterior)} (90% CI: ${fmtInterval(result.fusion.posteriorCi)})`,
    `- **Primary Suspected Mechanism:** ${open && topMech ? topMech.name : 'None — consistent with declared business'}`,
    `- **Estimated Monthly GMV:** ${inr(r.monthlyGmv)} (${inr(Math.round(r.observedGmv))} observed across ${r.salesCount} sales / ${Math.round(r.windowDays)} days)`,
    `- **Recommended Governance Action:** ${result.review.recommended} — ${level?.name ?? result.review.recommended}`,
    ``,
    `## Key Behavioral Mismatches (${fired.length} signals across ${result.fusion.independentFamilies.length} evidence families)`,
    ...(fired.length > 0
      ? fired.map(e => `- **${e.name}** (${e.family}, ${e.provenance}): ${e.observed}`)
      : ['- No illicit indicators fired. Activity aligns with declared profile.']),
    ``,
    `## Observed Ledger Summary`,
    `- Median Ticket: ${inr(Math.round(r.medianTicket))} (Declared: ${inr(p.ticketMin)}–${inr(p.ticketMax)})`,
    `- Exact Round-Number Share (₹500+): ${pct(r.roundShare)}`,
    `- Out-of-State Payers: ${pct(r.outOfStateShare)}`,
    `- Off-Hours Activity (IST): ${pct(r.offHoursShare)}`,
    `- Refund Rate: ${pct(r.refundRate)} (${result.l1.refundLinkage.orphan} unlinked refunds)`,
    ``,
    `## Governance & Maker-Checker Note`,
    `- ${result.fusion.gateReason}`,
    `- Automated fund freezes are disabled by policy; any settlement hold requires independent checker approval.`,
  ].join('\n');
}

export function ActionPack({ result }: { result: InvestigationResult }) {
  const [tab, setTab] = useState<'outreach' | 'str'>('outreach');
  const [copied, setCopied] = useState<'outreach' | 'str' | null>(null);

  const outreachText = merchantLetter(result.scenario.profile);
  const strText = buildStrSummary(result);
  const activeText = tab === 'outreach' ? outreachText : strText;

  const copy = async (which: 'outreach' | 'str', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard blocked in some contexts; ignore gracefully
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-slate-50/80 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">Analyst Action Pack</h3>
          <Badge tone="info">Drafts. A person sends or files</Badge>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-panel p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTab('outreach')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${tab === 'outreach' ? 'bg-indigo-50 text-indigo-700' : 'text-mute hover:text-ink'}`}
            >
              <Mail size={13} />Letter to merchant
            </button>
            <button
              type="button"
              onClick={() => setTab('str')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${tab === 'str' ? 'bg-indigo-50 text-indigo-700' : 'text-mute hover:text-ink'}`}
            >
              <FileText size={13} />Internal STR facts
            </button>
          </div>
          <Btn size="sm" variant="outline" onClick={() => void copy(tab, activeText)}>
            {copied === tab ? <><Check size={13} className="text-emerald-600" />Copied</> : <><Copy size={13} />Copy text</>}
          </Btn>
          <Btn size="sm" variant="primary" onClick={() => window.print()}>
            <Printer size={13} />Print / Save PDF
          </Btn>
        </div>
      </div>

      <div className="p-5">
        <p className="mb-3 text-xs text-mute">{tab === 'outreach'
          ? 'The same neutral letter for every merchant, whatever fired, so it cannot tip anyone off. If a suspicious-transaction report is being considered, check with the Principal Officer before contact.'
          : 'Internal only. Never send this to the merchant.'}</p>
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
          {activeText}
        </pre>
      </div>
    </Card>
  );
}
