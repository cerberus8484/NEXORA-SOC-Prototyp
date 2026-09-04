#!/usr/bin/env bash
# One-command local Nexora Prototype installer for WSL without Docker.
# It uses in-memory storage: local data is lost when the backend is stopped.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="$HOME/.local/state/nexora-wsl"
NVM_DIR="$HOME/.nvm"
ADMIN_EMAIL="admin@nexora.example"
ADMIN_PASSWORD="DevAdmin123!"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

[ "$(uname -s)" = "Linux" ] || fail "Run this installer inside a WSL Linux terminal."

if ! command -v curl >/dev/null 2>&1; then
  command -v sudo >/dev/null 2>&1 || fail "curl is missing and sudo is not available."
  sudo apt-get update
  sudo apt-get install -y curl
fi

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "==> Installing Linux Node version manager"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh | bash
fi

# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"
nvm install 20
nvm alias default 20 >/dev/null
nvm use 20 >/dev/null

NPM_BIN="$(command -v npm)"
case "$NPM_BIN" in
  /mnt/*|/c/*|*'.exe') fail "Windows npm was selected instead of Linux npm." ;;
esac

mkdir -p "$STATE_DIR"

echo "==> Installing Nexora backend"
( cd "$REPO_ROOT/backend" && "$NPM_BIN" ci --no-audit --no-fund )

if ! curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then
  echo "==> Starting Nexora backend"
  (
    cd "$REPO_ROOT/backend"
    nohup env DB_ENABLED=false NODE_ENV=development PORT=3000 \
      CORS_ORIGINS=http://localhost:5173 ADMIN_EMAIL="$ADMIN_EMAIL" \
      ADMIN_PASSWORD="$ADMIN_PASSWORD" JWT_SECRET=local-wsl-test-secret \
      "$NPM_BIN" run dev > "$STATE_DIR/api.log" 2>&1 &
    echo $! > "$STATE_DIR/api.pid"
  )
fi

echo "==> Installing Nexora frontend"
( cd "$REPO_ROOT/frontend" && "$NPM_BIN" ci --no-audit --no-fund )

if ! curl -fsS http://127.0.0.1:5173/login >/dev/null 2>&1; then
  echo "==> Starting Nexora frontend"
  (
    cd "$REPO_ROOT/frontend"
    nohup "$NPM_BIN" run dev -- --host 127.0.0.1 > "$STATE_DIR/web.log" 2>&1 &
    echo $! > "$STATE_DIR/web.pid"
  )
fi

echo "==> Waiting for Nexora"
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1 \
    && curl -fsS http://127.0.0.1:5173/login >/dev/null 2>&1 \
    && curl -fsS -X POST http://127.0.0.1:3000/api/v1/auth/login \
      -H 'Content-Type: application/json' \
      --data "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null 2>&1; then
    echo ""
    echo "=============================================="
    echo "  NEXORA PROTOTYPE IS READY"
    echo "  URL:      http://localhost:5173/login"
    echo "  Username: $ADMIN_EMAIL"
    echo "  Password: $ADMIN_PASSWORD"
    echo "=============================================="
    exit 0
  fi
  sleep 2
done

echo "ERROR: Nexora did not become ready within three minutes." >&2
echo "Backend log:  $STATE_DIR/api.log" >&2
echo "Frontend log: $STATE_DIR/web.log" >&2
exit 1
