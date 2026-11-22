# Architecture

| Layer | Job | Code |
|---|---|---|
| L1 Ingest & Lineage | Normalise feeds, link refunds, pseudonymise, map coverage | `data/dataset.ts`, `utils/ingest.ts`, `adapters/` |
| L2 Merchant Profile | Category norm, festival calendar, verified passports | `engines/residualEngine.ts`, `engines/passport.ts` |
| L3 Detection | Statistical tests on the account, each QR and the repeat-payer group | `engines/detectors.ts`, `engines/streams.ts` |
| L4 Evidence Fusion | Log-odds, shrinkage, gate, ASK | `engines/evidenceFusion.ts` |
| L5 Analyst Review | Honest story against front story | `engines/analystEngine.ts` |
| L6 Governed Response | Six levels, narrow scope, two people | `engines/responseEngine.ts`, `backend/src/workflow.ts` |
| L7 Audit & Learning | Sealed hash chain, labels, approved calibration | `backend/src/store.ts`, `backend/src/improverApi.ts` |

## Rules that hold everywhere

1. Missing data has weight 0 in both directions.
2. The declaration chooses the category row. Calm results against that row earn a quarter of their weight, and conduct tests ignore it.
3. An unknown category abstains. It is not treated as a local shop.
4. Every detector is `profile` (a change could explain it) or `conduct` (it could not). Match timing becomes conduct only with distant payers.
5. A signal built from others (H3) measures only their co-occurrence, is shrunk when they fire and is not an independent family.
6. k streams tested lowers each stream's prior log-odds by ln(k).
7. The merchant is scored without passports first. If a conduct signal fires in any scope, that score stands and the passports are suspended.
   Otherwise a passport sets covered payments aside from profile tests, without counting them as innocent. One applies per QR at a
   time. An answered question is written into the case's reason.
8. Restriction needs an identified link. Otherwise the recommendation stops at due diligence.

## Case gate

`P ≥ 0.10` and `conduct ≥ 1` and (`sources ≥ 2` or `families ≥ 3` or `conduct behaviours ≥ 2`).
Otherwise ASK when a conduct signal fired, or when `P ≥ 0.01` with signals in two families.

All numbers are in `rules/engine.json` and `rules/detectors.json`.
