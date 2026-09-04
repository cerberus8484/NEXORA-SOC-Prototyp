#!/usr/bin/env bash
# Local Nexora Prototype installer for WSL and Docker Desktop.
#
# This intentionally starts the development stack on 127.0.0.1. It is not a
# production installer: it creates no TLS configuration and exposes no ports
# to the network. Production hosts must use install-prod-fresh.sh instead.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE=(docker compose -f "$REPO_ROOT/docker-compose.dev.yml")

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed or not available in WSL."
command -v curl >/dev/null 2>&1 || fail "curl is not installed."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not available."
docker info >/dev/null 2>&1 || fail "Docker Desktop is not running or WSL integration is disabled."

echo "==> Starting local Nexora Prototype for WSL"
"${COMPOSE[@]}" up -d --build || fail "The local Docker stack could not be started."

echo "==> Waiting for API and web application"
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1 \
    && curl -fsS http://127.0.0.1:5173/login >/dev/null 2>&1 \
    && curl -fsS -X POST http://127.0.0.1:3000/api/v1/auth/login \
      -H 'Content-Type: application/json' \
      --data '{"email":"admin@nexora.example","password":"DevAdmin123!"}' >/dev/null 2>&1; then
    echo ""
    echo "=============================================="
    echo "  NEXORA PROTOTYPE IS READY"
    echo "  URL:      http://localhost:5173/login"
    echo "  Username: admin@nexora.example"
    echo "  Password: DevAdmin123!"
    echo "=============================================="
    exit 0
  fi
  sleep 2
done

echo "ERROR: Nexora did not become ready within three minutes." >&2
echo "The local database may already contain an administrator with a different password." >&2
echo "Run: docker compose -f docker-compose.dev.yml logs --tail=100 api web" >&2
exit 1
