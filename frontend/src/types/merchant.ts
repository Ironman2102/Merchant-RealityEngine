import type { PaymentEvent } from './payment';

export type CoverageKey = 'acquiring' | 'website' | 'orders' | 'bank' | 'fulfillment' | 'calendar' | 'verification';
export type CoverageState = 'AVAILABLE' | 'PARTIAL' | 'MISSING';

export interface MerchantProfile {
  id: string;
  name: string;
  city: string;
  mcc: string;
  category: string;
  products: string[];
  ticketMin: number;
  ticketMax: number;
  hours: [number, number];
  catchment: 'LOCAL' | 'NATIONAL';
  localStates: string[];
  expectedRoundShare: number;
  seasonalPeak: number;         // expected multiplier during the seasonal peak
  baselineWeekly: number;       // anchored weekly expectation (INR)
  accountAgeDays: number;
  declaredDomains: string[];
  declaredChannels: string[];
  declaredActivity: string[];
  /** Fields the PA did not supply. They hold placeholders and are never tested as if declared. */
  undeclared?: ('ticketMax' | 'hours' | 'catchment' | 'expectedRoundShare')[];
}

/**
 * Context Passport: a merchant's declared change, tied to one QR / link and a date range. It changes nothing until
 * a second person verifies the document, and even then it covers only profile signals, never conduct.
 */
export interface ContextPassport {
  id: string;
  reason: string;
  /** The QR, link or terminal the change is traded through. */
  linkId: string;
  from: string;               // ISO date
  until?: string;             // ISO date, at most rules engine.passport.maxDays after `from`
  document: string;           // reference of the evidence the checker looked at
  hours?: [number, number];
  /** States served, or ['*'] for national delivery. */
  states?: string[];
  ticketBand?: [number, number];
  volumeUplift?: number;
  status: 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'REVOKED';
  submittedBy?: string;
  reviewedBy?: string;
  revokedBy?: string;
  /** Set by the server on verification: its registry key, and the service client whose case it was verified on. */
  ref?: string;
  client?: string;
}

export interface WeeklyPoint { week: string; actual: number | null; seasonalMult: number }

export interface EmbedRecord { id: string; merchantId: string; linkId: string; host: string; path: string; category: 'own' | 'gambling' | 'resale' | 'marketplace' | 'unknown'; pageType: string; firstSeen: string }
export interface CatalogueItem { sku: string; name: string; price: number; inCategory: boolean; dupImage: boolean }
export interface WebData { embeds: EmbedRecord[]; catalogue: CatalogueItem[] }
export interface OrderRecord { orderId: string; saleId: string; status: 'DELIVERED' | 'SHIPPED' | 'NONE'; trackingId?: string }
export interface PeerInfo { id: string; name: string; status: 'ACTIVE' | 'DORMANT'; accountAgeDays: number }

export interface GraphNodeSpec { id: string; type: 'merchant' | 'payer' | 'account' | 'link' | 'website' | 'device' | 'beneficiary' | 'peer'; label: string; sub?: string; note?: string }
export type EdgeType = 'ENTITY_RESOLUTION' | 'BEHAVIOURAL_SIMILARITY' | 'PAYMENT_FLOW' | 'SHARED_INFRASTRUCTURE' | 'WEBSITE_LINK' | 'SETTLEMENT_RELATIONSHIP';
export interface GraphEdgeSpec { id: string; source: string; target: string; type: EdgeType; label: string; evidence: string[]; note?: string; weight?: number }
export interface GraphSpec { nodes: GraphNodeSpec[]; edges: GraphEdgeSpec[] }

export type ScenarioId = 'bakery' | 'sideline' | 'changed' | 'rotation' | 'fabricated' | 'diwali';
export type Label = 'CONFIRMED_ILLICIT' | 'ADJUDICATED_BENIGN' | 'UNRESOLVED';

export interface Scenario {
  id: ScenarioId | 'custom';
  title: string;
  subtitle: string;
  blurb: string;
  tone: 'illicit' | 'benign';
  expectedOutcome: string;
  scriptedLabel: Label;
  primaryMerchantId: string;
  profile: MerchantProfile;
  peers: PeerInfo[];
  events: PaymentEvent[];           // includes peer merchants' events
  weekly: WeeklyPoint[];
  fixtures: number[];               // match / event start times (epoch ms)
  coverage: Record<CoverageKey, CoverageState>;
  web: WebData;
  orders: OrderRecord[];
  verification: { contacted: number; confirmed: number } | null;
  bankCredits: { amount: number; beneficiaryHash: string }[];
  graph: GraphSpec;
  synthetic: string;                // plain-language list of injected signals
  /** Optional business-footprint feed (supplier payments, GST turnover), monthly INR. */
  footprint?: { supplierPaymentsMonthly: number; gstTurnoverMonthly: number } | null;
  /** Optional outside-in sightings: where this merchant's payment IDs were seen advertised. */
  sightings?: Sighting[];
  passports?: ContextPassport[];
  /** False when the weekly totals disagree with the ledger; volume evidence is then UNKNOWN. */
  weeklyReconciled?: boolean;
}
export interface Sighting { source: string; place: string; paymentRef: string; seenAt: string; note?: string }
