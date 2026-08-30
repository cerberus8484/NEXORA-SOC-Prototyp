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
#   sudo ./deploy/install.sh --profile all-in-one
#   sudo ./deploy/install.sh --profile core --domain soc.firma.de --admin-email admin@firma.de
#   ./deploy/install.sh --profile all-in-one --dry-run     # zeigt den Ablauf, ohne etwas zu tun
#   ./deploy/install.sh --profile all-in-one --reset-admin-password  # Admin-Passwort neu setzen
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
# shellcheck source=lib/admin-password.sh
. "$SCRIPT_DIR/lib/admin-password.sh"
INTAKE_DIR="$SCRIPT_DIR/nexora-intake"

# Safety-Flags, die dieser Installer immer auf false erzwingt.
SAFETY_FLAGS="DEPLOY_ENABLED CONFIG_APPLY_ENABLED AUTONOMY_ENABLED WAZUH_MANAGER_RESTART_ENABLED"

PROFILE="all-in-one"        # Default: lab/demo-freundlich
DOMAIN=""; ADMIN_EMAIL=""
MIN_DISK_GB=10
DRY_RUN=0
RESET_ADMIN_PW=0

# ── kleine Ausgabe-Helfer ────────────────────────────────────────────────────
# Matrix-Palette: 256-Farben-Gruen — 46 hell (Signal), 40 mittel, 22 dunkel (Rahmen).
M_HI=$'\033[38;5;46m'; M_MID=$'\033[38;5;40m'; M_DIM=$'\033[38;5;22m'; M_RST=$'\033[0m'
# Warn/Fehler bleiben bewusst gelb/rot: Ein Fehler darf sich NICHT ins Gruen einfuegen,
# sonst geht er im Farbteppich unter.
c_ok()   { printf "  ${M_HI}✓${M_RST} ${M_MID}%s${M_RST}\n" "$*"; }
c_warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
c_bad()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }
step()   { printf "\n${M_HI}▓▒░${M_RST} ${M_HI}%s${M_RST}\n" "$*"; }
die()    { c_bad "$*"; exit 1; }

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
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
    --profile)     PROFILE="${2:-}"; shift 2;;
    --domain)      DOMAIN="${2:-}"; shift 2;;
    --admin-email) ADMIN_EMAIL="${2:-}"; shift 2;;
    --min-disk-gb) MIN_DISK_GB="${2:-}"; shift 2;;
    --dry-run)     DRY_RUN=1; shift;;
    --reset-admin-password) RESET_ADMIN_PW=1; shift;;
    -h|--help)     usage 0;;
    *) die "Unbekanntes Argument: $1  (--help für Nutzung)";;
  esac
done

case "$PROFILE" in
  all-in-one|core) ;;
  *) die "--profile muss 'all-in-one' oder 'core' sein (war: '$PROFILE')";;
esac

# Profil-Mapping auf install-prod-fresh: core→core (Worker in API), all-in-one→full (eigener Worker-Container).
FRESH_PROFILE="core"; [ "$PROFILE" = "all-in-one" ] && FRESH_PROFILE="full"

# Lab-freundliche Defaults, damit `--profile all-in-one` ohne weitere Flags läuft.
# WICHTIG: NICHT 'localhost' — die Prod-Validierung (validateEnv) lehnt CORS_ORIGINS mit
# 'localhost'/'*' ab und der API-Boot würde fehlschlagen. 'nexora.local' besteht den Check;
# /health ist trotzdem über https://localhost erreichbar (kein Origin), Browser via /etc/hosts.
DOMAIN="${DOMAIN:-nexora.local}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@nexora.local}"

printf "${M_DIM}╔════════════════════════════════════════════════════════════╗${M_RST}\n"
printf "${M_DIM}║${M_RST}   ${M_HI}N E X O R A   S O C${M_RST}  ${M_DIM}//${M_RST}  ${M_MID}Installer${M_RST}                    ${M_DIM}║${M_RST}\n"
printf "${M_DIM}║${M_RST}   ${M_MID}Profil:${M_RST} ${M_HI}%-12s${M_RST} %-28s ${M_DIM}║${M_RST}\n" \
  "$PROFILE" "$([ "$DRY_RUN" -eq 1 ] && echo 'DRY-RUN - nichts wird ausgefuehrt')"
printf "${M_DIM}╚════════════════════════════════════════════════════════════╝${M_RST}\n"

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
ENV_EXISTED=0
if [ -f "$ENV_FILE" ]; then
  ENV_EXISTED=1
  c_ok ".env.production vorhanden — wird unverändert genutzt (nur Safety-Flags werden erzwungen)"
else
  c_warn ".env.production fehlt → generiere (Domain=$DOMAIN, Admin=$ADMIN_EMAIL)"
  run "$SCRIPT_DIR/gen-env-production.sh" --domain "$DOMAIN" --admin-email "$ADMIN_EMAIL"
fi

# ── 3. Safety-Flags erzwingen (Defense-in-Depth) ─────────────────────────────
step "3. Gefährliche Fähigkeiten hart auf false setzen"
for flag in $SAFETY_FLAGS; do set_env_kv "$flag" "false"; c_ok "$flag=false"; done
c_ok "Installation/Analyse/Korrelation aktiv — Apply/Autonomie/Restart bleiben AUS (nur mit expliziter Freigabe)"

# ── 4. Kern-Stack (reused: install-prod-fresh.sh) ────────────────────────────
step "4. Kern-Stack starten (Profil install-prod-fresh: $FRESH_PROFILE)"
# install-prod-fresh.sh sieht das bereits erzeugte .env, überspringt gen-env, macht
# TLS + Images bauen + soc.sh up + auf /health warten + Smoke-Tests.
run "$SCRIPT_DIR/install-prod-fresh.sh" --profile "$FRESH_PROFILE" --domain "$DOMAIN" --admin-email "$ADMIN_EMAIL"

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
  else
    c_warn "Collector/Intake-Stack nicht lokal vorhanden ($INTAKE_DIR) — übersprungen (Data-Plane liegt ggf. im separaten Repo)."
  fi
fi

# ── 5b. Bootstrap-Passwort aus der .env.production entfernen ────────────────
# Der Admin wird beim API-Start angelegt (ensureAdminFromEnv). Ist der Stack gesund,
# hat das stattgefunden — ab da ist ADMIN_PASSWORD nutzlos und waere nur noch ein
# Klartext-Admin-Passwort, das dauerhaft auf der Platte liegt. Der Installer sagt
# "wird nur EINMAL angezeigt"; ohne diesen Schritt stimmt das schlicht nicht.
#
# Gefahrlos: validateEnv prueft ADMIN_PASSWORD nur auf CHANGE_ME-Platzhalter (leer
# ist kein Fehler), und bootstrapAdmin steigt sauber mit 'admin_bootstrap_skipped'
# aus. Neustarts funktionieren also weiter — der Admin liegt in der Datenbank.
if [ "$DRY_RUN" -eq 0 ] && [ -f "$ENV_FILE" ] && grep -qE '^ADMIN_PASSWORD=.+' "$ENV_FILE"; then
  step "5b. Bootstrap-Passwort aufräumen"
  if curl -sk --max-time 10 "https://localhost/api/v1/health" 2>/dev/null | grep -q '"status":"ok"'; then
    # Passwort VOR dem Leeren retten — es soll am Ende nochmal erscheinen, damit es
    # nicht im Build-Log nach oben scrollt und verlorengeht.
    ADMIN_PW_SHOWN="$(grep -E "^ADMIN_PASSWORD=" "$ENV_FILE" | cut -d= -f2-)"
    sed -i 's|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=|' "$ENV_FILE"
    # `sed -i` schreibt eine NEUE Datei und benennt sie um — die 600er-Rechte aus
    # gen-env-production.sh gehen dabei verloren (neue Datei erbt die umask, i.d.R. 644).
    # Die Datei enthaelt weiterhin DB-Passwort, JWT_SECRET und alle Webhook-Secrets.
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    c_ok "ADMIN_PASSWORD aus .env.production entfernt (Admin ist angelegt, Wert nicht mehr nötig)"
    echo "     (Seeding ist idempotent: 'seed:admin' legt nur einen FEHLENDEN Admin an —"
    echo "      ein bestehendes Passwort setzt es NICHT zurueck.)"
  else
    c_warn "API nicht gesund — ADMIN_PASSWORD bleibt vorerst stehen (Admin evtl. noch nicht angelegt)."
  fi
fi

# ── 5c. Admin-Zugang sicherstellen ──────────────────────────────────────────
# Ohne diesen Schritt konnte eine Installation "erfolgreich" enden und trotzdem
# KEIN Admin-Konto haben:
#
#   Erst-Installation → Admin angelegt, ADMIN_PASSWORD danach aus der .env entfernt.
#   Spaeter das DB-Volume geloescht, die .env aber behalten (genau das passiert beim
#   "in Docker alles geloescht"-Neustart) → der Start-Bootstrap findet kein
#   ADMIN_PASSWORD, ueberspringt das Anlegen mit 'admin_bootstrap_skipped' — und
#   niemand merkt es, weil /health gruen ist und der Installer eine Zusammenfassung
#   druckt. Anmelden konnte sich dann niemand mehr.
#
# Deshalb wird hier nach dem Start GEPRUEFT statt vermutet. Das Passwort geht ueber
# eine Pipe in den Container, nicht ueber argv oder die Prozess-Umgebung.
#
# Exit-Codes von adminAccess.js: 0 = angelegt/gesetzt · 2 = war schon da · 1 = Fehler.
if [ "$DRY_RUN" -eq 0 ]; then
  step "5c. Admin-Zugang sicherstellen"
  ADMIN_MODE="--ensure"
  [ "$RESET_ADMIN_PW" -eq 1 ] && ADMIN_MODE="--reset"

  NEW_PW="$(nexora_gen_admin_password)"
  set +e
  ADMIN_OUT="$(printf '%s' "$NEW_PW" | "$SCRIPT_DIR/soc.sh" exec -T api node src/scripts/adminAccess.js "$ADMIN_MODE" 2>&1)"
  ADMIN_RC=$?
  set -e

  case "$ADMIN_RC" in
    0)
      ADMIN_PW_SHOWN="$NEW_PW"
      if [ "$ADMIN_MODE" = "--reset" ]; then
        c_ok "Admin-Passwort zurueckgesetzt — neues Passwort steht im Zugangs-Block unten"
      else
        c_ok "Admin-Konto angelegt — Passwort steht im Zugangs-Block unten"
      fi
      ;;
    2)
      c_ok "Admin-Konto vorhanden — Zugangsdaten bleiben unveraendert"
      ;;
    *)
      # Bewusst laut: ein stilles Weiterlaufen hiesse, der Operator bekommt eine
      # Erfolgsmeldung fuer ein System, in das er sich nicht einloggen kann.
      c_bad "Admin-Zugang konnte nicht hergestellt werden:"
      printf '%s\n' "$ADMIN_OUT" | tail -5
      die "Installation gestoppt — ohne Admin-Konto waere das System nicht bedienbar."
      ;;
  esac
  unset NEW_PW ADMIN_OUT
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

# Der Zugangs-Block unten erscheint nur, wenn dieser Lauf ein Passwort erzeugt hat.
# Die Zusammenfassung darf nicht auf einen Block verweisen, den es dann gar nicht gibt.
if [ -n "${ADMIN_PW_SHOWN:-}" ]; then
  LOGIN_HINT="Passwort siehe Zugangs-Block ganz unten (Wechsel beim ERSTEN Login erzwungen)"
else
  LOGIN_HINT="bestehende Installation — Passwort unverändert"
fi

cat <<SUMMARY

============================================================
  NEXORA SOC — INSTALLATION (Profil: $PROFILE)
------------------------------------------------------------
  UI:        https://${DOMAIN}/
  Login:     $ADMIN_EMAIL — $LOGIN_HINT

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

# ── Zugangsdaten-Block: bewusst GANZ am Ende ────────────────────────────────
# Bei einem Erst-Build scrollt die Ausgabe von Schritt 2 hinter hunderten Zeilen
# Docker-Build-Log nach oben weg. Das Passwort ist dann faktisch verloren, obwohl
# es "angezeigt" wurde. Deshalb hier erneut — es steht danach NICHT mehr auf Platte.
#
# KEIN Kasten mit fester Breite mehr: die rechte Rahmenkante wurde durch Umlaute
# und den Geviertstrich verschoben (printf zaehlt Bytes, das Terminal zaehlt Spalten),
# und ein langes Passwort haette sie ohnehin gesprengt.
#
# Auch KEINE OSC-8-Hyperlinks mehr: in MinTTY/Git-Bash kam davon nur der sichtbare
# Text an, klickbar wurde nichts. Terminals verlinken nackte URLs von sich aus —
# eine vollstaendige URL pro Zeile ist deshalb verlaesslicher als jede Escape-Sequenz.

# Veroeffentlichten HTTPS-Port ermitteln (Fallback 443) — die URL soll auch dann
# stimmen, wenn jemand das Port-Mapping in der Compose-Datei geaendert hat.
web_https_port() {
  local mapped
  mapped="$(docker compose -f "$SCRIPT_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE" port web 443 2>/dev/null | tail -1)"
  mapped="${mapped##*:}"
  case "$mapped" in
    ''|*[!0-9]*) printf '443' ;;
    *)           printf '%s' "$mapped" ;;
  esac
}

# Erste private IPv4 des Hosts — fuer den Zugriff von einem anderen Rechner.
# Bewusst ohne Backslash-Escapes ([.] statt \.), damit die Zeile jede Weitergabe
# durch Editoren und Skripte unbeschadet uebersteht. Findet sich keine IP,
# entfaellt die Zeile in der Ausgabe einfach.
host_lan_ip() {
  { hostname -I 2>/dev/null; ipconfig 2>/dev/null; } |
    grep -oE '[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+' |
    grep -E '^(10[.]|192[.]168[.]|172[.](1[6-9]|2[0-9]|3[01])[.])' |
    head -1
}

if [ "$DRY_RUN" -eq 0 ]; then
  PORT="$(web_https_port)"
  SUFFIX=""; [ "$PORT" != "443" ] && SUFFIX=":$PORT"
  LAN_IP="$(host_lan_ip || true)"

  printf '\n%b\n' "${M_HI}▓▒░ ZUGANG${M_RST}"
  printf '%b\n' "${M_DIM}────────────────────────────────────────────────────────────${M_RST}"
  printf '%b\n' "  ${M_MID}E-Mail:${M_RST}   ${M_HI}${ADMIN_EMAIL}${M_RST}"

  if [ -n "${ADMIN_PW_SHOWN:-}" ]; then
    printf '%b\n' "  ${M_MID}Passwort:${M_RST} ${M_HI}${ADMIN_PW_SHOWN}${M_RST}"
    printf '%b\n' "  ${M_DIM}(nur HIER sichtbar — steht danach nicht mehr auf der Platte)${M_RST}"
    printf '%b\n' "  ${M_DIM}Passwortwechsel wird beim ERSTEN Login erzwungen.${M_RST}"
  else
    printf '%b\n' "  ${M_MID}Passwort:${M_RST} ${M_HI}unveraendert${M_RST} ${M_DIM}(aus der Erst-Installation)${M_RST}"
    printf '%b\n' "  ${M_DIM}Verloren? Neues temporaeres Passwort erzeugen und anzeigen lassen:${M_RST}"
    printf '%b\n' "    ${M_MID}./deploy/install.sh --profile ${PROFILE} --reset-admin-password${M_RST}"
  fi

  printf '\n%b\n' "  ${M_MID}Web-UI — im Browser oeffnen:${M_RST}"
  printf '%b\n' "    ${M_HI}https://127.0.0.1${SUFFIX}/${M_RST}"
  [ -n "$LAN_IP" ] && printf '%b\n' "    ${M_HI}https://${LAN_IP}${SUFFIX}/${M_RST} ${M_DIM}(von einem anderen Rechner im Netz)${M_RST}"
  printf '%b\n' "    ${M_DIM}https://${DOMAIN}${SUFFIX}/ — nur mit '127.0.0.1 ${DOMAIN}' in der hosts-Datei${M_RST}"
  printf '%b\n\n' "  ${M_DIM}Das Zertifikat ist selbstsigniert — die Browserwarnung ist erwartet.${M_RST}"
fi
