# Backend

The API used by the AI Engine. `./start.sh` runs it on `127.0.0.1:8787`.

| Route (under `/api`) | Who | Purpose |
|---|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | anyone | Sign in and out |
| `GET`, `POST /investigations` | signed in | List, or analyse and open a case |
| `GET /investigations/{id}` + `/trace`, `/pack`, `/audit`, `/passport` | signed in | Read |
| `POST /investigations/{id}/review`, `/response`, `/label` | by role | Record. Restrictions, any change to one in force, and two-person labels wait. `{reject:true}` rejects or withdraws a label |
| `POST /investigations/{id}/approve` | a different person, by role; the proposer may only withdraw | Approve or reject. An approval sends the proposal's `proposedAt` and `level` |
| `POST /investigations/{id}/passport` | analyst, reviewer, admin | Record a declared change |
| `POST /investigations/{id}/passport-review` | a different reviewer or admin | Verify and re-score |
| `GET /rules/status`, `POST /rules/proposals/run` | signed in | Status; request a change |
| `POST /investigations/{id}/passport` with `{endorse: id}` | analyst, reviewer, admin | Take on a passport that came through the API |
| `POST /investigations/{id}/passport-revoke` | reviewer or admin, with a reason | Revoke, and re-score every case it answered |
| `POST /rules/proposals/{id}/approve`, `/promote` | a different reviewer or admin | Govern rules |
| `POST /rules/rollback` | two different reviewers or admins | The first asks, the second confirms. `{reject:true}` closes the request |
| `/v1/*` | service key | Scoring and batch, see `openapi.yaml` |

A `/v1` client is a key name. A key reads only cases and batches created under the same name, so give a replacement or read-only key
the client's name, and never give two clients the same one. Batches use the same promoted rules and verified passports as the server.
A restriction follows the merchant id to every case. Restrictions add up. An approved response that restricts nothing lifts all of
them, and needs the approval of the most severe. Merchant ids are the payment aggregator's: one id is one merchant for all its
clients. Staff see everything. A client gets the passports verified on its own cases and the aggregator's, without other cases'
documents, and is never shown other cases.

Single sign-on accounts belong to one issuer and subject, and never attach to a local username by themselves. An operator links
one with `npm run mre -- user:link-sso <username> <issuer> <subject>`. Emergency rules stop, at the server only and audited:
`npm run mre -- rollback --reason "<why>"`.

Doing less than the engine recommends, and any label on an open case or question, takes two people.

Security-relevant rows are sealed with `MRE_HASH_KEY` (`src/integrity.ts` lists them and what is not covered). A failed check
refuses writes, exports and scoring with 409. `npm run mre -- verify-db` checks everything and prints a checkpoint to keep elsewhere.
A database from before seals needs `npm run mre -- seal-db --reason "<why>"` once, which vouches for its rows as found.

There is no persona switch. Each person has an account. Limits before a pilot: `docs/FUTURE_BACKEND.md`.
Do not send real payment data to this prototype.
