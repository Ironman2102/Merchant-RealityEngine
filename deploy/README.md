# Run

Development, on this machine:

```bash
npm install
npm run api          # http://127.0.0.1:8787
npm run dev          # website on http://localhost:5173
npm run mre -- demo:learn
npm run mre -- rollback
```

Docker, when the daemon is available:

```bash
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.yml up --build
```

`/v1/health` does not need a service key. Scoring does: `npm run mre -- key:create demo score,cases,read`.

If a pinned Python package has no wheel for the image, the Dockerfile records that the install is best-effort (`|| true`) and the API still serves the Bayesian engine.
