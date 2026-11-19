# Backend and pilot workflow

The active HTTP API and server-side analysis entry point live in `src/`. Uploaded `mre-dataset/v1` JSON is validated, converted to the canonical scenario, analyzed by the deterministic engine, and saved as a case. The AI Engine workspace reads saved case summaries and case detail from this API.

## Run locally

`./start.sh` starts this API on `127.0.0.1:8787` and the Vite app on `localhost:5173`. `npm run api` starts only the API. `npm run build` creates the deployment bundle, but the Vercel handler intentionally returns 503 until authentication and tenant isolation exist.

## Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Service and storage mode |
| GET | `/api/investigations` | List saved cases, newest first |
| POST | `/api/investigations` | Validate a dataset, run analysis, and open a case |
| GET | `/api/investigations/{id}` | Retrieve case summary, workflow, evidence, coverage, and audit |
| POST | `/api/investigations/{id}/review` | Save analyst notes and merchant clarification |
| POST | `/api/investigations/{id}/response` | Record a proposed response and authority checks |
| POST | `/api/investigations/{id}/label` | Record an adjudicated label and learning update |

## Source layout

- `src/adapters/canonicalDataset.ts` is the current manual-upload adapter. Future partner adapters should normalize authorized provider data into `mre-dataset/v1`.
- `src/algorithms/analyze.ts` is the server-side analysis entry point and records the engine version with each case.
- `src/workflow.ts` manages investigation, analyst review, proposed response, labels, and audit events.
- `src/store.ts` persists local cases as JSON files and exposes a case list.
- `src/http.ts` and `src/server.ts` provide the HTTP API and local server.

The analysis uses the explainable rules and statistical checks documented in the root README and `docs/ARCHITECTURE.md`. It does not use a trained model. No payment partner connector is configured yet.

## Pilot readiness limits

The current store is local JSON persistence, suitable for a single-machine development workflow. It is not shared database storage and is not a production deployment configuration. The API does not yet provide user authentication, role-based access, tenant isolation, a secrets vault, encryption-key management, or a live payment action connector. Do not send real personal or payment data until those controls and the partner’s approved access method are in place.

Partner access is intentionally not fabricated. Implement a dedicated adapter only after the partner, authorization, API specification, and permitted data scope are known.
