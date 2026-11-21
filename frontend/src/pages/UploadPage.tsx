import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Download, FileJson, FileSpreadsheet, FileUp, Play, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useInvestigation } from '../hooks/useInvestigation';
import { usePortfolio } from '../hooks/usePortfolio';
import { datasetToScenario, type ParseResult } from '../data/dataset';
import { MECHANISMS, RESPONSE_LEVELS } from '../data/evidence';
import { runPatternPack, LADDER } from '../engines/patternPack';
import { InvestigationPage } from './InvestigationPage';
import { PatternBoard } from '../components/common/PatternBoard';
import { Badge, Btn, Callout, Panel } from '../components/ui/ui';
import { cx } from '../utils/format';
import {
  autoDetectMapping,
  buildDatasetFromCsv,
  buildSampleGatewayCsv,
  parseCsvText,
  type CsvColumnMapping,
  type CsvMerchantMeta,
  type ParsedCsv,
} from '../utils/csvToDataset';

const BASE = import.meta.env.BASE_URL;
type ServerStep = { layer: number; code: string; name: string; state: 'done' | 'waiting' | 'blocked'; summary: string };
type ServerCase = {
  id: string;
  workflow: ServerStep[];
  result: { recommended: string };
  user: { notes: string; clarification: string; chosenLevel: string | null; legalVerified: boolean; escrowConfirmed: boolean; executed: boolean; label: string | null };
};
const TEST_DATASETS = [
  { file: 'random-ai-engine-test.json', title: 'Juniper Lane Stationery · new synthetic dataset' },
  { file: 'demo-ai-engine-test.json', title: 'AI Engine upload test · Sweet Crumbs Bakery' },
  { file: '01-sweet-crumbs-betting-front.json', title: 'Sweet Crumbs Bakery · suspected betting collections' },
  { file: '02-merchant-rotation.json', title: 'Nova Gift Emporium · merchant rotation' },
  { file: '03-fabricated-online-store.json', title: 'Aarav Home Decor Online · fabricated commercial activity' },
  { file: '04-anand-sweets-diwali-genuine.json', title: 'Anand Sweets & Bakes · genuine Diwali growth' },
  { file: '09-telegram-betting-no-website.json', title: 'Kaveri Mithai Stores · Telegram betting link, no website' },
];

export function UploadPage() {
  const { loadCustom, clearCustom, custom, scenarioId, result, user, started, allDone, detailsOpen, setDetailsOpen } = useInvestigation();
  const { addUploaded, clearUploaded } = usePortfolio();
  const [caseKey, setCaseKey] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [over, setOver] = useState(false);
  const [analysed, setAnalysed] = useState(false);
  const [sampleFile, setSampleFile] = useState('');
  const [loadingSample, setLoadingSample] = useState(false);
  const [raw, setRaw] = useState('');
  const [serverCase, setServerCase] = useState<ServerCase | null>(null);
  const [serverError, setServerError] = useState('');
  const [posting, setPosting] = useState(false);
  const [legalVerified, setLegalVerified] = useState(false);
  const [escrowConfirmed, setEscrowConfirmed] = useState(false);
  const [csvData, setCsvData] = useState<ParsedCsv | null>(null);
  const [csvMap, setCsvMap] = useState<CsvColumnMapping | null>(null);
  const [csvMeta, setCsvMeta] = useState<CsvMerchantMeta>({
    id: 'M-CSV-001',
    name: 'Deccan Corner Bakery',
    category: 'Local Bakery & Confectionery',
    mcc: '5462',
    city: 'Bengaluru',
    state: 'KA',
    catchment: 'LOCAL',
    ticketMin: 120,
    ticketMax: 900,
    openHour: 7,
    closeHour: 22,
  });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { clearCustom(); clearUploaded(); setCaseKey(null); }, [clearCustom, clearUploaded]);

  const applyCsv = (data: ParsedCsv, mapping: CsvColumnMapping, meta: CsvMerchantMeta, name: string) => {
    const ds = buildDatasetFromCsv(data, mapping, meta);
    const jsonText = JSON.stringify(ds);
    setRaw(jsonText);
    setFileName(name);
    setParsed(datasetToScenario(ds));
  };

  const read = (name: string, text: string) => {
    clearCustom();
    clearUploaded();
    setCaseKey(null);
    setServerCase(null); setServerError(''); setLegalVerified(false); setEscrowConfirmed(false);
    setFileName(name); setAnalysed(false);

    const looksCsv = name.toLowerCase().endsWith('.csv') || (!text.trim().startsWith('{') && text.includes(','));
    if (looksCsv) {
      const parsedCsv = parseCsvText(text);
      if (parsedCsv.headers.length === 0 || parsedCsv.rows.length === 0) {
        setCsvData(null); setCsvMap(null); setRaw('');
        setParsed({ ok: false, errors: ['CSV file appears empty or missing header/data rows.'], warnings: [] });
        return;
      }
      const detected = autoDetectMapping(parsedCsv.headers);
      setCsvData(parsedCsv);
      setCsvMap(detected);
      applyCsv(parsedCsv, detected, csvMeta, name);
      return;
    }

    setCsvData(null);
    setCsvMap(null);
    setRaw(text);
    try { setParsed(datasetToScenario(JSON.parse(text))); }
    catch (e) { setParsed({ ok: false, errors: [`Could not read the file as JSON: ${(e as Error).message}`], warnings: [] }); }
  };
  const loadSampleCsv = () => {
    read('gateway-export-sample.csv', buildSampleGatewayCsv());
  };
  const onFile = async (f?: File | null) => { if (f) read(f.name, await f.text()); };
  const loadSample = async () => {
    const sample = TEST_DATASETS.find(item => item.file === sampleFile);
    if (!sample) return;
    setLoadingSample(true);
    try {
      const response = await fetch(`${BASE}samples/${sample.file}`);
      if (!response.ok) throw new Error(`Could not load the test file (${response.status}).`);
      read(sample.title, await response.text());
    } catch (e) {
      clearCustom();
      clearUploaded();
      setCaseKey(null);
      setFileName(sample.title);
      setAnalysed(false);
      setParsed({ ok: false, errors: [(e as Error).message], warnings: [] });
    } finally {
      setLoadingSample(false);
    }
  };
  const navigate = useNavigate();
  const [params] = useSearchParams();
  useEffect(() => {
    const file = params.get('sample');
    if (!file || !TEST_DATASETS.some(item => item.file === file)) return;
    setSampleFile(file);
    void (async () => {
      setLoadingSample(true);
      try {
        const response = await fetch(`${BASE}samples/${file}`);
        if (!response.ok) throw new Error(`Could not load the test file (${response.status}).`);
        const sample = TEST_DATASETS.find(item => item.file === file)!;
        read(sample.title, await response.text());
      } catch (e) {
        setParsed({ ok: false, errors: [(e as Error).message], warnings: [] });
      } finally { setLoadingSample(false); }
    })();
    // The sample query is read once, when the page opens from a worked example.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const analyse = async () => {
    if (!parsed?.scenario || !raw) return;
    setPosting(true); setServerError('');
    try {
      const response = await fetch('/api/investigations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `The investigation API rejected the file (${response.status}).`);
      setServerCase(body); setCaseKey(addUploaded(parsed.scenario)); setAnalysed(true);
      // Open the persistent case: same seven-layer run as the demo, saved on the server, survives reload.
      navigate(`/ai-engine/cases/${encodeURIComponent(body.id)}?run=1`);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'The investigation API is not reachable.');
    } finally { setPosting(false); }
  };
  const newAnalysis = () => {
    clearCustom(); clearUploaded(); setCaseKey(null); setParsed(null); setFileName(''); setRaw(''); setCsvData(null); setCsvMap(null); setServerCase(null); setServerError(''); setAnalysed(false); setDetailsOpen(false); setLegalVerified(false); setEscrowConfirmed(false);
    if (input.current) input.current.value = '';
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0]); };

  const hasRun = analysed && scenarioId === 'custom' && !!custom && started;
  const showSimulation = hasRun && !allDone;
  const showResult = hasRun && allDone;
  const fu = result.fusion, top = [...fu.mechanisms].sort((a, b) => b.score - a.score)[0];
  const pack = showResult ? runPatternPack(result, user.label) : null;
  const level = RESPONSE_LEVELS.find(l => l.id === result.review.recommended);
  const s = parsed?.summary;
  const datasetPanel = parsed && (
    <Panel title={<span className="flex items-center gap-2">{csvData ? <FileSpreadsheet size={15} className="text-indigo-600" /> : <FileJson size={15} className="text-indigo-600" />}{fileName}</span>}
      right={!analysed && parsed.ok ? <Btn variant="primary" onClick={analyse} disabled={posting}><Play size={14} />{posting ? 'Running on the server…' : 'Run all seven layers'}</Btn> : parsed.ok ? <Badge tone="ok">Dataset analyzed</Badge> : <Badge tone="bad">Cannot run</Badge>}>
      {serverError && !analysed && <div className="mb-3 flex gap-2 text-sm text-rose-700"><X size={15} className="mt-0.5 shrink-0" />{serverError}</div>}
      {!parsed.ok && <div className="space-y-1.5">{parsed.errors.map(e => <div key={e} className="flex gap-2 text-sm text-rose-700"><X size={15} className="mt-0.5 shrink-0" />{e}</div>)}</div>}
      {s && (
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><div className="text-xs text-mute">Merchant</div><div className="font-semibold text-ink">{s.merchant}</div><div className="text-xs text-mute">{s.city} · {s.category}</div></div>
          <div><div className="text-xs text-mute">Ledger</div><div className="font-semibold text-ink">{s.transactions} records</div><div className="text-xs text-mute">{s.sales} sales · {s.refunds} refunds · {s.settlements} settlements · {s.transfers} payouts</div></div>
          <div><div className="text-xs text-mute">Window</div><div className="font-semibold text-ink">{s.from} → {s.to}</div><div className="text-xs text-mute">{s.weeks} weeks of history · {s.fixtures} match fixtures</div></div>
          <div><div className="text-xs text-mute">Data available</div><div className="flex flex-wrap gap-1">{s.available.map(k => <Badge key={k} tone="ok">{k}</Badge>)}{s.missing.map(k => <Badge key={k} tone="mute">{k}: missing</Badge>)}</div></div>
        </div>)}
      {parsed.warnings.length > 0 && <div className="mt-3 space-y-1">{parsed.warnings.map(w => <div key={w} className="flex gap-2 text-xs text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</div>)}</div>}
    </Panel>
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight text-ink">{showSimulation ? 'Investigation in progress' : showResult ? 'Investigation result' : 'Analyze a merchant dataset'}</h1>
          <p className="mt-1 max-w-2xl text-sm text-mute">{showSimulation ? `${custom?.profile.name} is moving through the seven analysis layers.` : showResult ? `${custom?.profile.name} · completed across all seven layers.` : <>Drop any raw gateway <span className="font-mono font-semibold text-indigo-700">.csv</span> export (with auto column mapping) or an <span className="font-mono font-semibold text-indigo-700">mre-dataset/v1 .json</span> file.</>}</p></div>
        {!analysed && <div className="flex flex-wrap gap-2"><Btn size="sm" variant="outline" onClick={loadSampleCsv}><FileSpreadsheet size={14} className="text-indigo-600" />Try sample CSV export</Btn><a href={`${BASE}samples/DATASET_FORMAT.md`} download><Btn size="sm"><FileJson size={14} />Format guide</Btn></a><a href={`${BASE}samples/mre-dataset-template.json`} download><Btn size="sm"><Download size={14} />Empty template</Btn></a></div>}
      </div>

      {!analysed && <>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
          className={cx('flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors', over ? 'border-indigo-500 bg-indigo-50/50' : 'border-line2 bg-panel')}>
          <FileUp className="text-indigo-600" size={30} />
          <div className="text-sm font-semibold text-ink">Drop a raw gateway CSV (.csv) or dataset (.json) here</div>
          <div className="text-xs text-mute">Auto-detects columns &amp; paise/rupee scaling in browser</div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Btn variant="primary" onClick={() => input.current?.click()}>Choose file</Btn>
            <Btn variant="outline" onClick={loadSampleCsv}><FileSpreadsheet size={14} />Load sample CSV</Btn>
          </div>
          <input ref={input} type="file" accept=".json,.csv,application/json,text/csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
          <div className="text-[11px] text-dim">The mapped dataset is sent to the investigation API to score all 7 layers and save the case.</div>
        </div>

        <Panel title="Zero-Code Pilot Ready" subtitle="Test on any anonymized payment export in 15 seconds.">
          <ul className="space-y-3 text-sm text-mute">
            <li><span className="font-semibold text-ink">Raw CSV or JSON</span><br />Drop any gateway CSV export — columns like <span className="font-mono text-xs">amount_paise</span>, <span className="font-mono text-xs">created_at</span>, and <span className="font-mono text-xs">payer_state</span> are mapped automatically.</li>
            <li><span className="font-semibold text-ink">No missing-data penalty</span><br />Missing context feeds (website crawl, GST, orders) are marked <span className="font-mono text-xs">MISSING</span> and never counted against the merchant.</li>
            <li><span className="font-semibold text-ink">Executive Case Dossier</span><br />Outputs Claimed vs. Reality visuals, ₹ GMV at Risk, Merchant RFI draft, and printable FIU-IND STR summary.</li>
          </ul>
        </Panel>
      </div>

      {csvData && csvMap && (
        <Panel
          title="In-Browser CSV Column Mapper"
          subtitle={`${csvData.rows.length} rows detected in ${fileName} · adjust any column or merchant profile field below`}
          right={<Badge tone="info">Auto-mapped</Badge>}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Column Mapping */}
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">1. Column Mapping</div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {([
                  ['amount', 'Amount *'],
                  ['time', 'Timestamp *'],
                  ['payerState', 'Payer State'],
                  ['payerId', 'Payer VPA / ID'],
                  ['channel', 'Channel / Mode'],
                  ['type', 'Txn Type'],
                  ['id', 'Transaction ID'],
                  ['paymentLinkId', 'Payment Link ID'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="block text-xs">
                    <span className="font-medium text-mute">{label}</span>
                    <select
                      value={csvMap[key]}
                      onChange={e => {
                        const next = { ...csvMap, [key]: e.target.value };
                        setCsvMap(next);
                        applyCsv(csvData, next, csvMeta, fileName);
                      }}
                      className="mt-1 w-full rounded-lg border border-line2 bg-panel px-2.5 py-1.5 text-xs text-ink outline-none focus:border-indigo-500"
                    >
                      <option value="">— Not present —</option>
                      {csvData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1 text-xs">
                <span className="font-medium text-mute">Amount unit:</span>
                {(['rupees', 'paise'] as const).map(unit => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => {
                      const next = { ...csvMap, amountUnit: unit };
                      setCsvMap(next);
                      applyCsv(csvData, next, csvMeta, fileName);
                    }}
                    className={cx('rounded-md border px-2.5 py-1 font-medium capitalize', csvMap.amountUnit === unit ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-line bg-panel text-mute')}
                  >
                    {unit} {unit === 'paise' ? '(÷100)' : '(₹)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Declared Merchant KYC */}
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">2. Declared Merchant KYC Profile</div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="font-medium text-mute">Merchant Name</span>
                  <input
                    value={csvMeta.name}
                    onChange={e => { const m = { ...csvMeta, name: e.target.value }; setCsvMeta(m); applyCsv(csvData, csvMap, m, fileName); }}
                    className="mt-1 w-full rounded-lg border border-line2 bg-panel px-2.5 py-1.5 text-xs text-ink outline-none focus:border-indigo-500"
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium text-mute">Declared Category</span>
                  <input
                    value={csvMeta.category}
                    onChange={e => { const m = { ...csvMeta, category: e.target.value }; setCsvMeta(m); applyCsv(csvData, csvMap, m, fileName); }}
                    className="mt-1 w-full rounded-lg border border-line2 bg-panel px-2.5 py-1.5 text-xs text-ink outline-none focus:border-indigo-500"
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium text-mute">City &amp; Home State (2-letter)</span>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      value={csvMeta.city}
                      onChange={e => { const m = { ...csvMeta, city: e.target.value }; setCsvMeta(m); applyCsv(csvData, csvMap, m, fileName); }}
                      className="w-full rounded-lg border border-line2 bg-panel px-2.5 py-1.5 text-xs text-ink outline-none focus:border-indigo-500"
                    />
                    <input
                      value={csvMeta.state}
                      maxLength={2}
                      onChange={e => { const m = { ...csvMeta, state: e.target.value.toUpperCase() }; setCsvMeta(m); applyCsv(csvData, csvMap, m, fileName); }}
                      className="w-16 rounded-lg border border-line2 bg-panel px-2.5 py-1.5 text-center font-mono text-xs uppercase text-ink outline-none focus:border-indigo-500"
                    />
                  </div>
                </label>
                <label className="block text-xs">
                  <span className="font-medium text-mute">Declared Ticket Range (₹)</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      type="number"
                      value={csvMeta.ticketMin}
                      onChange={e => { const m = { ...csvMeta, ticketMin: Number(e.target.value) || 100 }; setCsvMeta(m); applyCsv(csvData, csvMap, m, fileName); }}
                      className="w-full rounded-lg border border-line2 bg-panel px-2.5 py-1.5 text-xs text-ink outline-none focus:border-indigo-500"
                    />
                    <span className="text-mute">–</span>
                    <input
                      type="number"
                      value={csvMeta.ticketMax}
                      onChange={e => { const m = { ...csvMeta, ticketMax: Number(e.target.value) || 1000 }; setCsvMeta(m); applyCsv(csvData, csvMap, m, fileName); }}
                      className="w-full rounded-lg border border-line2 bg-panel px-2.5 py-1.5 text-xs text-ink outline-none focus:border-indigo-500"
                    />
                  </div>
                </label>
              </div>
              <div className="overflow-x-auto rounded-lg border border-line bg-slate-50 p-2.5">
                <div className="mb-1.5 text-[11px] font-semibold text-slate-500">Live 3-row preview</div>
                <table className="w-full text-left font-mono text-[11px]">
                  <thead><tr className="text-dim">{csvData.headers.slice(0, 5).map(h => <th key={h} className="pr-3 pb-1">{h}</th>)}</tr></thead>
                  <tbody>
                    {csvData.rows.slice(0, 3).map((r, i) => (
                      <tr key={i} className="border-t border-line text-ink">
                        {csvData.headers.slice(0, 5).map(h => <td key={h} className="py-1 pr-3 truncate max-w-[140px]">{r[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Use a built-in test file" subtitle="Choose one of our curated sample datasets if you do not have a file of your own.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <select value={sampleFile} onChange={e => setSampleFile(e.target.value)} disabled={loadingSample} className="min-h-10 min-w-0 flex-1 rounded-lg border border-line2 bg-panel px-3 text-sm text-ink outline-none focus:border-indigo-500 disabled:opacity-50">
            <option value="">Choose a test file</option>
            {TEST_DATASETS.map(sample => <option key={sample.file} value={sample.file}>{sample.title}</option>)}
          </select>
          <Btn variant="outline" disabled={!sampleFile || loadingSample} onClick={loadSample}><FileJson size={14} />{loadingSample ? 'Loading file…' : 'Load test file'}</Btn>
        </div>
        <p className="mt-3 text-xs text-dim">The selected file will appear below for review. Press “Run all seven layers” when you are ready.</p>
      </Panel>
      </>}

      {!analysed && datasetPanel}

      {showSimulation && <InvestigationPage progressOnly />}

      {showResult && (
        <>
        <Panel title="Final result" subtitle={fu.gateReason} right={<Badge tone={fu.decision === 'OPEN_CASE' ? 'bad' : 'ok'}>{fu.decision === 'OPEN_CASE' ? `${fu.priority} priority` : 'No case opened'}</Badge>}>
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><div className="text-xs text-mute">Outcome</div><div className="mt-1 font-medium">{fu.decision === 'OPEN_CASE' ? 'Analyst review opened' : 'Activity explained'}</div></div>
            <div><div className="text-xs text-mute">Leading finding</div><div className="mt-1 font-medium">{fu.decision === 'OPEN_CASE' && top ? `${MECHANISMS.find(m => m.id === top.id)?.name ?? top.id} (${top.score.toFixed(2)})` : 'No remaining risk signal'}</div></div>
            <div><div className="text-xs text-mute">Recommended response</div><div className="mt-1 font-medium">{level?.id} · {level?.name}</div></div>
            {pack && <div><div className="text-xs text-mute">Trust ladder</div><div className="mt-1 font-medium">{LADDER.find(l => l.id === pack.ladder)?.name}</div></div>}
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
            <Btn variant="primary" onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen} aria-controls="analysis-evidence">{detailsOpen ? 'Hide evidence' : 'Evidence'} <ArrowRight size={14} /></Btn>
            <Btn onClick={newAnalysis}><FileUp size={14} />Analyze another dataset</Btn>
          </div>
        </Panel>

        {detailsOpen && pack && <div id="analysis-evidence" className="scroll-mt-20 space-y-6">
          {datasetPanel}
          <div className={cx('rounded-lg border p-5', fu.decision === 'OPEN_CASE' ? 'border-neutral-400/50 bg-neutral-400/[0.06]' : 'border-gray-400/50 bg-gray-400/[0.06]')}>
            <div className="flex flex-wrap items-start gap-4">
              {fu.decision === 'OPEN_CASE' ? <ShieldAlert className="text-neutral-300" size={34} /> : <ShieldCheck className="text-gray-300" size={34} />}
              <div className="min-w-0 flex-1">
                <div className={cx('text-xl font-semibold', fu.decision === 'OPEN_CASE' ? 'text-neutral-200' : 'text-gray-200')}>{fu.decision === 'OPEN_CASE' ? `Case opened · ${fu.priority} priority` : 'No case opened'}</div>
                <div className="mt-1 text-sm text-mute">{fu.gateReason}</div>
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><div className="text-xs text-mute">Leading hypothesis</div><div className="font-medium">{fu.decision === 'OPEN_CASE' && top ? `${MECHANISMS.find(m => m.id === top.id)?.name ?? top.id} (${top.score.toFixed(2)})` : 'None: alarm explained'}</div></div>
                  <div><div className="text-xs text-mute">Legitimate-business explanation</div><div className="font-medium">{result.review.legitStatus === 'HOLDS' ? 'Holds' : result.review.legitStatus === 'FAILED' ? 'Fails' : 'Inconclusive'}</div></div>
                  <div><div className="text-xs text-mute">Recommended response</div><div className="font-medium">{level?.id} · {level?.name}</div></div>
                  <div><div className="text-xs text-mute">Trust ladder</div><div className="font-medium">{LADDER.find(l => l.id === pack.ladder)!.name}</div></div>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              {caseKey && <Link to={`/ai-engine/portfolio/${caseKey}`}><Btn size="sm" variant="primary">Why: reasons and proof <ArrowRight size={13} /></Btn></Link>}
              {[['Investigation (all layers)', '/ai-engine/investigations'], ['Evidence graph', '/ai-engine/graph'], ['Analyst workbench', '/ai-engine/analyst'], ['Response centre', '/ai-engine/response']].map(([l, to]) => <Link key={to} to={to}><Btn size="sm">{l} <ArrowRight size={13} /></Btn></Link>)}
            </div>
          </div>
          <Callout tone="info" title="Every flag, by pattern type">Core detectors feed the verdict above. Solution patterns S1–S7 and the new betting patterns N1–N3 run alongside and set the trust ladder.</Callout>
          <PatternBoard res={result} label={user.label} />
        </div>}
        </>
      )}
    </>
  );
}
