#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexora — einheitlicher Installer (Phase 1).
#
# Ein Profil-DISPATCHER, der die vorhandenen Deploy-Bausteine orchestriert —
# es wird KEINE Logik dupliziert, sondern wiederverwendet:
#
#   1. Preflight (hier, VOR .env): root/sudo · git · docker · docker compose ·
#      freier Speicher · Host-Ports.
#   2. .env.production: falls fehlt → gen-env-production.sh (Secrets + Admin-Temp-PW).
#   3. Safety-Flags in .env HART auf false erzwingen (Defense-in-Depth).
#   4. Kern-Stack: install-prod-fresh.sh (TLS · Images bauen · soc.sh up · /health · Smoke).
#   5. Nur all-in-one: Collector/Intake-Stack (nexora-intake), soweit lokal vorhanden.
#   6. Konsolidierte Zusammenfassung: URL · laufende Services · nächste Schritte.
#
# Profile:
#   core        — Web · API · PostgreSQL · Queue/Worker (in der API) · Reverse-Proxy (nginx)
#   all-in-one  — core + dedizierter correlation-worker + Collector/Intake-Stack (falls lokal)
#
# Nutzung:
#   sudo ./deploy/install.sh --profile core --domain soc.firma.de --admin-email admin@firma.de
#   sudo ./deploy/install.sh --profile core --domain soc.firma.de --admin-email admin@firma.de
#   ./deploy/install.sh --profile all-in-one --dry-run     # zeigt den Ablauf, ohne etwas zu tun
#
# SICHERHEIT: gefährliche Fähigkeiten bleiben default AUS und werden hier erzwungen —
#   DEPLOY_ENABLED · CONFIG_APPLY_ENABLED · AUTONOMY_ENABLED · WAZUH_MANAGER_RESTART_ENABLED.
#   Installation/Analyse/Korrelation ja; Apply/Autonomie/Restart nur mit expliziter Freigabe.
#
# NICHT in Phase 1 (bewusst): Remote-Collector-Enrollment, Browser-Setup-Wizard,
#   Aktivierung von Apply/Autonomy/Restart.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.production"
INTAKE_DIR="$SCRIPT_DIR/nexora-intake"

# Safety-Flags, die dieser Installer immer auf false erzwingt.
SAFETY_FLAGS="DEPLOY_ENABLED CONFIG_APPLY_ENABLED AUTONOMY_ENABLED WAZUH_MANAGER_RESTART_ENABLED"

PROFILE="core"              # Sicherer Default: vollständiger Core ohne optionale Data-Plane
WITH_WAZUH=0
DOMAIN=""; ADMIN_EMAIL=""
MIN_DISK_GB=10
TLS_MODE="provided"
DRY_RUN=0
ENV_CREATED=0

# ── kleine Ausgabe-Helfer ────────────────────────────────────────────────────
c_ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
c_warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
c_bad()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }
step()   { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die()    { c_bad "$*"; exit 1; }

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

require_value() {
  [ "$#" -ge 2 ] && [ -n "${2:-}" ] || die "Option '$1' benötigt einen Wert."
}

validate_domain() {
  local value="$1"
  [ "${#value}" -le 253 ] \
    && [[ "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]] \
    || die "--domain ist ungültig: '$value' (erwartet einen DNS-Namen wie soc.example)."
}

validate_email() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]] \
    || die "--admin-email ist ungültig: '$value'."
}

# Führt ein Kommando aus — oder zeigt es nur an (Dry-Run).
run() {
  if [ "$DRY_RUN" -eq 1 ]; then printf '  \033[2m[dry-run]\033[0m %s\n' "$*"; else "$@"; fi
}

# key=value in .env.production idempotent setzen (ersetzt vorhandene Zeile, sonst anhängen).
set_env_kv() {
  local k="$1" v="$2"
  if [ "$DRY_RUN" -eq 1 ]; then printf '  \033[2m[dry-run]\033[0m set %s=%s\n' "$k" "$v"; return; fi
  if grep -qE "^${k}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
}

# ── Argumente ────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --profile)     require_value "$@"; PROFILE="$2"; shift 2;;
    --domain)      require_value "$@"; DOMAIN="$2"; shift 2;;
    --admin-email) require_value "$@"; ADMIN_EMAIL="$2"; shift 2;;
    --min-disk-gb) require_value "$@"; MIN_DISK_GB="$2"; shift 2;;
    --tls-mode)    require_value "$@"; TLS_MODE="$2"; shift 2;;
    --with-wazuh)  WITH_WAZUH=1; shift;;
    --dry-run)     DRY_RUN=1; shift;;
    -h|--help)     usage 0;;
    *) die "Unbekanntes Argument: $1  (--help für Nutzung)";;
  esac
done

case "$PROFILE" in
  all-in-one|core) ;;
  *) die "--profile muss 'all-in-one' oder 'core' sein (war: '$PROFILE')";;
esac

case "$TLS_MODE" in
  provided|self-signed) ;;
  *) die "--tls-mode muss 'provided' oder 'self-signed' sein (war: '$TLS_MODE')";;
esac

[[ "$MIN_DISK_GB" =~ ^[1-9][0-9]*$ ]] || die "--min-disk-gb muss eine positive ganze Zahl sein."

# Profil-Mapping auf install-prod-fresh: core→core (Worker in API), all-in-one→full (eigener Worker-Container).
FRESH_PROFILE="core"; [ "$PROFILE" = "all-in-one" ] && FRESH_PROFILE="full"

# Lab-freundliche Defaults, damit `--profile all-in-one` ohne weitere Flags läuft.
# WICHTIG: NICHT 'localhost' — die Prod-Validierung (validateEnv) lehnt CORS_ORIGINS mit
# 'localhost'/'*' ab und der API-Boot würde fehlschlagen. 'nexora.local' besteht den Check;
# /health ist trotzdem über https://localhost erreichbar (kein Origin), Browser via /etc/hosts.
DOMAIN="${DOMAIN:-nexora.local}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@nexora.local}"
validate_domain "$DOMAIN"
validate_email "$ADMIN_EMAIL"

# Das öffentliche Repository enthält bewusst keine Data-Plane. Ein explizites
# all-in-one-Profil darf deshalb nicht mit einem unvollständigen Betrieb enden.
if [ "$PROFILE" = "all-in-one" ] && [ ! -f "$INTAKE_DIR/docker-compose.yml" ]; then
  die "Collector/Intake-Stack fehlt ($INTAKE_DIR). Für diesen Checkout bitte --profile core verwenden."
fi

printf '\033[1mNexora Installer\033[0m — Profil: \033[36m%s\033[0m%s\n' \
  "$PROFILE" "$([ "$DRY_RUN" -eq 1 ] && echo '  (DRY-RUN — es wird nichts ausgeführt)')"

# ── 1. Preflight (vor .env) ──────────────────────────────────────────────────
step "1. Preflight"
# Im Dry-Run blockiert eine fehlende Umgebung nicht — dann wird nur gewarnt, damit
# der vollständige Ablauf sichtbar bleibt. Im echten Lauf ist es fail-fast.
req_fail() { if [ "$DRY_RUN" -eq 1 ]; then c_warn "$*"; else die "$*"; fi; }

# root/sudo — Docker braucht i. d. R. Root oder Docker-Gruppe.
if [ "$(id -u)" -eq 0 ]; then c_ok "als root ausgeführt"
else c_warn "nicht als root — Docker braucht ggf. 'sudo' oder Docker-Gruppen-Mitgliedschaft"; fi

# Tools
for bin in git docker curl openssl; do
  command -v "$bin" >/dev/null 2>&1 && c_ok "$bin vorhanden" || req_fail "'$bin' fehlt — bitte installieren."
done
if docker compose version >/dev/null 2>&1; then c_ok "docker compose (V2) vorhanden"
else req_fail "'docker compose' (V2) fehlt — bitte Docker Compose Plugin installieren."; fi

# Docker-Daemon erreichbar?
if [ "$DRY_RUN" -eq 1 ]; then c_warn "Docker-Daemon-Check im Dry-Run übersprungen"
elif docker info >/dev/null 2>&1; then c_ok "Docker-Daemon erreichbar"
else die "Docker-Daemon nicht erreichbar (läuft er? Rechte? 'sudo' nötig?)."; fi

# Freier Speicher am Repo-Standort
avail_gb="$(df -Pk "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2{print int($4/1024/1024)}' || echo 0)"
if [ "${avail_gb:-0}" -ge "$MIN_DISK_GB" ]; then c_ok "freier Speicher: ${avail_gb} GB (>= ${MIN_DISK_GB} GB)"
else c_warn "nur ${avail_gb} GB frei (empfohlen >= ${MIN_DISK_GB} GB) — Postgres-Daten + Images brauchen Platz"; fi

# Host-Ports (aus dem Prod-Compose veröffentlicht: 80/443) frei?
port_in_use() { { command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$1[[:space:]]"; } \
             || { command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }; }
for p in 80 443; do
  if port_in_use "$p"; then c_warn "Host-Port $p ist belegt — nginx/web könnte nicht binden"
  else c_ok "Host-Port $p frei"; fi
done

# ── 2. .env.production + Secrets ─────────────────────────────────────────────
step "2. .env.production (Secrets + Admin-Temp-Passwort)"
if [ -f "$ENV_FILE" ]; then
  c_ok ".env.production vorhanden — wird unverändert genutzt (nur Safety-Flags werden erzwungen)"
else
  c_warn ".env.production fehlt → generiere (Domain=$DOMAIN, Admin=$ADMIN_EMAIL)"
  run "$SCRIPT_DIR/gen-env-production.sh" --quiet-initial-login --domain "$DOMAIN" --admin-email "$ADMIN_EMAIL"
  ENV_CREATED=1
fi

if [ "$DRY_RUN" -eq 0 ]; then
  [ ! -L "$ENV_FILE" ] || die ".env.production darf kein Symlink sein."
  [ -f "$ENV_FILE" ] || die ".env.production wurde nicht erzeugt."
  chmod 600 "$ENV_FILE"
  for required_key in JWT_SECRET DB_PASSWORD AUDIT_IP_SALT ADMIN_PASSWORD WEBHOOK_SECRET_GENERIC WEBHOOK_SECRET_WAZUH WEBHOOK_SECRET_DATAPLANE; do
    grep -qE "^${required_key}=.*CHANGE_ME" "$ENV_FILE" \
      && die ".env.production enthält für ${required_key} noch einen CHANGE_ME-Wert."
  done
fi

# ── 3. Safety-Flags erzwingen (Defense-in-Depth) ─────────────────────────────
step "3. Gefährliche Fähigkeiten hart auf false setzen"
for flag in $SAFETY_FLAGS; do set_env_kv "$flag" "false"; c_ok "$flag=false"; done
c_ok "Installation/Analyse/Korrelation aktiv — Apply/Autonomie/Restart bleiben AUS (nur mit expliziter Freigabe)"

# ── 4. Kern-Stack (reused: install-prod-fresh.sh) ────────────────────────────
step "4. Kern-Stack starten (Profil install-prod-fresh: $FRESH_PROFILE)"
# install-prod-fresh.sh sieht das bereits erzeugte .env, überspringt gen-env, macht
# TLS + Images bauen + soc.sh up + auf /health warten + Smoke-Tests.
run "$SCRIPT_DIR/install-prod-fresh.sh" --profile "$FRESH_PROFILE" --domain "$DOMAIN" --admin-email "$ADMIN_EMAIL" --tls-mode "$TLS_MODE"

# Wazuh ist optional und läuft als separater, gepinnter Single-Node-Stack. Erst
# nach einem gesunden Nexora-Core werden Netzwerk, Zertifikate und Zugangsdaten
# erzeugt; ohne Flag bleibt die öffentliche Minimalinstallation schlank.
if [ "$WITH_WAZUH" -eq 1 ]; then
  step "4b. Wazuh Single Node installieren und sicher mit Nexora verbinden"
  run bash "$SCRIPT_DIR/install-wazuh-single-node.sh" --nexora-env "$ENV_FILE"
fi

# ── 5. Collector/Intake-Stack (nur all-in-one, soweit lokal vorhanden) ───────
INTAKE_STARTED=0
if [ "$PROFILE" = "all-in-one" ]; then
  step "5. Collector/Intake-Stack (SIEM · IDS · Firewall über collector-hub)"
  if [ -f "$INTAKE_DIR/docker-compose.yml" ]; then
    # install-dataplane.sh ist idempotent (schreibt nichts Vorhandenes) und übernimmt
    # das Webhook-Secret aus .env.production, falls vorhanden.
    if [ -x "$INTAKE_DIR/install-dataplane.sh" ]; then
      run bash -c "cd '$INTAKE_DIR' && ./install-dataplane.sh" || c_warn "install-dataplane.sh meldete Probleme — Kern läuft trotzdem."
    fi
    if run bash -c "cd '$INTAKE_DIR' && docker compose up -d --build"; then
      INTAKE_STARTED=1; c_ok "Intake/Collector-Stack gestartet (Collector ohne konfigurierte Quelle meldet ehrlich 'source not configured')"
    else
      c_warn "Intake/Collector-Stack konnte nicht starten — Kern läuft weiter. Später: cd deploy/nexora-intake && docker compose up -d --build"
    fi
  fi
fi

# ── 6. Zusammenfassung ───────────────────────────────────────────────────────
step "6. Zusammenfassung"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "  (Dry-Run — kein Stack gestartet. Der obige Ablauf würde real ausgeführt.)"
else
  echo "  Laufende Services (Kern):"
  ( [ -x "$SCRIPT_DIR/soc.sh" ] && "$SCRIPT_DIR/soc.sh" ps 2>/dev/null ) || docker compose -f "$SCRIPT_DIR/docker-compose.prod.yml" ps 2>/dev/null || true
  if [ "$INTAKE_STARTED" -eq 1 ]; then
    echo "  Laufende Services (Collector/Intake):"
    ( cd "$INTAKE_DIR" && docker compose ps 2>/dev/null ) || true
  fi
fi

cat <<SUMMARY

============================================================
  NEXORA SOC — INSTALLATION (Profil: $PROFILE)
------------------------------------------------------------
  UI:        https://${DOMAIN}:443/
  Login:     $ADMIN_EMAIL

  Aktiv:     Core · API · PostgreSQL · Worker · Reverse-Proxy$([ "$PROFILE" = all-in-one ] && echo ' · correlation-worker · Collector/Intake')
  AUS:       DEPLOY_ENABLED · CONFIG_APPLY_ENABLED · AUTONOMY_ENABLED · WAZUH_MANAGER_RESTART_ENABLED

  Nächste Schritte:
    • Browser (Lab): '127.0.0.1 ${DOMAIN}' in /etc/hosts → https://${DOMAIN}/ (self-signed)
    • Smoke:    ./deploy/smoke-test.sh   &&   ./deploy/smoke-csp.sh
    • Betrieb:  ./deploy/soc.sh ps | logs api | restart api | health
    • Quellen anbinden (Wazuh/OPNsense/Suricata): UI → Integrations / Konfiguration
    • (Phase 2, noch nicht enthalten) Remote-Collector-Enrollment · Setup-Wizard
============================================================
SUMMARY

# Zugangsdaten nur beim erstmaligen Erzeugen der geschützten .env ausgeben.
# Bei Re-Runs bleibt das bestehende Passwort absichtlich unsichtbar.
if [ "$DRY_RUN" -eq 0 ] && [ "$ENV_CREATED" -eq 1 ]; then
  env_value() { grep -m1 -E "^$1=" "$ENV_FILE" | cut -d= -f2-; }
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo ""
  echo "============================================================"
  echo "  ADMIN-ERSTANMELDUNG — JETZT SICHER NOTIEREN"
  echo "  URL (DNS): https://${DOMAIN}:443/"
  [ -n "$host_ip" ] && echo "  URL (IP):  https://${host_ip}:443/"
  echo "  Benutzer:   $(env_value ADMIN_EMAIL)"
  echo "  Passwort:   $(env_value ADMIN_PASSWORD)"
  echo "  Beim ersten Login wird ein Passwortwechsel erzwungen."
  echo "============================================================"
fi
