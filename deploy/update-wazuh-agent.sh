#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexora SOC — Wazuh-Agent auf DIESEM Linux-Host aktualisieren (idempotent).
#
# Gegenstück zu install-wazuh-agent.sh, aber für UPDATES eines bereits installierten
# Agenten (Deployment Center „updatebar", Slice 8). Läuft über den ssh-bash-Runner
# als root; die Ziel-Version kommt (optional) als WAZUH_AGENT_VERSION aus der Umgebung.
#
# PAKETMANAGER wird LOKAL auf dem Host erkannt (command -v apt-get/dnf/yum/zypper) —
# NICHT aus einem übergebenen OS-String. Damit gibt es hier keine Injektionsfläche über
# die Distro-Auswahl, und der Aufrufer (nodeUpdateService) muss die Distro nicht kennen.
#
# SIGNATURPRÜFUNG: Der jeweilige Paketmanager verifiziert die Paketsignatur gegen den
# beim Install gepinnten Wazuh-Keyring (apt: signed-by-Keyring; dnf/zypper: gpgcheck=1).
# Dieses Skript fügt KEINE Repos/Keys hinzu — es aktualisiert nur aus dem, was der
# Installer bereits pinned eingerichtet hat.
#
# IDEMPOTENT / SAFE:
#   - Ist der Wazuh-Agent NICHT installiert ⇒ self-skip (Exit 0), es wird nichts neu
#     installiert (Update ≠ Install).
#   - Ohne WAZUH_AGENT_VERSION ⇒ neueste verfügbare Version aus dem konfigurierten Repo.
#   - Config (ossec.conf) wird NIE überschrieben; nur Paket + Dienst-Neustart.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

WAZUH_AGENT_VERSION="${WAZUH_AGENT_VERSION:-}"   # optional; leer ⇒ neueste
PKG="wazuh-agent"

info(){ echo "==> [wazuh-agent-update] $*"; }
warn(){ echo "!!  [wazuh-agent-update] $*" >&2; }
die(){  echo "FEHLER: [wazuh-agent-update] $*" >&2; exit 1; }

# ── 0. Defense-in-Depth: Ziel-Version SELBST validieren (injektionssicher) ────
# Der Runner (ENV_VAL_RE) lässt ohnehin keine Metazeichen durch; hier zusätzlich ein
# strenges Versionsformat, bevor der Wert in eine Paketmanager-Versionsangabe geht.
if [ -n "$WAZUH_AGENT_VERSION" ]; then
  case "$WAZUH_AGENT_VERSION" in
    [0-9]*) : ;;                                  # muss mit Ziffer beginnen
    *) die "ungültige WAZUH_AGENT_VERSION" ;;
  esac
  if ! printf '%s' "$WAZUH_AGENT_VERSION" | grep -Eq '^[0-9][0-9A-Za-z.:_+~-]{0,31}$'; then
    die "ungültige WAZUH_AGENT_VERSION (Zeichensatz)"
  fi
fi

[ "$(id -u)" = "0" ] || die "muss als root laufen"

# ── 1. Paketmanager LOKAL erkennen (keine Distro-Eingabe von außen) ──────────
detect_pkg() {
  if command -v apt-get >/dev/null 2>&1; then echo apt
  elif command -v dnf   >/dev/null 2>&1; then echo dnf
  elif command -v yum   >/dev/null 2>&1; then echo yum
  elif command -v zypper >/dev/null 2>&1; then echo zypper
  else die "kein unterstützter Paketmanager gefunden (apt/dnf/yum/zypper)"; fi
}
FAMILY="$(detect_pkg)"
info "Paketmanager: $FAMILY"

# ── 2. Self-skip, wenn der Agent nicht installiert ist (Update ≠ Install) ─────
is_installed() {
  case "$FAMILY" in
    apt) dpkg -s "$PKG" >/dev/null 2>&1 ;;
    dnf|yum|zypper) rpm -q "$PKG" >/dev/null 2>&1 ;;
  esac
}
if ! is_installed; then
  info "$PKG ist nicht installiert — Update übersprungen (kein Neu-Install)."
  exit 0
fi

# ── 3. Upgrade (idempotent; Ziel-Version pinnen, falls gesetzt) ──────────────
export DEBIAN_FRONTEND=noninteractive
case "$FAMILY" in
  apt)
    apt-get update -y
    if [ -n "$WAZUH_AGENT_VERSION" ]; then
      apt-get install -y --only-upgrade "${PKG}=${WAZUH_AGENT_VERSION}-1"
    else
      apt-get install -y --only-upgrade "$PKG"
    fi
    ;;
  dnf)
    if [ -n "$WAZUH_AGENT_VERSION" ]; then dnf upgrade -y "${PKG}-${WAZUH_AGENT_VERSION}"; else dnf upgrade -y "$PKG"; fi
    ;;
  yum)
    if [ -n "$WAZUH_AGENT_VERSION" ]; then yum update -y "${PKG}-${WAZUH_AGENT_VERSION}"; else yum update -y "$PKG"; fi
    ;;
  zypper)
    zypper --non-interactive refresh
    if [ -n "$WAZUH_AGENT_VERSION" ]; then zypper --non-interactive install -y "${PKG}-${WAZUH_AGENT_VERSION}"; else zypper --non-interactive update -y "$PKG"; fi
    ;;
esac

# ── 4. Dienst neu starten + verifizieren ─────────────────────────────────────
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
  systemctl restart "$PKG"
  systemctl is-active --quiet "$PKG" || die "$PKG läuft nach dem Update nicht"
else
  # SysV-Fallback (ältere Systeme ohne systemd)
  service "$PKG" restart || /var/ossec/bin/wazuh-control restart
fi

info "Update abgeschlossen (Version: ${WAZUH_AGENT_VERSION:-neueste})."
exit 0
