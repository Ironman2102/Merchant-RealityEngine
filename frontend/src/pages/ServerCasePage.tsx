import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Badge, Btn, Callout } from '../components/ui/ui';
import { getPilotCase, type PilotCase } from '../services/pilotApi';
import { useInvestigation } from '../hooks/useInvestigation';
import { InvestigationPage } from './InvestigationPage';
import { EvidenceGraphPage } from './EvidenceGraphPage';
import { DetectionPage } from './DetectionPage';
import { PatternsPage } from './PatternsPage';
import { MerchantPage } from './MerchantPage';
import { AnalystPage } from './AnalystPage';
import { ResponsePage } from './ResponsePage';
import { AuditPage } from './AuditPage';
import { TracePage } from './TracePage';

/** Saved case = the same seven-layer screens as the guided demo, loaded from the server record and saved back to it. */
const VIEWS: Record<string, () => JSX.Element> = {
  investigations: () => <InvestigationPage />, graph: EvidenceGraphPage, detection: DetectionPage, patterns: PatternsPage,
  merchant: MerchantPage, analyst: AnalystPage, response: ResponsePage, audit: AuditPage, trace: TracePage,
};
export const CASE_VIEWS = Object.keys(VIEWS);

export function ServerCasePage() {
  const { id = '', view = 'investigations' } = useParams();
  const [params, setParams] = useSearchParams();
  const { caseId, loadCase, syncError, running } = useInvestigation();
  const [item, setItem] = useState<PilotCase | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async (animate = false) => {
    setLoading(true); setError('');
    try {
      const c = await getPilotCase(id);
      setItem(c); loadCase(id, c.scenario, c, animate);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this case.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (caseId === id && item) return;
    const animate = params.get('run') === '1';
    if (animate) setParams({}, { replace: true });
    void load(animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="space-y-4 py-8"><p className="text-sm text-neutral-300" role="alert">{error}</p><Link to="/ai-engine"><Btn><ArrowLeft size={14} />Back to workspace</Btn></Link></div>;
  if (!item || caseId !== id) return <div className="py-12 text-center text-sm text-mute" role="status">Loading case…</div>;
  const View = VIEWS[view] ?? VIEWS.investigations;
  const res = item.result as { decision: string; priority: string } | undefined;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link to="/ai-engine" className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink"><ArrowLeft size={14} />All investigations</Link>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-mute">{item.id} · saved {new Date(item.createdAt).toLocaleString()}</span>
        {res && <Badge tone={res.decision === 'OPEN_CASE' ? 'bad' : 'ok'}>{res.decision === 'OPEN_CASE' ? `${res.priority} review` : 'No case opened'}</Badge>}
        <Btn size="sm" onClick={() => void load()} disabled={loading || running}><RefreshCw size={13} />Refresh</Btn>
      </div>
    </div>
    {syncError && <Callout tone="warn" title="Not saved">{syncError}</Callout>}
    <div className="rounded border border-stone-400/30 bg-stone-400/5 px-4 py-3 text-xs leading-relaxed text-stone-200">Saved case: notes, responses and labels you record below are written to the case record and its audit history. Nothing here acts on payment rails.</div>
    <View />
  </div>;
}
