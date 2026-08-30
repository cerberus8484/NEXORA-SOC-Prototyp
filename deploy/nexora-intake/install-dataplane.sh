#!/usr/bin/env bash
# Installer für den Data-Plane-Stack (Korrelator + Kollektoren) auf dem Nexora-Host.
#
# Erzeugt das operator-private Scaffold neben docker-compose.yml:
#   - .env            (INTAKE_PG_PASSWORD, DATAPLANE_WEBHOOK_SECRET, CRED_* Collector-Tokens)
#   - hub.config.json (aus collector-hub/hub.config.example.json — Platzhalter danach füllen)
#   - keys/collector  (frisches ed25519-Keypair für read-only SSH zu den Quellen)
#
# DATAPLANE_WEBHOOK_SECRET wird — falls vorhanden — aus deploy/.env.production übernommen
# (== Backend WEBHOOK_SECRET_DATAPLANE, sonst nimmt das Backend die Status-Pushes nicht an).
#
# Schreibt NICHTS, was schon existiert (Schutz vor versehentlichem Überschreiben) — außer --force.
# Start danach:  docker compose up -d --build
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_HUB="$HERE/../collector-hub/hub.config.example.json"
BACKEND_ENV="$HERE/../.env.production"
ENV_OUT="$HERE/.env"
HUB_OUT="$HERE/hub.config.json"
KEYS_DIR="$HERE/keys"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 1;;
  esac
done

command -v openssl >/dev/null || { echo "FEHLER: openssl fehlt." >&2; exit 1; }
command -v ssh-keygen >/dev/null || { echo "FEHLER: ssh-keygen fehlt." >&2; exit 1; }
[ -f "$EXAMPLE_HUB" ] || { echo "FEHLER: Vorlage fehlt: $EXAMPLE_HUB" >&2; exit 1; }

exists_guard() {
  [ -e "$1" ] && [ "$FORCE" -ne 1 ] && { echo "FEHLER: $1 existiert bereits. --force zum Überschreiben." >&2; exit 1; }
  return 0
}

# ── DATAPLANE_WEBHOOK_SECRET aus dem Backend übernehmen (Kontinuität) ─────────
WH_DATAPLANE=""
if [ -f "$BACKEND_ENV" ]; then
  WH_DATAPLANE="$(grep -E '^WEBHOOK_SECRET_DATAPLANE=' "$BACKEND_ENV" | head -1 | cut -d= -f2- || true)"
fi
if [ -z "$WH_DATAPLANE" ] || echo "$WH_DATAPLANE" | grep -q 'CHANGE_ME'; then
  echo "WARNUNG: WEBHOOK_SECRET_DATAPLANE nicht aus $BACKEND_ENV übernommen."
  echo "         Es wird ein neues generiert — es MUSS mit dem Backend-Wert übereinstimmen,"
  echo "         sonst lehnt das Backend die Status-Pushes ab (401)."
  WH_DATAPLANE="$(openssl rand -hex 32)"
fi

# ── .env erzeugen ────────────────────────────────────────────────────────────
exists_guard "$ENV_OUT"
umask 077
{
  echo "# Data-Plane-Stack — operator-privat (gitignored). Erzeugt von install-dataplane.sh."
  echo "INTAKE_PG_PASSWORD=$(openssl rand -hex 24)"
  echo "DATAPLANE_WEBHOOK_SECRET=$WH_DATAPLANE"
  echo "# Collector-Tokens (Intake-Auth je Collector) — bei Bedarf an die Intake-Registry anpassen:"
  echo "CRED_HP_COWRIE=$(openssl rand -hex 24)"
  echo "CRED_HP_SURICATA=$(openssl rand -hex 24)"
  echo "CRED_LAB_WAZUH=$(openssl rand -hex 24)"
  echo "# OPNsense-Quelle ist in der Compose pausiert/optional — leer lassen, bis benötigt:"
  echo "CRED_LAB_OPNSENSE="
} > "$ENV_OUT"
chmod 600 "$ENV_OUT"
echo "OK: $ENV_OUT (chmod 600)"

# ── hub.config.json aus Vorlage ──────────────────────────────────────────────
exists_guard "$HUB_OUT"
cp "$EXAMPLE_HUB" "$HUB_OUT"
echo "OK: $HUB_OUT — Platzhalter <…> (Quell-IPs/User/Pfade) noch ersetzen."

# ── SSH-Keypair für read-only Quell-Zugriff ──────────────────────────────────
mkdir -p "$KEYS_DIR"; chmod 700 "$KEYS_DIR"
if [ ! -f "$KEYS_DIR/collector" ] || [ "$FORCE" -eq 1 ]; then
  rm -f "$KEYS_DIR/collector" "$KEYS_DIR/collector.pub"
  ssh-keygen -t ed25519 -N '' -C 'nexora-collector-readonly' -f "$KEYS_DIR/collector" >/dev/null
  chmod 600 "$KEYS_DIR/collector"
  echo "OK: $KEYS_DIR/collector (ed25519-Keypair)"
fi

echo ""
echo "============================================================"
echo "  DATA-PLANE-SCAFFOLD ERZEUGT. Noch zu tun (operator):"
echo "  1. hub.config.json: <…>-Platzhalter mit echten Quell-Hosts/Usern/Logpfaden füllen"
echo "     und identityFile-Pfade auf /keys/collector zeigen lassen."
echo "  2. Öffentlichen Key auf den Quell-Hosts installieren (read-only, command-restricted):"
echo "       --- keys/collector.pub ---"
sed 's/^/       /' "$KEYS_DIR/collector.pub" 2>/dev/null || true
echo "  3. Sicherstellen: DATAPLANE_WEBHOOK_SECRET (.env) == WEBHOOK_SECRET_DATAPLANE (Backend)."
echo "  4. Starten:  docker compose up -d --build"
echo "============================================================"
