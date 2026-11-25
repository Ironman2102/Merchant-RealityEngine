import type { Family, Mechanism } from '../types/evidence';
import type { LayerId, ResponseLevel } from '../types/investigation';

export const FAMILIES: { id: Family; name: string; short: string }[] = [
  { id: 'A', name: 'Ticket size and menu fit', short: 'Ticket' },
  { id: 'B', name: 'Payer behaviour and geography', short: 'Payer / geo' },
  { id: 'C', name: 'Timing and seasonality', short: 'Timing' },
  { id: 'D', name: 'Money-flow shape and refunds', short: 'Money flow' },
  { id: 'E', name: 'Cross-merchant cohorts and networks', short: 'Networks' },
  { id: 'F', name: 'Settlement and lifecycle', short: 'Settlement' },
  { id: 'G', name: 'Catalogue, website and payment-link provenance', short: 'Provenance' },
  { id: 'H', name: 'Drift, blending and rotation', short: 'Drift' },
  { id: 'I', name: 'Other abuse', short: 'Other' },
  { id: 'K', name: 'Declared profile vs category norm', short: 'Declared' },
];

export const MECHANISMS: { id: Mechanism; name: string; blurb: string }[] = [
  { id: 'ROTATION', name: 'Rotation', blurb: 'Collection moves between accounts or merchants to evade monitoring.' },
  { id: 'TRANSACTION_LAUNDERING', name: 'Transaction laundering', blurb: 'Undeclared activity is processed through a legitimate merchant’s credentials.' },
  { id: 'FABRICATED_SUBSTANCE', name: 'Fabricated substance', blurb: 'Commercial activity is manufactured and cannot be substantiated.' },
  { id: 'OTHER_ABUSE', name: 'Other abuse', blurb: 'Payout fan-out and other patterns that fit none of the above.' },
];

export interface LayerMeta {
  n: LayerId; code: string; name: string; tagline: string; does: string;
  inputs: string[]; processes: string[]; outputs: string[]; next: string;
}
export const LAYERS: LayerMeta[] = [
  { n: 1, code: 'L1', name: 'Ingest & Lineage', tagline: 'Multi-rail event store with pseudonymisation and honest gaps.',
    does: 'Normalises UPI, QR, card, netbanking, wallet, BNPL, POS, refund, chargeback, settlement, and payout records into one PaymentEvent timeline, HMAC-pseudonymises identifiers, links refunds to sales, and maps source coverage.',
    inputs: ['Multi-rail PA transactions (UPI, QR, card, netbanking, wallet, BNPL, POS)', 'Refunds, chargebacks & disputes', 'Settlements & onward payouts', 'Merchant KYC & declared channels', 'Website crawl, orders, fulfilment & bank credits'],
    processes: ['PA CSV / JSON adapter & schema validation', 'Normalise 11 canonical channels & 5 event types', 'Separate event, settle & ingest timestamps', 'Link refunds & chargebacks to original sales', 'HMAC-SHA256 pseudonymisation & privacy scrubbing', 'Build 7-source merchant coverage map'],
    outputs: ['Clean multi-rail PaymentEvent store', '7-feed coverage map & lineage'], next: 'The coverage map tells L3 which of the 30 detectors may run and which must abstain as UNKNOWN.' },
  { n: 2, code: 'L2', name: 'Merchant Profile', tagline: 'Category norms, festival seasonality, and drift baselines.',
    does: 'Pairs the declared merchant profile with independent MCC category norms (rules/mcc.json), festival calendar ramps, and link-scoped Context Passports to compute log-normal volume residuals, CUSUM drift, and changepoints.',
    inputs: ['Declared MCC, hours, catchment & channels', 'Independent MCC category norms (~40 MCCs)', 'Festival & match calendars (rules/calendar.json)', 'Verified Context Passports (link-scoped)', 'Weekly sales & L1 event history'],
    processes: ['Fit log-normal weekly volume baseline', 'Apply sector festival ramps & link-scoped passport uplift', 'Reconcile weekly totals against L1 ledger', 'Track sustained excess with ARL-calibrated CUSUM (h = 2.35)', 'Run Bayesian Online Changepoint Detection (BOCPD)'],
    outputs: ['Category-anchored behavioural expectations', 'Seasonally adjusted residuals, CUSUM & changepoints'], next: 'L3 detectors compare observed payments against category norms and these baselines.' },
  { n: 3, code: 'L3', name: 'Detection', tagline: '30 live detectors across 10 families, stream by stream.',
    does: 'Scores the whole account plus each payment link/QR, active payment rail (channel), and repeat-payer cohort with 30 statistical detectors (A–I + K), 10 advisory patterns, N4/N5 ring checks, and a leak-free Stage 2 ML second opinion.',
    inputs: ['L1 event store & coverage map', 'L2 category norms, baselines & CUSUM', 'Website embeds, orders, bank credits & peer cohorts'],
    processes: ['Split into account, per-link/QR, per-rail & repeat-payer streams', 'Run 30 detectors across 10 families (incl. D11 chargebacks & K2 undeclared rails)', 'Separate conduct signals from profile changes', 'Run cross-merchant N4/N5 ring detection & 10 advisory patterns (S1–S7, N1–N3)', 'Extract leak-free behavioral features for Stage 2 ML (LightGBM + TreeSHAP, MLP, classical)'],
    outputs: ['Graded EvidenceItems with LLR weights', 'Per-stream scores, ring links & Stage 2 ML second opinion'], next: 'EvidenceItems flow to L4 for Bayesian fusion; Stage 2 ML stays advisory and never overrides the gate.' },
  { n: 4, code: 'L4', name: 'Evidence Fusion', tagline: 'Bayesian log-odds, conduct gate, and question-before-case.',
    does: 'Fuses evidence in log-odds with within-family shrinkage (ρ = 0.3), excludes UNKNOWN (LLR 0), runs 1,000 Monte-Carlo draws for a 90% interval & conformal set, and opens a case only with conduct + independent corroboration.',
    inputs: ['L3 EvidenceItems across all streams', 'MCC + account-age base rate priors', 'Hard-rule overrides (R-01 betting host, R-02 shared peer beneficiary)'],
    processes: ['Within-family correlation shrinkage (ρ = 0.3) & damping', 'Exclude UNKNOWN and suspend passports if conduct fires', '1,000 Monte-Carlo draws for 90% CI & conformal abstention', 'Conduct + independence gate (≥2 sources, ≥3 families, or ≥2 conduct lineages)', 'Route profile-only departures to Context Passport ASK', 'Score 4 mechanism posteriors (Rotation, Laundering, Fabricated, Other)'],
    outputs: ['Posterior P(front), 90% CI & conformal set', 'OPEN_CASE, ASK (Context Passport), or NO_CASE with leading mechanism'], next: 'Opened cases and ASK items enter L5 for human review with full mathematical traceability.' },
  { n: 5, code: 'L5', name: 'Analyst Review', tagline: 'Competing chains, counterfactuals, and two-person passports.',
    does: 'Tests the Legitimate Business chain side by side against the Potential Front chain, renders the log-odds waterfall, flip-set counterfactuals, Value of Information (₹), and Evidence Graph, and handles two-person Context Passports.',
    inputs: ['L4 fusion result, posterior & mechanism scores', 'Raw source records & Evidence Graph', 'Merchant documents & Context Passport submissions'],
    processes: ['Compare Legitimate vs Potential Front evidence chains', 'Inspect log-odds trace waterfall & flip-set counterfactuals', 'Evaluate Value of Information (₹) for missing feeds', 'Verify Context Passports with two-person maker/checker sign-off', 'Inspect cross-merchant links & record analyst recommendation'],
    outputs: ['Reviewed case & competing-chain verdict', 'Verified/revoked Context Passports & response recommendation'], next: 'The reviewed case and expected-loss analysis set the starting level for L6.' },
  { n: 6, code: 'L6', name: 'Governed Response', tagline: 'Expected-loss L0–L5 ladder with maker/checker authority.',
    does: 'Selects the lowest expected-loss response (L0–L5) with conservative low-CI step-down, enforces maker/checker role separation and legal authority for L4/L5, and scopes L3 restrictions to suspect links while healthy rails stay live.',
    inputs: ['Reviewed case & analyst recommendation', 'Expected-loss cost matrix (rules/costs.json)', 'Suspect links, unsettled funds & legal/escrow checks'],
    processes: ['Compute expected loss at median & 90% CI low bound (step down on uncertainty)', 'Scope L3 restriction to identified suspect links/flows only', 'Enforce two-person maker/checker & distinct legal role for L4/L5', 'Create simulated time-boxed HoldRecord with 24h review & 72h expiry', 'Provide merchant notification & appeal route'],
    outputs: ['Approved response record & scoped restriction plan', 'Tamper-evident action log'], next: 'Every decision, restriction, and adjudication flows into L7 audit and calibration.' },
  { n: 7, code: 'L7', name: 'Audit, Labels & Learning', tagline: 'Hash-chained audit, RBI/FIU packs, and governed calibration.',
    does: 'Seals every action in a SHA-256 hash-chained, HMAC-signed SQLite audit trail, exports RBI/FIU-IND evidence packs, monitors PSI calibration drift, and converts two-person labels into backtested rule proposals.',
    inputs: ['L6 action audit & SQLite case store', 'Two-person adjudicated labels (Confirmed Front / Genuine / Unresolved)', 'Holdout synthetic & red-team suites'],
    processes: ['Append SHA-256 hash-chained & HMAC-sealed audit entries', 'Export structured RBI / FIU-IND evidence pack', 'Track PSI calibration drift & empirical peer baselines', 'Generate Beta-binomial calibration proposals from confirmed labels', 'Require holdout backtest + second-person approval before promoting rules'],
    outputs: ['Verifiable tamper-evident audit trail & evidence pack', 'Governed rule updates & refreshed expectations for L2/L3'], next: 'Approved rule patches and verified passports feed back into L2, L3, and L4 for future runs.' },
];

export const RESPONSE_LEVELS: { id: ResponseLevel; name: string; blurb: string; needsAuthority: boolean }[] = [
  { id: 'L0', name: 'Observe and log', blurb: 'Keep monitoring. Nothing changes for the merchant.', needsAuthority: false },
  { id: 'L1', name: 'Profile refresh and clarification', blurb: 'Ask the merchant to update the profile or explain the change.', needsAuthority: false },
  { id: 'L2', name: 'Enhanced Due Diligence', blurb: 'Open EDD: documents, site visit, purchaser checks.', needsAuthority: false },
  { id: 'L3', name: 'Restrict a defined prospective flow', blurb: 'Disable one identified payment flow, such as a single link.', needsAuthority: false },
  { id: 'L4', name: 'Time-boxed fund restriction', blurb: 'Hold a precisely identified amount for a limited time, subject to legal and escrow requirements.', needsAuthority: true },
  { id: 'L5', name: 'Terminate and report', blurb: 'Disable the merchant relationship and file required reports.', needsAuthority: true },
];
export const LEVEL_ORDER: ResponseLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
