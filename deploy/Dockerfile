FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN python3 -m venv /app/.venv && /app/.venv/bin/pip install --no-cache-dir -r ml/requirements.txt || true
RUN npm run build
RUN useradd --create-home --uid 10001 mre && chown -R mre /app
USER mre
VOLUME /app/backend/data
EXPOSE 8787 8790
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8787/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "backend/src/server.ts"]
