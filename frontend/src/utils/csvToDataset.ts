import { DATASET_FORMAT, type DatasetTransaction, type MreDataset } from '../data/dataset';
import type { Channel, EventType } from '../types/payment';
import type { MerchantProfile } from '../types/merchant';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export interface CsvColumnMapping {
  id: string;
  amount: string;
  time: string;
  type: string;
  payerId: string;
  payerState: string;
  channel: string;
  paymentLinkId: string;
  amountUnit: 'rupees' | 'paise';
}

export interface CsvMerchantMeta {
  id: string;
  name: string;
  category: string;
  mcc: string;
  city: string;
  state: string;
  catchment: 'LOCAL' | 'NATIONAL';
  ticketMin: number;
  ticketMax: number;
  openHour: number;
  closeHour: number;
}

export function parseCsvText(text: string): ParsedCsv {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(c => c.length > 0)) lines.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(c => c.length > 0)) lines.push(row);

  if (lines.length < 2) return { headers: lines[0] ?? [], rows: [] };
  const headers = lines[0];
  const rows = lines.slice(1).map(cols => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

function findHeader(headers: string[], patterns: RegExp[]): string {
  for (const pat of patterns) {
    const hit = headers.find(h => pat.test(h.toLowerCase()));
    if (hit) return hit;
  }
  return '';
}

export function autoDetectMapping(headers: string[]): CsvColumnMapping {
  const amount = findHeader(headers, [/amount_paise/, /paise/, /amount/, /amt/, /value/, /total/]);
  const amountUnit: 'rupees' | 'paise' = /paise/i.test(amount) ? 'paise' : 'rupees';
  return {
    id: findHeader(headers, [/txn_id/, /tx_id/, /transaction_id/, /^id$/, /ref/]),
    amount,
    time: findHeader(headers, [/created_at/, /event_time/, /timestamp/, /txn_time/, /^time$/, /date/]),
    type: findHeader(headers, [/txn_type/, /event_type/, /^type$/, /kind/]),
    payerId: findHeader(headers, [/payer_vpa/, /payer_id/, /payer_hash/, /customer_id/, /vpa/, /payer/]),
    payerState: findHeader(headers, [/payer_state/, /customer_state/, /^state$/, /region/]),
    channel: findHeader(headers, [/channel/, /payment_mode/, /mode/, /method/]),
    paymentLinkId: findHeader(headers, [/payment_link/, /link_id/, /terminal/]),
    amountUnit,
  };
}

function normalizeType(raw: string): EventType {
  const s = raw.trim().toUpperCase();
  if (s.includes('REFUND')) return 'REFUND';
  if (s.includes('SETTLE')) return 'SETTLEMENT';
  if (s.includes('TRANSFER') || s.includes('PAYOUT')) return 'TRANSFER';
  if (s.includes('CHARGEBACK') || s.includes('DISPUTE')) return 'CHARGEBACK';
  return 'SALE';
}

function normalizeChannel(raw: string): Channel {
  const s = raw.trim().toUpperCase();
  if (s.includes('POS') || s.includes('SWIPE') || s.includes('CARD')) return 'POS';
  if (s.includes('COLLECT')) return 'UPI_COLLECT';
  if (s.includes('LINK') || s.includes('UPI') || s.includes('QR')) return 'UPI_LINK';
  if (s.includes('PAYOUT')) return 'PAYOUT';
  if (s.includes('BANK') || s.includes('NEFT') || s.includes('IMPS')) return 'BANK';
  return 'ONLINE';
}

function normalizeIso(raw: string, fallbackIndex: number): string {
  const trimmed = raw.trim();
  if (trimmed) {
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  const base = Date.UTC(2026, 9, 10, 14, 0, 0) + fallbackIndex * 1_800_000;
  return new Date(base).toISOString();
}

export function buildDatasetFromCsv(
  parsed: ParsedCsv,
  mapping: CsvColumnMapping,
  meta: CsvMerchantMeta,
): MreDataset {
  const scale = mapping.amountUnit === 'paise' ? 0.01 : 1;
  const transactions: DatasetTransaction[] = parsed.rows
    .map((r, idx) => {
      const rawAmt = Number(String(r[mapping.amount] ?? '').replace(/[^0-9.-]/g, ''));
      const amount = Number.isFinite(rawAmt) && rawAmt > 0 ? Math.round(rawAmt * scale * 100) / 100 : 0;
      const t: DatasetTransaction = {
        id: (mapping.id && r[mapping.id]) || `TX-${String(idx + 1).padStart(4, '0')}`,
        merchantId: meta.id,
        type: mapping.type ? normalizeType(r[mapping.type] ?? '') : 'SALE',
        amount,
        time: normalizeIso(mapping.time ? (r[mapping.time] ?? '') : '', idx),
        channel: mapping.channel ? normalizeChannel(r[mapping.channel] ?? '') : 'UPI_LINK',
        sourceFeed: 'csv-upload',
      };
      if (mapping.payerId && r[mapping.payerId]) t.payerId = r[mapping.payerId];
      if (mapping.payerState && r[mapping.payerState]) t.payerState = r[mapping.payerState].toUpperCase().slice(0, 2);
      if (mapping.paymentLinkId && r[mapping.paymentLinkId]) t.paymentLinkId = r[mapping.paymentLinkId];
      const beneCol = findHeader(parsed.headers, [/beneficiary/, /bene_acct/, /settlement_account/, /bank_acct/]);
      if (beneCol && r[beneCol]) t.beneficiaryAccount = r[beneCol];
      return t;
    })
    .filter(t => t.amount > 0);

  const sales = transactions.filter(t => t.type === 'SALE');
  const totalSales = sales.reduce((s, t) => s + t.amount, 0);
  const baselineWeekly = Math.max(10_000, Math.round(totalSales * 0.25));

  const weeklySales = Array.from({ length: 8 }, (_, i) => ({
    week: `W${i + 1}`,
    actual: i < 6 ? Math.round(baselineWeekly * (0.9 + (i % 3) * 0.08)) : Math.round(totalSales * (i === 6 ? 0.45 : 0.55)),
    seasonalMultiplier: 1.0,
  }));

  const merchant: MerchantProfile = {
    id: meta.id,
    name: meta.name,
    category: meta.category,
    mcc: meta.mcc,
    city: `${meta.city}, ${meta.state}`,
    products: [meta.category],
    localStates: [meta.state.toUpperCase().slice(0, 2)],
    catchment: meta.catchment,
    ticketMin: meta.ticketMin,
    ticketMax: meta.ticketMax,
    hours: [meta.openHour, meta.closeHour],
    expectedRoundShare: 0.12,
    seasonalPeak: 1.6,
    baselineWeekly,
    accountAgeDays: 180,
    declaredDomains: [],
    declaredChannels: meta.catchment === 'LOCAL' ? ['POS', 'UPI_LINK'] : ['ONLINE', 'UPI_LINK'],
    declaredActivity: [meta.category],
  };

  return {
    format: DATASET_FORMAT,
    title: `${meta.name} (CSV Import)`,
    description: `Imported directly from raw CSV (${transactions.length} transactions mapped in browser).`,
    merchant,
    weeklySales,
    transactions,
    dataAvailability: {
      acquiring: 'AVAILABLE',
      website: 'MISSING',
      orders: 'MISSING',
      bank: 'MISSING',
      fulfillment: 'MISSING',
      calendar: 'MISSING',
      verification: 'MISSING',
    },
  };
}

/** Realistic sample gateway CSV export for 1-click testing of the in-browser CSV mapper. */
export function buildSampleGatewayCsv(): string {
  const header = 'txn_id,amount_paise,created_at,txn_type,payer_vpa,payer_state,payment_mode,payment_link_id';
  const states = ['MH', 'DL', 'UP', 'RJ', 'GJ', 'TN', 'WB', 'HR', 'PB', 'BR'];
  const amounts = [50000, 100000, 200000, 500000, 1000000, 250000, 150000];
  const rows: string[] = [header];
  const base = Date.UTC(2026, 9, 10, 17, 30, 0); // 23:00 IST (late night!)
  for (let i = 0; i < 64; i++) {
    const ts = new Date(base + Math.floor(i / 8) * 86_400_000 + (i % 8) * 900_000).toISOString();
    const amt = amounts[i % amounts.length];
    const st = i % 9 === 0 ? 'KA' : states[i % states.length];
    rows.push(`PG-${1001 + i},${amt},${ts},SALE,user${100 + (i % 28)}@upi,${st},UPI_LINK,PL-9942`);
  }
  return rows.join('\n');
}

/** Group a multi-merchant CSV by merchant_id / mid column into one MreDataset per merchant. */
export function buildDatasetsFromMultiCsv(
  parsed: ParsedCsv,
  mapping: CsvColumnMapping,
  defaultMeta: CsvMerchantMeta,
): { datasets: MreDataset[]; isMulti: boolean } {
  const midCol = findHeader(parsed.headers, [/^merchant_id$/, /^mid$/, /merchant/, /seller_id/]);
  if (!midCol) {
    return { datasets: [buildDatasetFromCsv(parsed, mapping, defaultMeta)], isMulti: false };
  }
  const nameCol = findHeader(parsed.headers, [/merchant_name/, /business_name/, /dba/]);
  const mccCol = findHeader(parsed.headers, [/^mcc$/, /category_code/]);
  const stateCol = findHeader(parsed.headers, [/merchant_state/, /home_state/]);
  const groups = new Map<string, Record<string, string>[]>();
  for (const r of parsed.rows) {
    const id = (r[midCol] ?? '').trim() || defaultMeta.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(r);
  }
  if (groups.size <= 1) {
    const onlyId = [...groups.keys()][0] ?? defaultMeta.id;
    const first = groups.get(onlyId)?.[0] ?? {};
    return {
      datasets: [buildDatasetFromCsv(parsed, mapping, {
        ...defaultMeta,
        id: onlyId,
        name: (nameCol && first[nameCol]) || defaultMeta.name,
        mcc: (mccCol && first[mccCol]) || defaultMeta.mcc,
        state: (stateCol && first[stateCol]) || defaultMeta.state,
      })],
      isMulti: false,
    };
  }
  const datasets: MreDataset[] = [];
  for (const [mid, rows] of groups.entries()) {
    const first = rows[0] ?? {};
    datasets.push(buildDatasetFromCsv({ headers: parsed.headers, rows }, mapping, {
      ...defaultMeta,
      id: mid,
      name: (nameCol && first[nameCol]) || `Merchant ${mid}`,
      mcc: (mccCol && first[mccCol]) || defaultMeta.mcc,
      state: (stateCol && first[stateCol]) || defaultMeta.state,
    }));
  }
  return { datasets, isMulti: true };
}
