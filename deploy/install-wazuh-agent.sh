#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexora SOC — Wazuh-Agent auf DIESEM Host installieren (optional, idempotent).
#
# Zweck: Damit der Ziel-Host sich am Wazuh-Manager überwacht, wird der Wazuh-Agent
# installiert und per Auto-Enrollment (Port 1515) registriert.
#
# MULTI-DISTRO: WAZUH_AGENT_OS wählt die Paketmanager-Familie:
#   debian, ubuntu                          → apt   (dpkg)
#   rhel, centos, rocky, alma, fedora, amazon → dnf/yum (rpm)
#   sles, opensuse                          → zypper (rpm)
# Der Wert ist STRIKT allowlisted (case unten) → mappt auf eine FESTE Code-Pfad-
# Familie; es geht NIE ein roher OS-String in einen Befehl. Default = debian ⇒
# bestehende Aufrufe ohne WAZUH_AGENT_OS verhalten sich unverändert (apt/Debian).
#
# OPTIONAL: Ohne gesetztes WAZUH_MANAGER tut das Skript NICHTS (self-skip, Exit 0).
# IDEMPOTENT: Ist der Agent bereits installiert, wird die Konfiguration NICHT
# überschrieben; das Skript stellt nur sicher, dass der Dienst aktiviert + gestartet ist.
#
# Aufruf (direkt):
#   WAZUH_MANAGER=10.0.10.77 ./deploy/install-wazuh-agent.sh                       # Debian/apt
#   WAZUH_MANAGER=10.0.10.77 WAZUH_AGENT_OS=rocky ./deploy/install-wazuh-agent.sh  # RHEL-Familie
#
# HINWEIS (RPM-Familien): Repo-Pfade/Paketnamen folgen der Wazuh-Doku (4.x). Der
# apt-Pfad ist gegen einen Live-Agenten verifiziert; die dnf/zypper-Pfade sind vor
# der Live-Schaltung auf einem echten RHEL-/SLES-Host zu smoke-testen (nicht raten) —
# analog zum GPG-Fingerprint-Prinzip. Bis dahin bleibt Deploy ohnehin DEPLOY_ENABLED-gated.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Konfiguration (ENV überschreibt Defaults) ───────────────────────────────
WAZUH_MANAGER="${WAZUH_MANAGER:-}"                    # Manager-IP/Host — leer ⇒ self-skip
WAZUH_AGENT_VERSION="${WAZUH_AGENT_VERSION:-4.14.6}"  # an Manager-Version anlehnen; leer ⇒ neueste
WAZUH_AGENT_NAME="${WAZUH_AGENT_NAME:-$(hostname)}"   # Registrierungsname am Manager
WAZUH_AGENT_GROUP="${WAZUH_AGENT_GROUP:-}"            # optionale Agenten-Gruppe(n)
WAZUH_AGENT_OS="${WAZUH_AGENT_OS:-debian}"            # Ziel-Distro (Allowlist unten)

# Interne, produktive Konstanten (keine ENV-Knöpfe).
GPG_KEY_URL="https://packages.wazuh.com/key/GPG-KEY-WAZUH"
APT_REPO="https://packages.wazuh.com/4.x/apt/"
YUM_REPO="https://packages.wazuh.com/4.x/yum/"        # rpm-Familien (dnf/yum UND zypper)
KEYRING="/usr/share/keyrings/wazuh.gpg"               # apt: dearmored Keyring
# Verifizierter Wazuh-Signing-Key-Fingerprint (2026-07-04 gegen den Live-Keyring
# eines echten Agenten UND packages.wazuh.com/key gegengeprüft). Gilt für ALLE
# Familien (Wazuh signiert deb + rpm mit demselben Key). Rotiert Wazuh den Key,
# bricht der Install bewusst ab, bis der neue Fingerprint hier steht.
WAZUH_GPG_FPR="0DCFCA5547B19D2A6099506096B3EE5F29111145"

# ── Ausgabe-Helfer ──────────────────────────────────────────────────────────
info(){ echo "==> [wazuh-agent] $*"; }
warn(){ echo "!!  [wazuh-agent] $*" >&2; }
die(){  echo "FEHLER: [wazuh-agent] $*" >&2; exit 1; }

# ── 0. Optional: ohne Manager nichts tun ─────────────────────────────────────
if [ -z "$WAZUH_MANAGER" ]; then
  info "WAZUH_MANAGER nicht gesetzt — Wazuh-Agent-Setup übersprungen (optional)."
  exit 0
fi

# ── 0b. Defense-in-Depth: ENV-Werte SELBST validieren ────────────────────────
case "$WAZUH_MANAGER"       in *[!A-Za-z0-9_.:/@-]*|'') die "ungültiger WAZUH_MANAGER";; esac
case "$WAZUH_AGENT_NAME"    in *[!A-Za-z0-9_.-]*)       die "ungültiger WAZUH_AGENT_NAME";; esac
case "$WAZUH_AGENT_VERSION" in *[!A-Za-z0-9_.:/@-]*)    die "ungültige WAZUH_AGENT_VERSION";; esac

# ── 0c. OS-Allowlist → Paketmanager-Familie (kein roher OS-String in Befehlen) ─
case "$WAZUH_AGENT_OS" in
  debian|ubuntu)                        PKG_FAMILY="apt" ;;
  rhel|centos|rocky|alma|fedora|amazon) PKG_FAMILY="rpm" ;;
  sles|opensuse)                        PKG_FAMILY="zypper" ;;
  *) die "nicht unterstütztes WAZUH_AGENT_OS='$WAZUH_AGENT_OS' (erlaubt: debian ubuntu rhel centos rocky alma fedora amazon sles opensuse)" ;;
esac
info "Ziel-OS '$WAZUH_AGENT_OS' → Paketmanager-Familie '$PKG_FAMILY'."

# Root oder sudo — beide Aufrufwege (Helper=root im CT, Direktlauf=User) tragen.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "Kein root und kein sudo verfügbar."
  SUDO="sudo"
fi

# ── Dienst-Steuerung (systemd bevorzugt, sonst wazuh-control) — familienunabhängig ─
enable_and_start_agent() {
  if command -v systemctl >/dev/null 2>&1; then
    $SUDO systemctl daemon-reload 2>/dev/null || true
    $SUDO systemctl enable wazuh-agent >/dev/null 2>&1 || true
    $SUDO systemctl restart wazuh-agent
  else
    $SUDO /var/ossec/bin/wazuh-control restart
  fi
}
is_agent_active() {
  if command -v systemctl >/dev/null 2>&1; then
    $SUDO systemctl is-active --quiet wazuh-agent 2>/dev/null
  else
    $SUDO /var/ossec/bin/wazuh-control status 2>/dev/null | grep -q 'is running'
  fi
}
ensure_running() {
  if is_agent_active; then
    info "Dienst läuft bereits — keine Änderung."
  else
    info "Dienst aktivieren + starten…"
    enable_and_start_agent
  fi
}

# ── GPG-Key holen + Fingerprint pinnen (kein TOFU) → verifizierte ASCII-Kopie ─
# Lädt den Key in eine temporäre Datei und prüft den primären Fingerprint gegen die
# verifizierte Konstante. Bei Abweichung: Datei löschen + harter Abbruch, BEVOR ein
# Paketmanager den Key benutzt. Gibt den Pfad der verifizierten Key-Datei auf stdout.
fetch_and_verify_key() {
  command -v gpg >/dev/null 2>&1 || die "gpg fehlt — für die Key-Verifikation erforderlich."
  local tmp; tmp="$(mktemp)"
  curl -fsSL "$GPG_KEY_URL" -o "$tmp" || { rm -f "$tmp"; die "GPG-Key-Download fehlgeschlagen."; }
  local got
  got="$(gpg --no-default-keyring --keyring /dev/null --show-keys --with-colons --with-fingerprint "$tmp" 2>/dev/null \
          | awk -F: '/^fpr:/{print $10; exit}')"
  if [ "$got" != "$WAZUH_GPG_FPR" ]; then
    rm -f "$tmp"
    die "GPG-Fingerprint-Mismatch (erwartet $WAZUH_GPG_FPR, erhalten ${got:-<leer>}) — Key verworfen, Abbruch."
  fi
  info "GPG-Fingerprint verifiziert." >&2
  echo "$tmp"
}

# ── Familien-spezifisch: bereits installiert? ────────────────────────────────
agent_installed() {
  case "$PKG_FAMILY" in
    apt)          dpkg-query -W -f='${Status}' wazuh-agent 2>/dev/null | grep -q 'install ok installed' ;;
    rpm|zypper)   rpm -q wazuh-agent >/dev/null 2>&1 ;;
  esac
}

# ── Familien-spezifisch: Repo einrichten + Agent installieren ────────────────
install_apt() {
  info "Prerequisites (gnupg, apt-transport-https, curl, lsb-release)…"
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -y
  $SUDO apt-get install -y gnupg apt-transport-https curl ca-certificates lsb-release
  local keyfile; keyfile="$(fetch_and_verify_key)"
  info "GPG-Key → $KEYRING (signed-by)"
  $SUDO gpg --no-default-keyring --dearmor -o "$KEYRING" < "$keyfile"
  $SUDO chmod 644 "$KEYRING"; rm -f "$keyfile"
  echo "deb [signed-by=$KEYRING] $APT_REPO stable main" | $SUDO tee /etc/apt/sources.list.d/wazuh.list >/dev/null
  $SUDO apt-get update -y
  local pkg="wazuh-agent"; [ -n "$WAZUH_AGENT_VERSION" ] && pkg="wazuh-agent=${WAZUH_AGENT_VERSION}-1"
  info "Installiere $pkg"
  $SUDO env WAZUH_MANAGER="$WAZUH_MANAGER" WAZUH_AGENT_NAME="$WAZUH_AGENT_NAME" WAZUH_AGENT_GROUP="$WAZUH_AGENT_GROUP" \
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$pkg"
  info "Paket auf 'hold' setzen (kein Auto-Upgrade über die Manager-Version)"
  echo "wazuh-agent hold" | $SUDO dpkg --set-selections
}

# Gemeinsame rpm-Repo-Datei (dnf/yum UND zypper lesen dieselbe [wazuh]-Sektion).
write_rpm_repo() {
  local dir="$1"
  $SUDO tee "${dir}/wazuh.repo" >/dev/null <<EOF
[wazuh]
gpgcheck=1
gpgkey=$GPG_KEY_URL
enabled=1
name=Wazuh repository
baseurl=$YUM_REPO
protect=1
EOF
}

install_rpm() {   # dnf bevorzugt, sonst yum
  local mgr; mgr="$(command -v dnf || command -v yum)" || die "Weder dnf noch yum gefunden."
  info "Prerequisites (gnupg2/curl) via ${mgr##*/}…"
  $SUDO "$mgr" install -y gnupg2 curl ca-certificates || warn "Prerequisites teils vorhanden — weiter."
  local keyfile; keyfile="$(fetch_and_verify_key)"
  info "GPG-Key importieren (rpm --import, verifiziert)"
  $SUDO rpm --import "$keyfile"; rm -f "$keyfile"
  write_rpm_repo "/etc/yum.repos.d"
  local pkg="wazuh-agent"; [ -n "$WAZUH_AGENT_VERSION" ] && pkg="wazuh-agent-${WAZUH_AGENT_VERSION}-1"
  info "Installiere $pkg"
  $SUDO env WAZUH_MANAGER="$WAZUH_MANAGER" WAZUH_AGENT_NAME="$WAZUH_AGENT_NAME" WAZUH_AGENT_GROUP="$WAZUH_AGENT_GROUP" \
    "$mgr" install -y "$pkg"
  # Version-Lock best-effort (Plugin evtl. nicht installiert → nur warnen, nicht scheitern).
  $SUDO "$mgr" versionlock add wazuh-agent >/dev/null 2>&1 \
    || warn "versionlock nicht verfügbar — Paket NICHT gepinnt (Plugin fehlt?)."
}

install_zypper() {
  info "Prerequisites (gpg2/curl) via zypper…"
  $SUDO zypper --non-interactive install gpg2 curl ca-certificates || warn "Prerequisites teils vorhanden — weiter."
  local keyfile; keyfile="$(fetch_and_verify_key)"
  info "GPG-Key importieren (rpm --import, verifiziert)"
  $SUDO rpm --import "$keyfile"; rm -f "$keyfile"
  write_rpm_repo "/etc/zypp/repos.d"
  $SUDO zypper --non-interactive --gpg-auto-import-keys refresh wazuh || $SUDO zypper --non-interactive refresh
  local pkg="wazuh-agent"; [ -n "$WAZUH_AGENT_VERSION" ] && pkg="wazuh-agent=${WAZUH_AGENT_VERSION}-1"
  info "Installiere $pkg"
  $SUDO env WAZUH_MANAGER="$WAZUH_MANAGER" WAZUH_AGENT_NAME="$WAZUH_AGENT_NAME" WAZUH_AGENT_GROUP="$WAZUH_AGENT_GROUP" \
    zypper --non-interactive install "$pkg"
  $SUDO zypper addlock wazuh-agent >/dev/null 2>&1 || warn "zypper addlock fehlgeschlagen — Paket NICHT gepinnt."
}

# ── 1. Bereits installiert? → nur Dienst sicherstellen (idempotent) ──────────
if agent_installed; then
  info "wazuh-agent ist bereits installiert — Konfiguration bleibt unangetastet."
  ensure_running
  info "Fertig (idempotenter Lauf)."
  exit 0
fi

# ── 2. Installieren nach Familie ─────────────────────────────────────────────
case "$PKG_FAMILY" in
  apt)    install_apt ;;
  rpm)    install_rpm ;;
  zypper) install_zypper ;;
esac

# ── 3. Aktivieren + starten → Auto-Enrollment über Port 1515 ─────────────────
info "Dienst aktivieren + starten (Auto-Enrollment am Manager $WAZUH_MANAGER über 1515)…"
enable_and_start_agent

info "Wazuh-Agent installiert — OS=$WAZUH_AGENT_OS · Manager=$WAZUH_MANAGER · Name=$WAZUH_AGENT_NAME · Version=${WAZUH_AGENT_VERSION:-latest}."
info "Prüfen: am Manager erscheint '$WAZUH_AGENT_NAME' als 'active' (kann kurz dauern)."
