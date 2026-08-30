#!/usr/bin/env bash
# Generiert deploy/.env.production aus .env.production.example:
#   - befüllt alle Pflicht-Secrets mit `openssl rand` (DB, JWT, AUDIT_IP_SALT, Webhook-Secrets)
#   - erzeugt ein POLICY-konformes Admin-Temp-Passwort (high: Upper+Lower+Digit+Special)
#     → Wechsel beim ersten Login wird erzwungen (must_change_password)
#   - setzt CORS_ORIGINS (Domain) + ADMIN_EMAIL
#
# Gibt das Admin-Temp-Passwort GENAU EINMAL aus (sonst keine Secrets auf stdout).
# Schreibt mit chmod 600. Überschreibt NICHT ohne --force.
#
# Nutzung: ./deploy/gen-env-production.sh --domain soc.firma.de --admin-email admin@firma.de
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE="$SCRIPT_DIR/.env.production.example"
OUT="$SCRIPT_DIR/.env.production"

DOMAIN=""; ADMIN_EMAIL=""; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain)      DOMAIN="$2"; shift 2;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2;;
    --force)       FORCE=1; shift;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 1;;
  esac
done

command -v openssl >/dev/null || { echo "FEHLER: openssl fehlt." >&2; exit 1; }
[ -f "$EXAMPLE" ] || { echo "FEHLER: $EXAMPLE fehlt." >&2; exit 1; }
if [ -f "$OUT" ] && [ "$FORCE" -ne 1 ]; then
  echo "FEHLER: $OUT existiert bereits. --force zum Überschreiben (ACHTUNG: erzeugt NEUE Secrets)." >&2
  exit 1
fi

# Fehlende Pflichtangaben interaktiv erfragen (nur wenn ein TTY da ist).
if [ -z "$DOMAIN" ];      then read -rp "Domain/Host (z.B. soc.firma.de): " DOMAIN; fi
if [ -z "$ADMIN_EMAIL" ]; then read -rp "Admin-E-Mail: " ADMIN_EMAIL; fi
[ -n "$DOMAIN" ]      || { echo "FEHLER: --domain erforderlich." >&2; exit 1; }
[ -n "$ADMIN_EMAIL" ] || { echo "FEHLER: --admin-email erforderlich." >&2; exit 1; }

# ── Secrets erzeugen ─────────────────────────────────────────────────────────
DB_PW="$(openssl rand -hex 24)"
JWT="$(openssl rand -hex 64)"
SALT="$(openssl rand -hex 32)"
WH_GENERIC="$(openssl rand -hex 32)"
WH_WAZUH="$(openssl rand -hex 32)"
WH_DATAPLANE="$(openssl rand -hex 32)"   # eigenes Secret für die Data-Plane-Status-Brücke
# Admin-Temp-Passwort — Erzeugung liegt in deploy/lib/admin-password.sh, weil der
# Recovery-Pfad (install.sh --reset-admin-password) exakt dieselbe Qualitaet braucht.
# Eine zweite Kopie wuerde auseinanderlaufen, und gerade bei der Passwort-Erzeugung
# faellt eine schwaechere Variante nicht auf.
# shellcheck source=lib/admin-password.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/admin-password.sh"
ADMIN_PW="$(nexora_gen_admin_password)"

# ── .env.production aus Vorlage erzeugen + Platzhalter ersetzen ──────────────
umask 077
cp "$EXAMPLE" "$OUT"
# Ersetzt eine ganze KEY=...-Zeile. Werte enthalten nur sichere Zeichen (hex/alnum/!).
repl() { sed -i -E "s|^$1=.*|$1=$2|" "$OUT"; }
repl DB_PASSWORD            "$DB_PW"
repl JWT_SECRET             "$JWT"
repl AUDIT_IP_SALT          "$SALT"
repl WEBHOOK_SECRET_GENERIC  "$WH_GENERIC"
repl WEBHOOK_SECRET_WAZUH    "$WH_WAZUH"
repl WEBHOOK_SECRET_DATAPLANE "$WH_DATAPLANE"
repl VITE_WIKI_BASE_URL      "/docs"
repl ADMIN_PASSWORD         "$ADMIN_PW"
repl ADMIN_EMAIL            "$ADMIN_EMAIL"
repl CORS_ORIGINS           "https://$DOMAIN"
chmod 600 "$OUT"

# Nicht behaupten, was nicht stimmt: Auf Dateisystemen ohne POSIX-Modi (NTFS unter
# Git Bash, manche CIFS-Mounts) laeuft `chmod` fehlerfrei durch, ohne etwas zu bewirken.
# Ein `stat` DIREKT nach dem chmod ist dabei wertlos — es liefert den angeforderten
# Modus zurueck (600), waehrend die Datei real 644 bleibt. Deshalb funktional testen:
# eine Wegwerfdatei auf 000 setzen und pruefen, ob sie danach noch lesbar ist.
# (Als root ist dieser Test untauglich — root liest auch 000 — dort genuegt `stat`.)
PERM_OK=0
if [ "$(id -u)" -eq 0 ]; then
  [ "$(stat -c '%a' "$OUT" 2>/dev/null)" = "600" ] && PERM_OK=1
else
  _probe="$(dirname "$OUT")/.permprobe.$$"
  : > "$_probe" 2>/dev/null || _probe=""
  if [ -n "$_probe" ]; then
    chmod 000 "$_probe" 2>/dev/null
    [ -r "$_probe" ] || PERM_OK=1
    chmod 600 "$_probe" 2>/dev/null; rm -f "$_probe"
  fi
fi
if [ "$PERM_OK" -eq 1 ]; then
  PERM_NOTE="chmod 600"
else
  PERM_NOTE="ACHTUNG: Dateisystem setzt keine POSIX-Rechte durch — Datei bleibt fuer andere lokale Benutzer lesbar und enthaelt Secrets im Klartext"
fi

echo ""
echo "OK: $OUT erzeugt ($PERM_NOTE). Generiert: DB-Passwort, JWT_SECRET, AUDIT_IP_SALT, Webhook-Secrets."
echo "    Hinweis: Integrationen (Wazuh-API, TI-Keys, IMAP, Cloud-LLM) bleiben leer/Platzhalter — bei Bedarf nachtragen."
echo ""
echo "============================================================"
echo "  ADMIN-ERSTANMELDUNG (wird nur EINMAL angezeigt — sicher notieren):"
echo "    E-Mail:   $ADMIN_EMAIL"
echo "    Passwort: $ADMIN_PW"
echo "  -> Beim ERSTEN Login MUSS das Passwort gewechselt werden."
echo "============================================================"
