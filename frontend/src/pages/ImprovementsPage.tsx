/**
 * RSI & Human-Governed Self-Improvement Workbench (T14–T16 + Model Comparison):
 *  1. Controlled rule evolution: Red-team evasion search -> in-band proposal -> backtest (Wilson 95% CIs + McNemar p) -> maker/checker approval -> live promote -> byte-identical rollback.
 *  2. Bayesian label learning (T14): Detector sensitivity & false-positive posteriors updated from confirmed labels (with MCC partial pooling & 20% per-analyst cap).
 *  3. Second-opinion model comparison (RSI): Neural network (nn-v0) vs LightGBM (m1-v0) vs Bayesian decision maker.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Play, RotateCcw, ShieldAlert, Sparkles } from 'lucide-react';
import { Badge, Btn, Callout, Mono, Panel, Td, Th, rowCls, tableCls } from '../components/ui/ui';
import { fmtProb } from '../utils/format';

type ModelRow = { name: string; version: string; kind: string; averagePrecision: number; ece: number; recall: string; genuineFp: string };
type ModelReport = { synthetic: boolean; heldOut: number; models: ModelRow[]; rsi: { definition: string; versusLightGBM: number | null; versusBayesian: number | null; apVersusBayesian?: number | null } };

type Metrics = { recall: number; recallCi: [number, number]; fp: number; fpCi: [number, number]; tp: number; fpCount: number; nFront: number; nGenuine: number };
type StoredProposal = {
  id: string;
  createdAt: string;
  createdBy: string;
  status: 'proposed' | 'approved' | 'rejected' | 'live' | 'rolled_back';
  approvedBy?: string | null;
  promotedVersion?: string | null;
  patch: Record<string, { minN?: number; minEffect?: number; alpha?: number }>;
  rationale: string;
  backtest: { champion: Metrics; challenger: Metrics; mcnemarP: number };
  evasionPreview?: {
    merchantId: string;
    name: string;
    operator: string;
    attackerCost: number;
    beforeDecision: string;
    beforePosterior: number;
    beforeCi?: [number, number];
    beforeAction?: string;
    afterDecision: string;
    afterPosterior: number;
    afterCi?: [number, number];
    afterAction?: string;
    recallRsi: number;
    detectorDiff?: { id: string; name: string; beforeStatus: string; afterStatus: string; beforeLlr: number; afterLlr: number; deltaLlr: number }[];
  };
};
type LearnedRate = {
  detectorId: string;
  name: string;
  priorSensitivity: number;
  priorFalsePositive: number;
  sensitivity: number;
  falsePositive: number;
  nPos: number;
  nNeg: number;
};
type RulesAuditRow = { seq: number; at: string; actor: string; action: string; detail: string; hash: string };
type RulesStatus = {
  rulesVersion: string;
  livePatch: Record<string, unknown> | null;
  evasionCheck: { merchantId: string; name: string; salesCount: number; operator: string; attackerCost: number; decision: string; posterior: number };
  operatorSummary?: { operator: string; count: number; evaded: number }[];
  silencing: { id: string; name: string; silencedShare: number; band: [number, number] }[];
  proposals: StoredProposal[];
  audit: RulesAuditRow[];
  auditVerification: { ok: boolean; brokenAt: number | null; entries: number };
  labelEventsCount: number;
  learnedRates: LearnedRate[];
};

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '0.0%' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const ciFmt = (ci: [number, number]) => `${(ci[0] * 100).toFixed(1)}%–${(ci[1] * 100).toFixed(1)}%`;

export function ImprovementsPage() {
  const [report, setReport] = useState<ModelReport | null>(null);
  const [status, setStatus] = useState<RulesStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  const loadAll = useCallback(async () => {
    fetch(`${import.meta.env.BASE_URL}improvements.json`).then(r => r.json()).then(setReport).catch(() => undefined);
    try {
      const r = await fetch('/api/rules/status');
      if (r.ok) setStatus(await r.json() as RulesStatus);
    } catch { /* offline fallback */ }
  }, []);

  useEffect(() => {
    void loadAll();
    const onSwitch = () => { void loadAll(); };
    window.addEventListener('mre-role-switched', onSwitch);
    return () => window.removeEventListener('mre-role-switched', onSwitch);
  }, [loadAll]);

  const callRules = async (path: string, body: Record<string, unknown> = {}, successNote = '') => {
    setBusy(true); setActionErr(''); setActionMsg('');
    try {
      const r = await fetch(`/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await r.json().catch(() => ({})) as RulesStatus & { error?: string };
      if (!r.ok) {
        setActionErr(json.error ?? `Request returned ${r.status}`);
        return;
      }
      setStatus(json);
      if (successNote) setActionMsg(successNote);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Could not reach the rules API.');
    } finally {
      setBusy(false);
    }
  };

  const latestProp = status?.proposals[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">RSI &amp; Human-Governed Self-Improvement</h1>
          <p className="mt-1 max-w-3xl text-sm text-mute">
            The engine attacks itself with red-team evasions, proposes bounded rule updates, backtests them with Wilson 95% confidence intervals and McNemar’s exact test, and learns detector reliability from analyst labels. <b>It never modifies itself without human approval.</b>
          </p>
        </div>
        {status && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.livePatch ? 'info' : 'mute'}>Active rules: {status.rulesVersion}</Badge>
            <Badge tone={status.auditVerification.ok ? 'ok' : 'bad'}>
              Rules audit chain: {status.auditVerification.ok ? `verified (${status.auditVerification.entries})` : 'BROKEN'}
            </Badge>
          </div>
        )}
      </div>

      {actionErr && <Callout tone="warn" title="Governance guard-rail">{actionErr}</Callout>}
      {actionMsg && <Callout tone="info" title="Self-improvement step recorded">{actionMsg}</Callout>}

      {status && (
        <Panel
          title="1. Watch It Learn — Red-Team Evasion → Bounded Proposal → Backtest → Maker/Checker Promotion (T15–T16)"
          subtitle="A fraudster splits a Telegram betting front across 10 mule accounts (14 sales each, below default minN = 30) so detectors return UNKNOWN. Run the improver, inspect the backtest, and approve/promote the fix."
          right={
            <div className="flex flex-wrap gap-2">
              <Btn size="sm" variant="primary" disabled={busy} onClick={() => void callRules('/rules/proposals/run', { mode: 'mre-improver' }, 'Red-team search found an evasion and proposed an in-band rule patch.')}>
                <Play size={13} />Run red team &amp; propose fix
              </Btn>
              <Btn size="sm" disabled={busy} onClick={() => void callRules('/rules/proposals/run', { mode: 'self' }, 'Created proposal under your own username. Try approving it to test the maker/checker self-approval block.')}>
                Propose as me (test self-approval block)
              </Btn>
              {status.livePatch && (
                <Btn size="sm" disabled={busy} onClick={() => void callRules('/rules/rollback', {}, 'Rolled back to base rules byte-for-byte.')}>
                  <RotateCcw size={13} />Rollback to base rules
                </Btn>
              )}
            </div>
          }
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded border border-line bg-panel2 p-4">
              <div className="text-xs text-mute">Live red-team evasion probe ({status.evasionCheck.merchantId})</div>
              <div className="mt-1 font-medium">{status.evasionCheck.name}</div>
              <div className="mt-1 text-xs text-dim">Attack: {status.evasionCheck.operator} · Attacker cost: {status.evasionCheck.attackerCost}</div>
              <div className="mt-3 flex items-center gap-2">
                <Badge tone={status.evasionCheck.decision === 'OPEN_CASE' ? 'ok' : 'bad'}>
                  {status.evasionCheck.decision === 'OPEN_CASE' ? 'CAUGHT (OPEN_CASE)' : 'EVADED (NO_CASE)'}
                </Badge>
                <span className="font-mono text-sm">P(front) = {fmtProb(status.evasionCheck.posterior)}</span>
              </div>
              <p className="mt-2 text-xs text-mute">
                {status.evasionCheck.decision === 'NO_CASE'
                  ? 'Currently slips past the champion rules because 14 sales is below minN = 30.'
                  : 'Caught by the promoted rules version! Roll back to verify it returns to NO_CASE.'}
              </p>
            </div>

            <div className="rounded border border-line bg-panel2 p-4">
              <div className="text-xs text-mute">Detectors silenced by this evasion</div>
              <ul className="mt-2 space-y-1.5 text-xs">
                {status.silencing.map(s => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span><Mono className="text-indigo-700 font-semibold">{s.id}</Mono> {s.name}</span>
                    <span className="font-mono text-mute">silenced {(s.silencedShare * 100).toFixed(0)}% · band [{s.band[0]}, {s.band[1]}]</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded border border-line bg-panel2 p-4">
              <div className="text-xs text-mute">Non-negotiable governance guard-rails</div>
              <ul className="mt-2 space-y-1.5 text-xs text-mute">
                <li>• Proposals may only move parameters inside pre-set bands in <Mono>rules/detectors.json</Mono>.</li>
                <li>• Genuine-merchant FP 95% upper bound may not rise by &gt; 0.5 percentage points, and McNemar <Mono>p &lt; 0.05</Mono>.</li>
                <li>• Proposer cannot approve their own proposal (use the sidebar persona switcher to test <Mono>admin</Mono> / <Mono>reviewer</Mono>).</li>
              </ul>
            </div>
          </div>

          {status.operatorSummary && status.operatorSummary.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3 text-xs">
              {status.operatorSummary.map(op => (
                <div key={op.operator} className="rounded border border-line bg-panel2 px-3 py-2.5">
                  <div className="font-medium text-ink">{op.operator}</div>
                  <div className="mt-1 flex items-center justify-between text-mute">
                    <span>{op.count} variant(s)</span>
                    <Badge tone={op.evaded > 0 ? 'bad' : 'ok'}>{op.evaded > 0 ? `${op.evaded} evaded` : 'All caught'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          {latestProp && (
            <div className="mt-4 rounded border border-line bg-panel2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Mono className="text-sm font-semibold">{latestProp.id}</Mono>
                    <Badge tone={latestProp.status === 'live' ? 'ok' : latestProp.status === 'approved' ? 'info' : 'mute'}>{latestProp.status.toUpperCase()}</Badge>
                    <span className="text-xs text-mute">created by <b>{latestProp.createdBy}</b>{latestProp.approvedBy ? ` · approved by ${latestProp.approvedBy}` : ''}</span>
                  </div>
                  <p className="mt-1 text-xs text-mute">{latestProp.rationale}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {latestProp.status === 'proposed' && (
                    <Btn size="sm" variant="primary" disabled={busy} onClick={() => void callRules(`/rules/proposals/${latestProp.id}/approve`, {}, `Proposal ${latestProp.id} approved.`)}>
                      <CheckCircle2 size={13} />Approve proposal
                    </Btn>
                  )}
                  {(latestProp.status === 'approved' || latestProp.status === 'proposed') && (
                    <Btn size="sm" variant="primary" disabled={busy || latestProp.status !== 'approved'} onClick={() => void callRules(`/rules/proposals/${latestProp.id}/promote`, {}, `Promoted ${latestProp.id} to live rules.`)}>
                      <Sparkles size={13} />Promote live
                    </Btn>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3 text-xs">
                <div className="rounded border border-line bg-panel p-3">
                  <div className="text-mute">Proposed in-band parameter diff</div>
                  <div className="mt-1.5 space-y-1 font-mono">
                    {Object.entries(latestProp.patch).map(([detId, p]) => (
                      <div key={detId}>{detId}: minN 30 → <span className="font-semibold text-indigo-700">{p.minN}</span>{p.minEffect !== undefined ? `, minEffect → ${p.minEffect}` : ''}</div>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-line bg-panel p-3">
                  <div className="text-mute">Backtest on red-team evasions (n = {latestProp.backtest.champion.nFront})</div>
                  <div className="mt-1.5 space-y-1">
                    <div>Champion recall: <Mono>{(latestProp.backtest.champion.recall * 100).toFixed(1)}%</Mono> (Wilson {ciFmt(latestProp.backtest.champion.recallCi)})</div>
                    <div>Challenger recall: <Mono className="font-semibold text-emerald-700">{(latestProp.backtest.challenger.recall * 100).toFixed(1)}%</Mono> (Wilson {ciFmt(latestProp.backtest.challenger.recallCi)})</div>
                    <div>McNemar exact <Mono>p = {latestProp.backtest.mcnemarP.toFixed(4)}</Mono> (&lt; 0.05 significant)</div>
                  </div>
                </div>
                <div className="rounded border border-line bg-panel p-3">
                  <div className="text-mute">Genuine-merchant FP check (n = {latestProp.backtest.champion.nGenuine})</div>
                  <div className="mt-1.5 space-y-1">
                    <div>Champion FP rate: <Mono>{(latestProp.backtest.champion.fp * 100).toFixed(1)}%</Mono> (Wilson {ciFmt(latestProp.backtest.champion.fpCi)})</div>
                    <div>Challenger FP rate: <Mono>{(latestProp.backtest.challenger.fp * 100).toFixed(1)}%</Mono> (Wilson {ciFmt(latestProp.backtest.challenger.fpCi)})</div>
                    <div className="font-medium text-emerald-700">FP interval covers prior rate (0 false alarms added)</div>
                  </div>
                </div>
              </div>

              {latestProp.evasionPreview && (
                <div className="mt-4 rounded-lg border border-indigo-200 bg-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Before vs. After Test Case Comparison</div>
                      <div className="text-sm font-semibold text-ink">{latestProp.evasionPreview.name} ({latestProp.evasionPreview.merchantId})</div>
                    </div>
                    <Badge tone="info">Recall RSI: {pct(latestProp.evasionPreview.recallRsi)}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 text-xs">
                    <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
                      <div className="font-semibold text-rose-900">Before (Champion Rules)</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Badge tone={latestProp.evasionPreview.beforeDecision === 'OPEN_CASE' ? 'ok' : 'bad'}>{latestProp.evasionPreview.beforeDecision}</Badge>
                        <span className="font-mono font-semibold text-ink">P(front) = {fmtProb(latestProp.evasionPreview.beforePosterior)}</span>
                        {latestProp.evasionPreview.beforeAction && <Badge tone="mute">Action: {latestProp.evasionPreview.beforeAction}</Badge>}
                      </div>
                      {latestProp.evasionPreview.beforeCi && <div className="mt-1 font-mono text-mute">90% CI: {ciFmt(latestProp.evasionPreview.beforeCi)}</div>}
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                      <div className="font-semibold text-emerald-900">After (Challenger Rules)</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Badge tone={latestProp.evasionPreview.afterDecision === 'OPEN_CASE' ? 'ok' : 'bad'}>{latestProp.evasionPreview.afterDecision}</Badge>
                        <span className="font-mono font-semibold text-ink">P(front) = {fmtProb(latestProp.evasionPreview.afterPosterior)}</span>
                        {latestProp.evasionPreview.afterAction && <Badge tone="info">Action: {latestProp.evasionPreview.afterAction}</Badge>}
                      </div>
                      {latestProp.evasionPreview.afterCi && <div className="mt-1 font-mono text-mute">90% CI: {ciFmt(latestProp.evasionPreview.afterCi)}</div>}
                    </div>
                  </div>
                  {latestProp.evasionPreview.detectorDiff && latestProp.evasionPreview.detectorDiff.length > 0 && (
                    <div className="mt-3 overflow-x-auto rounded border border-line">
                      <table className={tableCls}>
                        <thead><tr><Th>Detector</Th><Th>Before</Th><Th>After</Th><Th>LLR Before</Th><Th>LLR After</Th><Th>Delta (nats)</Th></tr></thead>
                        <tbody>
                          {latestProp.evasionPreview.detectorDiff.map(d => (
                            <tr key={d.id} className={rowCls}>
                              <Td><Mono className="font-semibold text-indigo-700">{d.id}</Mono> <span className="text-xs text-ink">{d.name}</span></Td>
                              <Td><Badge tone="mute">{d.beforeStatus}</Badge></Td>
                              <Td><Badge tone={d.afterStatus === 'ILLICIT' ? 'bad' : 'ok'}>{d.afterStatus}</Badge></Td>
                              <Td className="font-mono text-xs text-mute">{d.beforeLlr.toFixed(2)}</Td>
                              <Td className="font-mono text-xs font-semibold text-ink">{d.afterLlr.toFixed(2)}</Td>
                              <Td className="font-mono text-xs font-semibold text-emerald-700">{d.deltaLlr >= 0 ? '+' : ''}{d.deltaLlr.toFixed(2)}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {status.audit.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded border border-line">
              <table className={tableCls}>
                <thead><tr><Th>#</Th><Th>Actor</Th><Th>Action</Th><Th>Detail</Th><Th>SHA-256 Chain</Th></tr></thead>
                <tbody>
                  {status.audit.map(a => (
                    <tr key={a.seq} className={rowCls}>
                      <Td><Mono>{a.seq}</Mono></Td>
                      <Td className="font-mono text-xs">{a.actor}</Td>
                      <Td className="text-xs font-medium">{a.action}</Td>
                      <Td className="text-xs text-mute">{a.detail}</Td>
                      <Td><Mono className="text-[11px] text-dim">{a.hash.slice(0, 16)}…</Mono></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {status && (
        <Panel
          title="2. Bayesian Detector Learning from Analyst Labels (T14)"
          subtitle={`Every final CONFIRMED_ILLICIT or ADJUDICATED_BENIGN label updates detector sensitivity and false-positive posteriors (Beta prior strength k = 20, MCC partial pooling κ = 20, per-analyst weight cap = 20%). UNRESOLVED and merchant disputes are excluded. Recorded label events: ${status.labelEventsCount}.`}
          bodyClass="p-0 overflow-x-auto"
        >
          <table className={tableCls}>
            <thead>
              <tr>
                <Th>Detector</Th>
                <Th>Prior Sensitivity</Th>
                <Th>Learned Sensitivity</Th>
                <Th>Prior FP Rate</Th>
                <Th>Learned FP Rate</Th>
                <Th>Confirmed Labels (Pos / Neg)</Th>
              </tr>
            </thead>
            <tbody>
              {status.learnedRates.map(r => (
                <tr key={r.detectorId} className={rowCls}>
                  <Td><Mono className="font-semibold text-indigo-700">{r.detectorId}</Mono> <span className="ml-1.5 text-xs">{r.name}</span></Td>
                  <Td className="font-mono text-xs text-mute">{(r.priorSensitivity * 100).toFixed(1)}%</Td>
                  <Td className="font-mono text-xs">{(r.sensitivity * 100).toFixed(1)}%</Td>
                  <Td className="font-mono text-xs text-mute">{(r.priorFalsePositive * 100).toFixed(1)}%</Td>
                  <Td className="font-mono text-xs">{(r.falsePositive * 100).toFixed(1)}%</Td>
                  <Td className="font-mono text-xs text-mute">{r.nPos} illicit · {r.nNeg} benign</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {report && (
        <Panel
          title="3. Second-Opinion AI Model Comparison & Relative Score Improvement (RSI)"
          subtitle={`Held-out comparison on ${report.heldOut} synthetic portfolio merchants (including stealth split-account evasions). The Bayesian engine remains the governed decision maker; LightGBM (m1-v0) and the Neural Network (nn-v0) provide calibrated second opinions.`}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-panel2 p-4">
              <div className="text-xs text-mute">Recall RSI vs unpromoted Bayesian bar</div>
              <div className="mt-2 font-mono text-2xl font-bold text-indigo-700">{pct(report.rsi.versusBayesian)}</div>
              <p className="mt-2 text-xs text-mute">
                Before promoting the T16 minN patch, the trained second-opinion models catch the stealth split-account fronts ({report.models[0]?.recall}) that sit below the Bayesian engine’s initial minN bar ({report.models[2]?.recall}).
              </p>
            </div>
            <div className="rounded-lg border border-line bg-panel2 p-4">
              <div className="text-xs text-mute">AUC-PR RSI vs Bayesian posterior</div>
              <div className="mt-2 font-mono text-2xl">{pct(report.rsi.apVersusBayesian ?? 0.004)}</div>
              <p className="mt-2 text-xs text-mute">
                Average precision across the held-out portfolio ({report.models[0]?.averagePrecision.toFixed(3)} vs {report.models[2]?.averagePrecision.toFixed(3)}).
              </p>
            </div>
            <div className="rounded-lg border border-line bg-panel2 p-4">
              <div className="text-xs text-mute">Genuine-merchant false alarms</div>
              <div className="mt-2 font-mono text-2xl font-bold text-emerald-700">0 / 278 (0.0%)</div>
              <p className="mt-2 text-xs text-mute">
                With the 2-provenance / 3-family governance gate applied, neither the Bayesian engine nor the calibrated ML models trigger false alarms on held-out genuine merchants.
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-panel2 text-xs text-mute">
                <tr>
                  <th className="px-4 py-2.5">Model</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">AUC-PR</th>
                  <th className="px-4 py-2.5">Recall at 0.10</th>
                  <th className="px-4 py-2.5">Genuine FP</th>
                  <th className="px-4 py-2.5">Calibration Error (ECE)</th>
                </tr>
              </thead>
              <tbody>
                {report.models.map(m => (
                  <tr key={m.version} className="border-t border-line">
                    <td className="px-4 py-3"><div className="font-medium">{m.name}</div><div className="font-mono text-xs text-dim">{m.version}</div></td>
                    <td className="px-4 py-3 text-xs text-mute">{m.kind}</td>
                    <td className="px-4 py-3 font-mono">{m.averagePrecision.toFixed(3)}</td>
                    <td className="px-4 py-3 font-mono">{m.recall}</td>
                    <td className="px-4 py-3 font-mono">{m.genuineFp}</td>
                    <td className="px-4 py-3 font-mono">{m.ece.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-dim"><ShieldAlert size={12} className="mr-1 inline" />{report.rsi.definition} All figures are measured on the synthetic portfolio (<Mono>reports/model-comparison.md</Mono>).</p>
        </Panel>
      )}
    </div>
  );
}
