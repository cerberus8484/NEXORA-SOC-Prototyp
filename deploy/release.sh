#!/usr/bin/env bash
# Release-Skript für SOC Ticket Tool (Produktions-Server).
# Läuft auf dem Server (Ubuntu/Linux), setzt Docker voraus.
#
# Ablauf:
#   1. Aktuellen Branch ermitteln und git pull --ff-only origin <branch>
#   2. Zeigt neue Commits seit dem letzten Pull
#   3. Baut api + web (nur diese zwei; postgres braucht kein Build)
#   4. Rolling-Restart via docker compose up -d
#   5. Wartet 10 s, prüft /health über soc.sh
#   6. Gibt OK oder FEHLER + Exit-Code aus
#
# Nutzung: ./deploy/release.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOC="${SCRIPT_DIR}/soc.sh"

# ── Sicherheits-Check ────────────────────────────────────────────────────────
if [ ! -x "$SOC" ]; then
  echo "FEHLER: $SOC nicht gefunden oder nicht ausführbar." >&2
  exit 1
fi

# ── 1. Aktuelle HEAD-Position merken, dann pullen ────────────────────────────
CURRENT_BRANCH=$(git -C "${SCRIPT_DIR}/.." branch --show-current)

if [ -z "${CURRENT_BRANCH}" ]; then
  echo "FEHLER: Kein aktiver Git-Branch erkannt (detached HEAD)." >&2
  exit 1
fi

echo "==> git pull --ff-only origin ${CURRENT_BRANCH}"
BEFORE=$(git -C "${SCRIPT_DIR}/.." rev-parse HEAD)
git -C "${SCRIPT_DIR}/.." pull --ff-only origin "${CURRENT_BRANCH}"

# ── 2. Was ist neu? ──────────────────────────────────────────────────────────
echo ""
echo "==> Neue Commits:"
git -C "${SCRIPT_DIR}/.." log --oneline "${BEFORE}..HEAD" || echo "  (keine neuen Commits)"
echo ""

# ── 3. Images bauen (nur api + web — postgres nutzt fertiges Image) ──────────
echo "==> docker compose build api web"
"$SOC" build api web

# ── 4. Rolling Restart ───────────────────────────────────────────────────────
echo "==> docker compose up -d"
"$SOC" up

# ── 5. Health-Check (10 s warten, damit Container hochfahren kann) ───────────
echo "==> Warte 10 s auf Start der Container..."
sleep 10

echo "==> Health-Check via soc.sh health"
if "$SOC" health; then
  if [ -x "$SCRIPT_DIR/smoke-csp.sh" ]; then
    echo "==> Header/CSP-Smoke"
    "$SCRIPT_DIR/smoke-csp.sh"
  fi
  echo ""
  echo "======================================"
  echo "  RELEASE OK"
  echo "======================================"
else
  echo ""
  echo "======================================"
  echo "  FEHLER: Health-Check fehlgeschlagen"
  echo "  Logs prüfen: ./deploy/soc.sh logs api"
  echo "======================================"
  exit 1
fi
