/**
 * MRE dataset format (mre-dataset/v1).
 *
 * The upload format a payment aggregator would send to the engine: the declared merchant
 * profile, the payment ledger, and whatever context feeds exist (website crawl, orders,
 * bank credits, purchaser checks, match calendar). `datasetToScenario` validates a file and
 * converts it into the same `Scenario` the built-in cases use, so an uploaded dataset runs
 * through exactly the same engines. `scenarioToDataset` does the reverse and is used to
 * export the sample files.
 */
import type { Channel, EventType, PaymentEvent } from '../types/payment';
import type { CoverageKey, CoverageState, EmbedRecord, CatalogueItem, GraphSpec, MerchantProfile, OrderRecord, PeerInfo, Scenario, Sighting, WeeklyPoint, ContextPassport } from '../types/merchant';
import { RULES } from '../../../rules/index';
import { passportErrors } from '../engines/passport';
import { hashId } from '../utils/hash';
import { instant } from '../utils/time';

export const DATASET_FORMAT = 'mre-dataset/v1';

export interface DatasetTransaction {
  id: string;
  merchantId: string;
  type: EventType;
  amount: number;
  time: string;                    // ISO 8601, e.g. 2026-10-18T19:42:10+05:30
  settledAt?: string;              // when the sale was settled to the merchant
  payerId?: string;                // VPA / card token / customer ref (hashed on import)
  payerState?: string;             // 2-letter state code
  channel: Channel;
  paymentLinkId?: string;          // payment link or terminal used
  orderId?: string | null;         // order the payment belongs to (null = checked, none found)
  refundOfTransactionId?: string;  // REFUND only: the original sale
  paidTo?: string;                 // REFUND / TRANSFER: destination account, if not the payer
  beneficiaryAccount?: string;     // SETTLEMENT / TRANSFER: account that received the money
  payerMobile?: string;            // payer's registered mobile (pseudonymised on import), lets refunds to the payer's own other account count as the payer's
  destHolder?: string;             // REFUND / TRANSFER: account-holder identity of the destination (pseudonymised on import)
  sourceFeed?: string;
}

export interface MreDataset {
  format: typeof DATASET_FORMAT;
  title?: string;
  description?: string;
  merchant: MerchantProfile;
  peers?: PeerInfo[];
  weeklySales: { week: string; actual: number | null; seasonalMultiplier: number }[];
  transactions: DatasetTransaction[];
  matchFixtures?: string[];
  dataAvailability?: Partial<Record<CoverageKey, CoverageState>>;
  website?: { embeds: EmbedRecord[]; catalogue: CatalogueItem[] };
  orders?: OrderRecord[];
  bankCredits?: { amount: number; beneficiaryAccount: string }[];
  purchaserVerification?: { contacted: number; confirmed: number } | null;
  businessFootprint?: { supplierPaymentsMonthly: number; gstTurnoverMonthly: number } | null;
  externalSightings?: Sighting[];
  /** Uploads can only submit these. Verification happens on the server, by a second person. */
  contextPassports?: ContextPassport[];
  graph?: GraphSpec;
}

/* ---------- time helpers (IST, the timezone the scenarios are built in) ---------- */
const IST = 19800000;
export function toIst(ms: number): string {
  const d = new Date(Math.round(ms) + IST).toISOString();
  return d.slice(0, 19) + '+05:30';
}

/* ---------- export ---------- */
export function scenarioToDataset(sc: Scenario, extra?: { title?: string; description?: string }): MreDataset {
  // Destination and beneficiary identifiers are stored hashed; give each a stable readable alias.
  const alias = new Map<string, string>(), issued = new Map<string, number>();
  const name = (h: string | undefined, prefix: string) => {
    if (!h || h === '—') return undefined;
    if (!alias.has(h)) {
      const n = (issued.get(prefix) ?? 0) + 1;
      issued.set(prefix, n);
      alias.set(h, `${prefix}-${String(n).padStart(3, '0')}`);
    }
    return alias.get(h)!;
  };
  const transactions: DatasetTransaction[] = sc.events.map(e => {
    const t: DatasetTransaction = { id: e.id, merchantId: e.merchantId, type: e.type, amount: e.amount, time: toIst(e.eventTime), channel: e.channel };
    if (e.settleTime !== undefined && e.type === 'SALE') t.settledAt = toIst(e.settleTime);
    if (e.payerRef && e.payerRef !== '—') t.payerId = e.payerRef;
    if (e.payerState && e.payerState !== '—') t.payerState = e.payerState;
    if (e.linkId) t.paymentLinkId = e.linkId;
    if (e.orderId !== undefined) t.orderId = e.orderId;
    if (e.linkedSaleId) t.refundOfTransactionId = e.linkedSaleId;
    if (e.destHash !== e.payerHash && e.destHash !== '—') t.paidTo = name(e.destHash, 'ACC');
    if (e.beneficiaryHash) t.beneficiaryAccount = name(e.beneficiaryHash, 'BEN');
    t.sourceFeed = e.source;
    return t;
  });
  return {
    format: DATASET_FORMAT,
    title: extra?.title ?? sc.title,
    description: extra?.description ?? sc.blurb,
    merchant: sc.profile,
    peers: sc.peers,
    weeklySales: sc.weekly.map(w => ({ week: w.week, actual: w.actual, seasonalMultiplier: w.seasonalMult })),
    transactions,
    matchFixtures: sc.fixtures.map(toIst),
    dataAvailability: sc.coverage,
    website: sc.web,
    orders: sc.orders,
    bankCredits: sc.bankCredits.map(b => ({ amount: b.amount, beneficiaryAccount: name(b.beneficiaryHash, 'BEN') ?? 'UNKNOWN' })),
    purchaserVerification: sc.verification,
    businessFootprint: sc.footprint ?? null,
    externalSightings: sc.sightings ?? [],
    ...(sc.passports?.length ? { contextPassports: sc.passports } : {}),
    graph: sc.graph,
  };
}

/* ---------- import + validation ---------- */
export interface ParseResult { ok: boolean; errors: string[]; warnings: string[]; scenario?: Scenario; summary?: DatasetSummary }
export interface DatasetSummary {
  title: string; merchant: string; city: string; category: string; transactions: number; sales: number; refunds: number;
  settlements: number; transfers: number; from: string; to: string; weeks: number; fixtures: number;
  available: CoverageKey[]; missing: CoverageKey[];
}

export const TYPES: EventType[] = ['SALE', 'REFUND', 'TRANSFER', 'SETTLEMENT', 'CHARGEBACK'];
export const CHANNELS: Channel[] = ['POS', 'UPI_QR', 'UPI_LINK', 'UPI_COLLECT', 'CARD', 'NETBANKING', 'WALLET', 'BNPL', 'ONLINE', 'PAYOUT', 'BANK'];
const CHANNEL_ALIASES: Record<string, Channel> = {
  UPI: 'UPI_LINK',
  UPI_INTENT: 'UPI_LINK',
  QR: 'UPI_QR',
  STATIC_QR: 'UPI_QR',
  DYNAMIC_QR: 'UPI_QR',
  UPI_STATIC_QR: 'UPI_QR',
  UPI_DYNAMIC_QR: 'UPI_QR',
  CARD_ONLINE: 'CARD',
  CARD_POS: 'CARD',
  CREDIT_CARD: 'CARD',
  DEBIT_CARD: 'CARD',
  VISA: 'CARD',
  MASTERCARD: 'CARD',
  RUPAY: 'CARD',
  AMEX: 'CARD',
  NET_BANKING: 'NETBANKING',
  INTERNET_BANKING: 'NETBANKING',
  NB: 'NETBANKING',
  PREPAID_WALLET: 'WALLET',
  PPI: 'WALLET',
  PAYTM_WALLET: 'WALLET',
  PHONEPE_WALLET: 'WALLET',
  MOBIKWIK: 'WALLET',
  EMI: 'BNPL',
  PAY_LATER: 'BNPL',
  PAYLATER: 'BNPL',
};
/** Accept common input formatting and payment-rail aliases, while keeping the
 * internal event channel restricted to the canonical Channel enum. */
export function normalizeChannel(value: unknown): Channel | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const canonical = CHANNEL_ALIASES[key] ?? key;
  return CHANNELS.includes(canonical as Channel) ? canonical as Channel : undefined;
}
const COVERAGE: CoverageKey[] = ['acquiring', 'website', 'orders', 'bank', 'fulfillment', 'calendar', 'verification'];
const STATES: CoverageState[] = ['AVAILABLE', 'PARTIAL', 'MISSING'];
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const strArr = (x: unknown) => Array.isArray(x) && x.every(isStr);
const { maxPaymentRupees, maxSettlementRupees } = RULES.engine.limits;

function defaultSource(t: DatasetTransaction): string {
  if (t.type === 'SETTLEMENT') return 'settlement.ledger';
  if (t.type === 'TRANSFER') return 'payout.ledger';
  if (t.type === 'CHARGEBACK') return 'acquirer.chargeback';
  if (t.type === 'REFUND') return 'acquirer.refund';
  const ch = normalizeChannel(t.channel);
  if (ch === 'CARD') return 'acquirer.card';
  if (ch === 'NETBANKING') return 'acquirer.netbanking';
  if (ch === 'WALLET') return 'acquirer.wallet';
  if (ch === 'BNPL') return 'acquirer.bnpl';
  if (ch === 'POS') return 'acquirer.pos';
  if (ch === 'ONLINE') return 'acquirer.online';
  return 'acquirer.upi';
}

const GRAPH_LINKS = 60;
const NODE_TYPES = ['merchant', 'payer', 'account', 'link', 'website', 'device', 'beneficiary', 'peer'];
const EDGE_TYPES = ['ENTITY_RESOLUTION', 'BEHAVIOURAL_SIMILARITY', 'PAYMENT_FLOW', 'SHARED_INFRASTRUCTURE', 'WEBSITE_LINK', 'SETTLEMENT_RELATIONSHIP'];
/** A supplied graph is drawn as it is, so it must be drawable. */
function drawable(g: unknown): g is GraphSpec {
  const { nodes, edges } = (g ?? {}) as Partial<GraphSpec>;
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !nodes.some(n => n?.type === 'merchant')) return false;
  const ids = new Set(nodes.map(n => n?.id));
  return nodes.every(n => isStr(n?.id) && isStr(n.label) && NODE_TYPES.includes(n.type) && (n.sub === undefined || typeof n.sub === 'string'))
    && edges.every(e => isStr(e?.id) && ids.has(e.source) && ids.has(e.target) && EDGE_TYPES.includes(e.type) && Array.isArray(e.evidence));
}

/** Minimal evidence graph for datasets that do not supply one. */
export function autoGraph(p: MerchantProfile, events: PaymentEvent[], embeds: EmbedRecord[], peers: PeerInfo[]): GraphSpec {
  const nodes: GraphSpec['nodes'] = [{ id: 'm1', type: 'merchant', label: p.name, sub: `MCC ${p.mcc} · ${p.city.split(',')[0]}` }];
  const edges: GraphSpec['edges'] = [];
  let k = 0; const edge = (source: string, target: string, type: GraphSpec['edges'][number]['type'], label: string, evidence: string[] = []) => edges.push({ id: `a${++k}`, source, target, type, label, evidence });
  // Dynamic QRs mean one link per payment. The picture keeps the links that were seen on pages, then the first others.
  const seen = new Set(embeds.map(e => e.linkId)), every = [...new Set(events.filter(e => e.merchantId === p.id && e.linkId).map(e => e.linkId!))];
  const links = every.length > GRAPH_LINKS ? [...every.filter(l => seen.has(l)), ...every.filter(l => !seen.has(l))].slice(0, GRAPH_LINKS) : every;
  links.forEach((l, i) => { nodes.push({ id: `l${i}`, type: l.startsWith('TERM') ? 'device' : 'link', label: l }); edge('m1', `l${i}`, 'ENTITY_RESOLUTION', 'issued to merchant'); });
  [...new Set(embeds.map(e => e.host))].forEach((h, i) => {
    const em = embeds.filter(e => e.host === h), own = p.declaredDomains.includes(h);
    nodes.push({ id: `w${i}`, type: 'website', label: h, sub: own ? 'declared website' : `undeclared · ${em[0].category}` });
    em.forEach(e => { const li = links.indexOf(e.linkId); if (li >= 0) edge(`l${li}`, `w${i}`, 'WEBSITE_LINK', `embedded on ${e.pageType}`, own ? [] : ['G6']); });
  });
  const ben = [...new Set(events.filter(e => e.merchantId === p.id && e.type === 'SETTLEMENT' && e.beneficiaryHash).map(e => e.beneficiaryHash!))];
  ben.forEach((b, i) => { nodes.push({ id: `b${i}`, type: 'beneficiary', label: `Beneficiary ${i + 1}`, sub: b }); edge('m1', `b${i}`, 'SETTLEMENT_RELATIONSHIP', 'settles to', ben.length > 1 ? ['F5'] : []); });
  peers.forEach((q, i) => { nodes.push({ id: `q${i}`, type: 'peer', label: q.name, sub: `${q.status.toLowerCase()} · ${q.accountAgeDays} days` }); edge('m1', `q${i}`, 'BEHAVIOURAL_SIMILARITY', 'cohort peer', ['E3']); });
  return { nodes, edges };
}

/**
 * Do the last two weekly totals agree with the last 14 days of ledger? undefined = too little ledger to tell.
 * Settlement and refund timestamps do not stretch the window; only sales count.
 */
function reconcile(own: PaymentEvent[], weekly: WeeklyPoint[]): boolean | undefined {
  const { days, tolerance } = RULES.engine.reconcile, sales = own.filter(e => e.type === 'SALE');
  const totals = weekly.slice(-days / 7).map(w => w.actual);
  if (!sales.length || totals.length < days / 7 || totals.some(v => v === null)) return undefined;
  const first = sales[0].eventTime, end = sales[sales.length - 1].eventTime, DAY = 86400000;
  if (end - first < (days - 1.5) * DAY) return undefined;
  const ledger = sales.reduce((s, e) => (e.eventTime > end - days * DAY ? s + e.amount : s), 0), stated = totals.reduce<number>((s, v) => s + (v ?? 0), 0);
  return Math.abs(ledger - stated) <= tolerance * Math.max(ledger, stated);
}

const MERCHANT_LISTS = ['undeclared', 'declaredDomains', 'declaredChannels', 'declaredActivity', 'products'] as const;
const TEXT_FIELDS = ['payerId', 'payerState', 'paymentLinkId', 'paidTo', 'beneficiaryAccount', 'payerMobile', 'destHolder'] as const;
/** What a passport from a file is allowed to say about itself. */
export const asSubmitted = (p: ContextPassport): ContextPassport => (p && typeof p === 'object' ? { ...p, status: 'SUBMITTED', submittedBy: undefined, reviewedBy: undefined, revokedBy: undefined, ref: undefined, client: undefined } : p);

/**
 * A file cannot vouch for itself: Context Passports arrive unverified, with no maker or checker, unless the caller says
 * `trustPassports` (only code that got them from the server's registry may).
 */
export function datasetToScenario(raw: unknown, opts: { trustPassports?: boolean } = {}): ParseResult {
  try { return readDataset(raw, !!opts.trustPassports); }
  catch (e) { return { ok: false, errors: [`A field in this file has the wrong shape (${e instanceof Error ? e.message : String(e)}).`], warnings: [] }; }
}

function readDataset(raw: unknown, trustPassports: boolean): ParseResult {
  const errors: string[] = [], warnings: string[] = [];
  const fail = (m: string) => { errors.push(m); return { ok: false, errors, warnings }; };
  if (!raw || typeof raw !== 'object') return fail('The file is not a JSON object.');
  const d = raw as Partial<MreDataset>;
  if (d.format !== DATASET_FORMAT) warnings.push(`"format" should be "${DATASET_FORMAT}". Reading it as v1 anyway.`);

  // merchant
  const m = d.merchant as Partial<MerchantProfile> | undefined;
  if (!m || typeof m !== 'object') return fail('Missing "merchant" (the declared business profile).');
  const req: [keyof MerchantProfile, (x: unknown) => boolean, string][] = [
    ['id', isStr, 'text'], ['name', isStr, 'text'], ['city', isStr, 'text'], ['mcc', isStr, 'text'], ['category', isStr, 'text'],
    ['ticketMin', isNum, 'number'], ['ticketMax', isNum, 'number'], ['baselineWeekly', isNum, 'number'], ['accountAgeDays', isNum, 'number'],
    ['localStates', strArr, 'list of state codes'],
  ];
  req.forEach(([k, ok, t]) => { if (!ok(m[k])) errors.push(`merchant.${k} is required (${t}).`); });
  if (!Array.isArray(m.hours) || m.hours.length !== 2 || !m.hours.every(isNum)) errors.push('merchant.hours is required as [open, close] in 24h, e.g. [7, 22].');
  else if (!m.hours.every(h => Number.isInteger(h) && h >= 0 && h <= 24) || m.hours[0] === m.hours[1]) errors.push('merchant.hours must be two different whole hours between 0 and 24. Overnight businesses may close before they open, e.g. [22, 6].');
  if (isNum(m.ticketMin) && isNum(m.ticketMax) && !(m.ticketMin >= 0 && m.ticketMin < m.ticketMax)) errors.push('merchant.ticketMin must be at least 0 and below merchant.ticketMax.');
  // An invisible character or stray space would make the same merchant look like one with no history.
  if (isStr(m.id) && (m.id !== m.id.trim() || /[\p{Cc}\p{Cf}]/u.test(m.id))) errors.push('merchant.id cannot start or end with a space, or contain invisible characters.');
  if (isStr(m.mcc) && !/^(\d{4}|UNKNOWN)$/.test(m.mcc)) errors.push('merchant.mcc must be four digits, or UNKNOWN.');
  if (isNum(m.accountAgeDays) && m.accountAgeDays < 0) errors.push('merchant.accountAgeDays cannot be negative.');
  if (isNum(m.baselineWeekly) && m.baselineWeekly <= 0) errors.push('merchant.baselineWeekly must be above 0.');
  const undeclared = new Set(Array.isArray(m.undeclared) ? m.undeclared : []);
  if (m.catchment === undefined) undeclared.add('catchment');
  if (m.expectedRoundShare === undefined) undeclared.add('expectedRoundShare');
  const defaults = { products: [], catchment: 'LOCAL', expectedRoundShare: 0.06, seasonalPeak: 1, declaredDomains: [], declaredChannels: [], declaredActivity: [] } as Partial<MerchantProfile>;
  const profile = { ...defaults, ...m, ...(undeclared.size ? { undeclared: [...undeclared] } : {}) } as MerchantProfile;

  // Optional fields: wrong shapes are refused here, because the browser runs the engine straight after this parser.
  for (const k of MERCHANT_LISTS) if (m[k] !== undefined && !strArr(m[k])) errors.push(`merchant.${k} must be a list of text values.`);
  const site = d.website as { embeds?: unknown; catalogue?: unknown } | null | undefined;
  const rows: Record<string, unknown> = { peers: d.peers, orders: d.orders, bankCredits: d.bankCredits, externalSightings: d.externalSightings, 'website.embeds': site?.embeds, 'website.catalogue': site?.catalogue };
  for (const [k, v] of Object.entries(rows)) if (v !== undefined && v !== null && !(Array.isArray(v) && v.every(x => !!x && typeof x === 'object'))) errors.push(`${k} must be a list of objects.`);

  // transactions
  if (!Array.isArray(d.transactions) || !d.transactions.length) errors.push('"transactions" must be a non-empty list.');
  if (!Array.isArray(d.weeklySales) || !d.weeklySales.length) errors.push('"weeklySales" must list weekly sales history (at least the last 8–16 weeks).');
  if (errors.length) return { ok: false, errors, warnings };

  const ids = new Set<string>();
  const events: PaymentEvent[] = [];
  const seenEvent = new Set<string>();
  let duplicates = 0;
  d.transactions!.forEach((t, i) => {
    const at = `transactions[${i}]${t && isStr(t.id) ? ` (${t.id})` : ''}`;
    if (!t || typeof t !== 'object') { errors.push(`${at} is not an object.`); return; }
    if (!isStr(t.id)) errors.push(`${at}: "id" is required.`); else if (ids.has(t.id)) errors.push(`${at}: duplicate id.`); else ids.add(t.id);
    if (!TYPES.includes(t.type)) errors.push(`${at}: "type" must be one of ${TYPES.join(', ')}.`);
    if (!isNum(t.amount) || t.amount < 0) errors.push(`${at}: "amount" must be a positive number in rupees.`);
    else {
      // A settlement or payout is a batch of payments, so it gets a batch-sized limit.
      const cap = t.type === 'SETTLEMENT' || t.type === 'TRANSFER' ? maxSettlementRupees : maxPaymentRupees;
      if (t.amount > cap) errors.push(`${at}: "amount" is above ₹${cap.toLocaleString('en-IN')}; check the units (rupees, not paise).`);
    }
    const channel = normalizeChannel(t.channel);
    if (!channel) errors.push(`${at}: "channel" must be one of ${CHANNELS.join(', ')} (UPI is also accepted as UPI_LINK).`);
    if (!isStr(t.merchantId)) errors.push(`${at}: "merchantId" is required.`);
    const time = instant(t.time);
    if (!isStr(t.time) || Number.isNaN(time)) errors.push(`${at}: "time" must be an ISO date-time, e.g. 2026-10-18T19:42:10+05:30.`);
    for (const f of TEXT_FIELDS) if (t[f] !== undefined && t[f] !== null && typeof t[f] !== 'string') errors.push(`${at}: "${f}" must be text.`);
    if (errors.length > 25) return;
    const settle = t.settledAt ? instant(t.settledAt) : undefined;
    const payerRef = t.payerId ?? '—', payerHash = t.payerId ? hashId(t.payerId) : '—';
    const ev: PaymentEvent = {
      id: t.id, merchantId: t.merchantId, type: t.type, amount: t.amount, eventTime: time,
      ingestTime: time + 30000, payerRef, payerHash, destHash: t.paidTo ? hashId(t.paidTo) : payerHash,
      payerState: t.payerState ?? '—', channel: channel ?? t.channel, source: t.sourceFeed ?? defaultSource(t),
    };
    if (settle !== undefined && !Number.isNaN(settle)) ev.settleTime = settle;
    if (t.type === 'SETTLEMENT') ev.settleTime = time;
    if (t.paymentLinkId) ev.linkId = t.paymentLinkId;
    if (t.orderId !== undefined) ev.orderId = t.orderId;
    if (t.refundOfTransactionId) ev.linkedSaleId = t.refundOfTransactionId;
    if (t.beneficiaryAccount) ev.beneficiaryHash = hashId(t.beneficiaryAccount);
    if (t.payerMobile) ev.payerMobileHash = hashId(t.payerMobile);
    if (t.destHolder) ev.destHolderHash = hashId(t.destHolder);
    // Exact duplicates only when a payer id is present: two anonymous payers can pay the same amount in the same second.
    const dupKey = t.payerId ? `${t.type}|${t.merchantId}|${t.payerId}|${t.amount}|${time}` : null;
    if (dupKey && seenEvent.has(dupKey)) { duplicates++; return; }
    if (dupKey) seenEvent.add(dupKey);
    events.push(ev);
  });
  if (errors.length) { if (errors.length > 25) errors.splice(25, errors.length, '…more errors not shown.'); return { ok: false, errors, warnings }; }
  events.sort((a, b) => a.eventTime - b.eventTime);
  if (duplicates) warnings.push(`${duplicates} exact duplicate transaction(s) (same type, payer, amount and time) were dropped.`);

  const own = events.filter(e => e.merchantId === profile.id);
  if (!own.length) return fail(`No transactions belong to merchant.id "${profile.id}". Check the merchantId on each transaction.`);
  if (!own.some(e => e.type === 'SALE')) errors.push('The merchant has no SALE transactions to analyse.');
  own.filter(e => e.type === 'REFUND' && e.linkedSaleId && !ids.has(e.linkedSaleId)).length && warnings.push('Some refunds point to a refundOfTransactionId that is not in the file; they will count as refunds without an original sale.');
  if (!own.some(e => e.type === 'SETTLEMENT')) warnings.push('No SETTLEMENT records: settlement checks (F5, F8) will be weaker.');

  const weekly: WeeklyPoint[] = [];
  d.weeklySales!.forEach((w, i) => {
    if (!w || !isStr(w.week) || !(w.actual === null || isNum(w.actual)) || !isNum(w.seasonalMultiplier)) errors.push(`weeklySales[${i}] needs week (text), actual (number or null) and seasonalMultiplier (number).`);
    else if (w.seasonalMultiplier < 0.2 || w.seasonalMultiplier > 6) errors.push(`weeklySales[${i}].seasonalMultiplier must be between 0.2 and 6.`);
    else if (w.actual !== null && w.actual < 0) errors.push(`weeklySales[${i}].actual cannot be negative.`);
    else weekly.push({ week: w.week, actual: w.actual, seasonalMult: w.seasonalMultiplier });
  });
  if (weekly.length < 6) warnings.push('Fewer than 6 weeks of history: baselines and CUSUM will be less reliable.');

  const fixtures = (d.matchFixtures ?? []).map(instant).filter(x => !Number.isNaN(x));
  if ((d.matchFixtures ?? []).length !== fixtures.length) warnings.push('Some matchFixtures could not be read as dates and were skipped.');

  
  const coverage = { acquiring: 'AVAILABLE', website: 'MISSING', orders: 'MISSING', bank: 'MISSING', fulfillment: 'MISSING', calendar: fixtures.length ? 'AVAILABLE' : 'MISSING', verification: 'MISSING', ...(d.dataAvailability ?? {}) } as Record<CoverageKey, CoverageState>;
  COVERAGE.forEach(k => { if (!STATES.includes(coverage[k])) { errors.push(`dataAvailability.${k} must be AVAILABLE, PARTIAL or MISSING.`); } });
  if ((d.website?.embeds?.length || d.website?.catalogue?.length) && !d.dataAvailability?.website) coverage.website = 'AVAILABLE';
  if (d.orders?.length && !d.dataAvailability?.orders) coverage.orders = 'AVAILABLE';
  if (d.bankCredits?.length && !d.dataAvailability?.bank) coverage.bank = 'AVAILABLE';
  if (d.purchaserVerification && !d.dataAvailability?.verification) coverage.verification = 'AVAILABLE';
  const pv = d.purchaserVerification;
  if (pv && !(isNum(pv.contacted) && isNum(pv.confirmed) && Number.isInteger(pv.contacted) && Number.isInteger(pv.confirmed) && pv.contacted > 0 && pv.confirmed >= 0 && pv.confirmed <= pv.contacted))
    errors.push('purchaserVerification needs whole numbers with 0 ≤ confirmed ≤ contacted and contacted > 0.');
  if (coverage.calendar === 'AVAILABLE' && !fixtures.length) warnings.push('The match calendar is marked AVAILABLE but has no fixtures; calendar checks will be UNKNOWN.');
  const filed = Array.isArray(d.contextPassports) ? d.contextPassports : [];
  filed.forEach((p, i) => passportErrors(p).forEach(e => errors.push(`contextPassports[${i}]: ${e}`)));
  if (new Set(filed.map(p => p?.id)).size !== filed.length) errors.push('contextPassports: each passport needs its own id.');
  const passports = trustPassports ? filed : filed.map(asSubmitted);
  if (d.contextPassports !== undefined && !Array.isArray(d.contextPassports)) errors.push('contextPassports must be a list.');
  if (errors.length) return { ok: false, errors, warnings };
  if (!RULES.knowsCategory(profile.mcc)) warnings.push(`MCC ${profile.mcc} has no category norm: category tests will abstain rather than guess. Only category-free tests run.`);
  const weeklyReconciled = reconcile(own, weekly);
  if (weeklyReconciled === false) warnings.push('weeklySales does not match the transaction ledger for the last 14 days, so volume evidence (H1, H2) will be UNKNOWN.');

  const web = {
    embeds: (d.website?.embeds ?? []).map((e, i) => ({ ...e, id: e.id || `EMB-${String(i + 1).padStart(3, '0')}` })),
    catalogue: d.website?.catalogue ?? [],
  };
  const peers = d.peers ?? [];
  const supplied = drawable(d.graph) ? d.graph : undefined;
  if (d.graph && !supplied) warnings.push('The supplied graph could not be drawn, so one was built from the ledger.');
  const sc: Scenario = {
    id: 'custom',
    passports, weeklyReconciled,
    title: d.title ?? profile.name,
    subtitle: 'Uploaded dataset',
    blurb: d.description ?? `Dataset for ${profile.name}, ${profile.city}.`,
    tone: 'illicit',
    expectedOutcome: 'Unknown until the engine runs: this is your data.',
    scriptedLabel: 'UNRESOLVED',
    primaryMerchantId: profile.id,
    profile, peers, events, weekly, fixtures, coverage, web,
    orders: d.orders ?? [],
    verification: d.purchaserVerification ?? null,
    bankCredits: (d.bankCredits ?? []).map(b => ({ amount: b.amount, beneficiaryHash: hashId(b.beneficiaryAccount) })),
    graph: supplied ?? autoGraph(profile, events, web.embeds, peers),
    synthetic: d.description ?? 'Uploaded dataset',
    footprint: d.businessFootprint ?? null,
    sightings: d.externalSightings ?? [],
  };

  const sales = own.filter(e => e.type === 'SALE');
  const summary: DatasetSummary = {
    title: sc.title, merchant: profile.name, city: profile.city, category: `${profile.category} (MCC ${profile.mcc})`,
    transactions: own.length, sales: sales.length, refunds: own.filter(e => e.type === 'REFUND').length,
    settlements: own.filter(e => e.type === 'SETTLEMENT').length, transfers: own.filter(e => e.type === 'TRANSFER').length,
    from: toIst(own[0].eventTime).slice(0, 10), to: toIst(own[own.length - 1].eventTime).slice(0, 10), weeks: weekly.length, fixtures: fixtures.length,
    available: COVERAGE.filter(k => coverage[k] !== 'MISSING'), missing: COVERAGE.filter(k => coverage[k] === 'MISSING'),
  };
  return { ok: true, errors, warnings, scenario: sc, summary };
}
