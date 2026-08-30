#!/bin/sh
# Nexora Bootstrap Installer (P_INSTALL_1)
#
# Zweck: einen Linux-Host beim Nexora-Backend registrieren und den Heartbeat-
# Agenten einrichten. Es werden AUSSCHLIESSLICH read-only Systemdaten gemeldet
# (Hostname, Kernel, Adressen). Dieses Skript veraendert NIEMALS die Host-
# Konfiguration fuer Adressierung, Namensaufloesung, Paketfilter, Bridging,
# Mitschnitt oder eine Security-Appliance. Es ruft auch keine solchen Werkzeuge.
#
# Credential-Modell (Slice 2):
#   - Der Enrollment-Token wird NUR fuer die einmalige Enrollment-Anfrage genutzt
#     und NIE auf die Platte geschrieben.
#   - Das Backend liefert in der Enrollment-Antwort ein eigenes Node-Credential.
#   - Nur dieses Node-Credential wird root-only gespeichert und fuer Heartbeats
#     verwendet.
#
# Nutzung:
#   sudo ./bootstrap.sh --server https://nexora.example --token enr_xxxxxxxx
#
# Optionen:
#   --server <url>   Backend-Basis-URL (Pflicht)
#   --token  <tok>   Enrollment-Token aus dem Admin-UI (Pflicht, einmalig)
#   --dir    <pfad>  Installationsverzeichnis (Default: /opt/nexora-agent)
set -eu

SERVER=""
TOKEN=""
INSTALL_DIR="/opt/nexora-agent"

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="${2:-}"; shift 2 ;;
    --token)  TOKEN="${2:-}";  shift 2 ;;
    --dir)    INSTALL_DIR="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Nutzung: $0 --server <url> --token <enr_...> [--dir <pfad>]"
      exit 0 ;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$SERVER" ] || { echo "Fehler: --server fehlt" >&2; exit 2; }
[ -n "$TOKEN" ]  || { echo "Fehler: --token fehlt" >&2; exit 2; }

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)

# ── Preflight: nur lesen, nichts veraendern ────────────────────────────────
HOST=$(hostname)
PLATFORM=$(uname -s)
KERNEL=$(uname -r)

# IPv4/IPv6-Adressen als read-only Auskunft (keine Konfigurations-Aenderung).
ips_json() {
  hostname -I 2>/dev/null | awk '{o="";for(i=1;i<=NF;i++)o=o (i>1?",":"") "\"" $i "\"";print "[" o "]"}'
}
IPS=$(ips_json); [ -n "$IPS" ] || IPS='[]'

# ── Enrollment: Token NUR hier verwenden (Body), nie persistieren ──────────
PAYLOAD=$(printf '{"token":"%s","hostname":"%s","platform":"%s","version":"%s","ips":%s,"capabilities":["inventory","heartbeat"]}' \
  "$TOKEN" "$HOST" "$PLATFORM" "$KERNEL" "$IPS")

# Body (enthaelt den Enrollment-Token) ueber stdin uebergeben — so steht der
# Token NICHT in der Prozess-Kommandozeile (ps / /proc/PID/cmdline).
RESP=$(printf '%s' "$PAYLOAD" | curl -fsS -X POST "$SERVER/api/v1/provisioning/enroll" \
  -H 'Content-Type: application/json' \
  --data-binary @-)

NODE_ID=$(printf '%s' "$RESP" | sed -n 's/.*"nodeId":"\([^"]*\)".*/\1/p')
NODE_CRED=$(printf '%s' "$RESP" | sed -n 's/.*"nodeCredential":"\([^"]*\)".*/\1/p')
[ -n "$NODE_ID" ]   || { echo "Fehler: Enrollment lieferte keine nodeId" >&2; exit 1; }
[ -n "$NODE_CRED" ] || { echo "Fehler: Enrollment lieferte kein nodeCredential" >&2; exit 1; }

# ── Agent-Dateien ablegen ──────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/nexora-agent.sh" "$INSTALL_DIR/nexora-agent.sh"
chmod 755 "$INSTALL_DIR/nexora-agent.sh"

# Config nur fuer root lesbar — enthaelt NUR das Node-Credential, NIE den
# Enrollment-Token (der ist nach dem Enrollment verbraucht).
umask 077
cat > "$INSTALL_DIR/agent.env" <<EOF
NEXORA_SERVER=$SERVER
NEXORA_NODE_ID=$NODE_ID
NEXORA_NODE_CREDENTIAL=$NODE_CRED
EOF
chmod 600 "$INSTALL_DIR/agent.env"

# Sensibles aus dem Speicher des Skripts loesen (best-effort).
TOKEN=""; NODE_CRED=""; RESP=""; PAYLOAD=""
echo "Enrollment OK — nodeId=$NODE_ID"

# ── Agent dauerhaft starten (eigener Dienst; keine Netz-/Firewall-Aenderung) ─
if command -v systemctl >/dev/null 2>&1; then
  if cp "$SCRIPT_DIR/nexora-agent.service" /etc/systemd/system/nexora-agent.service 2>/dev/null; then
    systemctl daemon-reload
    systemctl enable --now nexora-agent.service
    echo "Agent als systemd-Dienst gestartet (nexora-agent.service)."
  else
    echo "Hinweis: systemd-Unit konnte nicht installiert werden — bitte manuell starten." >&2
  fi
else
  nohup "$INSTALL_DIR/nexora-agent.sh" >"$INSTALL_DIR/agent.log" 2>&1 &
  echo "Agent im Hintergrund gestartet (kein systemd erkannt)."
fi

echo "Bootstrap abgeschlossen."
