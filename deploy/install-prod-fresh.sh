#!/usr/bin/env bash
# Fresh-Install von Nexora SOC auf einem frischen Linux-Host (z.B. Proxmox-9-VM).
#
# Voraussetzung auf dem Host: Docker + Docker Compose v2 + git + openssl + curl,
# und dieses Repo ist bereits geklont (git clone … && cd …).
#
# Ablauf (idempotent, fail-fast):
#   1. Preflight — benötigte Tools vorhanden?
#   2. .env.production — falls fehlt, via gen-env-production.sh erzeugen (Secrets + Admin-Temp-PW)
#   3. TLS-Zertifikat — falls die in .env gesetzten Pfade fehlen, self-signed erzeugen
#   4. Images bauen (api + web)
#   5. Stack starten (docker compose up -d) — Migrationen + Admin-Seed laufen beim API-Boot
#   6. Auf /health warten (nicht blind schlafen)
#   7. Erfolg + Login-Hinweis
#
# Nutzung:
#   ./deploy/install-prod-fresh.sh --domain soc.firma.de --admin-email admin@firma.de
#
# EMPFOHLEN VORHER: ./deploy/preflight-check.sh  (read-only; fängt fehlende Tools,
#   CHANGE_ME-Reste, belegte Ports, zu wenig Plattenplatz; beim Umzug zusätzlich
#   --restore-file <backup> für Passphrase- + Probe-Decrypt-Check).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOC="$SCRIPT_DIR/soc.sh"
ENV_FILE="$SCRIPT_DIR/.env.production"

DOMAIN=""; ADMIN_EMAIL=""; PROFILE="${NEXORA_PROFILE:-core}"
while [ $# -gt 0 ]; do
  case "$1" in
    --domain)      DOMAIN="$2"; shift 2;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2;;
    --profile)     PROFILE="$2"; shift 2;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 1;;
  esac
done
case "$PROFILE" in
  core|full) ;;
  *) echo "FEHLER: --profile muss 'core' oder 'full' sein (war: $PROFILE)" >&2; exit 1;;
esac
export NEXORA_PROFILE="$PROFILE"

# ── 1. Preflight ─────────────────────────────────────────────────────────────
echo "==> Preflight"
for bin in docker git openssl curl; do
  command -v "$bin" >/dev/null || { echo "FEHLER: '$bin' fehlt. Bitte installieren." >&2; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo "FEHLER: 'docker compose' (V2) fehlt." >&2; exit 1; }
[ -x "$SOC" ] || { echo "FEHLER: $SOC nicht ausführbar." >&2; exit 1; }

# ── 2. .env.production ───────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "==> .env.production fehlt -> generiere (Secrets + Admin-Temp-Passwort)"
  gen_args=()
  [ -n "$DOMAIN" ]      && gen_args+=(--domain "$DOMAIN")
  [ -n "$ADMIN_EMAIL" ] && gen_args+=(--admin-email "$ADMIN_EMAIL")
  "$SCRIPT_DIR/gen-env-production.sh" "${gen_args[@]}"
else
  echo "==> .env.production vorhanden — wird unverändert genutzt"
fi

# ── 3. TLS-Zertifikat (self-signed, falls Pfade fehlen) ──────────────────────
CRT="$(grep -E '^TLS_CERT_PATH=' "$ENV_FILE" | cut -d= -f2- || true)"
KEY="$(grep -E '^TLS_KEY_PATH=' "$ENV_FILE" | cut -d= -f2- || true)"
CRT="${CRT:-/etc/ssl/soc/server.crt}"
KEY="${KEY:-/etc/ssl/soc/server.key}"
if [ ! -f "$CRT" ] || [ ! -f "$KEY" ]; then
  CN="${DOMAIN:-localhost}"

  # `sudo` NUR verwenden, wenn es existiert UND ohne Rueckfrage laeuft — sonst haengt
  # der Installer an einer Passwortabfrage oder bricht dort ab, wo es kein sudo gibt
  # (Windows/Docker Desktop, rootless Container, macOS ohne Admin).
  SUDO=""
  if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    SUDO="sudo"
  fi

  # Am RECHT entscheiden, nicht am Erfolg des mkdir: Unter Git Bash/MSYS wuerde
  # `mkdir -p /etc/ssl/soc` sogar gelingen (landet im MSYS-Wurzelverzeichnis) — fuer
  # den Docker-Bind-Mount ist der Pfad dann aber wertlos. Ohne root/sudo also gar
  # nicht erst nach /etc/ssl greifen, sondern repo-lokal ablegen und die Pfade in die
  # .env.production zurueckschreiben, damit Compose denselben Ort mountet.
  if [ -z "$SUDO" ] && [ "$(id -u)" -ne 0 ]; then
    echo "    ! kein root/sudo — Zertifikat wird repo-lokal unter ./tls abgelegt"
    CRT="$SCRIPT_DIR/tls/server.crt"
    KEY="$SCRIPT_DIR/tls/server.key"
    sed -i "s|^TLS_CERT_PATH=.*|TLS_CERT_PATH=./tls/server.crt|" "$ENV_FILE"
    sed -i "s|^TLS_KEY_PATH=.*|TLS_KEY_PATH=./tls/server.key|"  "$ENV_FILE"
  fi
  $SUDO mkdir -p "$(dirname "$CRT")" "$(dirname "$KEY")"

  echo "==> Self-signed TLS-Zertifikat erzeugen: $CRT"
  # MSYS_NO_PATHCONV: Git Bash deutet "/CN=..." sonst als POSIX-Pfad und macht daraus
  # "D:/Git/CN=..." — auf Linux ist die Variable wirkungslos.
  # subjectAltName ist Pflicht: Browser ignorieren den CN seit Jahren.
  # Fehler werden NICHT verschluckt; ein stiller openssl-Abbruch fuehrte bisher zu
  # einem unerklaerlichen Folgefehler weiter unten.
  # Aus dem Zielverzeichnis heraus mit RELATIVEN Dateinamen arbeiten. Grund: unter
  # Git Bash/MSYS braucht "-subj /CN=..." die Konvertierung AUS (sonst wird daraus
  # "D:/Git/CN=..."), waehrend absolute MSYS-Pfade wie /c/Users/... die Konvertierung
  # AN braeuchten, damit openssl.exe sie versteht. Beides gleichzeitig geht nicht —
  # relative Namen loesen den Konflikt und verhalten sich auf Linux identisch.
  if ! ( cd "$(dirname "$CRT")" && MSYS_NO_PATHCONV=1 $SUDO openssl req       -x509 -newkey rsa:2048 -nodes -days 825       -keyout "$(basename "$KEY")" -out "$(basename "$CRT")" -subj "/CN=$CN"       -addext "subjectAltName=DNS:$CN,DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1 ); then
    echo "FEHLER: Zertifikatserzeugung fehlgeschlagen (openssl). Ziel: $CRT" >&2
    exit 1
  fi
  $SUDO chmod 600 "$KEY" 2>/dev/null || true   # privater Schluessel gehoert nicht lesbar
  echo "    (Selbstsigniert — fuer echte Produktion spaeter durch ein gueltiges Zertifikat ersetzen.)"
fi

# ── 3b. Profil in .env.production verankern ──────────────────────────────────
# Damit spätere soc.sh-Aufrufe (ps/logs/restart/down) DASSELBE Profil sehen — sonst
# würde `soc.sh down` den Worker-Container stehen lassen. Beim Profil `full` läuft der
# Korrelator als eigener Container, also darf die API ihn NICHT zusätzlich fahren.
set_env_kv() {  # key value — idempotent (ersetzt vorhandene Zeile, sonst anhängen)
  local k="$1" v="$2"
  if grep -qE "^${k}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
}
echo "==> Profil '$PROFILE' in .env.production verankern"
set_env_kv NEXORA_PROFILE "$PROFILE"
if [ "$PROFILE" = "full" ]; then
  set_env_kv CORRELATION_WORKER_ENABLED "false"   # Worker läuft im eigenen Container
else
  set_env_kv CORRELATION_WORKER_ENABLED "true"    # API verarbeitet selbst (wie bisher)
fi

# ── 4./5. Bauen + Starten ────────────────────────────────────────────────────
echo "==> Images bauen (api + web)"
"$SOC" build api web
if [ "$PROFILE" = "full" ]; then
  echo "==> Korrelations-Worker bauen (gleiches Image, eigener Container)"
  "$SOC" build correlation-worker
fi
echo "==> Stack starten (docker compose up -d, Profil: $PROFILE)"
"$SOC" up

# ── 6. Auf Health warten ─────────────────────────────────────────────────────
echo "==> Warte auf /health (max ~90s) — Migrationen + Admin-Seed laufen beim Boot"
ok=0
for _ in $(seq 1 30); do
  if curl -k -fsS https://localhost/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done
if [ "$ok" -ne 1 ]; then
  echo "FEHLER: /health nicht erreicht. Logs prüfen: $SOC logs api" >&2
  exit 1
fi

# ── 7. Fertig ────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  NEXORA SOC LAEUFT"
echo "  UI:    https://${DOMAIN:-<host>}/"
echo "  Login: Admin-E-Mail + Temp-Passwort (siehe Ausgabe oben)"
echo "         -> Passwortwechsel wird beim ERSTEN Login erzwungen."
echo ""
echo "  Smoke-Test (empfohlen): ./deploy/smoke-test.sh"
echo "  Header/CSP-Smoke:       ./deploy/smoke-csp.sh"
echo ""
echo "  Optional danach: Data-Plane (Korrelator + Kollektoren)"
echo "    cd deploy/nexora-intake && ./install-dataplane.sh && docker compose up -d --build"
echo "============================================================"

# Smoke-Test direkt anschließen (read-only) — gibt sofort grün/rot.
if [ -x "$SCRIPT_DIR/smoke-test.sh" ]; then
  echo ""
  echo "==> Smoke-Test"
  "$SCRIPT_DIR/smoke-test.sh" || echo "    (Smoke-Test meldete Probleme — siehe oben.)"
fi

if [ -x "$SCRIPT_DIR/smoke-csp.sh" ]; then
  echo ""
  echo "==> Header/CSP-Smoke"
  "$SCRIPT_DIR/smoke-csp.sh" || echo "    (Header/CSP-Smoke meldete Probleme — siehe oben.)"
fi
