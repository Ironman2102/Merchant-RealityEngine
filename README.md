# Merchant Reality Engine (MRE)

https://merchant-reality-engine.netlify.app

An interactive prototype of a merchant-intelligence platform for Payment Aggregators and payment-risk teams.
It asks one question: **does this merchant behave like the business it claims to be?**


The project has three connected experiences:

- **Public website** (`/`, `/architecture`): the product story, the seven-layer architecture and the technology.
- **Guided demo** (`/demo/*`): four deterministic, prebuilt merchant scenarios. Run one and inspect all seven layers and its final result inside the demo.
- **AI Engine** (`/ai-engine/*`): upload a dataset, run server-side analysis, review evidence, record a proposed response and label, and return to saved case summaries.
- **Offline Python prototype** (`./start.sh prototype`): a separate synthetic-data experiment; its multi-merchant report is not part of the web app.
> **Everything is synthetic.** Merchants, transactions, websites, crawler snapshots and portfolio figures are fabricated and deterministic. Nothing is verified real-world evidence. There are no customers, partners or performance claims. The response design is a product proposal, not a statement of legal or regulatory requirements, and nothing freezes real money.

## Measured on the synthetic portfolio

These figures are copied from the report files. They are synthetic. They are not real-world accuracy.

| Figure | Value | Source |
|---|---|---|
| Recall | 0.903 (65/72), Wilson 0.813–0.952 | `reports/benchmark.md` |
| Precision | 1.000 (65/65), Wilson 0.944–1.000 | `reports/benchmark.md` |
| Genuine-merchant false-positive rate | 0.000 (0/928), Wilson 0.000–0.004 | `reports/benchmark.md` |
| Telegram (no-website) recall | 0.857 (12/14), Wilson 0.601–0.960 | `reports/benchmark.md` |
| M1 AUC-PR | 1.000, bootstrap 1.000–1.000 | `reports/model-comparison.md` |
| Bayesian AUC-PR | 0.996, bootstrap 0.982–1.000 | `reports/model-comparison.md` |
| Opened queue | 65 cases, expected false alarms 1.68 | `reports/benchmark.md` |

The trained model is a second opinion. It does not choose the action. Throughput on this machine is in `reports/perf.md`. The red-team rate is in `reports/redteam.md`.

## Run it

Use `./start.sh` to start the web app (Node.js 20+). To run the separate offline Python prototype, install its dependencies with `python3 -m pip install -r prototype/requirements.txt` and run `./start.sh prototype`.

for windows user :

Requires Node.js 20 or later.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run selftest   # run the engines on all four scenarios and print results
```

No API keys or accounts are needed for the synthetic demo. Analyze sends the dataset to the local investigation API in `backend/`.

## Routes

| Route | What it is |
|---|---|
| `/` | Homepage: problem, approach, seven-layer explorer, technology, use cases, differentiation |
| `/architecture` | Architecture, design principles, prototype scope versus production |
| `/demo` | Four prebuilt scenarios and their seven-layer demo results |
| `/demo/investigations` | Seven-layer run for the selected demo merchant |
| `/demo/portfolio` | Results for the four demo merchants only |
| `/demo/merchant`, `/demo/graph`, `/demo/detection`, `/demo/patterns` | Demo merchant profile and evidence views |
| `/demo/analyst`, `/demo/response`, `/demo/audit` | Simulated analyst review, response and audit |
| `/ai-engine` | Saved server case list and current analysis status |
| `/ai-engine/analyze` | Upload a merchant dataset. The API in `backend/` runs the analysis and stores the case |
| `/ai-engine/cases/{id}` | Persistent case summary, evidence, analyst review, proposed response and audit |
| `/ai-engine/portfolio` | The single latest uploaded analysis; empty before the first run |
| `/ai-engine/investigations`, `/ai-engine/merchant`, `/ai-engine/graph`, `/ai-engine/detection`, `/ai-engine/patterns` | Findings for the latest uploaded dataset only; require a completed run |
| `/ai-engine/analyst`, `/ai-engine/response`, `/ai-engine/audit` | Review and action tools scoped to the latest uploaded dataset only |

The old `/demo/upload` link redirects to `/ai-engine/analyze`. The demo's four-merchants scenario pages remain under `/demo`.

## Scenarios

| Scenario | What it shows | Expected result |
|---|---|---|
| Sweet Crumbs Bakery (default) | Betting collections behind a bakery | Case opened; transaction laundering leads; L3 disables one link, POS stays live |
| Merchant rotation | Dormant account replaced by a similar one | Case opened; rotation leads |
| Fabricated commercial substance | Online store that cannot substantiate sales | Case opened on four independent families; outcome stays unresolved |
| Legitimate Diwali growth | Real 3× festival surge | **No case opened.** The volume alarm is explained |

The demo and AI Engine use separate state. Demo pages show only their four built-in merchants. The AI Engine sends uploaded canonical JSON to the backend, which stores local case records and serves the saved case list. The optional Python prototype uses its own committed synthetic CSV dataset and runs offline; its report is not served by the web app.

## How it works in brief

1. In the guided demo, deterministic generators (`frontend/src/data/transactions.ts`) create event stores from fixed seeds.
2. `runInvestigation` (`frontend/src/engines/investigationEngine.ts`) is a pure function: same scenario in, same result out.
3. Detectors compute their results from the records (residuals, CUSUM, round-number heaping, geographic mismatch, pre-match funding lift against a same-clock-time control, refund reconciliation, beneficiary changes, cohort continuity and more). Nothing about the final verdict is hard-coded.
4. Fusion collapses correlated signals, excludes UNKNOWN, weights by reliability and fake difficulty, applies the two-independent-family gate and ranks four mechanism hypotheses.
5. The UI reveals layer results progressively; analyst notes, proposed responses, labels and audit history are recorded by the backend.
6. The optional offline Python prototype in `prototype/` reads its own sample CSV feeds and applies hand-set evidence-family rules. It is separate from the user-upload workspace and is not a trained machine-learning model.

## Project layout

```text
package.json, package-lock.json, vite.config.ts, tsconfig.json, start.sh
frontend/
  index.html
  public/       static assets, sample datasets and flowchart assets
  src/
    components/
    data/
    engines/
    hooks/
    layers/
    pages/
    styles/
    types/
    utils/
backend/        HTTP API, server-side analysis entry point, adapter and case store
api/            Vercel adapter for the backend bundle
api-src/        pointer to the maintained backend location
docs/           project and data documentation
prototype/      separate offline Python experiment and generated output
scripts/        sample export and engine self-test
archive/legacy-frontend/  preserved, inactive root-level frontend copy
```
Stack: React 18, TypeScript, Vite, Tailwind CSS v4, Recharts, React Flow (`@xyflow/react`), Lucide, React Router.

## Known limitations

- 25 of the 112 catalogued detection patterns run as live statistical detectors in the Bayesian engine, alongside 10 solution and betting patterns (`S1–S7`, `N1–N3`); the remaining catalogue slots are design counts.
- Category norms (`rules/mcc.json`) and initial detector sensitivities/false-positive rates (`rules/detectors.json`) are expert priors until calibrated on real labelled merchants in a shadow pilot.
- Trained ML models (`M1` LightGBM with TreeSHAP and `nn-v0` Neural Network) are trained on the 1,000-merchant synthetic portfolio and serve strictly as a second opinion; they never override the governed Bayesian decision.
- Website, domain-category and purchaser-verification data are synthetic fixtures. No external site is contacted.
- Controlled self-improvement (`T14` Bayesian label learning and `T15–T16` red-team rule proposals with Wilson CIs and McNemar backtests) requires explicit maker/checker approval by a distinct reviewer/admin; the engine never modifies its own rules autonomously.
- The evidence pack produces draft FIU-IND STR facts and RBI PA Master Direction mappings for the Principal Officer to review; it is not an automatic portal filing.
