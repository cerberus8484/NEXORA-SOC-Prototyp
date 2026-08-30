#!/usr/bin/env bash
#
# check-opnsense-nat-fields.sh — Read-only-Diagnose: Welche NAT-/Firewall-/
# Interface-Felder liefert OPNsense (pfSense-Decoder) wirklich in den Wazuh-Indexer?
#
# Zweck: Entscheidet die Slice-3-Architektur der Honeypot-/Flow-Korrelation —
#   * Sind data.nat_* / data.post_nat_* tatsächlich vorhanden → Slice 3 kann die
#     NAT-Kette DIREKT pro Event lesen (flowNormalizer 'firewall'-Quelltyp mappt sie).
#   * Fehlen sie → NAT-Kette muss per KORRELATION (Zeit + IP + Port) rekonstruiert
#     werden.
#
# WICHTIG — Architektur-Kontext für die Auswertung:
#   * VPS-Honeypot (öffentlich): das DNAT :22→:2222 liegt auf der VPS-iptables,
#     NICHT auf OPNsense. OPNsense kann diese DNAT-Kette nicht belegen → dafür ist
#     später separate VPS-Firewall-/iptables-Telemetrie nötig.
#   * Interner Honeypot (CT 179, LAN): aktuell keine NAT-Kette — Cowrie liefert nur
#     die interne Ziel-/Session-Sicht.
#   * Künftiger Honeypot hinter OPNsense-WAN: dann werden OPNsense-NAT-Felder ODER
#     zeit-/portbasierte Korrelation relevant — genau das prüft dieses Skript.
#
# SICHERHEIT:
#   * Ausschließlich GET/_search-Abfragen — KEINE Writes, keine Mutationen.
#   * Keine Secrets im Skript. Zugang nur über Umgebungsvariablen.
#   * Gibt keine Credentials aus (nur die Query-Ergebnisse).
#
# Konfiguration (Umgebungsvariablen):
#   IDX_URL       (Pflicht) Basis-URL des Indexers, z.B. https://<host>:9200
#                 — bewusst KEIN Default, damit keine Topologie fest im Repo steht.
#   IDX_USER      (Pflicht) Indexer-Benutzer.
#   IDX_PASS      (Pflicht) Indexer-Passwort.
#   IDX_INSECURE  (optional) "1" = TLS-Zertifikat nicht prüfen (-k), für self-signed.
#                 Default: 0 (Zertifikat wird geprüft).
#   IDX_INDEX     (optional) Index-/Alias-Pattern. Default: wazuh-alerts-*
#   IDX_RANGE_A   (optional) Zeitfenster Abfrage A. Default: now-7d
#   IDX_RANGE_B   (optional) Zeitfenster Abfrage B. Default: now-30d
#
# Auswertung:
#   Abfrage A listet die ECHTEN data.*-Keys einiger aktueller Firewall-Events
#     → zeigt unverfälscht, was der Decoder produziert (auch unerwartete Keys).
#   Abfrage B zählt pro erwartetem Feld die Treffer über den Zeitraum
#     → doc_count > 0  = Feld kommt an  → Slice 3: direktes Feld-Mapping möglich.
#     → doc_count = 0  = Feld fehlt     → Slice 3: Korrelation/Stitching nötig.
#
# Nutzung:
#   IDX_URL=https://<host>:9200 IDX_USER=admin IDX_PASS=*** IDX_INSECURE=1 \
#     bash tools/ops/check-opnsense-nat-fields.sh

set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Pflicht-Variablen prüfen (ohne Werte auszugeben) ────────────────────────
: "${IDX_URL:?IDX_URL ist erforderlich (z.B. https://host:9200) — siehe Header}"
: "${IDX_USER:?IDX_USER ist erforderlich}"
: "${IDX_PASS:?IDX_PASS ist erforderlich}"

command -v curl >/dev/null 2>&1 || die "curl wird benötigt"

INDEX="${IDX_INDEX:-wazuh-alerts-*}"
RANGE_A="${IDX_RANGE_A:-now-7d}"
RANGE_B="${IDX_RANGE_B:-now-30d}"

INSECURE=""
[ "${IDX_INSECURE:-0}" = "1" ] && INSECURE="-k"

# jq ist optional: vorhanden → hübsch filtern, sonst Roh-JSON.
have_jq=0
command -v jq >/dev/null 2>&1 && have_jq=1

# Read-only _search; -f lässt curl bei HTTP-Fehlern fehlschlagen. Body via stdin.
search() {
  # shellcheck disable=SC2086
  curl -fsS $INSECURE --user "$IDX_USER:$IDX_PASS" \
    -H 'Content-Type: application/json' \
    "${IDX_URL%/}/${INDEX}/_search" --data-binary @-
}

FW_GROUPS='["pfsense","firewall","opnsense","pf"]'

echo "== A) Echte data.*-Keys aktueller Firewall-Events (Fenster: ${RANGE_A}) =="
respA="$(search <<JSON
{
  "size": 3,
  "sort": [{ "@timestamp": "desc" }],
  "_source": ["data"],
  "query": { "bool": { "filter": [
    { "terms": { "rule.groups": ${FW_GROUPS} } },
    { "range": { "@timestamp": { "gte": "${RANGE_A}" } } }
  ] } }
}
JSON
)"
if [ "$have_jq" = "1" ]; then
  echo "$respA" | jq '.hits.hits[]._source.data | keys'
else
  echo "$respA"
  echo "(Hinweis: jq nicht installiert → Roh-JSON; für die Key-Liste jq installieren)" >&2
fi

echo
echo "== B) Existenz-Zählung erwarteter NAT-/Firewall-Felder (Fenster: ${RANGE_B}) =="
respB="$(search <<JSON
{
  "size": 0,
  "query": { "bool": { "filter": [
    { "terms": { "rule.groups": ${FW_GROUPS} } },
    { "range": { "@timestamp": { "gte": "${RANGE_B}" } } }
  ] } },
  "aggs": { "f": { "filters": { "filters": {
    "srcintf":        { "exists": { "field": "data.srcintf" } },
    "dstintf":        { "exists": { "field": "data.dstintf" } },
    "rulenum":        { "exists": { "field": "data.rulenum" } },
    "nat_rule":       { "exists": { "field": "data.nat_rule" } },
    "nat_srcip":      { "exists": { "field": "data.nat_srcip" } },
    "post_nat_srcip": { "exists": { "field": "data.post_nat_srcip" } },
    "nat_dstip":      { "exists": { "field": "data.nat_dstip" } },
    "post_nat_dstip": { "exists": { "field": "data.post_nat_dstip" } },
    "srczone":        { "exists": { "field": "data.srczone" } },
    "dstzone":        { "exists": { "field": "data.dstzone" } },
    "bytes_in":       { "exists": { "field": "data.bytes_in" } },
    "bytes_out":      { "exists": { "field": "data.bytes_out" } }
  } } } }
}
JSON
)"
if [ "$have_jq" = "1" ]; then
  echo "$respB" | jq '{ firewall_events_total: .hits.total.value, fields: .aggregations.f.buckets }'
else
  echo "$respB"
fi

echo
echo "Fertig. Auswertung: doc_count>0 = Feld kommt an (Feld-Mapping möglich);" >&2
echo "doc_count=0 = Feld fehlt (Slice 3 braucht Korrelation/Stitching)." >&2
