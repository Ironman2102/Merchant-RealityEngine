/**
 * Map a payment-aggregator's export folder into mre-dataset/v1.
 * Identifier fields are HMAC-pseudonymised here, before the engine sees them.
 * context.json, when present, supplies feeds the three CSVs cannot carry (website, orders, peers, …).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATASET_FORMAT, toIst, type DatasetTransaction, type MreDataset } from '../frontend/src/data/dataset';
import type { MerchantProfile } from '../frontend/src/types/merchant';
import { parseCsv } from './csv';
import { pseudonym } from './pseudonym';

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

const ID_FIELDS = ['payerId', 'paidTo', 'beneficiaryAccount', 'payerMobile', 'destHolder'] as const;
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

function hasOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
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
  let accountAgeDays = 0;
  if (onboarded && latestMs !== undefined) {
    const start = Date.parse(onboarded.length <= 10 ? `${onboarded}T00:00:00${mapping.timezone}` : onboarded);
    if (!Number.isNaN(start)) accountAgeDays = Math.max(0, Math.floor((latestMs - start) / 86_400_000));
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
    localStates: home ? [home] : [],
    expectedRoundShare: 0.06,
    seasonalPeak: 1,
    baselineWeekly: baselineWeeklyRaw !== undefined ? baselineWeeklyRaw * scale : 0,
    accountAgeDays,
    declaredDomains,
    declaredChannels: [],
    declaredActivity: [],
  };
  if (!merchant.id) warnings.push('A merchant row has no id and was skipped.');
  return { merchant, warnings };
}

function weekBuckets(txns: DatasetTransaction[], timezone: string): MreDataset['weeklySales'] {
  if (!txns.length) return [];
  const times = txns.map(t => Date.parse(t.time)).filter(n => !Number.isNaN(n));
  const end = Math.max(...times);
  const byEnd = new Map<number, number>();
  for (const t of txns) {
    if (t.type !== 'SALE') continue;
    const ms = Date.parse(t.time);
    const bucketEnd = end - Math.floor((end - ms) / (7 * 86_400_000)) * 7 * 86_400_000;
    byEnd.set(bucketEnd, (byEnd.get(bucketEnd) ?? 0) + t.amount);
  }
  return [...byEnd.entries()].sort((a, b) => a[0] - b[0]).map(([ms, actual]) => ({
    week: toIst(ms).slice(0, 10), actual, seasonalMultiplier: 1,
  }));
  void timezone;
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
    const cell = (keyName: string) => col(txHeader, row, specOf(tspec[keyName]).column);
    const typeRaw = cell('type');
    const typeSpec = specOf(tspec.type);
    const type = typeSpec.map ? typeSpec.map[typeRaw] : typeRaw;
    if (!type || (typeSpec.map && !(typeRaw in typeSpec.map))) {
      if (typeRaw) warnings.push(`transactions row ${i + 2}: unknown type "${typeRaw}" skipped`);
      return;
    }
    const channelRaw = cell('channel');
    const channelSpec = specOf(tspec.channel);
    const channel = channelSpec.map ? channelSpec.map[channelRaw] : channelRaw;
    if (!channel || (channelSpec.map && !(channelRaw in channelSpec.map))) {
      warnings.push(`transactions row ${i + 2}: unknown channel "${channelRaw}" skipped`);
      return;
    }
    const amountRaw = num(cell('amount'));
    if (amountRaw === undefined) { warnings.push(`transactions row ${i + 2}: amount missing, skipped`); return; }
    const scale = mapping.amountUnit === 'paise' ? 0.01 : 1;
    const amount = amountRaw * scale;
    let time = cell('time');
    if (time && !hasOffset(time)) time = `${time}${mapping.timezone}`;
    let settled = cell('settledAt');
    if (settled && !hasOffset(settled)) settled = `${settled}${mapping.timezone}`;
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
    opt('payerState', cell('payerState'));
    opt('payerMobile', cell('payerMobile'));
    opt('paymentLinkId', cell('paymentLinkId'));
    const order = cell('orderId');
    if (order === 'null') txn.orderId = null;
    else if (order !== '') txn.orderId = order;
    opt('refundOfTransactionId', cell('refundOfTransactionId'));
    opt('paidTo', cell('paidTo'));
    opt('destHolder', cell('destHolder'));
    opt('beneficiaryAccount', cell('beneficiaryAccount'));
    for (const f of ID_FIELDS) {
      const v = txn[f];
      if (typeof v === 'string' && v) (txn as unknown as Record<string, string>)[f] = pseudonym(v, key);
    }
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

  const datasets: MreDataset[] = [];
  for (const row of merchants.rows) {
    const idCell = col(merchants.header, row, specOf(mapping.merchants.id).column);
    const txns = parsedTx.filter(t => t.merchantId === idCell).map(t => t.row);
    const latest = txns.reduce((m, t) => Math.max(m, Date.parse(t.time) || 0), 0);
    const built = merchantFromRow(merchants.header, row, mapping, latest || undefined);
    warnings.push(...built.warnings);
    if (!built.merchant.id) continue;
    const extra = context.byMerchant?.[built.merchant.id] ?? {};
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
    const peers = (peerTransactions ?? []).map(t => {
      const copy = { ...t };
      for (const f of ID_FIELDS) {
        const v = copy[f];
        if (typeof v === 'string' && v) (copy as unknown as Record<string, string>)[f] = pseudonym(v, key);
      }
      return copy;
    });
    txns.push(...peers);
    const bankCredits = (restExtra.bankCredits ?? []).map(b => ({
      ...b,
      beneficiaryAccount: b.beneficiaryAccount ? pseudonym(b.beneficiaryAccount, key) : b.beneficiaryAccount,
    }));
    const weeklySales = weeklyBy.get(built.merchant.id) ?? weekBuckets(txns, mapping.timezone);
    const dataset: MreDataset = {
      format: DATASET_FORMAT,
      ...restExtra,
      merchant,
      transactions: txns,
      weeklySales,
      ...(restExtra.bankCredits ? { bankCredits } : {}),
    };
    datasets.push(dataset);
  }
  return { datasets, warnings };
}
