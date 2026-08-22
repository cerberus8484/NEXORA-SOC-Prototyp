#!/usr/bin/env bash
# Bequemer Wrapper für das Produktions-Compose.
# Setzt -f und --env-file automatisch — funktioniert aus jedem Verzeichnis.
#
#   ./deploy/soc.sh ps
#   ./deploy/soc.sh logs api
#   ./deploy/soc.sh up            (= up -d)
#   ./deploy/soc.sh restart api
#   ./deploy/soc.sh exec api npm run seed:admin
#   ./deploy/soc.sh health        (curl auf /health)
#
# Gibt KEINE Secrets aus.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="$SCRIPT_DIR/docker-compose.prod.yml"
ENV_FILE="$SCRIPT_DIR/.env.production"
WAZUH_BRIDGE="$SCRIPT_DIR/docker-compose.wazuh-bridge.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Fehler: $ENV_FILE fehlt. Aus .env.production.example anlegen und Werte setzen." >&2
  exit 1
fi

# ── Deployment-Profil ────────────────────────────────────────────────────────
# `core` (Default) = API/Web/DB wie bisher. `full` schaltet zusätzlich den
# Korrelations-Worker als eigenen Container frei (Compose-Profil `full`).
# Quelle: Umgebungsvariable NEXORA_PROFILE, sonst der Eintrag in .env.production.
# So wirkt das Profil auf JEDES soc.sh-Kommando (up/ps/logs/restart) einheitlich —
# sonst würde `soc.sh ps` den Worker nicht anzeigen und `down` ihn stehen lassen.
PROFILE="${NEXORA_PROFILE:-$(grep -E '^NEXORA_PROFILE=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)}"
PROFILE_ARGS=()
[ -n "${PROFILE:-}" ] && [ "$PROFILE" != "core" ] && PROFILE_ARGS=(--profile "$PROFILE")

# Wazuh ist ein optionaler, separater Stack. Erst der Installer setzt den Marker,
# wodurch auch alle späteren soc.sh-Kommandos konsistent das gemeinsame Netzwerk
# und den CA-Mount verwenden. Ohne Marker bleibt Compose unverändert.
WAZUH_ENABLED="$(grep -E '^NEXORA_WAZUH_ENABLED=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
COMPOSE_ARGS=(-f "$COMPOSE" --env-file "$ENV_FILE")
if [ "$WAZUH_ENABLED" = "true" ]; then
  [ -f "$WAZUH_BRIDGE" ] || { echo "Fehler: Wazuh-Bridge-Datei fehlt: $WAZUH_BRIDGE" >&2; exit 1; }
  COMPOSE_ARGS+=(-f "$WAZUH_BRIDGE")
fi

cmd="${1:-}"
if [ -z "$cmd" ]; then
  echo "Nutzung: $0 <kommando> [args]   (z. B. ps | logs api | up | restart api | health)" >&2
  echo "Profil:  NEXORA_PROFILE=core|full  (aktuell: ${PROFILE:-core})" >&2
  exit 1
fi
shift || true

case "$cmd" in
  health)
    # Eigenes Kommando — kein docker-compose-Subcommand.
    curl -k -fsS https://localhost/health
    echo
    ;;
  up)
    # immer detached
    docker compose "${COMPOSE_ARGS[@]}" "${PROFILE_ARGS[@]}" up -d "$@"
    rc=$?
    # ── nginx MUSS nach einem api-Recreate neu starten ───────────────────────
    # Gelernt am 2026-08-01: Wird `api` neu erstellt, bekommt der Container eine NEUE
    # IP im Docker-Netz. nginx hat den Upstream aber beim eigenen Start aufgelöst und
    # hält die ALTE IP fest → alles über nginx läuft in HTTP 502 (Login UND die
    # Wazuh-Webhooks), während die API selbst gesund ist und Direktzugriffe (Data-Plane)
    # weiter funktionieren. Der Fehler ist deshalb tückisch: „API healthy, trotzdem 502".
    # Ein nginx-Neustart löst neu auf und kostet ~1 s — im Deploy-Fenster vernachlässigbar.
    if [ "$rc" -eq 0 ] && docker compose "${COMPOSE_ARGS[@]}" "${PROFILE_ARGS[@]}" ps --status running --services 2>/dev/null | grep -qx web; then
      echo "==> nginx neu starten (Upstream-IP neu auflösen)"
      docker compose "${COMPOSE_ARGS[@]}" "${PROFILE_ARGS[@]}" restart web >/dev/null 2>&1 || true
    fi
    exit "$rc"
    ;;
  *)
    exec docker compose "${COMPOSE_ARGS[@]}" "${PROFILE_ARGS[@]}" "$cmd" "$@"
    ;;
esac
