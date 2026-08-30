#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexora Containment — Host-Isolation (ADR-042 Slice 3a, Linux/nftables).
#
# Zweck: Netz-Isolation eines KOMPROMITTIERTEN Hosts (Lateral-Movement rein/raus
# kappen, C2 unterbinden), OHNE den Management-Kanal zu verlieren.
#
# KERN-INVARIANTE (MGMT-PRESERVATION): der Kanal, über den Nexora diesen Host steuert,
# bleibt erreichbar — sonst wäre die spätere Freigabe (release-isolation.sh) nicht mehr
# zustellbar. Zwei sich ergänzende Quellen, damit ein stale/falsch konfiguriertes
# NEXORA_MGMT_CIDR NICHT zur Selbst-Aussperrung führt:
#   1. PRIMÄR: der TATSÄCHLICHE Live-Control-Channel aus $SSH_CONNECTION
#      ("clientIP clientPort serverIP serverPort") — genau die Peer-IP + der echte
#      Server-SSH-Port, über den dieses Skript gerade läuft. Damit stimmt der erhaltene
#      Port zwangsläufig mit dem realen Verbindungsport überein (kein Config-Rateschritt).
#   2. ERGÄNZEND: das deklarierte NEXORA_MGMT_CIDR:NEXORA_MGMT_SSH_PORT (z. B. für HA-
#      Backends/andere Operator-Quellen). Wird zusätzlich erhalten.
#
# Eigenschaften: fail-closed (bricht ohne erhaltbaren Kanal / ohne nft ab), idempotent
# (Tabelle wird atomar zurückgesetzt), self-verifying (Exit 0 NUR nach struktureller
# Prüfung der Preservation-Regeln). Keine CLI-Argumente — Parameter kommen als validierte
# ENV über stdin (sshExecRunner-Preamble).
#
# ACHTUNG: root-Firewall-Eingriff. Vor Scharfschaltung LAB-Smoke + Security-Review.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MGMT_CIDR="${NEXORA_MGMT_CIDR:-}"
MGMT_PORT="${NEXORA_MGMT_SSH_PORT:-22}"
TABLE="inet nexora_containment"
IPV4_CIDR_RE='^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(/[0-9]{1,2})?$'
IPV4_RE='^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'
PORT_RE='^[0-9]{1,5}$'

log()  { echo "==> [nexora-containment] $*"; }
fail() { echo "!! [nexora-containment] $*" >&2; exit 1; }

# ── Live-Control-Channel aus der laufenden SSH-Session ableiten (Primärquelle) ─
CTRL_IP=""; CTRL_PORT=""
if [ -n "${SSH_CONNECTION:-}" ]; then
  # shellcheck disable=SC2206
  _conn=(${SSH_CONNECTION})
  _ip="${_conn[0]:-}"; _port="${_conn[3]:-}"
  if [[ "$_ip" =~ $IPV4_RE ]] && [[ "$_port" =~ $PORT_RE ]]; then
    CTRL_IP="$_ip"; CTRL_PORT="$_port"
  fi
fi

# ── Vorbedingungen (fail-closed) ─────────────────────────────────────────────
# Der Runner erzwingt bereits NEXORA_MGMT_CIDR (Selbst-Aussperr-Schutz); hier lokal
# validieren (Defense-in-Depth). Es MUSS mindestens ein erhaltbarer Kanal existieren.
[ -n "$MGMT_CIDR" ] || fail "NEXORA_MGMT_CIDR fehlt — Isolation ohne Mgmt-Preservation verweigert (Selbst-Aussperr-Schutz)."
[[ "$MGMT_CIDR" =~ $IPV4_CIDR_RE ]] || fail "NEXORA_MGMT_CIDR ist kein gültiges IPv4/CIDR: ${MGMT_CIDR}"
[[ "$MGMT_PORT" =~ $PORT_RE ]]      || fail "NEXORA_MGMT_SSH_PORT ist kein Port: ${MGMT_PORT}"
command -v nft >/dev/null 2>&1      || fail "nftables (nft) nicht verfügbar — iptables-Fallback ist eine eigene Slice."

# ── Ruleset bauen ────────────────────────────────────────────────────────────
# Atomar + idempotent in EINEM nft-Transaktionsfile (add→delete→add setzt sauber
# zurück, auch bei Re-Isolation). Reihenfolge: established/related + loopback + die
# Preservation-Accepts, DANN 'policy drop' für alles Übrige. Priorität -300 lässt
# diese Chains sehr früh greifen. Der Output-Chain erhält KEINEN breiten daddr-Accept
# (Isolation soll eng sein) — Antworten des Hosts laufen über established,related.
RULES=$(cat <<NFT
add table ${TABLE}
delete table ${TABLE}
add table ${TABLE}
add chain ${TABLE} input   { type filter hook input   priority -300 ; policy drop ; }
add chain ${TABLE} output  { type filter hook output  priority -300 ; policy drop ; }
add chain ${TABLE} forward { type filter hook forward priority -300 ; policy drop ; }
add rule ${TABLE} input  ct state established,related accept
add rule ${TABLE} input  iif "lo" accept
add rule ${TABLE} output ct state established,related accept
add rule ${TABLE} output oif "lo" accept
add rule ${TABLE} input  ip saddr ${MGMT_CIDR} tcp dport ${MGMT_PORT} accept
NFT
)
# Primärkanal (Live-SSH-Peer) zusätzlich erhalten — schützt auch bei falschem CIDR/Port.
if [ -n "$CTRL_IP" ]; then
  RULES="${RULES}
add rule ${TABLE} input  ip saddr ${CTRL_IP}/32 tcp dport ${CTRL_PORT} accept"
  log "Live-Control-Channel erkannt: ${CTRL_IP}:${CTRL_PORT} (wird zusätzlich erhalten)."
else
  log "Kein $SSH_CONNECTION verfügbar — Preservation nur über NEXORA_MGMT_CIDR."
fi

printf '%s\n' "$RULES" | nft -f -

# ── Self-Verify (Exit 0 nur bei strukturell bestätigten Preservation-Regeln) ──
nft list table ${TABLE} >/dev/null 2>&1 || fail "Isolation-Tabelle nach Anwendung nicht auffindbar."
nft list chain ${TABLE} input | grep -q "ip saddr ${MGMT_CIDR} tcp dport ${MGMT_PORT} accept" \
  || fail "Mgmt-Preservation-Regel fehlt in der input-Chain — abgebrochen."
if [ -n "$CTRL_IP" ]; then
  nft list chain ${TABLE} input | grep -q "ip saddr ${CTRL_IP}/32 tcp dport ${CTRL_PORT} accept" \
    || fail "Control-Channel-Preservation-Regel fehlt in der input-Chain — abgebrochen."
fi
log "Host isoliert (${TABLE} aktiv); Control-Channel erhalten."
exit 0
