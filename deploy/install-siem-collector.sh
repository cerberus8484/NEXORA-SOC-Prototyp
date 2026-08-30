#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexora SOC — SIEM-Collector auf DIESEM Host installieren (idempotent).
#
# Wird vom Deployment Center über den Control-Adapter `ssh-siem-collector`
# per SSH auf das Ziel gepiped und mit `bash -s` ausgeführt. Die Konfiguration
# kommt als validierte ENV-Preamble vom SSH-Runner — KEINE Nutzereingabe landet
# je in einer Befehlszeile.
#
# INTEGRITÄT (der Kern dieses Skripts):
# Der Collector liegt im privaten Data-Plane-Repo und wird als Release-Artefakt
# verteilt. Dieses Skript lädt es über HTTPS und prüft die SHA256-Prüfsumme gegen
# den vom Aufrufer gelieferten Wert, BEVOR das Binary installiert oder gestartet
# wird. Stimmt sie nicht, wird abgebrochen und die Datei entfernt — es wird NIE
# ungeprüfter Code ausgeführt. Gleicher Maßstab wie GPG-Pinning (Wazuh/apt) und
# Authenticode-Prüfung (Wazuh/MSI).
#
# IDEMPOTENT: Läuft bereits dieselbe Version, bleibt alles unangetastet; das
# Skript stellt nur sicher, dass der Dienst aktiviert und gestartet ist.
#
# Aufruf (direkt, zum Testen):
#   COLLECTOR_VERSION=v1.2.0 COLLECTOR_SHA256=<64 hex> \
#     NEXORA_INTAKE_URL=https://10.0.10.75/api/v1/dataplane/events \
#     ./deploy/install-siem-collector.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

COLLECTOR_VERSION="${COLLECTOR_VERSION:-}"
COLLECTOR_SHA256="${COLLECTOR_SHA256:-}"
NEXORA_INTAKE_URL="${NEXORA_INTAKE_URL:-}"
# Bezugsquelle: Release-Artefakt im Control-Plane-Repo (öffentlich), Binary aus
# dem privaten Data-Plane-Repo. Überschreibbar für Air-Gap/Spiegel.
RELEASE_BASE="${RELEASE_BASE:-https://github.com/cerberus8484/Nexora-Control-Plane/releases/download}"

SERVICE="nexora-siem-collector"
BIN_PATH="/usr/local/bin/${SERVICE}"
CONF_DIR="/etc/nexora"
CONF_PATH="${CONF_DIR}/siem-collector.env"

info(){ echo "==> [siem-collector] $*"; }
die(){  echo "FEHLER: [siem-collector] $*" >&2; exit 1; }

# ── 0. Defense-in-Depth: ENV SELBST validieren ───────────────────────────────
# Nicht nur dem Aufrufer (SSH-Runner) vertrauen — liefe das Skript je über einen
# anderen Pfad, darf nichts Ungültiges in URL oder Dateinamen geraten.
[ -n "$COLLECTOR_VERSION" ] || die "COLLECTOR_VERSION fehlt"
[ -n "$COLLECTOR_SHA256" ]  || die "COLLECTOR_SHA256 fehlt (Prüfsumme ist Pflicht)"
[ -n "$NEXORA_INTAKE_URL" ] || die "NEXORA_INTAKE_URL fehlt"
case "$COLLECTOR_VERSION" in *[!A-Za-z0-9.v-]*) die "ungültige COLLECTOR_VERSION";; esac
case "$COLLECTOR_SHA256"  in *[!a-fA-F0-9]*)   die "ungültige COLLECTOR_SHA256";; esac
[ "${#COLLECTOR_SHA256}" -eq 64 ] || die "COLLECTOR_SHA256 muss 64 Hex-Zeichen haben"
case "$NEXORA_INTAKE_URL" in
  https://*|http://*) ;;
  *) die "NEXORA_INTAKE_URL muss http(s) sein";;
esac
case "$NEXORA_INTAKE_URL" in *[[:space:]]*) die "NEXORA_INTAKE_URL enthält Leerzeichen";; esac

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "Kein root und kein sudo verfügbar."
  SUDO="sudo"
fi
for bin in curl sha256sum install; do
  command -v "$bin" >/dev/null 2>&1 || die "'$bin' fehlt auf dem Ziel-Host."
done

# ── 1. Bereits in dieser Version installiert? → nur Dienst sicherstellen ─────
installed_version() {
  [ -x "$BIN_PATH" ] || return 1
  "$BIN_PATH" --version 2>/dev/null | head -1 || true
}
if cur="$(installed_version)" && [ -n "$cur" ] && printf '%s' "$cur" | grep -qF "$COLLECTOR_VERSION"; then
  info "Version $COLLECTOR_VERSION ist bereits installiert — Binary bleibt unangetastet."
  $SUDO systemctl enable "$SERVICE" >/dev/null 2>&1 || true
  $SUDO systemctl restart "$SERVICE"
  info "Fertig (idempotenter Lauf)."
  exit 0
fi

# ── 2. Artefakt laden ────────────────────────────────────────────────────────
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) GOARCH="amd64";;
  aarch64|arm64) GOARCH="arm64";;
  *) die "nicht unterstützte Architektur: $ARCH";;
esac
ASSET="${SERVICE}_${COLLECTOR_VERSION}_linux_${GOARCH}"
URL="${RELEASE_BASE}/${COLLECTOR_VERSION}/${ASSET}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info "Artefakt laden: $URL"
curl -fsSL --proto '=https' --tlsv1.2 -o "$TMP/collector" "$URL" \
  || die "Download fehlgeschlagen (Version/Architektur vorhanden?)"

# ── 3. INTEGRITÄT PRÜFEN — vor jeder Ausführung ──────────────────────────────
info "SHA256 prüfen…"
ACTUAL="$(sha256sum "$TMP/collector" | awk '{print $1}')"
EXPECTED="$(printf '%s' "$COLLECTOR_SHA256" | tr 'A-F' 'a-f')"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  rm -f "$TMP/collector"
  die "PRÜFSUMME STIMMT NICHT (erwartet $EXPECTED, erhalten $ACTUAL) — Artefakt verworfen, nichts installiert."
fi
info "Prüfsumme verifiziert."

# ── 4. Installieren ──────────────────────────────────────────────────────────
info "Binary installieren → $BIN_PATH"
$SUDO install -m 0755 -o root -g root "$TMP/collector" "$BIN_PATH"

info "Konfiguration schreiben → $CONF_PATH"
$SUDO mkdir -p "$CONF_DIR"
# Erst 0600 anlegen, DANN befüllen — sonst läge das Token kurz world-readable.
$SUDO install -m 0600 -o root -g root /dev/null "$CONF_PATH"
{
  printf 'NEXORA_INTAKE_URL=%s\n' "$NEXORA_INTAKE_URL"
  # Token nur schreiben, wenn geliefert (optional). Es steht NIE in einer
  # Befehlszeile und wird NICHT geloggt — nur in diese 0600-Datei.
  [ -n "${NEXORA_COLLECTOR_TOKEN:-}" ] && printf 'NEXORA_COLLECTOR_TOKEN=%s\n' "$NEXORA_COLLECTOR_TOKEN"
} | $SUDO tee "$CONF_PATH" >/dev/null
$SUDO chmod 0600 "$CONF_PATH"
if [ -n "${NEXORA_COLLECTOR_TOKEN:-}" ]; then
  info "Collector-Credential hinterlegt (0600, nicht im Log)."
else
  info "Kein Credential geliefert — Collector sendet noch nicht authentifiziert."
fi

info "systemd-Unit schreiben"
$SUDO tee "/etc/systemd/system/${SERVICE}.service" >/dev/null <<UNIT
[Unit]
Description=Nexora SIEM-Collector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${CONF_PATH}
ExecStart=${BIN_PATH}
Restart=on-failure
RestartSec=5
# Härtung: der Collector liest Firewall-Logs und sendet — er braucht keine Rechte darüber hinaus.
DynamicUser=no
User=root
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/${SERVICE}
StateDirectory=${SERVICE}

[Install]
WantedBy=multi-user.target
UNIT

# ── 5. Starten ───────────────────────────────────────────────────────────────
info "Dienst aktivieren + starten"
$SUDO systemctl daemon-reload
$SUDO systemctl enable "$SERVICE" >/dev/null 2>&1 || true
$SUDO systemctl restart "$SERVICE"

info "SIEM-Collector $COLLECTOR_VERSION installiert — Ziel: $NEXORA_INTAKE_URL"
info "Prüfen:  systemctl status $SERVICE"
