# Nexora Data Plane — Intake-Server + Outbox-Worker + Collector-Hub (gleiches Image, anderer CMD).
FROM node:20-alpine
WORKDIR /app

# openssh-client: der Collector-Hub (ADR-036) zieht Logs per read-only `ssh tail` von den Quellen.
RUN apk add --no-cache openssh-client

# Nur Manifeste zuerst (Layer-Cache), dann Prod-Deps.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

ENV PORT=8081
EXPOSE 8081

# Healthcheck ohne Extra-Tools: Node-Einzeiler gegen /health.
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8081) +'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/intake/main.js"]
