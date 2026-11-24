FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN useradd --create-home --uid 10001 mre && mkdir -p backend/data && chown -R mre /app
USER mre
ENV HOST=0.0.0.0
VOLUME /app/backend/data
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8787/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "backend/src/server.ts"]
