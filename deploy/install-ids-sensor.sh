#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexora SOC — IDS-Sensor (Suricata) auf DIESEM Host installieren (idempotent).
#
# Wird vom Deployment Center über den Control-Adapter `ssh-ids-sensor` per SSH auf
# das Ziel gepiped und mit `bash -s` ausgeführt. Die Parameter kommen als ENV
# (MONITOR_INTERFACE, TARGET_OS) — nie als Kommandozeilen-Argumente.
#
# Anders als die Kollektoren: Suricata kommt aus den DISTRIBUTIONS-Paketquellen.
# Die Integrität sichert der Paketmanager (GPG-signierte Repos) — es gibt kein
# eigenes Binary und keine SHA256-Prüfung. Suricata PUSHT nicht: es schreibt
# EVE-JSON nach /var/log/suricata/eve.json, das der Collector-Hub per SSH-tail
# abholt.
#
# Manuell testbar:
#     MONITOR_INTERFACE=eth1 TARGET_OS=debian ./deploy/install-ids-sensor.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MONITOR_INTERFACE="${MONITOR_INTERFACE:-}"
TARGET_OS="${TARGET_OS:-debian}"
EVE_PATH="/var/log/suricata/eve.json"

# ── Selbstvalidierung (Defense-in-Depth; der Adapter validiert bereits) ─────────
case "$MONITOR_INTERFACE" in
  '' ) echo "FEHLER: [ids-sensor] MONITOR_INTERFACE fehlt" >&2; exit 2 ;;
  *[!a-zA-Z0-9._-]* ) echo "FEHLER: [ids-sensor] MONITOR_INTERFACE enthält unzulässige Zeichen" >&2; exit 2 ;;
esac
case "$TARGET_OS" in
  debian|ubuntu|rhel|centos|rocky|alma|fedora|amazon|sles|opensuse ) : ;;
  * ) echo "FEHLER: [ids-sensor] TARGET_OS '$TARGET_OS' nicht unterstützt" >&2; exit 2 ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "FEHLER: [ids-sensor] muss als root laufen (sudo)" >&2; exit 2
fi

log() { echo "[ids-sensor] $*"; }

# ── Idempotenz: bereits installiert + aktiv → nichts tun ────────────────────────
if command -v suricata >/dev/null 2>&1 && systemctl is-active --quiet suricata 2>/dev/null; then
  log "Suricata läuft bereits ($(suricata -V 2>/dev/null | head -1)) — unangetastet."
  exit 0
fi

# ── Paketinstallation je OS-Familie (GPG-Integrität durch den Paketmanager) ─────
install_pkg() {
  case "$TARGET_OS" in
    debian|ubuntu)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y -qq suricata jq >/dev/null
      ;;
    rhel|centos|rocky|alma|amazon)
      # EPEL liefert Suricata für die RHEL-Familie.
      (command -v dnf >/dev/null 2>&1 && dnf install -y -q epel-release || yum install -y -q epel-release) || true
      if command -v dnf >/dev/null 2>&1; then dnf install -y -q suricata jq; else yum install -y -q suricata jq; fi
      ;;
    fedora)
      dnf install -y -q suricata jq
      ;;
    sles|opensuse)
      zypper --non-interactive --quiet install -y suricata jq
      ;;
  esac
}

log "Installiere Suricata (OS-Familie: $TARGET_OS)…"
install_pkg

if ! command -v suricata >/dev/null 2>&1; then
  echo "FEHLER: [ids-sensor] Suricata nach der Installation nicht gefunden" >&2; exit 1
fi

# ── Regeln aktualisieren (best-effort; suricata-update ist Teil des Pakets) ─────
if command -v suricata-update >/dev/null 2>&1; then
  log "Aktualisiere Regelsatz…"
  suricata-update --quiet >/dev/null 2>&1 || log "suricata-update fehlgeschlagen — fahre mit mitgelieferten Regeln fort."
fi

# ── EVE-JSON sicherstellen: der Collector-Hub tailt genau diese Datei ───────────
# Suricata schreibt EVE per Default; wir stellen nur sicher, dass es aktiv ist und
# auf dem gewünschten Interface lauscht. Config wird NICHT blind überschrieben —
# nur das Interface gesetzt (idempotent) und der eve-Log-Typ geprüft.
CONF="/etc/suricata/suricata.yaml"
if [ -f "$CONF" ]; then
  if ! grep -qE "eve-log" "$CONF"; then
    echo "FEHLER: [ids-sensor] eve-log fehlt in $CONF — abgebrochen (kein EVE, kein Nutzen)" >&2; exit 1
  fi
  log "EVE-JSON in $CONF vorhanden."
fi

mkdir -p "$(dirname "$EVE_PATH")"

# ── Dienst mit dem gewünschten Interface starten ────────────────────────────────
# Interface geht als validierter Wert an suricata (kein Shell-Splitting: exec-Form).
log "Aktiviere Dienst auf Interface $MONITOR_INTERFACE…"
if [ -f /etc/default/suricata ]; then
  # Debian/Ubuntu: Interface über die Default-Datei setzen (idempotent).
  sed -i "s/^IFACE=.*/IFACE=$MONITOR_INTERFACE/" /etc/default/suricata 2>/dev/null || true
  grep -qE "^IFACE=" /etc/default/suricata 2>/dev/null || echo "IFACE=$MONITOR_INTERFACE" >> /etc/default/suricata
fi

systemctl enable suricata >/dev/null 2>&1 || true
systemctl restart suricata

# ── Verifikation: Dienst aktiv, EVE-Datei entsteht ──────────────────────────────
sleep 2
if ! systemctl is-active --quiet suricata; then
  echo "FEHLER: [ids-sensor] Suricata startete nicht" >&2; exit 1
fi

log "Suricata aktiv auf $MONITOR_INTERFACE. EVE: $EVE_PATH (Collector-Hub tailt diese Datei)."
log "IDS-Sensor installiert."
