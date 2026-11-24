# Run

```bash
npm ci
npm run dev:users
npm run api          # http://127.0.0.1:8787
npm run dev          # http://localhost:5173
```

Docker (one container; the model runs inside the API process):

```bash
cp deploy/.env.example deploy/.env   # then set MRE_HASH_KEY to the output of: openssl rand -hex 32
docker compose -f deploy/docker-compose.yml up --build
```

Netlify needs `MRE_HASH_KEY`, `MRE_SESSION_SECRET` (16+ characters) and `MRE_BOOT_USERS` as `name:password:role,...` with one
account per person. The server refuses to start, and the function refuses to serve, with a missing key on a host, a short, guessable or
placeholder secret, or a placeholder password. Webhook secrets need 16+ characters too, or nothing is sent. Changing `MRE_HASH_KEY`
changes every pseudonym and invalidates every seal (the server will then refuse to start on that database), so set it before
there is data to keep. `MRE_ML_URL` (default `http://127.0.0.1:8790`) and Daytona env vars are optional for the Stage 2 ML second-opinion scorer; if offline, the Bayesian engine still scores normally with `ml: null`. Cases on Netlify live in
a temporary `/tmp/mre.db` database and can vanish between requests: demo from a laptop.
