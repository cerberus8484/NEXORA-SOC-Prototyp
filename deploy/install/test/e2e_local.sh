#!/bin/sh
# P_INSTALL_1 Slice 2 — lokale E2E-Harness für den Bootstrap-Credential-Handoff.
#
# Fährt bootstrap.sh REAL gegen einen lokalen Mock-Server (127.0.0.1, ephemerer
# Port) und beweist:
#   - agent.env enthält das Node-Credential, aber NIE den Enrollment-Token
#   - Heartbeat mit Node-Credential → 200
#   - Heartbeat mit Enrollment-Token → 401
#
# Kein echter Host, kein Lab, kein systemd-Dienst (systemctl wird gestubbt →
# Nicht-Loop-Pfad), kein dauerhafter Prozess, alle temporären Dateien werden
# beim Beenden entfernt.
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
INSTALL_SRC=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)

umask 077  # temporaeres Verzeichnis nur fuer den aktuellen Nutzer lesbar
TMP=$(mktemp -d 2>/dev/null || mktemp -d -t nexora-e2e)
PORTFILE="$TMP/port"
AGENT_DIR="$TMP/agent"
mkdir -p "$AGENT_DIR" "$TMP/bin"

# systemctl-Stub erzwingt den Nicht-Loop-Pfad — es startet KEIN dauerhafter Agent.
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/systemctl"
chmod +x "$TMP/bin/systemctl"
PATH="$TMP/bin:$PATH"

SRV_PID=""
cleanup() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null || true
  rm -rf "$TMP" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

fail() { echo "E2E FAIL: $1" >&2; exit 1; }

# ── Mock-Server starten ────────────────────────────────────────────────────
node "$SCRIPT_DIR/mock_server.js" "$PORTFILE" &
SRV_PID=$!

i=0
while [ ! -s "$PORTFILE" ] && [ "$i" -lt 50 ]; do i=$((i + 1)); sleep 0.1; done
[ -s "$PORTFILE" ] || fail "Mock-Server lieferte keinen Port"
PORT=$(cat "$PORTFILE")
SERVER="http://127.0.0.1:$PORT"

# ── Bootstrap real ausführen (Enrollment-Token nur im Request) ─────────────
sh "$INSTALL_SRC/bootstrap.sh" --server "$SERVER" --token "enr_fake_e2e_token" --dir "$AGENT_DIR" >/dev/null 2>&1 \
  || fail "bootstrap.sh Exit != 0"

ENV="$AGENT_DIR/agent.env"
[ -f "$ENV" ] || fail "agent.env fehlt"
grep -q "NEXORA_NODE_CREDENTIAL=ncr_" "$ENV" || fail "kein Node-Credential in agent.env"
grep -q "enr_" "$ENV" && fail "Enrollment-Token-Material (enr_) in agent.env"
grep -q "NEXORA_TOKEN" "$ENV" && fail "NEXORA_TOKEN in agent.env"

# ── Heartbeat wie der Agent: nur mit Node-Credential ───────────────────────
CRED=$(sed -n 's/^NEXORA_NODE_CREDENTIAL=//p' "$ENV")
NID=$(sed -n 's/^NEXORA_NODE_ID=//p' "$ENV")

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SERVER/api/v1/provisioning/nodes/$NID/heartbeat" \
  -H "Authorization: Bearer $CRED" -H 'Content-Type: application/json' -d '{"status":"healthy"}')
[ "$CODE" = "200" ] || fail "Heartbeat mit Node-Credential ergab $CODE (erwartet 200)"

CODE2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SERVER/api/v1/provisioning/nodes/$NID/heartbeat" \
  -H "Authorization: Bearer enr_fake_e2e_token" -H 'Content-Type: application/json' -d '{"status":"healthy"}')
[ "$CODE2" = "401" ] || fail "Enrollment-Token-Heartbeat ergab $CODE2 (erwartet 401)"

echo "E2E OK: agent.env credential-only · Heartbeat(Credential)=200 · Heartbeat(EnrollToken)=401"
