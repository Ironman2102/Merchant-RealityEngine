# Backend

The API used by the AI Engine. `./start.sh` runs it on `127.0.0.1:8787`.

| Route (under `/api`) | Who | Purpose |
|---|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | anyone | Sign in and out |
| `GET`, `POST /investigations` | signed in | List, or analyse and open a case |
| `GET /investigations/{id}` + `/trace`, `/pack`, `/audit`, `/passport` | signed in | Read |
| `POST /investigations/{id}/review`, `/response`, `/label` | by role | Record; restrictions and two-person labels wait |
| `POST /investigations/{id}/approve` | a different person, by role | Approve or reject |
| `POST /investigations/{id}/passport` | analyst, reviewer, admin | Record a declared change |
| `POST /investigations/{id}/passport-review` | a different reviewer or admin | Verify and re-score |
| `GET /rules/status`, `POST /rules/proposals/run` | signed in | Status; request a change |
| `POST /rules/proposals/{id}/approve`, `/promote`, `POST /rules/rollback` | a different reviewer or admin | Govern rules |
| `/v1/*` | service key | Scoring and batch, see `openapi.yaml` |

There is no persona switch. Each person has an account. Limits before a pilot: `docs/FUTURE_BACKEND.md`.
Do not send real payment data to this prototype.
