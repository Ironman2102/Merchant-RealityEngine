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
account per person. The Daytona and `MRE_ML_URL` variables are no longer used and should be removed. Cases on that host live in
a temporary database and can vanish between requests: demo from a laptop.
