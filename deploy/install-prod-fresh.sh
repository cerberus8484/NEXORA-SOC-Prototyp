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

DOMAIN=""; ADMIN_EMAIL=""; PROFILE="${NEXORA_PROFILE:-core}"; TLS_MODE="provided"; ENV_CREATED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain|--admin-email|--profile|--tls-mode)
      [ $# -ge 2 ] && [ -n "${2:-}" ] || { echo "FEHLER: Option '$1' benötigt einen Wert." >&2; exit 1; }
      case "$1" in
        --domain) DOMAIN="$2";;
        --admin-email) ADMIN_EMAIL="$2";;
        --profile) PROFILE="$2";;
        --tls-mode) TLS_MODE="$2";;
      esac
      shift 2;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 1;;
  esac
done
case "$PROFILE" in
  core|full) ;;
  *) echo "FEHLER: --profile muss 'core' oder 'full' sein (war: $PROFILE)" >&2; exit 1;;
esac
case "$TLS_MODE" in
  provided|self-signed) ;;
  *) echo "FEHLER: --tls-mode muss 'provided' oder 'self-signed' sein." >&2; exit 1;;
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
  "$SCRIPT_DIR/gen-env-production.sh" --quiet-initial-login "${gen_args[@]}"
  ENV_CREATED=1
else
  echo "==> .env.production vorhanden — wird unverändert genutzt"
fi

# ── 3. TLS-Zertifikat ────────────────────────────────────────────────────────
CRT="$(grep -E '^TLS_CERT_PATH=' "$ENV_FILE" | cut -d= -f2- || true)"
KEY="$(grep -E '^TLS_KEY_PATH=' "$ENV_FILE" | cut -d= -f2- || true)"
CRT="${CRT:-/etc/ssl/soc/server.crt}"
KEY="${KEY:-/etc/ssl/soc/server.key}"
if [ "$TLS_MODE" = "provided" ] && { [ ! -f "$CRT" ] || [ ! -f "$KEY" ]; }; then
  echo "FEHLER: TLS-Zertifikat oder Schlüssel fehlt. Für Produktion gültige Pfade in .env.production setzen; Self-signed nur explizit mit --tls-mode self-signed." >&2
  exit 1
fi
if [ "$TLS_MODE" = "self-signed" ] && { [ ! -f "$CRT" ] || [ ! -f "$KEY" ]; }; then
  case "${DOMAIN:-localhost}" in localhost|*.local) ;; *) echo "FEHLER: --tls-mode self-signed ist nur für localhost oder .local-Lab-Domains zulässig." >&2; exit 1;; esac
  echo "==> Self-signed TLS-Zertifikat erzeugen: $CRT (nur Lab)"
  CN="${DOMAIN:-localhost}"
  SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
  $SUDO mkdir -p "$(dirname "$CRT")" "$(dirname "$KEY")"
  $SUDO openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "$KEY" -out "$CRT" -subj "/CN=$CN" >/dev/null 2>&1
  $SUDO chmod 600 "$KEY"
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

# Smoke-Test direkt anschließen (read-only) — gibt sofort grün/rot.
if [ -x "$SCRIPT_DIR/smoke-test.sh" ]; then
  echo ""
  echo "==> Smoke-Test"
  if ! "$SCRIPT_DIR/smoke-test.sh"; then
    echo "FEHLER: Smoke-Test fehlgeschlagen." >&2
    exit 1
  fi
fi

if [ -x "$SCRIPT_DIR/smoke-csp.sh" ]; then
  echo ""
  echo "==> Header/CSP-Smoke"
  if ! "$SCRIPT_DIR/smoke-csp.sh"; then
    echo "FEHLER: Header/CSP-Smoke fehlgeschlagen." >&2
    exit 1
  fi
fi

# ── 7. Erfolgreicher Abschluss ───────────────────────────────────────────────
env_value() { grep -m1 -E "^$1=" "$ENV_FILE" | cut -d= -f2-; }
configured_domain="$(env_value CORS_ORIGINS | sed -E 's#^https?://##; s#/.*$##; s#,.*$##')"
configured_email="$(env_value ADMIN_EMAIL)"
host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"

echo ""
echo "============================================================"
echo "  NEXORA SOC LAEUFT"
echo "  UI (DNS): https://${configured_domain:-${DOMAIN:-<host>}}:443/"
[ -n "$host_ip" ] && echo "  UI (IP):  https://${host_ip}:443/"
echo "  Login:    ${configured_email:-${ADMIN_EMAIL:-<Admin-E-Mail>}}"
if [ "$ENV_CREATED" -eq 1 ]; then
  echo "  Passwort: $(env_value ADMIN_PASSWORD)"
  echo "  WICHTIG:  Passwort jetzt sicher ablegen; Wechsel wird beim ersten Login erzwungen."
else
  echo "  Passwort: wird bei bestehender .env.production nicht erneut angezeigt."
fi
echo ""
echo "  Optional danach: Data-Plane (Korrelator + Kollektoren)"
echo "    cd deploy/nexora-intake && ./install-dataplane.sh && docker compose up -d --build"
echo "============================================================"
