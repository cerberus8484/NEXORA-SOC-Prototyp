#!/usr/bin/env bash
# Bootstrap einer FRISCHEN Linux-VM (Debian/Ubuntu, z.B. auf Proxmox 9) für Nexora SOC.
#
# Bereitet den Host vor, BIS install-prod-fresh.sh laufen kann:
#   1. apt-Pakete: docker.io + docker-compose-plugin + git + openssl + curl
#   2. Docker aktivieren + den Benutzer in die docker-Gruppe
#   3. Repo nach /opt/SOC-Orchestrator klonen (oder pullen)
#
# Danach:
#   cd /opt/SOC-Orchestrator && ./deploy/install-prod-fresh.sh --domain ... --admin-email ...
#
# Idempotent: bereits Installiertes/Geklontes wird übersprungen/aktualisiert.
# Mit sudo oder als root ausführen (apt install).
#
# Nutzung:
#   ./proxmox-vm-bootstrap.sh --repo https://github.com/cerberus8484/Nexora-Control-Plane.git [--branch main]
set -euo pipefail

REPO=""; BRANCH="main"; TARGET_DIR="/opt/SOC-Orchestrator"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)   REPO="$2"; shift 2;;
    --branch) BRANCH="$2"; shift 2;;
    --dir)    TARGET_DIR="$2"; shift 2;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 1;;
  esac
done

[ -n "$REPO" ] || { echo "FEHLER: --repo <git-url> erforderlich." >&2; exit 1; }

# sudo nur wenn nicht root.
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

# ── 1. Paketquelle prüfen (nur Debian/Ubuntu = apt) ──────────────────────────
command -v apt-get >/dev/null || {
  echo "FEHLER: Kein apt-get gefunden. Dieses Script unterstützt Debian/Ubuntu." >&2
  echo "        Auf anderen Distros Docker/git/openssl/curl manuell installieren." >&2
  exit 1
}

echo "==> Basis-Pakete installieren (git, openssl, curl, ca-certificates)"
$SUDO apt-get update -y
$SUDO apt-get install -y git openssl curl ca-certificates

echo "==> Docker installieren (offiziell, inkl. Compose-v2-Plugin)"
# 'docker-compose-plugin' liegt NICHT in den Debian/Ubuntu-Basis-Repos, sondern nur
# bei download.docker.com. get.docker.com richtet das offizielle Repo ein und liefert
# docker-ce + docker-compose-plugin (= 'docker compose' V2) auf Debian UND Ubuntu.
curl -fsSL https://get.docker.com | $SUDO sh

echo "==> Docker aktivieren"
$SUDO systemctl enable --now docker

# Benutzer in docker-Gruppe (für rootless docker-Aufrufe; greift nach Neu-Login).
if [ "$(id -u)" -ne 0 ]; then
  $SUDO usermod -aG docker "$USER" || true
  echo "    Hinweis: einmal ab- und wieder anmelden, damit die docker-Gruppe greift"
  echo "    (oder die folgenden Schritte mit 'sudo' ausführen)."
fi

# ── 2. Verifikation ──────────────────────────────────────────────────────────
echo "==> Versionen"
docker --version || true
docker compose version || true
git --version || true

# ── 3. Repo klonen oder aktualisieren ────────────────────────────────────────
mkdir -p "$(dirname "$TARGET_DIR")"
if [ -d "$TARGET_DIR/.git" ]; then
  echo "==> Repo existiert — aktualisiere ($BRANCH)"
  git -C "$TARGET_DIR" fetch origin "$BRANCH" --quiet
  git -C "$TARGET_DIR" checkout "$BRANCH" --quiet
  git -C "$TARGET_DIR" pull origin "$BRANCH" --quiet
else
  echo "==> Repo klonen nach $TARGET_DIR ($BRANCH)"
  git clone --branch "$BRANCH" "$REPO" "$TARGET_DIR"
fi

echo ""
echo "============================================================"
echo "  HOST BEREIT."
echo "  Weiter mit:"
echo "    cd $TARGET_DIR"
echo "    ./deploy/install-prod-fresh.sh --domain <soc.firma.de> --admin-email <admin@firma.de>"
echo ""
echo "  (Umzug MIT Daten? Vorher alte .env.production + Backup + ~/.soc_backup_pass"
echo "   einspielen — siehe docs/03-admin-guide/migration-old-to-new.md)"
echo "============================================================"
