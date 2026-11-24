/**
 * Map a payment-aggregator's export folder into mre-dataset/v1.
 * Identifier fields are HMAC-pseudonymised here, before the engine sees them.
 * context.json, when present, supplies feeds the three CSVs cannot carry (website, orders, peers, …).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asSubmitted, DATASET_FORMAT, normalizeChannel, toIst, TYPES, type DatasetTransaction, type MreDataset } from '../frontend/src/data/dataset';
import type { MerchantProfile } from '../frontend/src/types/merchant';
import { parseCsv } from './csv';
import { passportErrors } from '../frontend/src/engines/passport';
import { own, RULES } from '../rules/index';
import { minimise, scrub } from './privacy';
import { maskIds } from './pseudonym';
import { parseAmount, parseTime, stateCode, succeeded, weeklyFromLedger } from '../frontend/src/utils/ingest';

type FieldSpec = string | { column: string; map?: Record<string, string>; split?: string };
interface Mapping {
  name: string;
  files: { transactions: string; merchants: string; weekly: string };
  delimiter: string;
  amountUnit: 'rupees' | 'paise';
  timezone: string;
  transactions: Record<string, FieldSpec>;
  merchants: Record<string, FieldSpec>;
  weekly: { merchantId: string; weekEnd: string; sales: string };
}

const specOf = (v: FieldSpec) => (typeof v === 'string' ? { column: v } : v);

function table(dir: string, file: string, delimiter: string): { header: string[]; rows: string[][] } | null {
  const path = join(dir, file);
  if (!existsSync(path)) return null;
  const grid = parseCsv(readFileSync(path, 'utf8'), delimiter);
  if (!grid.length) return { header: [], rows: [] };
  return { header: grid[0], rows: grid.slice(1).filter(r => r.some(c => c !== '')) };
}

function col(header: string[], row: string[], name: string): string {
  const i = header.indexOf(name);
  return i < 0 ? '' : (row[i] ?? '').trim();
}

/** An id with a hidden character would be a merchant with no history. */
const cleanId = (raw: string) => raw.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();

function num(raw: string): number | undefined {
  if (raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function merchantFromRow(header: string[], row: string[], mapping: Mapping, latestMs: number | undefined): { merchant: MerchantProfile; warnings: string[] } {
  const warnings: string[] = [];
  const m = mapping.merchants;
  const get = (key: string) => col(header, row, specOf(m[key]).column);
  const scale = mapping.amountUnit === 'paise' ? 0.01 : 1;
  const open = num(get('openHour'));
  const close = num(get('closeHour'));
  const onboarded = get('onboardedOn');
  // An unknown age gets the neutral prior (odds 1), not the doubled prior of a brand-new account.
  let accountAgeDays = 1000, ageKnown = false;
  if (onboarded && latestMs !== undefined) {
    const start = Date.parse(parseTime(onboarded, mapping.timezone) ?? '');
    if (!Number.isNaN(start)) ageKnown = true;
    if (ageKnown) accountAgeDays = Math.max(0, Math.floor((latestMs - start) / 86_400_000));
  }
  const domains = specOf(m.declaredDomains);
  const declaredDomains = col(header, row, domains.column).split(domains.split ?? '|').map(s => s.trim()).filter(Boolean);
  const home = get('homeState');
  const ticketMinRaw = num(get('ticketMin'));
  const ticketMaxRaw = num(get('ticketMax'));
  const baselineWeeklyRaw = num(get('baselineWeekly'));
  const id = cleanId(get('id')), rawMcc = get('mcc');
  // A bad field is dropped and reported. It must not leave the whole merchant unscored.
  const mcc = /^\d{4}$/.test(rawMcc) ? rawMcc : /^\d{3}$/.test(rawMcc) ? `0${rawMcc}` : 'UNKNOWN';
  if (mcc !== rawMcc) warnings.push(`merchant ${id}: category code "${rawMcc}" read as ${mcc}.`);
  const merchant = {
    id,
    name: get('name') || `Merchant ${id}`,
    city: get('city') || 'Unknown',
    mcc,
    category: get('category') || 'Not supplied',
    products: [],
    ticketMin: ticketMinRaw !== undefined ? ticketMinRaw * scale : 0,
    ticketMax: ticketMaxRaw !== undefined ? ticketMaxRaw * scale : 0,
    hours: [open ?? 0, close ?? 24] as [number, number],
    catchment: (get('catchment') === 'NATIONAL' ? 'NATIONAL' : 'LOCAL') as 'LOCAL' | 'NATIONAL',
    localStates: stateCode(home) ? [stateCode(home)!] : [],
    expectedRoundShare: 0.06,
    seasonalPeak: 1,
    baselineWeekly: baselineWeeklyRaw !== undefined ? baselineWeeklyRaw * scale : 0,
    accountAgeDays,
    declaredDomains,
    declaredChannels: [],
    declaredActivity: [],
  };
  const undeclared: NonNullable<MerchantProfile['undeclared']> = [];
  const validHour = (h: number | undefined) => h !== undefined && Number.isInteger(h) && h >= 0 && h <= 24;
  if (!validHour(open) || !validHour(close) || open === close) {
    undeclared.push('hours'); merchant.hours = [0, 24];
    if (open !== undefined || close !== undefined) warnings.push(`merchant ${id}: trading hours unreadable, treated as not declared.`);
  }
  if (merchant.ticketMin < 0) merchant.ticketMin = 0;
  if (!get('catchment')) undeclared.push('catchment');
  if (ticketMaxRaw === undefined || merchant.ticketMax <= merchant.ticketMin) {
    undeclared.push('ticketMax'); merchant.ticketMax = merchant.ticketMin + 1;
    if (ticketMaxRaw !== undefined) warnings.push(`merchant ${id}: ticket range unreadable, treated as not declared.`);
  }
  if (!(merchant.baselineWeekly > 0)) merchant.baselineWeekly = 1; // reference line only; never evidence
  if (undeclared.length) Object.assign(merchant, { undeclared });
  if (!ageKnown) warnings.push(`merchant ${merchant.id}: onboarding date unknown, neutral account-age prior used.`);
  if (!merchant.id) warnings.push('A merchant row has no id and was skipped.');
  return { merchant: merchant as MerchantProfile, warnings };
}

export interface Mapped {
  datasets: MreDataset[];
  warnings: string[];
  /** Rows of this merchant that could not be read, so a partial score never looks like a complete one. */
  skipped: Map<string, number>;
  /** The merchant from the three CSVs alone, to score when its context.json entry cannot be used. */
  core: WeakMap<MreDataset, () => MreDataset>;
}

export function mapExport(dir: string, mappingPath: string, key: Buffer): Mapped {
  const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as Mapping;
  const warnings: string[] = [];
  const tx = table(dir, mapping.files.transactions, mapping.delimiter);
  const merchants = table(dir, mapping.files.merchants, mapping.delimiter);
  const weekly = table(dir, mapping.files.weekly, mapping.delimiter);
  const skipped = new Map<string, number>(), core = new WeakMap<MreDataset, () => MreDataset>(), secret = () => key;
  if (!merchants) return { datasets: [], warnings: [`Missing ${mapping.files.merchants}`], skipped, core };
  const txRows = tx?.rows ?? [];
  const txHeader = tx?.header ?? [];
  const tspec = mapping.transactions;

  const parsedTx: { row: DatasetTransaction; merchantId: string }[] = [];
  txRows.forEach((row, i) => {
    if (tspec.status) {
      const status = col(txHeader, row, specOf(tspec.status).column);
      if (!succeeded(status)) { warnings.push(`transactions row ${i + 2}: status "${status}" is not a success, skipped`); return; }
    }
    const cell = (keyName: string) => col(txHeader, row, specOf(tspec[keyName]).column);
    const merchantId = cleanId(cell('merchantId'));
    const skip = (why: string) => {
      warnings.push(`transactions row ${i + 2}: ${why}, skipped`);
      skipped.set(merchantId, (skipped.get(merchantId) ?? 0) + 1);
    };
    const typeRaw = cell('type');
    const typeSpec = specOf(tspec.type);
    const type = typeSpec.map ? own(typeSpec.map, typeRaw) : typeRaw;
    if (!type || !TYPES.includes(type as DatasetTransaction['type'])) { skip(`type "${typeRaw}" is not known`); return; }
    const channelRaw = cell('channel');
    const channelSpec = specOf(tspec.channel);
    const channel = normalizeChannel(channelSpec.map ? own(channelSpec.map, channelRaw) : channelRaw);
    if (!channel) { skip(`channel "${channelRaw}" is not known`); return; }
    const amountRead = parseAmount(cell('amount')) ?? num(cell('amount'));
    if (amountRead === undefined || !Number.isFinite(amountRead)) { skip('amount missing or unreadable'); return; }
    const scale = mapping.amountUnit === 'paise' ? 0.01 : 1;
    // Money out is often exported as a negative number. A negative sale means nothing.
    if (amountRead < 0 && type === 'SALE') { skip('a sale with a negative amount'); return; }
    const amount = Math.abs(amountRead) * scale;
    const limits = RULES.engine.limits;
    if (amount > (type === 'SETTLEMENT' || type === 'TRANSFER' ? limits.maxSettlementRupees : limits.maxPaymentRupees)) { skip('amount above the limit, check rupees or paise'); return; }
    const time = parseTime(cell('time'), mapping.timezone);
    if (!time) { skip('time unreadable'); return; }
    const settled = cell('settledAt') ? parseTime(cell('settledAt'), mapping.timezone) ?? '' : '';
    const txn: DatasetTransaction = {
      id: cell('id') || `row-${i + 2}`, merchantId, type: type as DatasetTransaction['type'], amount, time, channel: channel as DatasetTransaction['channel'],
    };
    const opt = (field: keyof DatasetTransaction, raw: string) => {
      if (raw === '') return;
      (txn as unknown as Record<string, unknown>)[field] = raw;
    };
    opt('settledAt', settled);
    opt('payerId', cell('payerId'));
    opt('payerState', stateCode(cell('payerState')) ?? '');
    opt('payerMobile', cell('payerMobile'));
    opt('paymentLinkId', cell('paymentLinkId'));
    const order = cell('orderId');
    if (order === 'null') txn.orderId = null;
    else if (order !== '') txn.orderId = order;
    opt('refundOfTransactionId', cell('refundOfTransactionId'));
    opt('paidTo', cell('paidTo'));
    opt('destHolder', cell('destHolder'));
    opt('beneficiaryAccount', cell('beneficiaryAccount'));
    maskIds(txn, () => key);
    parsedTx.push({ row: txn, merchantId });
  });

  const weeklyBy = new Map<string, MreDataset['weeklySales']>();
  if (weekly) for (const row of weekly.rows) {
    const id = cleanId(col(weekly.header, row, mapping.weekly.merchantId));
    const salesRaw = col(weekly.header, row, mapping.weekly.sales);
    const read = parseAmount(salesRaw) ?? num(salesRaw), weekEnd = col(weekly.header, row, mapping.weekly.weekEnd);
    if (!weekEnd) { warnings.push(`weekly: a row of merchant ${id} has no week, skipped`); continue; }
    const actual = read === undefined || !(read >= 0) ? null : read;
    if (salesRaw && actual === null) warnings.push(`weekly: sales "${salesRaw}" of merchant ${id} unreadable, left empty`);
    const scale = mapping.amountUnit === 'paise' ? 0.01 : 1;
    const point = { week: weekEnd, actual: actual === null ? null : actual * scale, seasonalMultiplier: 1 };
    const list = weeklyBy.get(id) ?? [];
    list.push(point);
    weeklyBy.set(id, list);
  }

  let context: { byMerchant?: Record<string, Partial<MreDataset>> } = {};
  const contextPath = join(dir, 'context.json');
  if (existsSync(contextPath)) {
    try { context = JSON.parse(readFileSync(contextPath, 'utf8')) ?? {}; }
    catch { warnings.push('context.json is not valid JSON and was ignored. Every merchant is scored from the CSVs alone.'); }
  }

  const byMerchant = new Map<string, DatasetTransaction[]>();
  for (const { row, merchantId } of parsedTx) { const list = byMerchant.get(merchantId); if (list) list.push(row); else byMerchant.set(merchantId, [row]); }
  const datasets: MreDataset[] = [];
  for (const row of merchants.rows) {
    const idCell = cleanId(col(merchants.header, row, specOf(mapping.merchants.id).column));
    const txns: DatasetTransaction[] = [], taken = new Map<string, DatasetTransaction>();
    // The same row twice is one payment. Two payments that share an id are both kept, the second under its own id.
    const add = (t: DatasetTransaction) => {
      const first = taken.get(t.id);
      if (first && first.merchantId === t.merchantId && first.type === t.type && first.amount === t.amount && first.time === t.time) {
        warnings.push(`merchant ${idCell}: transaction ${t.id} repeated, counted once`);
        return;
      }
      let id = t.id;
      for (let n = 2; taken.has(id); n++) id = `${t.id}#${n}`;
      const kept = id === t.id ? t : { ...t, id };
      if (kept !== t) warnings.push(`merchant ${idCell}: transaction id ${t.id} reused, kept as ${id}`);
      taken.set(id, kept);
      txns.push(kept);
    };
    for (const t of byMerchant.get(idCell) ?? []) add(t);
    const latest = txns.reduce((m, t) => Math.max(m, Date.parse(t.time) || 0), 0);
    const built = merchantFromRow(merchants.header, row, mapping, latest || undefined);
    for (const w of built.warnings) warnings.push(w);
    if (!built.merchant.id) continue;
    const extra = own(context.byMerchant, built.merchant.id) ?? {};
    const { peerTransactions, ...restExtra } = extra as Partial<MreDataset> & { peerTransactions?: DatasetTransaction[] };
    const extraMerchant = restExtra.merchant as MerchantProfile | undefined;
    const merchant: MerchantProfile = extraMerchant
      ? {
          ...extraMerchant,
          ...built.merchant,
          products: extraMerchant.products ?? built.merchant.products,
          localStates: extraMerchant.localStates?.length ? extraMerchant.localStates : built.merchant.localStates,
          expectedRoundShare: extraMerchant.expectedRoundShare ?? built.merchant.expectedRoundShare,
          seasonalPeak: extraMerchant.seasonalPeak ?? built.merchant.seasonalPeak,
          accountAgeDays: extraMerchant.accountAgeDays ?? built.merchant.accountAgeDays,
          declaredChannels: extraMerchant.declaredChannels ?? built.merchant.declaredChannels,
          declaredActivity: extraMerchant.declaredActivity ?? built.merchant.declaredActivity,
        }
      : built.merchant;
    if (!extraMerchant) merchant.undeclared = [...new Set([...(merchant.undeclared ?? []), 'expectedRoundShare' as const])];
    // context.json is hand-written: one merchant's bad entry must not abort everybody's batch.
    const peers = (Array.isArray(peerTransactions) ? peerTransactions : []).filter(t => t && typeof t === 'object').map(t => {
      const copy = { ...t };
      maskIds(copy, () => key);
      return copy;
    });
    const ledgerWeeks = () => weeklyFromLedger(txns.filter(t => t.type === 'SALE' && t.merchantId === built.merchant.id));
    const ownRows = txns.slice();
    for (const peer of peers) add(peer);
    const bankCredits = (Array.isArray(restExtra.bankCredits) ? restExtra.bankCredits : []).filter(b => b && typeof b === 'object').map(b => {
      const copy = { ...b };
      maskIds(copy, () => key, ['beneficiaryAccount']);
      return copy;
    });
    const weeklySales = weeklyBy.get(built.merchant.id) ?? ledgerWeeks();
    const filed = Array.isArray(restExtra.contextPassports) ? restExtra.contextPassports : [], passportIds = new Set<string>();
    const passports = filed.filter(x => {
      if (passportErrors(x).length || passportIds.has(x.id)) { warnings.push(`merchant ${built.merchant.id}: an invalid or repeated Context Passport in context.json was ignored`); return false; }
      passportIds.add(x.id);
      return true;
    }).map(asSubmitted);
    const dataset: MreDataset = {
      format: DATASET_FORMAT,
      ...restExtra,
      merchant,
      transactions: txns,
      weeklySales,
      ...(restExtra.bankCredits ? { bankCredits } : {}),
      ...(restExtra.contextPassports !== undefined ? { contextPassports: passports } : {}),
    };
    const stored = minimise(dataset, secret);
    datasets.push(stored);
    core.set(stored, () => minimise<MreDataset>({ format: DATASET_FORMAT, merchant: { ...built.merchant }, transactions: ownRows, weeklySales: weeklyBy.get(built.merchant.id) ?? ledgerWeeks() }, secret));
  }
  return { datasets, warnings: warnings.map(w => scrub(w, secret)), skipped, core };
}
