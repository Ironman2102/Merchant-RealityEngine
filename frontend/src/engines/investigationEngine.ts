import type { Scenario } from '../types/merchant';
import type { InvestigationResult, L1Result, LayerId, Scope, Timeline } from '../types/investigation';
import type { PaymentEvent } from '../types/payment';
import { volumeModel } from './residualEngine';
import { RULES } from '../../../rules/index';
import { cusum } from './cusumEngine';
import { cohortContinuity } from './cohortContinuity';
import { runDetectors } from './detectors';
import { deliveredOrderCover, passportCover, passportsInForce, type Axis } from './passport';
import { narrowSuspects, splitStreams } from './streams';
import { fuse } from './evidenceFusion';
import { buildReview } from './analystEngine';

function layer1(
  sc: Scenario,
  ev: PaymentEvent[],
  pre?: { sales: PaymentEvent[]; refunds: PaymentEvent[]; settlements: PaymentEvent[]; transfers: PaymentEvent[]; chargebacks: PaymentEvent[] },
): L1Result {
  const byType: Record<string, PaymentEvent[]> = pre
    ? { SALE: pre.sales, REFUND: pre.refunds, TRANSFER: pre.transfers, SETTLEMENT: pre.settlements, CHARGEBACK: pre.chargebacks }
    : { SALE: [], REFUND: [], TRANSFER: [], SETTLEMENT: [], CHARGEBACK: [] };
  if (!pre) {
    for (const e of ev) { const bucket = byType[e.type]; if (bucket) bucket.push(e); }
  }
  const counts = Object.fromEntries(
    Object.entries(byType).map(([t, x]) => [t, { n: x.length, value: x.reduce((s, e) => s + e.amount, 0) }]),
  );
  const sid = new Set(byType.SALE.map(e => e.id)), refunds = byType.REFUND, linked = refunds.filter(r => r.linkedSaleId && sid.has(r.linkedSaleId)).length;
  const seen = new Set<string>(), hashSamples: { raw: string; hash: string }[] = [];
  for (const e of ev) if (e.type === 'SALE' && !seen.has(e.payerRef) && hashSamples.length < 4) { seen.add(e.payerRef); hashSamples.push({ raw: e.payerRef, hash: e.payerHash }); }
  const c = sc.coverage;
  return { counts, refundLinkage: { total: refunds.length, linked, orphan: refunds.length - linked }, coverage: c, hashSamples, sources: [
    { name: 'Payment transactions', key: 'acquiring', state: c.acquiring, records: counts.SALE.n, note: 'Acquirer UPI, QR, card, netbanking, wallet & POS feed' },
    { name: 'Refunds and chargebacks', key: 'acquiring', state: c.acquiring, records: counts.REFUND.n + counts.CHARGEBACK.n, note: 'Refund ledger' },
    { name: 'Settlements', key: 'acquiring', state: c.acquiring, records: counts.SETTLEMENT.n, note: 'Settlement ledger' },
    { name: 'Merchant KYC', key: 'kyc', state: 'AVAILABLE', records: 1, note: 'Declared profile and documents' },
    { name: 'Website and checkout snapshots', key: 'website', state: c.website, records: sc.web.embeds.length, note: 'Crawler snapshots of declared and third-party pages' },
    { name: 'Payer identifiers', key: 'payer', state: ev.some(e => e.type === 'SALE' && e.payerHash !== '—') ? 'AVAILABLE' : 'MISSING', records: new Set(ev.filter(e => e.payerHash !== '—').map(e => e.payerHash)).size, note: 'Hashed on entry' },
    { name: 'Order and fulfilment feeds', key: 'orders', state: c.orders, records: sc.orders.length, note: c.orders === 'MISSING' ? 'No feed connected' : 'Merchant order system' },
    { name: 'Bank-side information', key: 'bank', state: c.bank, records: sc.bankCredits.length, note: c.bank === 'MISSING' ? 'Not shared by the bank' : 'Bank credit feed' },
  ] };
}

const TL: Record<LayerId, Timeline[]> = {
  1: [{ op: 'Connect feeds and read records', ms: 160 }, { op: 'Normalise to PaymentEvent', ms: 240 }, { op: 'Classify sale / refund / transfer / settlement', ms: 120 }, { op: 'Separate event, settle and ingest time', ms: 90 }, { op: 'Link refunds to original sales', ms: 180 }, { op: 'Hash payer identifiers', ms: 70 }, { op: 'Build coverage map', ms: 60 }],
  2: [{ op: 'Load approved profile', ms: 80 }, { op: 'Anchored baseline', ms: 60 }, { op: 'Seasonal expectation', ms: 90 }, { op: 'Rolling challenger', ms: 110 }, { op: 'Residuals and CUSUM', ms: 140 }],
  3: [{ op: 'Run family A–B detectors', ms: 210 }, { op: 'Run family C–D detectors', ms: 260 }, { op: 'Cohort continuity search', ms: 320 }, { op: 'Run family E–G detectors', ms: 280 }, { op: 'Run family H–I detectors', ms: 150 }, { op: 'Emit EvidenceItems', ms: 40 }],
  4: [{ op: 'Exclude UNKNOWN evidence', ms: 40 }, { op: 'Collapse correlated signals', ms: 120 }, { op: 'Weight by reliability and fake difficulty', ms: 90 }, { op: 'Check source independence', ms: 70 }, { op: 'Score mechanism hypotheses', ms: 130 }, { op: 'Open or decline case', ms: 30 }],
  5: [{ op: 'Build competing chains', ms: 110 }, { op: 'Test each link against evidence', ms: 190 }, { op: 'Draft recommendation', ms: 70 }],
  6: [{ op: 'Map case to response level', ms: 60 }, { op: 'Scope action to defined flow', ms: 90 }, { op: 'Check legal-authority gate', ms: 120 }],
  7: [{ op: 'Prepare label options', ms: 50 }, { op: 'Compute indicators', ms: 80 }, { op: 'Stage calibration inputs', ms: 90 }, { op: 'Hash-chain audit entries', ms: 40 }],
};

export type LearnedRateOverride = Map<string, { sensitivity: number; falsePositive: number }>;

/**
 * Pure, deterministic. Same scenario in → same result out.
 * `draws: 0` skips the Monte-Carlo interval, for backtests that only need the decision (the gate never reads the interval).
 *
 * A Context Passport explains a change and never conduct. So the merchant is scored without passports first: if a conduct
 * signal fires in any scope, that score stands and the passports are suspended. Sales matched to delivered online
 * orders are set aside from the out-of-state payer test the same way, and through the same two passes.
 */
export function runInvestigation(
  sc: Scenario,
  options: { draws?: number; posteriorDraws?: number; learnedRates?: LearnedRateOverride } = {},
): InvestigationResult {
  const opts = { draws: options.draws ?? options.posteriorDraws, learnedRates: options.learnedRates };
  const inForce = passportsInForce(sc), excused = deliveredOrderCover(sc).size;
  // ponytail: excused sales cost two full investigate passes; skip the second when no B6/H3 evidence is affected.
  if (!inForce.length && !excused) return investigate(sc, opts).result;
  const bare = investigate({ ...sc, passports: [] }, { ...opts, orderExcuse: false });
  const asScored: InvestigationResult = inForce.length ? { ...bare.result, scenario: sc, passportsSuspended: true } : { ...bare.result, scenario: sc };
  if (bare.conduct) return asScored;
  const explained = investigate(sc, opts);
  // Setting payments aside shifts the shares of the rest. An explanation must not create a conduct signal either.
  if (explained.conduct) return asScored;
  const { result } = explained;
  if (bare.result.fusion.followUp === 'ASK' && result.fusion.followUp === 'NONE') {
    // The question is answered, not erased: whoever reads the case sees that it was raised and what answered it.
    if (inForce.length) {
      result.passportAnswered = inForce.map(p => p.id);
      result.fusion.gateReason += ` A question about this change was answered by passport ${result.passportAnswered.join(', ')}. Revoking it reopens the question. Once it expires, a later file asks again.`;
    }
    if (excused) result.fusion.gateReason += ` ${excused} out-of-state payments matched to delivered online orders were set aside from the out-of-state check.`;
  }
  return result;
}

function investigate(
  sc: Scenario,
  opts: { draws?: number; learnedRates?: LearnedRateOverride; orderExcuse?: boolean },
): { result: InvestigationResult; conduct: boolean } {
  const events: PaymentEvent[] = [];
  const sales: PaymentEvent[] = [], refunds: PaymentEvent[] = [], settlements: PaymentEvent[] = [], transfers: PaymentEvent[] = [], chargebacks: PaymentEvent[] = [];
  for (const e of sc.events) {
    if (e.merchantId !== sc.primaryMerchantId) continue;
    events.push(e);
    if (e.type === 'SALE') sales.push(e);
    else if (e.type === 'REFUND') refunds.push(e);
    else if (e.type === 'SETTLEMENT') settlements.push(e);
    else if (e.type === 'TRANSFER') transfers.push(e);
    else if (e.type === 'CHARGEBACK') chargebacks.push(e);
  }
  const vol = volumeModel(sc), rows = vol.rows, cs = cusum(rows, vol.z), cohort = cohortContinuity(sc);
  const excused = opts.orderExcuse === false ? new Set<string>() : deliveredOrderCover(sc), pass = passportCover(sc);
  const norm = RULES.mcc(sc.profile.mcc), covered = (e: PaymentEvent, axis: Axis) => pass(e, axis) || (axis === 'area' && excused.has(e.id));
  const detect = (xs: PaymentEvent[], scope: Scope, pre?: { s: PaymentEvent[]; r: PaymentEvent[]; st: PaymentEvent[]; tr: PaymentEvent[]; cb: PaymentEvent[] }) => {
    const view = scope.kind === 'link' ? { ...sc, web: { ...sc.web, embeds: sc.web.embeds.filter(e => e.merchantId !== sc.primaryMerchantId || e.linkId === scope.id) } }
      : scope.kind === 'repeat-payers' || scope.kind === 'channel' ? { ...sc, web: { embeds: [], catalogue: sc.web.catalogue } } : sc;
    const s = pre ? pre.s : xs.filter(e => e.type === 'SALE');
    const r = pre ? pre.r : xs.filter(e => e.type === 'REFUND');
    const st = pre ? pre.st : xs.filter(e => e.type === 'SETTLEMENT');
    const tr = pre ? pre.tr : xs.filter(e => e.type === 'TRANSFER');
    const cb = pre ? pre.cb : xs.filter(e => e.type === 'CHARGEBACK');
    return runDetectors({
      sc: view, p: sc.profile, norm, vol, all: xs, sales: s, refunds: r, settlements: st, transfers: tr, chargebacks: cb,
      rows, cusum: cs, cohort, scope: scope.kind, covered, learnedRates: opts.learnedRates,
    });
  };

  const salesN = sales.length;
  const account: Scope = { kind: 'account', id: 'account', label: 'Whole account', sales: salesN, share: 1 };
  let scope = account, evidence = detect(events, account, { s: sales, r: refunds, st: settlements, tr: transfers, cb: chargebacks }), fusion = fuse(evidence, sc.profile, opts);
  const wholeAccount = evidence;

  const parts = splitStreams(events);
  // k streams are k chances to be wrong, so each starts ln(k) lower.
  const priorShift = parts.length > 1 ? -Math.log(parts.length) : 0;
  const scored = parts.map(part => {
    const ev = detect(part.events, part.scope);
    return { ...part, evidence: ev, fusion: fuse(ev, sc.profile, { draws: 0, priorShift, learnedRates: opts.learnedRates }) };
  });
  // The headline is the widest scope that opens a case. Failing that, the most probable stream that does.
  const best = (pick: (f: typeof fusion) => boolean) => scored.filter(x => pick(x.fusion)).sort((a, b) => b.fusion.posterior - a.fusion.posterior)[0];
  const head = fusion.gatePassed ? undefined : best(f => f.gatePassed) ?? (fusion.followUp === 'ASK' ? undefined : best(f => f.followUp === 'ASK'));
  if (head) {
    scope = head.scope; evidence = head.evidence;
    fusion = fuse(evidence, sc.profile, { ...opts, priorShift });
    fusion.gateReason = `${scope.label} (${scope.sales} of ${salesN} sales), scored on its own: ${fusion.gateReason}`;
  }

  const suspectLinks = fusion.gatePassed ? narrowSuspects(sc, events, scored.filter(x => x.fusion.gatePassed && x.scope.kind === 'link').map(x => x.scope.id)) : [];
  const streams = scored.map(x => ({ scope: x.scope, posterior: x.fusion.posterior, decision: x.fusion.decision, followUp: x.fusion.followUp, fired: x.evidence.filter(e => e.status === 'ILLICIT').map(e => e.id) }));
  const review = buildReview(evidence, fusion, suspectLinks), peak = [...rows].reverse().find(r => r.actual !== null) ?? null;
  const conduct = [wholeAccount, ...scored.map(x => x.evidence)].some(items => items.some(e => e.status === 'ILLICIT' && e.signal === 'conduct'));
  return {
    conduct,
    result: {
      scenario: sc, events, l1: layer1(sc, events, { sales, refunds, settlements, transfers, chargebacks }),
      l2: { profile: sc.profile, rows, cusum: cs, peak }, evidence, cohort, fusion, review, scope, streams, suspectLinks, timelines: TL,
    },
  };
}
