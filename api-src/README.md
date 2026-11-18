# Investigation API

The website's seven-layer engines run here as an HTTP API. The guided demo stays in the browser. **Analyze a dataset** sends the file to this API, stores a case, and then waits for a human response and a label.

`./start.sh` starts the API on port 8787 and the website on port 5173. The Vite dev server proxies `/api` to the API.

## Workflow

1. `POST /api/investigations` with an `mre-dataset/v1` JSON file. Layers 1–5 run, and the response lists all seven steps.
2. `GET /api/investigations?id={id}` returns that same case.
3. `POST /api/investigations` with `{ "action": "review", "id", "notes", "clarification" }` records the analyst.
4. `POST /api/investigations` with `{ "action": "response", "id", "chosenLevel": "L0"–"L5", "legalVerified", "escrowConfirmed" }` runs the authority gate. L4 and L5 stay blocked until their checks pass.
5. `POST /api/investigations` with `{ "action": "label", "id", "label": "CONFIRMED_ILLICIT" | "ADJUDICATED_BENIGN" | "UNRESOLVED" }` records the outcome and the learning update.

The same steps also work as `/api/investigations/{id}`, `/review`, `/response`, and `/label` when you run the API locally.

On a follow-up call, send the original `dataset` again if this process no longer has the case. The server rebuilds layers 1–5 from it and applies the new step.

Cases are stored in memory and in `api-src/data/` (or `/tmp/mre-cases` on Vercel). That is one machine, not a database.

The files in this folder are the API:

| File | What you are looking at |
|---|---|
| `http.ts` | Routes: open a case, fetch it, review, response, label |
| `workflow.ts` | Runs the seven layers and builds the step-by-step result |
| `store.ts` | Keeps the case in memory and a JSON file |
| `server.ts` | Local server on port 8787 |
| `selfcheck.ts` | Proves open, block, response, and label |
| `bundle-api.mjs` | Packs this folder into one file for the Vercel adapter in `api/` |

```bash
npm run check:api
curl -s -X POST http://127.0.0.1:8787/api/investigations -H 'content-type: application/json' --data-binary @frontend/public/samples/01-sweet-crumbs-betting-front.json
```
