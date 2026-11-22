import { DATASET_FORMAT, type DatasetTransaction, type MreDataset } from '../data/dataset';
import type { Channel, EventType } from '../types/payment';
import type { MerchantProfile } from '../types/merchant';
import { parseAmount, parseTime, stateCode, succeeded, weeklyFromLedger } from './ingest';

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
  status: string;
  refundOf: string;
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
  accountAgeDays: number;
}

export interface CsvImport { dataset: MreDataset; errors: string[]; warnings: string[] }

export function parseCsvText(text: string): ParsedCsv {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split('\n', 1)[0];
  const sep = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

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
    } else if (ch === sep) {
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

export function autoDetectMapping(headers: string[]): CsvColumnMapping {
  const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const used = new Set<string>();
  // Exact names, not fragments: "payer" must never match "payer_state". One column fills one field.
  const find = (...names: string[]) => {
    for (const name of names) {
      const hit = headers.find(h => !used.has(h) && norm(h) === name);
      if (hit) { used.add(hit); return hit; }
    }
    return '';
  };
  const payerState = find('payer_state', 'customer_state', 'payer_region', 'state');
  const status = find('status', 'txn_status', 'transaction_status', 'payment_status');
  const refundOf = find('original_txn_id', 'refund_of', 'parent_txn_id', 'original_transaction_id');
  const id = find('txn_id', 'tx_id', 'transaction_id', 'payment_id', 'id', 'rrn', 'utr', 'reference', 'ref');
  const amount = find('amount_paise', 'amount_in_paise', 'amount', 'txn_amount', 'transaction_amount', 'amount_inr', 'amount_rs', 'amt', 'value');
  const time = find('created_at', 'event_time', 'timestamp', 'txn_time', 'transaction_time', 'txn_date', 'transaction_date', 'date_time', 'datetime', 'payment_time', 'time', 'date');
  return {
    id, amount, time, status, refundOf, payerState,
    type: find('txn_type', 'event_type', 'transaction_type', 'type', 'kind'),
    payerId: find('payer_vpa', 'customer_vpa', 'payer_id', 'payer_hash', 'payer_token', 'customer_id', 'vpa', 'payer'),
    channel: find('channel', 'payment_mode', 'payment_method', 'mode', 'method'),
    paymentLinkId: find('payment_link_id', 'link_id', 'qr_id', 'qr_code_id', 'payment_link', 'terminal_id', 'tid', 'terminal'),
    amountUnit: /paise/i.test(amount) ? 'paise' : 'rupees',
  };
}

function normalizeType(raw: string): EventType | null {
  const s = raw.trim().toUpperCase();
  if (s.includes('REFUND')) return 'REFUND';
  if (s.includes('SETTLE')) return 'SETTLEMENT';
  if (s.includes('TRANSFER') || s.includes('PAYOUT')) return 'TRANSFER';
  if (s.includes('CHARGEBACK') || s.includes('DISPUTE')) return 'CHARGEBACK';
  return /^(SALE|PAYMENT|PAY|CREDIT|PURCHASE|CAPTURE|COLLECT|COLLECTION|UPI|CARD|P)$/.test(s) ? 'SALE' : null;
}

function normalizeChannel(raw: string): Channel {
  const s = raw.trim().toUpperCase();
  if (s.includes('POS') || s.includes('SWIPE')) return 'POS';
  if (s.includes('COLLECT')) return 'UPI_COLLECT';
  if (s.includes('LINK') || s.includes('UPI') || s.includes('QR')) return 'UPI_LINK';
  if (s.includes('PAYOUT')) return 'PAYOUT';
  if (s.includes('BANK') || s.includes('NEFT') || s.includes('IMPS')) return 'BANK';
  return 'ONLINE';
}

/** Builds a dataset from what is in the file and nothing else: no invented history, dates or types. */
export function buildDatasetFromCsv(parsed: ParsedCsv, mapping: CsvColumnMapping, meta: CsvMerchantMeta): CsvImport {
  const errors: string[] = [], warnings: string[] = [];
  if (!mapping.amount) errors.push('Choose the amount column.');
  if (!mapping.time) errors.push('Choose the timestamp column. Times are never made up.');
  const scale = mapping.amountUnit === 'paise' ? 0.01 : 1;
  const skipped = { status: 0, type: 0, time: 0, amount: 0 };
  let badState = 0;
  const transactions: DatasetTransaction[] = [];
  if (!errors.length) parsed.rows.forEach((r, idx) => {
    const cell = (key: string) => (key ? (r[key] ?? '').trim() : '');
    if (mapping.status && !succeeded(cell(mapping.status))) { skipped.status++; return; }
    const type = mapping.type ? normalizeType(cell(mapping.type)) : 'SALE';
    if (!type) { skipped.type++; return; }
    const time = parseTime(cell(mapping.time));
    if (!time) { skipped.time++; return; }
    let raw = parseAmount(cell(mapping.amount));
    // Refunds and payouts are often exported as negatives. A negative sale is not a sale.
    if (raw !== null && raw < 0 && type !== 'SALE') raw = -raw;
    if (raw === null || raw <= 0) { skipped.amount++; return; }
    const t: DatasetTransaction = {
      id: cell(mapping.id) || `TX-${String(idx + 1).padStart(4, '0')}`, merchantId: meta.id, type, time,
      amount: Math.round(raw * scale * 100) / 100,
      channel: mapping.channel ? normalizeChannel(cell(mapping.channel)) : 'UPI_LINK', sourceFeed: 'csv-upload',
    };
    if (cell(mapping.payerId)) t.payerId = cell(mapping.payerId);
    if (cell(mapping.payerState)) { const code = stateCode(cell(mapping.payerState)); if (code) t.payerState = code; else badState++; }
    if (cell(mapping.paymentLinkId)) t.paymentLinkId = cell(mapping.paymentLinkId);
    if (cell(mapping.refundOf)) t.refundOfTransactionId = cell(mapping.refundOf);
    transactions.push(t);
  });

  const note = (n: number, what: string) => { if (n) warnings.push(`${n} row${n === 1 ? '' : 's'} ${what}`); };
  note(skipped.status, 'left out because the payment did not succeed or its status is unrecognised.');
  note(skipped.type, 'left out because the transaction type is unrecognised. They were not assumed to be sales.');
  note(skipped.time, 'left out because the date could not be read. Dates are read day first (DD/MM/YYYY).');
  note(skipped.amount, 'left out because the amount could not be read as a positive number.');
  note(badState, 'had an unrecognised state, so their location is unknown.');
  const sales = transactions.filter(t => t.type === 'SALE');
  if (!errors.length && !sales.length) errors.push('No successful sales could be read from this file.');
  if (!mapping.status) warnings.push('No status column is mapped. Confirm that the export holds successful payments only.');
  if (!mapping.payerId) warnings.push('No payer column: repeat-payer tests will be UNKNOWN.');
  if (!mapping.payerState) warnings.push('No payer location: geography tests will be UNKNOWN.');
  if (!mapping.paymentLinkId) warnings.push('No QR or link column: a hidden side-stream cannot be scored or disabled on its own.');

  const weeklySales = weeklyFromLedger(sales);
  if (weeklySales.filter(w => w.actual !== null).length < 8) warnings.push('Less than 8 complete weeks of ledger: volume evidence will be limited or UNKNOWN. No history was invented.');
  const merchant: MerchantProfile = {
    id: meta.id,
    name: meta.name || meta.id,
    category: meta.category || 'Category not supplied',
    mcc: meta.mcc || 'UNKNOWN',
    city: [meta.city, meta.state].filter(Boolean).join(', ') || 'City not supplied',
    products: [],
    localStates: stateCode(meta.state) ? [stateCode(meta.state)!] : [],
    catchment: meta.catchment,
    ticketMin: meta.ticketMin,
    ticketMax: meta.ticketMax,
    hours: [meta.openHour, meta.closeHour],
    expectedRoundShare: 0.06,
    seasonalPeak: 1,
    baselineWeekly: Math.max(1, weeklySales[0]?.actual ?? 1),
    accountAgeDays: meta.accountAgeDays,
    declaredDomains: [],
    declaredChannels: [],
    declaredActivity: [],
    // The form asks for none of these, so they are not tested as if the merchant had declared them.
    undeclared: ['hours', 'catchment', 'expectedRoundShare'],
  };
  if (meta.ticketMax <= meta.ticketMin) { merchant.undeclared!.push('ticketMax'); merchant.ticketMax = merchant.ticketMin + 1; }
  const dataset: MreDataset = {
    format: DATASET_FORMAT,
    title: `${merchant.name} (CSV Import)`,
    description: `Imported from CSV (${transactions.length} of ${parsed.rows.length} rows used).`,
    merchant, weeklySales, transactions,
    dataAvailability: { acquiring: 'AVAILABLE', website: 'MISSING', orders: 'MISSING', bank: 'MISSING', fulfillment: 'MISSING', calendar: 'MISSING', verification: 'MISSING' },
  };
  return { dataset, errors, warnings };
}

/** Realistic sample gateway CSV export for 1-click testing of the in-browser CSV mapper. */
export function buildSampleGatewayCsv(): string {
  const header = 'txn_id,amount_paise,created_at,txn_type,payer_vpa,payer_state,payment_mode,payment_link_id,status';
  const states = ['MH', 'DL', 'UP', 'RJ', 'GJ', 'TN', 'WB', 'HR', 'PB', 'BR'];
  const amounts = [50000, 100000, 200000, 500000, 1000000, 250000, 150000];
  const rows: string[] = [header];
  const base = Date.UTC(2026, 9, 10, 17, 30, 0); // 23:00 IST (late night!)
  for (let i = 0; i < 64; i++) {
    const ts = new Date(base + Math.floor(i / 8) * 86_400_000 + (i % 8) * 900_000).toISOString();
    const amt = amounts[i % amounts.length];
    const st = i % 9 === 0 ? 'KA' : states[i % states.length];
    rows.push(`PG-${1001 + i},${amt},${ts},SALE,user${100 + (i % 12)}@upi,${st},UPI_LINK,PL-9942,SUCCESS`);
  }
  return rows.join('\n');
}
