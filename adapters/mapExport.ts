/**
 * Map a payment-aggregator's export folder into mre-dataset/v1.
 * Identifier fields are HMAC-pseudonymised here, before the engine sees them.
 * context.json, when present, supplies feeds the three CSVs cannot carry (website, orders, peers, …).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asSubmitted, DATASET_FORMAT, toIst, type DatasetTransaction, type MreDataset } from '../frontend/src/data/dataset';
import type { MerchantProfile } from '../frontend/src/types/merchant';
import { parseCsv } from './csv';
import { own } from '../rules/index';
import { maskIds } from './pseudonym';
import { parseTime, stateCode, succeeded, weeklyFromLedger } from '../frontend/src/utils/ingest';

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
  const merchant = {
    id: get('id'),
    name: get('name'),
    city: get('city'),
    mcc: get('mcc'),
    category: get('category'),
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
  if (open === undefined || close === undefined) { undeclared.push('hours'); merchant.hours = [0, 24]; }
  if (!get('catchment')) undeclared.push('catchment');
  if (ticketMaxRaw === undefined) { undeclared.push('ticketMax'); merchant.ticketMax = merchant.ticketMin + 1; }
  if (baselineWeeklyRaw === undefined) merchant.baselineWeekly = 1; // reference line only; never evidence
  if (undeclared.length) Object.assign(merchant, { undeclared });
  if (!ageKnown) warnings.push(`merchant ${merchant.id}: onboarding date unknown, neutral account-age prior used.`);
  if (!merchant.id) warnings.push('A merchant row has no id and was skipped.');
  return { merchant: merchant as MerchantProfile, warnings };
}

export function mapExport(dir: string, mappingPath: string, key: Buffer): { datasets: MreDataset[]; warnings: string[] } {
  const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as Mapping;
  const warnings: string[] = [];
  const tx = table(dir, mapping.files.transactions, mapping.delimiter);
  const merchants = table(dir, mapping.files.merchants, mapping.delimiter);
  const weekly = table(dir, mapping.files.weekly, mapping.delimiter);
  if (!merchants) return { datasets: [], warnings: [`Missing ${mapping.files.merchants}`] };
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
    const typeRaw = cell('type');
    const typeSpec = specOf(tspec.type);
    const type = typeSpec.map ? own(typeSpec.map, typeRaw) : typeRaw;
    if (!type) {
      if (typeRaw) warnings.push(`transactions row ${i + 2}: unknown type "${typeRaw}" skipped`);
      return;
    }
    const channelRaw = cell('channel');
    const channelSpec = specOf(tspec.channel);
    const channel = channelSpec.map ? own(channelSpec.map, channelRaw) : channelRaw;
    if (!channel) {
      warnings.push(`transactions row ${i + 2}: unknown channel "${channelRaw}" skipped`);
      return;
    }
    const amountRaw = num(cell('amount'));
    if (amountRaw === undefined) { warnings.push(`transactions row ${i + 2}: amount missing, skipped`); return; }
    const scale = mapping.amountUnit === 'paise' ? 0.01 : 1;
    const amount = amountRaw * scale;
    const time = parseTime(cell('time'), mapping.timezone);
    if (!time) { warnings.push(`transactions row ${i + 2}: time unreadable, skipped`); return; }
    const settled = cell('settledAt') ? parseTime(cell('settledAt'), mapping.timezone) ?? '' : '';
    const merchantId = cell('merchantId');
    const txn: DatasetTransaction = {
      id: cell('id'), merchantId, type: type as DatasetTransaction['type'], amount, time, channel: channel as DatasetTransaction['channel'],
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
    const id = col(weekly.header, row, mapping.weekly.merchantId);
    const salesRaw = col(weekly.header, row, mapping.weekly.sales);
    const actual = salesRaw === '' ? null : num(salesRaw);
    const scale = mapping.amountUnit === 'paise' ? 0.01 : 1;
    const point = { week: col(weekly.header, row, mapping.weekly.weekEnd), actual: actual === undefined || actual === null ? null : actual * scale, seasonalMultiplier: 1 };
    const list = weeklyBy.get(id) ?? [];
    list.push(point);
    weeklyBy.set(id, list);
  }

  let context: { byMerchant?: Record<string, Partial<MreDataset>> } = {};
  const contextPath = join(dir, 'context.json');
  if (existsSync(contextPath)) context = JSON.parse(readFileSync(contextPath, 'utf8'));

  const byMerchant = new Map<string, DatasetTransaction[]>();
  for (const { row, merchantId } of parsedTx) { const list = byMerchant.get(merchantId); if (list) list.push(row); else byMerchant.set(merchantId, [row]); }
  const datasets: MreDataset[] = [];
  for (const row of merchants.rows) {
    const idCell = col(merchants.header, row, specOf(mapping.merchants.id).column);
    const txns = [...(byMerchant.get(idCell) ?? [])];
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
    for (const peer of peers) txns.push(peer);
    const bankCredits = (Array.isArray(restExtra.bankCredits) ? restExtra.bankCredits : []).filter(b => b && typeof b === 'object').map(b => {
      const copy = { ...b };
      maskIds(copy, () => key, ['beneficiaryAccount']);
      return copy;
    });
    const weeklySales = weeklyBy.get(built.merchant.id) ?? ledgerWeeks();
    const dataset: MreDataset = {
      format: DATASET_FORMAT,
      ...restExtra,
      merchant,
      transactions: txns,
      weeklySales,
      ...(restExtra.bankCredits ? { bankCredits } : {}),
      ...(Array.isArray(restExtra.contextPassports) ? { contextPassports: restExtra.contextPassports.map(asSubmitted) } : {}),
    };
    datasets.push(dataset);
  }
  return { datasets, warnings };
}
