# What we claim, where it is tested, and where it stops

Say the claim only with its limit. Tests run with `npm test`. All data is synthetic.

| Claim | Test (`tests/engine/`) | Limit |
|---|---|---|
| A restriction, and lifting it, takes two people | `retest`, `open-items` | People are accounts. Two accounts for one person would pass |
| Doing less than recommended, or labelling a case or question, takes two people | `claims`, `open-items` | A new upload is a new case. It does not close the old one, which stays open |
| An approver approves what they saw | `claims` | Over HTTP. In-process callers may omit it |
| A change is a question, and a case needs conduct | `audit-fixes`, `properties` | Honest merchants can still open a case: 5 of 10,800 on fresh seeds |
| A passport never moves a score that has conduct | `retest` | A forged document can answer a question where no conduct fired |
| Passports: two humans, one per QR at a time, revocable | `open-items` | Nobody here can authenticate a document |
| Restrictions follow the merchant | `open-items` | They follow the merchant id. A new id starts clean |
| Database tampering is detected | `claims` | Not with the server key, not an old copy of the whole database, not delivery logs or rules files |
| Identifiers are pseudonymised or masked | `claims`, `adapters` | Merchant and QR ids are kept. Names in free text are not detected |
| A client sees only its own cases | `retest`, `open-items`, `claims` | A client is a key name. Merchant ids are shared across the aggregator |
| The same file gives the same score on any host | `claims`, `properties` | Under the same rules version and verified passports |
| A cleared or no-case merchant gets no suspicion draft | `claims` | A draft for an open case still needs the Principal Officer |
| Bad export rows do not drop a merchant | `claims` | Skipped rows are counted, not repaired. No sales means no score |
| Batch uses the live rules and verified passports | `retest` | Batch results do not become cases in the console |
| Rules rollback takes two people | `open-items` | An operator at the server has an audited emergency stop |
| A QR is scored on its own | `audit-fixes` | 30+ payments, the 50 busiest. Splitting across QRs loses the link-only action |
| Large ledgers are scored | `retest` (250,000 rows) | An HTTP upload is capped at 6 MB |

## Do not claim

- Tamper-proof, secure or penetration-tested.
- Better than rules. A one-line rule opens more cases when payer location is missing (`docs/JUDGE_QA.md`).
- That a side business cannot hide, or that identifier changes are followed.
- That anything is sent, disabled, held or appealed. MRE records the decision.
- Network detection. The graph is a picture.
- Real-world accuracy.
