#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Installiert/entfernt einen Cron-Job auf dem Proxmox-Host, der die Windows-
# Live-Doku regelmaessig neu spiegelt — so ist die Doku immer aktuell, auch
# ohne expliziten Deploy-Lauf.
#
#   ./install-doc-cron.sh install [INTERVALL_MIN]   # default 15 Min
#   ./install-doc-cron.sh remove
#   ./install-doc-cron.sh status
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRON_TAG="# nexora-lab-docs"
LOG="/var/log/nexora-lab-docs.log"

_cmd() {
  # Secrets sind fuer 'docs' nicht noetig (nur Lesezugriff) → kein source secrets.env.
  echo "cd ${HERE} && DOC_GIT_COMMIT=1 ./deploy-lab.sh docs >> ${LOG} 2>&1 ${CRON_TAG}"
}

case "${1:-status}" in
  install)
    interval="${2:-15}"
    [[ "$interval" =~ ^[0-9]+$ ]] || { echo "Intervall muss Zahl (Minuten) sein."; exit 1; }
    line="*/${interval} * * * * $(_cmd)"
    tmp="$(mktemp)"
    crontab -l 2>/dev/null | grep -v "$CRON_TAG" > "$tmp" || true
    echo "$line" >> "$tmp"
    crontab "$tmp"; rm -f "$tmp"
    echo "✔️  Cron installiert: alle ${interval} Min → ${LOG}"
    echo "   $line"
    ;;
  remove)
    tmp="$(mktemp)"
    crontab -l 2>/dev/null | grep -v "$CRON_TAG" > "$tmp" || true
    crontab "$tmp"; rm -f "$tmp"
    echo "✔️  Cron entfernt."
    ;;
  status)
    if crontab -l 2>/dev/null | grep -q "$CRON_TAG"; then
      echo "Aktiv:"; crontab -l | grep "$CRON_TAG"
    else
      echo "Kein Doku-Cron installiert."
    fi
    ;;
  *) echo "Usage: $0 install [min] | remove | status"; exit 1 ;;
esac
