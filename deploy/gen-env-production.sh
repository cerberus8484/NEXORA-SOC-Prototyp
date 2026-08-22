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

DOMAIN=""; ADMIN_EMAIL=""; TLS_CERT_PATH=""; TLS_KEY_PATH=""; FORCE=0; QUIET_INITIAL_LOGIN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain)      DOMAIN="$2"; shift 2;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2;;
    --tls-cert-path) TLS_CERT_PATH="$2"; shift 2;;
    --tls-key-path)  TLS_KEY_PATH="$2"; shift 2;;
    --force)       FORCE=1; shift;;
    --quiet-initial-login) QUIET_INITIAL_LOGIN=1; shift;;
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
TLS_CERT_PATH="${TLS_CERT_PATH:-/etc/ssl/soc/server.crt}"
TLS_KEY_PATH="${TLS_KEY_PATH:-/etc/ssl/soc/server.key}"
[[ "$TLS_CERT_PATH" =~ ^[A-Za-z0-9_./:-]+$ ]] || { echo "FEHLER: --tls-cert-path enthält ungültige Zeichen." >&2; exit 1; }
[[ "$TLS_KEY_PATH" =~ ^[A-Za-z0-9_./:-]+$ ]] || { echo "FEHLER: --tls-key-path enthält ungültige Zeichen." >&2; exit 1; }

# ── Secrets erzeugen ─────────────────────────────────────────────────────────
DB_PW="$(openssl rand -hex 24)"
JWT="$(openssl rand -hex 64)"
SALT="$(openssl rand -hex 32)"
WH_GENERIC="$(openssl rand -hex 32)"
WH_WAZUH="$(openssl rand -hex 32)"
WH_DATAPLANE="$(openssl rand -hex 32)"   # eigenes Secret für die Data-Plane-Status-Brücke
# Admin-Temp-Passwort: 24 zufällige Zeichen aus allen 4 Klassen, KEIN festes Suffix
# (ein konstanter Anhang wie "Aa1!" senkt die Entropie und triggert Hashcat-Regeln).
# Re-Roll bis alle vier Klassen vertreten sind (besteht damit auch die high-Policy).
# Zeichensatz ohne | & / (würden die sed-Ersetzung unten brechen).
# Hinweis: 'head' schließt die Pipe nach 24 Bytes → 'tr' bekommt SIGPIPE (Exit 141).
# Unter 'set -o pipefail' würde das die Passwortgenerierung abbrechen → 2>/dev/null + '|| true'.
gen_pw() { LC_ALL=C tr -dc 'A-Za-z0-9!@#%+=' < /dev/urandom 2>/dev/null | head -c 24 || true; }
ADMIN_PW="$(gen_pw)"
while ! { printf '%s' "$ADMIN_PW" | grep -q '[A-Z]' && printf '%s' "$ADMIN_PW" | grep -q '[a-z]' \
       && printf '%s' "$ADMIN_PW" | grep -q '[0-9]' && printf '%s' "$ADMIN_PW" | grep -q '[!@#%+=]'; }; do
  ADMIN_PW="$(gen_pw)"
done

# ── .env.production aus Vorlage erzeugen + Platzhalter ersetzen ──────────────
umask 077
cp "$EXAMPLE" "$OUT"
# CRLF → LF erzwingen: eine Vorlage mit Windows-Zeilenenden (z. B. Checkout auf
# Windows, dann nach Linux kopiert) würde sonst Trailing-\r in JEDEN Wert tragen —
# u. a. in TLS_CERT_PATH → nginx kann das Zertifikat nicht laden. Defensiv strippen.
sed -i 's/\r$//' "$OUT"
# Ersetzt eine ganze KEY=...-Zeile. Werte enthalten nur sichere Zeichen (hex/alnum/!).
repl() { sed -i -E "s|^$1=.*|$1=$2|" "$OUT"; }
repl DB_PASSWORD            "$DB_PW"
repl JWT_SECRET             "$JWT"
repl AUDIT_IP_SALT          "$SALT"
repl WEBHOOK_SECRET_GENERIC  "$WH_GENERIC"
repl WEBHOOK_SECRET_WAZUH    "$WH_WAZUH"
repl WEBHOOK_SECRET_DATAPLANE "$WH_DATAPLANE"
repl VITE_WIKI_BASE_URL      ""
repl ADMIN_PASSWORD         "$ADMIN_PW"
repl ADMIN_EMAIL            "$ADMIN_EMAIL"
repl CORS_ORIGINS           "https://$DOMAIN"
repl TLS_CERT_PATH          "$TLS_CERT_PATH"
repl TLS_KEY_PATH           "$TLS_KEY_PATH"
# Externe Integrationen werden bei einer frischen Installation nicht mit
# Beispiel-Endpunkten aktiviert. Konfiguration erfolgt danach bewusst im UI
# oder durch einen Operator in der geschützten .env.production.
repl WAZUH_API_URL           ""
repl WAZUH_API_USER          ""
repl WAZUH_API_PASSWORD      ""
repl OLLAMA_BASE_URL         ""
chmod 600 "$OUT"

echo ""
echo "OK: $OUT erzeugt (chmod 600). Generiert: DB-Passwort, JWT_SECRET, AUDIT_IP_SALT, Webhook-Secrets."
echo "    Hinweis: Integrationen (Wazuh-API, TI-Keys, IMAP, Cloud-LLM) bleiben leer/Platzhalter — bei Bedarf nachtragen."
if [ "$QUIET_INITIAL_LOGIN" -eq 0 ]; then
  echo ""
  echo "============================================================"
  echo "  ADMIN-ERSTANMELDUNG (wird nur EINMAL angezeigt — sicher notieren):"
  echo "    E-Mail:   $ADMIN_EMAIL"
  echo "    Passwort: $ADMIN_PW"
  echo "  -> Beim ERSTEN Login MUSS das Passwort gewechselt werden."
  echo "============================================================"
fi
