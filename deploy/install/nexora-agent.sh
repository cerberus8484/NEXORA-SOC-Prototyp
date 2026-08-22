#!/bin/sh
# Nexora Provisioning Agent (P_INSTALL_1)
#
# Sendet periodisch einen Heartbeat mit read-only Systemdaten. Liest NUR
# (Hostname, Kernel, Adressen) und veraendert NIE die Host-Konfiguration.
# Authentifizierung ausschliesslich ueber das Node-Credential (Bearer) — NIE
# ueber den Enrollment-Token. Antwort des Servers wird nicht ausgewertet/
# ausgefuehrt — es gibt keinen Command-/Apply-Kanal.
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/agent.env"   # NEXORA_SERVER, NEXORA_NODE_ID, NEXORA_NODE_CREDENTIAL

INTERVAL="${NEXORA_INTERVAL:-60}"

ips_json() {
  hostname -I 2>/dev/null | awk '{o="";for(i=1;i<=NF;i++)o=o (i>1?",":"") "\"" $i "\"";print "[" o "]"}'
}

while true; do
  KERNEL=$(uname -r)
  IPS=$(ips_json); [ -n "$IPS" ] || IPS='[]'
  BODY=$(printf '{"status":"healthy","version":"%s","ips":%s}' "$KERNEL" "$IPS")

  # Best-effort: ein verpasster Heartbeat darf den Loop nie abbrechen.
  # Das Node-Credential geht ueber eine stdin-Config (-K -) statt als -H-Argument
  # in die Kommandozeile — so ist es nicht via ps / /proc/PID/cmdline sichtbar.
  printf 'header = "Authorization: Bearer %s"\n' "$NEXORA_NODE_CREDENTIAL" | \
    curl -fsS -K - -X POST "$NEXORA_SERVER/api/v1/provisioning/nodes/$NEXORA_NODE_ID/heartbeat" \
      -H 'Content-Type: application/json' \
      -d "$BODY" >/dev/null 2>&1 || true

  sleep "$INTERVAL"
done
