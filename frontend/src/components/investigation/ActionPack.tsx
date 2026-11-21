import { useState } from 'react';
import { Check, Copy, FileText, Mail, Printer } from 'lucide-react';
import type { InvestigationResult } from '../../types/investigation';
import { MECHANISMS, RESPONSE_LEVELS } from '../../data/evidence';
import { computeMerchantReality } from './ClaimedVsReality';
import { Badge, Btn, Card } from '../ui/ui';
import { fmtInterval, fmtProb, inr, pct } from '../../utils/format';

function buildMerchantOutreach(result: InvestigationResult): string {
  const p = result.scenario.profile;
  const fired = [...result.evidence].filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr);
  const requests: string[] = [];

  for (const e of fired.slice(0, 4)) {
    const id = e.id.toLowerCase();
    if (id.includes('geo') || id.includes('state')) {
      requests.push('• Shipping / delivery receipts or courier manifests explaining orders from customers outside ' + p.localStates.join(', '));
    } else if (id.includes('ticket') || id.includes('round')) {
      requests.push('• Itemized GST invoices / product catalog matching recent high-value exact-amount transactions');
    } else if (id.includes('hour') || id.includes('fixture') || id.includes('night')) {
      requests.push('• Confirmation of your current operating hours and fulfillment logs for late-night / off-hour transactions');
    } else if (id.includes('refund') || id.includes('payout')) {
      requests.push('• Reconciliation sheet linking recent customer refunds / payouts back to original customer orders');
    } else if (id.includes('link') || id.includes('domain') || id.includes('telegram')) {
      requests.push('• Official website, storefront URL, or authorized sales channel details where payment links are shared');
    } else {
      requests.push(`• Supporting business invoices / documentation clarifying: ${e.name}`);
    }
  }
  if (requests.length === 0) {
    requests.push('• Routine confirmation of current product catalog and business operating hours');
  }

  return [
    `Subject: Quick Verification Needed — Recent Settlement Activity (${p.name} | MID ${p.id})`,
    '',
    `Dear ${p.name} Team,`,
    '',
    `As part of our routine RBI merchant-monitoring review for your registered ${p.category} account (${p.city}), we noticed recent payment patterns that differ from the business profile submitted during onboarding.`,
    '',
    'To keep your settlements running smoothly without interruption, please reply within 48 hours with the following documents:',
    ...requests,
    '',
    'If your business has recently launched a new product line, seasonal promotion, or online delivery service, a brief note with sample invoices will help us update your merchant profile immediately.',
    '',
    'Thank you for your cooperation,',
    'Merchant Risk Operations Team',
  ].join('\n');
}

function buildStrSummary(result: InvestigationResult): string {
  const p = result.scenario.profile;
  const r = computeMerchantReality(result);
  const open = result.fusion.decision === 'OPEN_CASE';
  const level = RESPONSE_LEVELS.find(l => l.id === result.review.recommended);
  const topMech = MECHANISMS.find(m => m.id === result.fusion.mechanisms[0]?.id);
  const fired = [...result.evidence].filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr);

  return [
    `# Merchant Risk & Compliance Dossier (FIU-IND / RBI PA-PG Reference)`,
    ``,
    `- **Merchant:** ${p.name} (MID: \`${p.id}\`)`,
    `- **Declared Business:** ${p.category} · MCC ${p.mcc} · ${p.city} (${p.catchment})`,
    `- **Verdict:** ${open ? `ESCALATE — OPEN CASE (${result.fusion.priority} Priority)` : 'CLEARED — NO CASE OPENED'}`,
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

  const outreachText = buildMerchantOutreach(result);
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
          <h3 className="text-sm font-semibold text-ink">1-Click Analyst Action Pack</h3>
          <Badge tone="info">Saves ~15 min/case</Badge>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-panel p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTab('outreach')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${tab === 'outreach' ? 'bg-indigo-50 text-indigo-700' : 'text-mute hover:text-ink'}`}
            >
              <Mail size={13} />Merchant RFI Draft
            </button>
            <button
              type="button"
              onClick={() => setTab('str')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${tab === 'str' ? 'bg-indigo-50 text-indigo-700' : 'text-mute hover:text-ink'}`}
            >
              <FileText size={13} />FIU-IND STR / Audit Pack
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
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
          {activeText}
        </pre>
      </div>
    </Card>
  );
}
