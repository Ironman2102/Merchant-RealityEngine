/**
 * Write the nine sample merchants into both example PA layouts.
 * context.json keeps every non-ledger field so mapExport can reproduce the original dataset.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toCsv } from '../adapters/csv';
import type { DatasetTransaction, MreDataset } from '../frontend/src/data/dataset';

const GENERIC_TYPE: Record<string, string> = { SALE: 'PAYMENT', REFUND: 'REFUND', SETTLEMENT: 'SETTLEMENT', TRANSFER: 'PAYOUT', CHARGEBACK: 'CHARGEBACK' };
const ALT_TYPE: Record<string, string> = { SALE: 'P', REFUND: 'R', SETTLEMENT: 'S', TRANSFER: 'O', CHARGEBACK: 'C' };
const GENERIC_CHANNEL: Record<string, string> = { UPI_LINK: 'UPI_INTENT', UPI_COLLECT: 'UPI_COLLECT', POS: 'POS', ONLINE: 'CARD_ONLINE', PAYOUT: 'PAYOUT', BANK: 'BANK' };
const ALT_CHANNEL: Record<string, string> = { UPI_LINK: 'UI', UPI_COLLECT: 'UC', POS: 'PS', ONLINE: 'ON', PAYOUT: 'PO', BANK: 'BK' };

const SAMPLES = readdirSync('frontend/public/samples').filter(f => /^0[1-9]-/.test(f)).sort();

function load(): MreDataset[] {
  return SAMPLES.map(f => JSON.parse(readFileSync(join('frontend/public/samples', f), 'utf8')) as MreDataset);
}

function cell(v: string | number | null | undefined): string | number | null {
  return v === undefined || v === null ? '' : v;
}

export function writeLayout(dir: string, datasets: MreDataset[], kind: 'generic' | 'alt'): void {
  const paise = kind === 'alt';
  const money = (n: number | null) => (n === null ? null : paise ? Math.round(n * 100) : n);
  const typeOf = kind === 'alt' ? ALT_TYPE : GENERIC_TYPE;
  const channelOf = kind === 'alt' ? ALT_CHANNEL : GENERIC_CHANNEL;
  const names = kind === 'alt'
    ? ['col_txn_id', 'col_merchant_id', 'col_txn_type', 'col_amount', 'col_txn_time', 'col_settled_at', 'col_payer_vpa', 'col_payer_state', 'col_payer_mobile', 'col_channel', 'col_link_id', 'col_order_id', 'col_original_txn_id', 'col_refund_to', 'col_refund_to_holder', 'col_beneficiary_account']
    : ['txn_id', 'merchant_id', 'txn_type', 'amount', 'txn_time', 'settled_at', 'payer_vpa', 'payer_state', 'payer_mobile', 'channel', 'link_id', 'order_id', 'original_txn_id', 'refund_to', 'refund_to_holder', 'beneficiary_account'];
  const txRows: (string | number | null)[][] = [names];
  const merchHeader = kind === 'alt'
    ? ['col_merchant_id', 'col_legal_name', 'col_city', 'col_mcc', 'col_category', 'col_declared_min_ticket', 'col_declared_max_ticket', 'col_open_hour', 'col_close_hour', 'col_state', 'col_catchment', 'col_declared_weekly_volume', 'col_onboarded_on', 'col_domains']
    : ['merchant_id', 'legal_name', 'city', 'mcc', 'category', 'declared_min_ticket', 'declared_max_ticket', 'open_hour', 'close_hour', 'state', 'catchment', 'declared_weekly_volume', 'onboarded_on', 'domains'];
  const merchRows: (string | number | null)[][] = [merchHeader];
  const weekHeader = kind === 'alt' ? ['col_merchant_id', 'col_week_end', 'col_sales_value'] : ['merchant_id', 'week_end', 'sales_value'];
  const weekRows: (string | number | null)[][] = [weekHeader];
  const byMerchant: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const d of datasets) {
    if (seen.has(d.merchant.id)) throw new Error(`Duplicate merchant id ${d.merchant.id}`);
    seen.add(d.merchant.id);
    const latest = d.transactions.reduce((m, t) => Math.max(m, Date.parse(t.time) || 0), 0);
    const onboarded = new Date(latest - d.merchant.accountAgeDays * 86_400_000).toISOString().slice(0, 10);
    merchRows.push([
      d.merchant.id, d.merchant.name, d.merchant.city, d.merchant.mcc, d.merchant.category,
      money(d.merchant.ticketMin), money(d.merchant.ticketMax), d.merchant.hours[0], d.merchant.hours[1],
      d.merchant.localStates[0] ?? '', d.merchant.catchment, money(d.merchant.baselineWeekly), onboarded,
      d.merchant.declaredDomains.join('|'),
    ]);
    for (const w of d.weeklySales) weekRows.push([d.merchant.id, w.week, money(w.actual)]);
    for (const t of d.transactions) txRows.push(txnRow(t, typeOf, channelOf, money));
    const { transactions, weeklySales: _w, ...rest } = d;
    byMerchant[d.merchant.id] = { ...rest, peerTransactions: transactions.filter(t => t.merchantId !== d.merchant.id) };
  }
  mkdirSync(dir, { recursive: true });
  const delimiter = kind === 'alt' ? ';' : ',';
  writeFileSync(join(dir, 'transactions.csv'), toCsv(txRows, delimiter));
  writeFileSync(join(dir, 'merchants.csv'), toCsv(merchRows, delimiter));
  writeFileSync(join(dir, 'weekly.csv'), toCsv(weekRows, delimiter));
  writeFileSync(join(dir, 'context.json'), JSON.stringify({ byMerchant }));
}

function txnRow(t: DatasetTransaction, typeOf: Record<string, string>, channelOf: Record<string, string>, money: (n: number | null) => number | null): (string | number | null)[] {
  return [
    t.id, t.merchantId, typeOf[t.type] ?? t.type, money(t.amount), t.time, cell(t.settledAt),
    cell(t.payerId), cell(t.payerState), cell(t.payerMobile), channelOf[t.channel] ?? t.channel,
    cell(t.paymentLinkId), t.orderId === null ? 'null' : cell(t.orderId), cell(t.refundOfTransactionId),
    cell(t.paidTo), cell(t.destHolder), cell(t.beneficiaryAccount),
  ];
}

if (process.argv[1]?.endsWith('export-pa-files.ts')) {
  const datasets = load();
  writeLayout('examples/generic-pa', datasets, 'generic');
  writeLayout('examples/alt-pa', datasets, 'alt');
  console.log(`Wrote ${datasets.length} merchants into examples/generic-pa and examples/alt-pa`);
}
