/** Cross-merchant network & ring detection (N4 shared beneficiaries, N5 overlapping payer cohorts). */
import type { Scenario } from '../frontend/src/types/merchant';

export interface RingLink {
  kind: 'N4_SHARED_BENEFICIARY' | 'N5_PAYER_OVERLAP';
  key: string;
  label: string;
  merchants: { id: string; name: string }[];
  metricLabel: string;
  severity: 'HIGH' | 'MEDIUM';
}

export interface RingReport {
  rings: RingLink[];
  linkedMerchantIds: string[];
}

export interface RingOptions {
  /** Posterior P(front) per merchantId. When supplied, clean franchises (N4-only) and low-overlap local coincidences (N5-only) are suppressed unless corroborated. */
  posteriorByMerchant?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  /** Minimum max posterior across linked merchants to treat a single-edge link as a fraud ring (default 0.05). */
  minLinkedPosterior?: number;
  /** Beneficiary hashes allowlisted as known corporate/franchise parent accounts. */
  allowlistedBeneficiaries?: ReadonlySet<string>;
}

function getPosterior(map: RingOptions['posteriorByMerchant'], id: string): number | undefined {
  if (!map) return undefined;
  return map instanceof Map ? map.get(id) : (map as Record<string, number>)[id];
}

export function detectRings(scenarios: readonly Scenario[], opts?: RingOptions): RingReport {
  if (scenarios.length < 2) return { rings: [], linkedMerchantIds: [] };

  const minP = opts?.minLinkedPosterior ?? 0.05;
  const allowBen = opts?.allowlistedBeneficiaries;
  const hasRiskMap = !!opts?.posteriorByMerchant;

  // Deduplicate by merchantId while collecting beneficiaries, non-anonymous payers, and dormant-handoff flags.
  const merchantIndex = new Map<string, number>();
  const meta: { id: string; name: string; payerCount: number; hasDormantPeer: boolean }[] = [];
  const byBeneficiary = new Map<string, Set<number>>();
  const byPayer = new Map<string, Set<number>>();

  for (const sc of scenarios) {
    const mid = sc.profile.id;
    let idx = merchantIndex.get(mid);
    if (idx === undefined) {
      idx = meta.length;
      merchantIndex.set(mid, idx);
      meta.push({
        id: mid,
        name: sc.profile.name,
        payerCount: 0,
        hasDormantPeer: (sc.peers ?? []).some(p => p.status === 'DORMANT'),
      });
    }
    const seenPayers = new Set<string>();
    for (const ev of sc.events) {
      if (ev.type === 'SALE' && ev.payerHash) {
        const ph = ev.payerHash.trim();
        // Never count anonymous POS placeholder '—' as a shared payer across shops.
        if (ph && ph !== '—') seenPayers.add(ph);
      }
      if ((ev.type === 'SETTLEMENT' || ev.type === 'TRANSFER') && ev.beneficiaryHash) {
        const acct = ev.beneficiaryHash.trim();
        if (!acct || acct === '—' || allowBen?.has(acct)) continue;
        let set = byBeneficiary.get(acct);
        if (!set) { set = new Set(); byBeneficiary.set(acct, set); }
        set.add(idx);
      }
    }
    meta[idx].payerCount = seenPayers.size;
    for (const ph of seenPayers) {
      let set = byPayer.get(ph);
      if (!set) { set = new Set(); byPayer.set(ph, set); }
      set.add(idx);
    }
  }

  // Inverted-index pairwise payer overlap: visits only pairs that actually share >= 1 non-anonymous payer (O(sum k_p^2), not O(N^2)).
  const pairShared = new Map<string, number>();
  const MAX_POPULAR_PAYER = 250; // guard against hyper-common aggregator/wallet proxy IDs
  for (const mSet of byPayer.values()) {
    if (mSet.size < 2 || mSet.size > MAX_POPULAR_PAYER) continue;
    const arr = [...mSet].sort((a, b) => a - b);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]}:${arr[j]}`;
        pairShared.set(key, (pairShared.get(key) ?? 0) + 1);
      }
    }
  }

  // Precompute pairs that share a beneficiary so dual-signal (N4 + N5) quiet rings are always caught.
  const sharedBenPairs = new Set<string>();
  const merchantHasPayerOverlap = new Set<number>();
  for (const [key, shared] of pairShared.entries()) {
    if (shared < 3) continue;
    const [ai, bi] = key.split(':').map(Number);
    if (meta[ai].payerCount < 3 || meta[bi].payerCount < 3) continue;
    const minSize = Math.min(meta[ai].payerCount, meta[bi].payerCount);
    const overlap = shared / minSize;
    if (overlap >= 0.05 || shared >= 5) {
      merchantHasPayerOverlap.add(ai);
      merchantHasPayerOverlap.add(bi);
    }
  }
  for (const mSet of byBeneficiary.values()) {
    if (mSet.size < 2) continue;
    const arr = [...mSet].sort((a, b) => a - b);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) sharedBenPairs.add(`${arr[i]}:${arr[j]}`);
    }
  }

  const rings: RingLink[] = [];
  const linked = new Set<string>();

  for (const [acct, mSet] of byBeneficiary.entries()) {
    if (mSet.size < 2) continue;
    const idxs = [...mSet];
    if (hasRiskMap) {
      let maxP = 0;
      let anyDormant = false;
      let anyPayerOverlap = false;
      for (const i of idxs) {
        const p = getPosterior(opts?.posteriorByMerchant, meta[i].id) ?? 0;
        if (p > maxP) maxP = p;
        if (meta[i].hasDormantPeer) anyDormant = true;
        if (merchantHasPayerOverlap.has(i)) anyPayerOverlap = true;
      }
      // Clean multi-branch franchise (all merchants P < minP, no dormant handoff, no payer overlap, <=6 outlets) is not a fraud ring.
      if (maxP < minP && !anyDormant && !anyPayerOverlap && idxs.length <= 6) continue;
    }
    const merchants = idxs.map(i => ({ id: meta[i].id, name: meta[i].name }));
    merchants.forEach(m => linked.add(m.id));
    rings.push({
      kind: 'N4_SHARED_BENEFICIARY',
      key: `n4-${acct}`,
      label: `Shared settlement beneficiary ${acct}`,
      merchants,
      metricLabel: `${merchants.length} linked MIDs`,
      severity: 'HIGH',
    });
  }

  for (const [key, shared] of pairShared.entries()) {
    if (shared < 3) continue;
    const [ai, bi] = key.split(':').map(Number);
    if (meta[ai].payerCount < 3 || meta[bi].payerCount < 3) continue;
    const minSize = Math.min(meta[ai].payerCount, meta[bi].payerCount);
    const overlap = shared / minSize;
    if (!(overlap >= 0.05 || shared >= 5)) continue;

    if (hasRiskMap) {
      const pA = getPosterior(opts?.posteriorByMerchant, meta[ai].id) ?? 0;
      const pB = getPosterior(opts?.posteriorByMerchant, meta[bi].id) ?? 0;
      const maxP = Math.max(pA, pB);
      const sharesBen = sharedBenPairs.has(key);
      const anyDormant = meta[ai].hasDormantPeer || meta[bi].hasDormantPeer;
      // Clean nearby shops (e.g. tech-park lunch crowd) with low overlap (<35%), distinct beneficiaries, and no risk are suppressed.
      if (maxP < minP && !sharesBen && !anyDormant && overlap < 0.35) continue;
    }

    const a = meta[ai], b = meta[bi];
    linked.add(a.id);
    linked.add(b.id);
    rings.push({
      kind: 'N5_PAYER_OVERLAP',
      key: `n5-${a.id}-${b.id}`,
      label: `Payer cohort overlap (${a.name} ↔ ${b.name})`,
      merchants: [{ id: a.id, name: a.name }, { id: b.id, name: b.name }],
      metricLabel: `${shared} shared payers (${(overlap * 100).toFixed(1)}%)`,
      severity: overlap >= 0.2 ? 'HIGH' : 'MEDIUM',
    });
  }

  return { rings, linkedMerchantIds: [...linked] };
}
