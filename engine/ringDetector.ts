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

export function detectRings(scenarios: readonly Scenario[]): RingReport {
  if (scenarios.length < 2) return { rings: [], linkedMerchantIds: [] };

  const byBeneficiary = new Map<string, Map<string, string>>();
  const payersByMerchant = new Map<string, { name: string; payers: Set<string> }>();

  for (const sc of scenarios) {
    const mid = sc.profile.id;
    const mname = sc.profile.name;
    const payers = new Set<string>();
    for (const ev of sc.events) {
      if (ev.type === 'SALE' && ev.payerHash) payers.add(ev.payerHash);
      if ((ev.type === 'SETTLEMENT' || ev.type === 'TRANSFER') && ev.beneficiaryHash) {
        const acct = ev.beneficiaryHash.trim();
        if (!acct) continue;
        if (!byBeneficiary.has(acct)) byBeneficiary.set(acct, new Map());
        byBeneficiary.get(acct)!.set(mid, mname);
      }
    }
    payersByMerchant.set(mid, { name: mname, payers });
  }

  const rings: RingLink[] = [];
  const linked = new Set<string>();

  for (const [acct, mMap] of byBeneficiary.entries()) {
    if (mMap.size < 2) continue;
    const merchants = [...mMap.entries()].map(([id, name]) => ({ id, name }));
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

  const mids = [...payersByMerchant.keys()];
  for (let i = 0; i < mids.length; i++) {
    for (let j = i + 1; j < mids.length; j++) {
      const a = payersByMerchant.get(mids[i])!;
      const b = payersByMerchant.get(mids[j])!;
      if (a.payers.size < 3 || b.payers.size < 3) continue;
      let shared = 0;
      for (const p of a.payers) if (b.payers.has(p)) shared++;
      if (shared >= 3) {
        const minSize = Math.min(a.payers.size, b.payers.size);
        const overlap = shared / minSize;
        if (overlap >= 0.05 || shared >= 5) {
          linked.add(mids[i]);
          linked.add(mids[j]);
          rings.push({
            kind: 'N5_PAYER_OVERLAP',
            key: `n5-${mids[i]}-${mids[j]}`,
            label: `Payer cohort overlap (${a.name} ↔ ${b.name})`,
            merchants: [{ id: mids[i], name: a.name }, { id: mids[j], name: b.name }],
            metricLabel: `${shared} shared payers (${(overlap * 100).toFixed(1)}%)`,
            severity: overlap >= 0.2 ? 'HIGH' : 'MEDIUM',
          });
        }
      }
    }
  }

  return { rings, linkedMerchantIds: [...linked] };
}
