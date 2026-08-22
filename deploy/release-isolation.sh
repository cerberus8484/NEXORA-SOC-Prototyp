#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexora Containment — Isolation aufheben (ADR-042 Slice 3a, Linux/nftables).
#
# Kehrt isolate-host.sh vollständig um: entfernt die dedizierte Isolations-Tabelle
# und stellt damit die reguläre Konnektivität wieder her. Das System-Regelwerk des
# Hosts bleibt unberührt (die Isolation lag ausschließlich in nexora_containment).
#
# Eigenschaften: idempotent (kein Fehler, wenn keine Isolation aktiv ist),
# self-verifying (Exit 0 NUR nachdem die Tabelle nachweislich entfernt ist).
# Braucht KEINE Mgmt-CIDR — die Freigabe stellt Konnektivität ohnehin wieder her.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TABLE="inet nexora_containment"

log()  { echo "==> [nexora-containment] $*"; }
fail() { echo "!! [nexora-containment] $*" >&2; exit 1; }

command -v nft >/dev/null 2>&1 || fail "nftables (nft) nicht verfügbar."

# Idempotent: Tabelle nur löschen, wenn vorhanden.
if nft list table ${TABLE} >/dev/null 2>&1; then
  nft delete table ${TABLE}
  log "Isolation aufgehoben (${TABLE} entfernt)."
else
  log "Keine aktive Isolation gefunden — nichts zu tun (idempotent)."
fi

# Self-Verify: Tabelle ist wirklich weg.
if nft list table ${TABLE} >/dev/null 2>&1; then
  fail "Isolation-Tabelle nach Löschung noch vorhanden — abgebrochen."
fi
log "Konnektivität wiederhergestellt."
exit 0
