# ── Stage 1: Builder ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Nur package-Dateien zuerst (Layer-Caching)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Source kopieren
COPY src/ ./src/

# ── Stage 2: Production Image ─────────────────────────────────
FROM node:20-alpine AS production

# Sicherheit: kein root
RUN addgroup -S socapi && adduser -S socapi -G socapi

WORKDIR /app

# Aus Builder übernehmen
COPY --from=builder --chown=socapi:socapi /app/node_modules ./node_modules
COPY --from=builder --chown=socapi:socapi /app/src ./src
COPY --chown=socapi:socapi package.json ./

# Umgebungsvariablen (keine Secrets hier!)
ENV NODE_ENV=production
ENV PORT=3000

# Kein root-Prozess
USER socapi

EXPOSE 3000

# Healthcheck — /health muss 200 zurückgeben
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["node", "src/server.js"]
