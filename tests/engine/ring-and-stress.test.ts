/**
 * Unit & edge-case tests for `engine/ringDetector.ts` (N4 shared beneficiary & N5 payer overlap)
 * and invariants over the 1,200-dataset stress benchmark.
 * Returns the number of failed assertions.
 */
import fs from 'fs';
import path from 'path';
import { detectRings } from '../../engine/ringDetector';
import { datasetToScenario } from '../../frontend/src/data/dataset';
import type { Scenario } from '../../frontend/src/types/merchant';

function mkSc(id: string, opts: { payers?: string[]; ben?: string } = {}): Scenario {
  const payers = opts.payers ?? [`${id}-P1`, `${id}-P2`, `${id}-P3`, `${id}-P4`];
  const raw = {
    format: 'mre-dataset/v1',
    merchant: {
      id, name: `Shop ${id}`, city: 'Bengaluru, KA', mcc: '5462', category: 'Bakeries',
      ticketMin: 50, ticketMax: 2000, baselineWeekly: 50000, accountAgeDays: 100,
      hours: [7, 22], localStates: ['KA'],
    },
    weeklySales: Array.from({ length: 8 }, (_, i) => ({ week: `W${i + 1}`, actual: 50000, seasonalMultiplier: 1 })),
    transactions: [
      ...payers.map((p, i) => ({
        id: `${id}-S-${i}`, merchantId: id, type: 'SALE', amount: 500,
        time: `2026-06-0${(i % 7) + 1}T12:00:00+05:30`, channel: 'UPI_LINK',
        ...(p === '__ANON__' ? {} : { payerId: p }),
      })),
      {
        id: `${id}-SET`, merchantId: id, type: 'SETTLEMENT', amount: 10000,
        time: '2026-06-08T12:00:00+05:30', channel: 'BANK',
        beneficiaryAccount: opts.ben ?? `BEN-${id}`,
      },
    ],
  };
  const r = datasetToScenario(raw);
  if (!r.ok || !r.scenario) throw new Error(r.errors.join('; '));
  return r.scenario;
}

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); }
    else console.log(`  ✓ ${name}`);
  };

  check('detectRings: <2 scenarios returns empty', detectRings([]).rings.length === 0 && detectRings([mkSc('A')]).rings.length === 0);

  // N4 shared beneficiary
  const n4 = detectRings([mkSc('A', { ben: 'SHARED-BEN' }), mkSc('B', { ben: 'SHARED-BEN' }), mkSc('C', { ben: 'OTHER-BEN' })]);
  check('detectRings: N4 flags shared beneficiary between A & B only',
    n4.rings.some(r => r.kind === 'N4_SHARED_BENEFICIARY' && r.merchants.length === 2 && r.severity === 'HIGH') &&
    n4.linkedMerchantIds.includes('A') && n4.linkedMerchantIds.includes('B') && !n4.linkedMerchantIds.includes('C'));

  // N5 payer cohort overlap (>=3 shared & >=20% -> HIGH; <3 shared -> none)
  const n5 = detectRings([
    mkSc('X', { payers: ['SP1', 'SP2', 'SP3', 'UX1'] }),
    mkSc('Y', { payers: ['SP1', 'SP2', 'SP3', 'UY1'] }),
  ]);
  check('detectRings: N5 flags >=3 shared payers as HIGH (>=20% overlap)',
    n5.rings.some(r => r.kind === 'N5_PAYER_OVERLAP' && r.severity === 'HIGH'));

  const disjoint = detectRings([
    mkSc('D1', { payers: ['A1', 'A2', 'A3', 'SH1', 'SH2'] }),
    mkSc('D2', { payers: ['B1', 'B2', 'B3', 'SH1', 'SH2'] }),
  ]);
  check('detectRings: 2 shared payers (<3 threshold) does not trigger N5', disjoint.rings.length === 0);

  // Anonymous POS edge: two shops with 2 distinct named payers + anonymous sales ('—') must NOT count '—' as a shared payer!
  const anonRing = detectRings([
    mkSc('AN1', { payers: ['U1', 'U2', '__ANON__', '__ANON__', '__ANON__'] }),
    mkSc('AN2', { payers: ['V1', 'V2', '__ANON__', '__ANON__', '__ANON__'] }),
  ]);
  check('detectRings: anonymous payer placeholder "—" alone does not trigger N5',
    anonRing.rings.length === 0, JSON.stringify(anonRing.rings));

  // Verify 1,200-dataset stress benchmark invariants when report is present
  const reportPath = path.resolve(process.cwd(), 'reports/benchmark-1k-results.json');
  if (fs.existsSync(reportPath)) {
    const rep = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    check('benchmark-1k: >= 1000 cases evaluated cleanly',
      rep.summary?.total >= 1000 &&
      rep.summary?.parseErrors === 0 &&
      rep.summary?.nanErrors === 0 &&
      rep.summary?.ciViolations === 0,
      JSON.stringify(rep.summary));
  }

  return bad;
}
