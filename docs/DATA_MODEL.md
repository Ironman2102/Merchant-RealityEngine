# Data model

Types live in `frontend/src/types`.

- **PaymentEvent** (`payment.ts`): one sale, refund, transfer, settlement or chargeback, with event, settle and ingest time kept apart.
- **MerchantProfile** (`merchant.ts`): the declaration. `undeclared` lists fields the PA did not supply; they are never tested.
- **ContextPassport** (`merchant.ts`): a declared change for one `linkId` and period, with a document and a status.
- **EvidenceItem** (`evidence.ts`): one detector's result: status, log-likelihood, `signal` (profile or conduct), test, p, effect, n.
- **InvestigationResult** (`investigation.ts`): evidence and fusion for the headline `scope`, every stream's result, and `suspectLinks`.

The server stores pseudonymised events, never the raw upload.
