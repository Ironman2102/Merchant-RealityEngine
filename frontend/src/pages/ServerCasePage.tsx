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
  const { caseId, loadCase, syncError, running, user } = useInvestigation();
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

  if (error) return <div className="space-y-4 py-8"><p className="text-sm text-bad" role="alert">{error}</p><Link to="/ai-engine"><Btn><ArrowLeft size={14} />Back to workspace</Btn></Link></div>;
  if (!item || caseId !== id) return <div className="py-12 text-center text-sm text-mute" role="status">Loading case…</div>;
  const View = VIEWS[view] ?? VIEWS.investigations;
  const res = item.result as { decision: string; priority: string } | undefined;

  return <div className="space-y-6">
    <div className="no-print flex flex-wrap items-center justify-between gap-3">
      <Link to="/ai-engine" className="inline-flex items-center gap-2 text-sm font-medium text-mute hover:text-ink"><ArrowLeft size={14} />All investigations</Link>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-mute">{item.id} · saved {new Date(item.createdAt).toLocaleString()}</span>
        {res && (user.label === 'ADJUDICATED_BENIGN'
          ? <Badge tone="ok">Cleared on review</Badge>
          : <Badge tone={res.decision === 'OPEN_CASE' ? 'bad' : 'ok'}>{res.decision === 'OPEN_CASE' ? `${res.priority} review` : 'No case opened'}</Badge>)}
        <Btn size="sm" onClick={() => void load()} disabled={loading || running}><RefreshCw size={13} />Refresh</Btn>
      </div>
    </div>
    {syncError && <Callout tone="warn" title="Not saved">{syncError}</Callout>}
    <div className="no-print rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-xs leading-relaxed text-warn">Saved case: notes, responses and labels you record below are written to the case record and its audit history. Nothing here acts on payment rails.</div>
    {!!item.history?.some(h => !h.label && (h.decision === 'OPEN_CASE' || h.followUp === 'ASK')) && <div role="status" className="no-print rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-xs text-warn">
      <b>Still open on this merchant:</b>{' '}
      {item.history.filter(h => !h.label && (h.decision === 'OPEN_CASE' || h.followUp === 'ASK')).map((h, i) => <span key={h.id}>{i > 0 && ' · '}<Link className="underline" to={`/ai-engine/cases/${h.id}`}>{h.id}</Link> {h.decision === 'OPEN_CASE' ? 'case' : 'question'}</span>)}. This file does not close them.
    </div>}
    {!!item.history?.some(h => h.label) && <div role="status" className="no-print rounded-lg border border-line bg-panel2 px-4 py-2.5 text-xs">
      <b>Earlier decisions on this merchant:</b>{' '}
      {item.history.filter(h => h.label).map((h, i) => <span key={h.id}>{i > 0 && ' · '}<Link className="underline" to={`/ai-engine/cases/${h.id}`}>{h.id}</Link> {h.label === 'ADJUDICATED_BENIGN' ? 'cleared on review' : h.label === 'CONFIRMED_ILLICIT' ? 'confirmed illicit' : 'unresolved'}</span>)}
    </div>}
    <View />
  </div>;
}
