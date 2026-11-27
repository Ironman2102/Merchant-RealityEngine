/**
 * Regression suite for multi-payment-method support and logical fallacy fixes:
 *  1. Canonical payment channels (CARD, NETBANKING, WALLET, BNPL, UPI_QR, POS, UPI_LINK, UPI_COLLECT)
 *  2. Consistent QR channel mapping between datasetToScenario and CSV uploader
 *  3. D11 elevated chargeback rate detector + K2 undeclared payment rail detector
 *  4. Per-channel stream splitting for non-QR / dynamic-QR rails
 *  5. R-02 override only fires when F5 shares a beneficiary with a peer (not ordinary bank switches)
 *  6. Anonymous POS/card placeholder '—' excluded from ML features, cohortContinuity, E3, and patternPack
 *  7. B10 abstains on NATIONAL catchment categories (consistent with B6)
 *  8. Context Passport volumeUplift scoped to the passport's link share
 *  9. Pattern Pack N2 respects overnight / 24h trading hours
 */
import { readFileSync } from 'node:fs';
import { analyze, behavioralFeatures } from '../../engine/index';
import { datasetToScenario, normalizeChannel, type MreDataset } from '../../frontend/src/data/dataset';
import { buildDatasetFromCsv, parseCsvText, autoDetectMapping } from '../../frontend/src/utils/csvToDataset';
import { runInvestigation } from '../../frontend/src/engines/investigationEngine';
import { runPatternPack } from '../../frontend/src/engines/patternPack';
import { cohortContinuity } from '../../frontend/src/engines/cohortContinuity';
import { passportUplift } from '../../frontend/src/engines/passport';
import { splitStreams } from '../../frontend/src/engines/streams';

function loadSample(file: string): MreDataset {
  return JSON.parse(readFileSync(`frontend/public/samples/${file}`, 'utf8')) as MreDataset;
}

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); }
    else console.log(`  ✓ ${name}`);
  };

  // 1. Canonical payment rails & aliases
  check('normalizeChannel supports CARD/NETBANKING/WALLET/BNPL/UPI_QR',
    normalizeChannel('CREDIT_CARD') === 'CARD'
    && normalizeChannel('net-banking') === 'NETBANKING'
    && normalizeChannel('Paytm Wallet') === 'WALLET'
    && normalizeChannel('EMI') === 'BNPL'
    && normalizeChannel('QR') === 'UPI_QR');

  // 2. CSV uploader maps QR -> UPI_QR and CARD/NETBANKING/WALLET/BNPL distinctly
  const csv = [
    'txn_id,amount,txn_time,txn_type,payer_vpa,payer_state,channel,link_id,status',
    'T1,250,2026-10-10T10:00:00+05:30,SALE,p1@upi,KA,QR,QR-1,SUCCESS',
    'T2,1200,2026-10-10T11:00:00+05:30,SALE,card-tok-1,KA,CARD_ONLINE,,SUCCESS',
    'T3,800,2026-10-10T12:00:00+05:30,SALE,nb-user-1,KA,NETBANKING,,SUCCESS',
    'T4,500,2026-10-10T13:00:00+05:30,SALE,wal-1,KA,WALLET,,SUCCESS',
    'T5,3000,2026-10-10T14:00:00+05:30,SALE,bnpl-1,KA,EMI,,SUCCESS',
  ].join('\n');
  const parsedCsv = parseCsvText(csv);
  const built = buildDatasetFromCsv(parsedCsv, autoDetectMapping(parsedCsv.headers), {
    id: 'M-MULTI', name: 'Multi Rail Shop', category: 'Retail', mcc: '5462',
    city: 'Bengaluru', state: 'KA', catchment: 'LOCAL', ticketMin: 100, ticketMax: 5000,
    openHour: 8, closeHour: 22, accountAgeDays: 400,
  });
  const chs = built.dataset.transactions.map(t => t.channel);
  check('CSV uploader preserves all 5 payment rails',
    chs[0] === 'UPI_QR' && chs[1] === 'CARD' && chs[2] === 'NETBANKING' && chs[3] === 'WALLET' && chs[4] === 'BNPL',
    JSON.stringify(chs));

  // 3. D11 chargebacks & K2 undeclared payment rails
  const base = loadSample('07-udupi-tiffin-steady.json');
  const cardAttack: MreDataset = {
    ...base,
    merchant: { ...base.merchant, id: 'M-CARD-CB', declaredChannels: ['Counter QR', 'In-store POS'] },
    transactions: [
      ...base.transactions.map(t => ({ ...t, merchantId: 'M-CARD-CB', channel: t.type === 'SALE' ? 'NETBANKING' as const : t.channel })),
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `CB-${i}`, merchantId: 'M-CARD-CB', type: 'CHARGEBACK' as const, amount: 500,
        time: base.transactions[i].time, channel: 'NETBANKING' as const,
      })),
    ],
  };
  const cardRes = analyze(cardAttack);
  check('card/netbanking attack analyzes', cardRes.ok);
  if (cardRes.ok) {
    const d11 = cardRes.result.evidence.find(e => e.id === 'D11');
    const k2 = cardRes.result.evidence.find(e => e.id === 'K2');
    check('D11 fires on elevated chargebacks', d11?.status === 'ILLICIT', `got ${d11?.status}`);
    check('K2 fires on undeclared NETBANKING rail', k2?.status === 'ILLICIT', `got ${k2?.status}`);
  }

  // 4. Per-channel stream splitting when dynamic QRs / cards have no static linkId
  const multiRailTxns = [
    ...Array.from({ length: 40 }, (_, i) => ({
      id: `S-QR-${i}`, merchantId: 'M-STR', type: 'SALE' as const, amount: 150,
      eventTime: 1_760_000_000_000 + i * 3600_000, ingestTime: 1_760_000_030_000 + i * 3600_000,
      payerRef: `u${i}@upi`, payerHash: `h${i}`, destHash: `h${i}`, payerState: 'KA',
      channel: 'UPI_QR' as const, linkId: `DYN-${i}`, source: 'acquirer.upi',
    })),
    ...Array.from({ length: 40 }, (_, i) => ({
      id: `S-CD-${i}`, merchantId: 'M-STR', type: 'SALE' as const, amount: 1000,
      eventTime: 1_760_000_000_000 + i * 3600_000, ingestTime: 1_760_000_030_000 + i * 3600_000,
      payerRef: `c${i}`, payerHash: `ch${i}`, destHash: `ch${i}`, payerState: 'MH',
      channel: 'CARD' as const, source: 'acquirer.card',
    })),
  ];
  const streams = splitStreams(multiRailTxns);
  check('splitStreams creates per-channel streams for dynamic QRs & CARD',
    streams.some(s => s.scope.kind === 'channel' && s.scope.id === 'CARD')
    && streams.some(s => s.scope.kind === 'channel' && s.scope.id === 'UPI_QR'),
    JSON.stringify(streams.map(s => s.scope)));

  // 5. R-02 override does NOT fire on ordinary bank switches without a shared peer beneficiary
  const bankSwitch: MreDataset = {
    ...base,
    merchant: { ...base.merchant, id: 'M-BANKSW' },
    transactions: [
      ...base.transactions.filter(t => t.type !== 'SETTLEMENT').map(t => ({ ...t, merchantId: 'M-BANKSW' })),
      { id: 'ST-1', merchantId: 'M-BANKSW', type: 'SETTLEMENT', amount: 10000, time: '2026-10-05T11:00:00+05:30', channel: 'BANK', beneficiaryAccount: 'OWN-BANK-A' },
      { id: 'ST-2', merchantId: 'M-BANKSW', type: 'SETTLEMENT', amount: 10000, time: '2026-10-10T11:00:00+05:30', channel: 'BANK', beneficiaryAccount: 'OWN-BANK-B' },
      { id: 'ST-3', merchantId: 'M-BANKSW', type: 'SETTLEMENT', amount: 10000, time: '2026-10-15T11:00:00+05:30', channel: 'BANK', beneficiaryAccount: 'OWN-BANK-C' },
      { id: 'ST-4', merchantId: 'M-BANKSW', type: 'SETTLEMENT', amount: 10000, time: '2026-10-20T11:00:00+05:30', channel: 'BANK', beneficiaryAccount: 'OWN-BANK-D' },
    ],
  };
  const bsRes = analyze(bankSwitch);
  check('R-02 does NOT trigger when F5 fires without shared peer beneficiary',
    bsRes.ok && !bsRes.result.fusion.logOdds.overrides.some(o => o.id === 'R-02'),
    bsRes.ok ? JSON.stringify(bsRes.result.fusion.logOdds.overrides) : '');

  // 6. Anonymous POS placeholder '—' does not inflate HHI, cohort overlap, or loss-chasing
  const anonPos: MreDataset = {
    ...base,
    merchant: { ...base.merchant, id: 'M-ANON' },
    peers: [{ id: 'M-PEER-ANON', name: 'Other POS Shop', status: 'DORMANT', accountAgeDays: 200 }],
    transactions: [
      ...base.transactions.slice(0, 40).map((t, i) => ({
        ...t, id: `A-${i}`, merchantId: 'M-ANON', type: 'SALE' as const, channel: 'POS' as const,
        amount: 200 + (i % 5) * 100, payerId: undefined,
      })),
      ...base.transactions.slice(0, 20).map((t, i) => ({
        ...t, id: `P-${i}`, merchantId: 'M-PEER-ANON', type: 'SALE' as const, channel: 'POS' as const,
        amount: 250, payerId: undefined,
      })),
    ],
  };
  const anonParsed = datasetToScenario(anonPos);
  check('anonymous POS scenario parses', anonParsed.ok);
  if (anonParsed.ok && anonParsed.scenario) {
    const res = runInvestigation(anonParsed.scenario, { draws: 0 });
    const bf = behavioralFeatures(res);
    const cc = cohortContinuity(anonParsed.scenario);
    const pp = runPatternPack(res);
    const n1 = pp.results.find(r => r.id === 'N1');
    check('anonymous POS has payer_hhi === 0 (not 1.0)', bf.payer_hhi === 0, `got ${bf.payer_hhi}`);
    check('anonymous POS cohort jaccard === 0 (not 1.0)', (cc[0]?.jaccard ?? 0) === 0, `got ${cc[0]?.jaccard}`);
    check('anonymous POS does not trigger N1 loss-chasing', n1?.status === 'CLEAR', `got ${n1?.status}`);
  }

  // 7. B10 abstains for NATIONAL catchment categories (e.g. 5712 / 5732 / 5964)
  const natBase = loadSample('03-fabricated-online-store.json');
  const natParsed = datasetToScenario({
    ...natBase,
    merchant: { ...natBase.merchant, mcc: '5964', catchment: 'NATIONAL' },
  });
  if (natParsed.ok && natParsed.scenario) {
    const res = runInvestigation(natParsed.scenario, { draws: 0 });
    const b10 = res.evidence.find(e => e.id === 'B10');
    check('B10 abstains on NATIONAL catchment MCC', b10?.status === 'UNKNOWN', `got ${b10?.status}`);
  } else {
    check('national scenario parses', false);
  }

  // 8. Context Passport volumeUplift is scoped to the passport's link share
  const tinyLinkDs: MreDataset = {
    ...base,
    merchant: { ...base.merchant, id: 'M-PP' },
    transactions: base.transactions.map((t, i) => ({
      ...t, merchantId: 'M-PP',
      paymentLinkId: t.type === 'SALE' ? (i < 5 ? 'LINK-TINY' : 'LINK-MAIN') : t.paymentLinkId,
    })),
    contextPassports: [{
      id: 'CP-TINY', reason: 'Small side pop-up', linkId: 'LINK-TINY',
      from: '2026-09-01', until: '2026-12-01', document: 'Pop-up lease',
      volumeUplift: 3, status: 'VERIFIED',
    }],
  };
  const tinyParsed = datasetToScenario(tinyLinkDs, { trustPassports: true });
  if (tinyParsed.ok && tinyParsed.scenario) {
    const lastT = tinyParsed.scenario.events[tinyParsed.scenario.events.length - 1].eventTime;
    const up = passportUplift(tinyParsed.scenario, lastT);
    check('tiny side-link passport does NOT grant 3x whole-account uplift', up < 1.2, `got ${up}`);
  }

  // 9. Pattern Pack N2 respects overnight / 24h hours
  const overnightDs: MreDataset = {
    ...base,
    merchant: { ...base.merchant, id: 'M-NIGHT', hours: [20, 4] },
    transactions: base.transactions.map((t, i) => ({
      ...t, merchantId: 'M-NIGHT',
      time: t.type === 'SALE' ? `2026-10-${String(10 + (i % 10)).padStart(2, '0')}T01:30:00+05:30` : t.time,
    })),
  };
  const nightParsed = datasetToScenario(overnightDs);
  if (nightParsed.ok && nightParsed.scenario) {
    const res = runInvestigation(nightParsed.scenario, { draws: 0 });
    const n2 = runPatternPack(res).results.find(r => r.id === 'N2');
    check('N2 does not flag legitimate overnight business during open hours', n2?.status === 'CLEAR', `got ${n2?.status}`);
  }

  return bad;
}
