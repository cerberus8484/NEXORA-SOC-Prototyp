#!/usr/bin/env bash
#
# smoke-honeypot-timeline.sh — Dev-Stack-Smoke für die Honeypot-Kette.
#
# Prüft objektiv (read-only) die 4 Checkpoints gegen die laufende Dev-API:
#   Cowrie-Event → Wazuh/Indexer → Ticket → network.flows → network.honeypotSessions → UI
#
# Voraussetzung: Dev-Backend läuft und ist gegen den ECHTEN Wazuh-Indexer
# konfiguriert (WAZUH_INDEXER_URL/USER/PASSWORD), und es existiert ein
# Cowrie-Ticket (interner Honeypot CT 179 empfohlen). KEIN Production-Deploy.
#
# SICHERHEIT: nur GET-Reads (+ ein Login-POST). Keine Secrets im Skript.
#
# Konfiguration (Umgebungsvariablen):
#   API_BASE     (Pflicht)  z.B. http://localhost:3000
#   TICKET_ID    (Pflicht)  ID des Cowrie-Tickets
#   SMOKE_TOKEN  (optional)  Bearer-Token; ODER:
#   SMOKE_USER / SMOKE_PASS  (optional)  Login via POST /api/v1/auth/login (Cookie)
#   EXCLUDE_IPS  (optional)  Komma-Liste IPs, die NICHT Angreifer sein dürfen
#                            (Agent-/Honeypot-/WireGuard-IP) → Checkpoint 1
#
# Nutzung:
#   API_BASE=http://localhost:3000 TICKET_ID=<id> \
#     SMOKE_USER=admin@nexora.example SMOKE_PASS='***' \
#     EXCLUDE_IPS=10.99.99.80,10.99.99.77,10.99.77.1 \
#     bash tools/ops/smoke-honeypot-timeline.sh

set -euo pipefail

: "${API_BASE:?API_BASE erforderlich (z.B. http://localhost:3000)}"
: "${TICKET_ID:?TICKET_ID erforderlich}"
command -v curl >/dev/null 2>&1 || { echo "curl benötigt" >&2; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "jq benötigt" >&2; exit 1; }

BASE="${API_BASE%/}"
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
AUTH=()

if [ -n "${SMOKE_TOKEN:-}" ]; then
  AUTH=(-H "Authorization: Bearer ${SMOKE_TOKEN}")
elif [ -n "${SMOKE_USER:-}" ] && [ -n "${SMOKE_PASS:-}" ]; then
  curl -fsS -c "$JAR" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg e "$SMOKE_USER" --arg p "$SMOKE_PASS" '{email:$e,password:$p}')" \
    "$BASE/api/v1/auth/login" >/dev/null || { echo "Login fehlgeschlagen" >&2; exit 1; }
else
  echo "Auth fehlt: SMOKE_TOKEN ODER SMOKE_USER+SMOKE_PASS setzen" >&2; exit 1
fi

api() { curl -fsS -b "$JAR" "${AUTH[@]}" "$BASE$1"; }

pass=0; fail=0
ok()   { echo "  PASS — $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL — $1"; fail=$((fail+1)); }

echo "== Ticket $TICKET_ID =="
TICKET="$(api "/api/v1/tickets/$TICKET_ID")"
T() { echo "$TICKET" | jq -r "(.data // .).$1 // empty"; }

echo "[1] Ticket trägt echte externe Angreifer-IP"
ATTACKER="$(T attackerIp)"; SRC="$(T srcIp)"; SENSOR="$(T sensorIp)"
echo "    attackerIp=$ATTACKER  srcIp=$SRC  sensorIp=$SENSOR"
if [ -n "$ATTACKER" ]; then ok "attackerIp gesetzt"; else bad "attackerIp leer"; fi
if [ -n "${EXCLUDE_IPS:-}" ]; then
  IFS=',' read -ra EX <<< "$EXCLUDE_IPS"
  badvip=0
  for ip in "${EX[@]}"; do
    if [ "$ATTACKER" = "$ip" ]; then bad "attackerIp == ausgeschlossene IP $ip (Agent/Honeypot/WG)"; badvip=1; fi
  done
  [ "$badvip" = 0 ] && ok "attackerIp ist keine Agent-/Honeypot-/WG-IP"
fi

echo "== Timeline / Network =="
TL="$(api "/api/v1/tickets/$TICKET_ID/timeline")"
NET() { echo "$TL" | jq "$1"; }

echo "[2] Network & NAT — Cowrie-Flow"
CF="$(echo "$TL" | jq '[.network.flows[]? | select(.sourceType=="cowrie")]')"
CFN="$(echo "$CF" | jq 'length')"
if [ "$CFN" -ge 1 ]; then ok "Cowrie-Flow vorhanden ($CFN)"; else bad "kein Cowrie-Flow in network.flows"; fi
if [ "$CFN" -ge 1 ]; then
  echo "$CF" | jq -e '.[0].destinationIp != null' >/dev/null && ok "destinationIp (interne Honeypot-IP) gesetzt" || bad "destinationIp fehlt"
  echo "$CF" | jq -e '.[0].direction=="inbound"' >/dev/null && ok "direction=inbound" || bad "direction nicht inbound"
  echo "$CF" | jq -e '(.[0].service // "") | ascii_downcase | test("ssh|telnet")' >/dev/null && ok "service ssh/telnet" || bad "service nicht ssh/telnet"
fi

echo "[3] Honeypot Sessions"
HS="$(echo "$TL" | jq '.network.honeypotSessions // []')"
HSN="$(echo "$HS" | jq 'length')"
if [ "$HSN" -ge 1 ]; then ok "honeypotSessions gefüllt ($HSN)"; else bad "network.honeypotSessions leer"; fi
if [ "$HSN" -ge 1 ]; then
  echo "$HS" | jq -e '.[0].sessionId != null and .[0].sessionId != ""' >/dev/null && ok "Session-ID vorhanden" || bad "Session-ID fehlt"
  echo "$HS" | jq -e '(.[0].loginAttempts // 0) | type=="number"' >/dev/null && ok "loginAttempts numerisch" || bad "loginAttempts fehlt"
  # KEINE Passwörter im Frontend-Payload (auch kein maskiertes Feld).
  if echo "$HS" | jq -e 'tostring | test("password";"i") | not' >/dev/null; then ok "keine Passwort-Felder im Payload"; else bad "Passwort-Feld im honeypotSessions-Payload!"; fi
fi

echo "[4] API-Form"
echo "$TL" | jq -e '(.network.flows | type)=="array"' >/dev/null && ok "network.flows ist Array (unverändert)" || bad "network.flows fehlt/kein Array"
echo "$TL" | jq -e 'has("network") and (.network | has("honeypotSessions"))' >/dev/null && ok "network.honeypotSessions als separater Block" || bad "honeypotSessions nicht separat"

echo
echo "Ergebnis: $pass PASS / $fail FAIL"
[ "$fail" -eq 0 ]
