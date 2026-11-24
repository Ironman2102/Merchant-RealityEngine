/**
 * What may be stored from a file or a person's typing.
 *  - Only the fields the format defines. Anything else (an owner's phone, a KYC block) is dropped.
 *  - In those fields, text that looks like a phone, PAN, GSTIN, Aadhaar or card number, e-mail or UPI id is masked with a
 *    keyed, repeatable token, so ids that join rows still join.
 *  - The merchant's own ids (merchant id, QR / link, advertised payment id) are kept: an analyst has to act on them.
 * Pattern matching cannot recognise a person's name or an address written as free text.
 */
import { loadHashKey, pseudonym } from './pseudonym';

const ANYWHERE = [
  /(?<![\w.+-])[\w.+-]{1,256}@[a-z0-9][a-z0-9.-]{1,255}/gi, // e-mail, UPI id
  /(?<![a-z0-9])\d{2}[a-z]{5}\d{4}[a-z][0-9a-z]{3}(?![a-z0-9])/gi, // GSTIN
  /(?<![a-z0-9])[a-z]{5}\d{4}[a-z](?![a-z0-9])/gi, // PAN
  /(?<![\w+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\w)/g, // Indian mobile
  /(?<!\w)\d{4}[ -]\d{4}[ -]\d{4}(?:[ -]\d{1,7})?(?!\w)/g, // Aadhaar or card, grouped
];
// A bare 12 digit number is also a UPI reference and 13 a timestamp, so these apply to free text only.
const FREE_TEXT = /(?<!\w)\d{12,19}(?!\w)/g;

export function scrub(text: string, key: () => Buffer, free = true): string {
  let out = text;
  for (const pattern of free ? [...ANYWHERE, FREE_TEXT] : ANYWHERE) out = out.replace(pattern, found => `masked_${pseudonym(found, key()).slice(2, 14)}`);
  return out;
}
/** For what a person types on the server: notes, reasons, document references. */
export const scrubText = (text: string) => scrub(text, loadHashKey);

type Kind = 'text' | 'id' | 'own' | 'number' | 'time';
interface Fields { [field: string]: Kind | Fields }

const FORMAT: Fields = {
  format: 'id', title: 'text', description: 'text',
  merchant: {
    id: 'own', name: 'text', city: 'text', mcc: 'id', category: 'text', products: 'text', ticketMin: 'number', ticketMax: 'number', hours: 'number',
    catchment: 'id', localStates: 'id', expectedRoundShare: 'number', seasonalPeak: 'number', baselineWeekly: 'number', accountAgeDays: 'number',
    declaredDomains: 'id', declaredChannels: 'text', declaredActivity: 'text', undeclared: 'id',
  },
  peers: { id: 'own', name: 'text', status: 'id', accountAgeDays: 'number' },
  weeklySales: { week: 'id', actual: 'number', seasonalMultiplier: 'number' },
  transactions: {
    id: 'id', merchantId: 'own', type: 'id', amount: 'number', time: 'time', settledAt: 'time', payerId: 'id', payerState: 'id', channel: 'id', paymentLinkId: 'own',
    orderId: 'id', refundOfTransactionId: 'id', paidTo: 'id', beneficiaryAccount: 'id', payerMobile: 'id', destHolder: 'id', sourceFeed: 'text',
  },
  matchFixtures: 'time',
  dataAvailability: { acquiring: 'id', website: 'id', orders: 'id', bank: 'id', fulfillment: 'id', calendar: 'id', verification: 'id' },
  website: {
    embeds: { id: 'id', merchantId: 'own', linkId: 'own', host: 'id', path: 'text', category: 'id', pageType: 'text', firstSeen: 'id' },
    catalogue: { sku: 'id', name: 'text', price: 'number', inCategory: 'number', dupImage: 'number' },
  },
  orders: { orderId: 'id', saleId: 'id', status: 'id', trackingId: 'id' },
  bankCredits: { amount: 'number', beneficiaryAccount: 'id' },
  purchaserVerification: { contacted: 'number', confirmed: 'number' },
  businessFootprint: { supplierPaymentsMonthly: 'number', gstTurnoverMonthly: 'number' },
  externalSightings: { source: 'text', place: 'text', paymentRef: 'own', seenAt: 'id', note: 'text' },
  contextPassports: {
    id: 'id', reason: 'text', linkId: 'own', from: 'id', until: 'id', document: 'text', hours: 'number', states: 'id', ticketBand: 'number', volumeUplift: 'number', status: 'id',
  },
  graph: {
    nodes: { id: 'id', type: 'id', label: 'text', sub: 'text', note: 'text' },
    edges: { id: 'id', source: 'id', target: 'id', type: 'id', label: 'text', evidence: 'id', note: 'text', weight: 'number' },
  },
};

function keep(value: unknown, rule: Kind | Fields, key: () => Buffer): unknown {
  if (Array.isArray(value)) return value.map(v => (Array.isArray(v) ? null : keep(v, rule, key)));
  if (value && typeof value === 'object') {
    // An object where one value belongs could carry anything.
    if (typeof rule === 'string') return null;
    const from = value as Record<string, unknown>, out: Record<string, unknown> = {};
    for (const field in rule) if (Object.hasOwn(from, field) && from[field] !== undefined) out[field] = keep(from[field], rule[field], key);
    return out;
  }
  const free = rule === 'text';
  if (typeof value === 'string') return rule === 'own' || rule === 'time' ? value : scrub(value, key, free);
  if (typeof value === 'number' && rule !== 'number' && rule !== 'own' && rule !== 'time') {
    const masked = scrub(String(value), key, free);
    return masked === String(value) ? value : masked;
  }
  return value;
}

/** The dataset with only the format's fields, scrubbed. Anything that is not an object is returned as it is, to be refused. */
export function minimise<T>(dataset: T, key: () => Buffer): T {
  return (dataset && typeof dataset === 'object' && !Array.isArray(dataset) ? keep(dataset, FORMAT, key) : dataset) as T;
}
