#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Wazuh All-in-One — Proxmox VM 177
#
# Läuft als root auf dem Proxmox-Host.
# Erstellt VM → installiert Ubuntu 24.04 via Cloud-Init → installiert Wazuh →
# konfiguriert Webhook zum SOC Tool.
#
# Ausführen:
#   chmod +x /root/proxmox-install-wazuh.sh
#   /root/proxmox-install-wazuh.sh
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail

# ── Konfiguration ────────────────────────────────────────────────────────────

VMID=177
VM_NAME="wazuh"
BRIDGE="vmbr0"
CORES=4
MEMORY_MB=8192
DISK_SIZE="80G"
STORAGE="NAS"
IMAGE_DIR="/mnt/pve/NAS/template/iso"
IMAGE_URL="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
IMAGE_PATH="${IMAGE_DIR}/noble-server-cloudimg-amd64.img"

VM_IP="192.168.240.77"
VM_CIDR="${VM_IP}/24"
VM_GW="192.168.240.1"
DNS="192.168.240.1"

CI_USER="wazuhadmin"
# VM-Passwort NIE hartcodieren/committen — per Env setzen:
#   CI_PASSWORD='<dein-passwort>' ./deploy/proxmox-install-wazuh.sh
CI_PASSWORD="${CI_PASSWORD:-CHANGE_ME_VM_PASSWORD}"

# SOC Tool — Webhook-Endpunkt (Backend läuft auf 192.168.240.72:8080 via nginx)
# SECRET muss exakt mit WEBHOOK_SECRET_WAZUH in deploy/.env.production übereinstimmen
SOC_TOOL_HOST="192.168.240.75"
SOC_TOOL_PORT="443"          # nginx HTTPS
SOC_WEBHOOK_URL="https://${SOC_TOOL_HOST}/api/v1/integrations/wazuh/webhook"
# Setze hier das Secret das auch im SOC Tool in WEBHOOK_SECRET_WAZUH steht:
WAZUH_WEBHOOK_SECRET="${WAZUH_WEBHOOK_SECRET:-CHANGE_ME_WAZUH_SECRET_32CHARS}"

# Wazuh-Installations-Timeout in Sekunden
WAZUH_TIMEOUT=1800

# ── Farben (TTY- + NO_COLOR-bewusst) ─────────────────────────────────────────
if [[ -t 1 && "${NO_COLOR:-}" != "1" && "${TERM:-}" != "dumb" ]]; then
  C_RESET=$'\e[0m'; C_BOLD=$'\e[1m'; C_DIM=$'\e[2m'
  C_CYAN=$'\e[36m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_RED=$'\e[31m'; C_BLUE=$'\e[34m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_BLUE=''
fi
RULE="$(printf '─%.0s' {1..58})"

# ── Hilfsfunktionen ──────────────────────────────────────────────────────────
STEP_N=0
TOTAL_STEPS=10

banner() {
  printf '\n%s%s' "${C_CYAN}" "${C_BOLD}"
  cat <<'EOF'
  ╔══════════════════════════════════════════════════════════╗
  ║                                                          ║
  ║     N E X O R A   S O C   ·   Wazuh Auto-Installer       ║
  ║     Proxmox VM → Ubuntu 24.04 → Wazuh 4.9 → Webhook      ║
  ║                                                          ║
  ╚══════════════════════════════════════════════════════════╝
EOF
  printf '%s\n' "${C_RESET}"
}

log()  { STEP_N=$((STEP_N + 1)); printf '\n%s▸ [%d/%d] %s%s\n%s  %s%s\n' "${C_CYAN}${C_BOLD}" "${STEP_N}" "${TOTAL_STEPS}" "$*" "${C_RESET}" "${C_DIM}" "${RULE}" "${C_RESET}"; }
step() { printf '   %s•%s %s\n' "${C_BLUE}" "${C_RESET}" "$*"; }
ok()   { printf '   %s✓%s %serledigt%s\n' "${C_GREEN}${C_BOLD}" "${C_RESET}" "${C_DIM}" "${C_RESET}"; }
warn() { printf '   %s⚠%s %s%s%s\n' "${C_YELLOW}${C_BOLD}" "${C_RESET}" "${C_YELLOW}" "$*" "${C_RESET}"; }
fail() { printf '\n   %s✗ FEHLER:%s %s\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$*" >&2; exit 1; }

banner

# ── 0. Preflight ─────────────────────────────────────────────────────────────
log "Preflight"
[[ $EUID -eq 0 ]]           || fail "Als root ausführen (sudo -i)"
command -v qm    >/dev/null  || fail "qm nicht gefunden — auf Proxmox-Host ausführen"
command -v pvesm >/dev/null  || fail "pvesm nicht gefunden"
command -v ssh   >/dev/null  || fail "ssh nicht gefunden"
command -v wget  >/dev/null  || fail "wget nicht gefunden"
command -v ssh-keygen >/dev/null || fail "ssh-keygen nicht gefunden"

if qm status "${VMID}" >/dev/null 2>&1; then
  fail "VMID ${VMID} existiert bereits. Zuerst löschen:
  qm stop ${VMID}
  qm destroy ${VMID} --purge 1 --destroy-unreferenced-disks 1"
fi

pvesm status | awk '{print $1}' | grep -qx "${STORAGE}" \
  || fail "Storage '${STORAGE}' nicht gefunden. Check: pvesm status"

[[ "${WAZUH_WEBHOOK_SECRET}" == "CHANGE_ME_WAZUH_SECRET_32CHARS" ]] && \
  warn "Standard-Webhook-Secret aktiv. Setze WAZUH_WEBHOOK_SECRET=<dein-secret> oder ändere es nach der Installation."
[[ "${CI_PASSWORD}" == "CHANGE_ME_VM_PASSWORD" ]] && \
  fail "CI_PASSWORD nicht gesetzt. Aufruf: CI_PASSWORD='<dein-passwort>' ./deploy/proxmox-install-wazuh.sh"
ok

# ── 1. Cloud-Image ───────────────────────────────────────────────────────────
log "Ubuntu 24.04 Noble Cloud-Image"
mkdir -p "${IMAGE_DIR}"
if [[ -f "${IMAGE_PATH}" ]]; then
  step "Bereits vorhanden: ${IMAGE_PATH}"
else
  step "Download: ${IMAGE_URL}"
  wget -q --show-progress -O "${IMAGE_PATH}" "${IMAGE_URL}"
  step "Download abgeschlossen"
fi
ok

# ── 2. Temporärer SSH-Key ────────────────────────────────────────────────────
log "Temporärer SSH-Key für Automation"
TMP_KEY_DIR=$(mktemp -d)
TMP_PRIV="${TMP_KEY_DIR}/id_ed25519_setup"
TMP_PUB="${TMP_KEY_DIR}/id_ed25519_setup.pub"
ssh-keygen -t ed25519 -N "" -f "${TMP_PRIV}" -C "wazuh-setup-$(date +%s)" -q
SSH_PUBKEY=$(cat "${TMP_PUB}")
step "Key: ${TMP_PRIV}"
ok

# Cleanup bei Exit (Fehler oder Erfolg)
cleanup() {
  rm -rf "${TMP_KEY_DIR}"
}
trap cleanup EXIT

# ── 3. VM erstellen ──────────────────────────────────────────────────────────
log "VM ${VMID} (${VM_NAME}) erstellen"

qm create "${VMID}" \
  --name    "${VM_NAME}" \
  --ostype  l26 \
  --cores   "${CORES}" \
  --memory  "${MEMORY_MB}" \
  --net0    "virtio,bridge=${BRIDGE}" \
  --serial0 socket \
  --vga     serial0 \
  --agent   "enabled=1,fstrim_cloned_disks=1" \
  --onboot  1 \
  --scsihw  virtio-scsi-pci

step "Disk importieren → ${STORAGE}"
qm importdisk "${VMID}" "${IMAGE_PATH}" "${STORAGE}" --format qcow2

# Disk-Volumename per pvesm list ermitteln — unabhängig vom Output-Format
DISK_VOL=$(pvesm list "${STORAGE}" 2>/dev/null \
  | awk 'NR>1 && /vm-'"${VMID}"'-disk/ {print $1}' | head -1)
[[ -n "${DISK_VOL}" ]] || fail "Disk-Volume nach Import nicht gefunden. Check: pvesm list ${STORAGE}"

step "Disk als virtio0 hängen (${DISK_VOL})"
qm set "${VMID}" \
  --virtio0 "${DISK_VOL},cache=writeback,discard=on" \
  --boot    order=virtio0

step "Disk auf ${DISK_SIZE} vergrößern"
qm resize "${VMID}" virtio0 "${DISK_SIZE}"

step "Cloud-Init konfigurieren"
qm set "${VMID}" --ide2 "${STORAGE}:cloudinit"
# sshkeys erwartet eine Datei — temporäre Datei anlegen
TMP_PUBKEY_FILE="${TMP_KEY_DIR}/authorized_keys"
echo "${SSH_PUBKEY}" > "${TMP_PUBKEY_FILE}"
qm set "${VMID}" \
  --ciuser      "${CI_USER}" \
  --cipassword  "${CI_PASSWORD}" \
  --sshkeys     "${TMP_PUBKEY_FILE}" \
  --ipconfig0   "ip=${VM_CIDR},gw=${VM_GW}" \
  --nameserver  "${DNS}" \
  --searchdomain "local"
ok

# ── 4. VM starten ────────────────────────────────────────────────────────────
log "VM ${VMID} starten"
qm start "${VMID}"
step "Warte auf SSH (${VM_IP}) — max. 5 Minuten..."

# accept-new statt no: akzeptiert den Host-Key der frisch erstellten VM beim ersten Connect,
# pinnt ihn aber danach (kein dauerhaftes Ignorieren). Provisioning gegen eine eben erzeugte
# VM in der internen Proxmox-Bridge — MITM-Fenster minimal, aber nicht mehr blind „no".
SSH_OPTS="-i ${TMP_PRIV} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=4 -o BatchMode=yes -o LogLevel=ERROR"

for i in $(seq 1 75); do
  sleep 4
  if ssh ${SSH_OPTS} "${CI_USER}@${VM_IP}" "true" 2>/dev/null; then
    step "SSH bereit nach $((i * 4))s"
    break
  fi
  if [[ $i -eq 75 ]]; then
    fail "VM nicht erreichbar nach 5 min.
    Manuell prüfen: qm terminal ${VMID}
    Dann: ssh ${CI_USER}@${VM_IP}"
  fi
  printf "."
done
echo
ok

# ── 5. Cloud-Init abwarten + Pakete vorbereiten ──────────────────────────────
log "Basis-Setup auf VM"
# shellcheck disable=SC2087
ssh ${SSH_OPTS} "${CI_USER}@${VM_IP}" bash -s << 'REMOTE_SETUP'
  set -e
  echo "  Warte auf Cloud-Init..."
  sudo cloud-init status --wait >/dev/null 2>&1 || true
  # Sicherheitshalber: apt-Lock freiwarten
  for i in $(seq 1 30); do
    sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break
    sleep 2
  done

  echo "  Hostname setzen..."
  sudo hostnamectl set-hostname wazuh-server

  echo "  Paketlisten aktualisieren..."
  sudo apt-get update -qq

  echo "  Abhängigkeiten installieren..."
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    curl wget apt-transport-https gnupg2 lsb-release \
    qemu-guest-agent net-tools > /dev/null 2>&1

  sudo systemctl enable --now qemu-guest-agent 2>/dev/null || true
  echo "  Basis-Setup abgeschlossen"
REMOTE_SETUP
ok

# ── 6. Wazuh installieren ────────────────────────────────────────────────────
log "Wazuh All-in-One installieren (dauert ca. 15–20 Minuten)"
step "Installer wird heruntergeladen..."

# shellcheck disable=SC2087
ssh ${SSH_OPTS} "${CI_USER}@${VM_IP}" bash -s << REMOTE_WAZUH
  set -e
  cd /root || cd ~
  echo "  Wazuh Installer herunterladen..."
  curl -sO https://packages.wazuh.com/4.9/wazuh-install.sh
  curl -sO https://packages.wazuh.com/4.9/config.yml
  echo "  Starte Installation (--no-check-certificates wegen internem Netz)..."
  sudo bash wazuh-install.sh -a 2>&1 | tee /tmp/wazuh-install.log
REMOTE_WAZUH

step "Wazuh-Dienste prüfen..."
# shellcheck disable=SC2087
ssh ${SSH_OPTS} "${CI_USER}@${VM_IP}" bash -s << 'CHECK_SERVICES'
  for svc in wazuh-manager wazuh-indexer wazuh-dashboard; do
    status=$(sudo systemctl is-active "$svc" 2>/dev/null || echo "unknown")
    echo "  $svc: $status"
  done
CHECK_SERVICES
ok

# ── 7. Wazuh-Passwort auslesen ───────────────────────────────────────────────
log "Zugangsdaten sichern"
WAZUH_ADMIN_PASS=$(ssh ${SSH_OPTS} "${CI_USER}@${VM_IP}" \
  "sudo tar -axf ~/wazuh-install-files.tar wazuh-install-files/wazuh-passwords.txt --to-stdout 2>/dev/null \
  | grep -A1 'username.*admin' | grep password | awk '{print \$NF}' | tr -d \"'\"" 2>/dev/null || echo "nicht_lesbar")
step "Dashboard-User:     admin"
step "Dashboard-Passwort: ${WAZUH_ADMIN_PASS}"
ok

# ── 8. Webhook → SOC Tool konfigurieren ─────────────────────────────────────
log "Wazuh-Webhook → SOC Tool (${SOC_WEBHOOK_URL})"

# Python-Integration-Script auf der VM ablegen
# shellcheck disable=SC2087
ssh ${SSH_OPTS} "${CI_USER}@${VM_IP}" bash -s << REMOTE_HOOK
  set -e

  # Verzeichnis für custom integrations
  sudo mkdir -p /var/ossec/integrations

  # HMAC-signierter Webhook-Sender
  sudo tee /var/ossec/integrations/custom-soc-tool >/dev/null << 'PYEOF'
#!/usr/bin/env python3
"""Wazuh Custom Integration → SOC Tool Webhook (HMAC-gesichert)."""
import sys, json, hashlib, hmac, time, ssl
from urllib.request import urlopen, Request
from urllib.error import URLError

SOC_URL    = "${SOC_WEBHOOK_URL}"
SOC_SECRET = b"${WAZUH_WEBHOOK_SECRET}"

def main():
    if len(sys.argv) < 2:
        sys.exit(1)

    alert_file = sys.argv[1]
    try:
        with open(alert_file) as f:
            alert = json.load(f)
    except Exception as e:
        print(f"[soc-hook] Alert lesen fehlgeschlagen: {e}", file=sys.stderr)
        sys.exit(1)

    payload = json.dumps(alert, separators=(',', ':')).encode()
    ts      = str(int(time.time()))
    msg     = f"{ts}.".encode() + payload
    sig     = "sha256=" + hmac.new(SOC_SECRET, msg, hashlib.sha256).hexdigest()

    req = Request(SOC_URL, data=payload, headers={
        "Content-Type":        "application/json",
        "X-Webhook-Signature": sig,
        "X-Webhook-Timestamp": ts,
    })

    # Selbstsignierte Zertifikate intern tolerieren
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode    = ssl.CERT_NONE

    try:
        with urlopen(req, timeout=10, context=ctx) as resp:
            print(f"[soc-hook] Delivered — HTTP {resp.status}", file=sys.stderr)
    except URLError as e:
        print(f"[soc-hook] Delivery failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
PYEOF

  sudo chmod 755 /var/ossec/integrations/custom-soc-tool
  sudo chown root:wazuh /var/ossec/integrations/custom-soc-tool

  echo "  Integration-Script abgelegt"

  # ossec.conf: Integration-Block einfügen (wenn noch nicht vorhanden)
  if ! sudo grep -q "custom-soc-tool" /var/ossec/etc/ossec.conf; then
    sudo python3 - << 'PYCONF'
conf_path = "/var/ossec/etc/ossec.conf"
with open(conf_path) as f:
    conf = f.read()

integration = """
  <!-- SOC Tool Webhook Integration (automatisch eingefügt) -->
  <integration>
    <name>custom-soc-tool</name>
    <level>3</level>
    <alert_format>json</alert_format>
  </integration>
"""

conf = conf.replace("</ossec_config>", integration + "\n</ossec_config>")
with open(conf_path, "w") as f:
    f.write(conf)
print("  Integration in ossec.conf eingefügt")
PYCONF
  else
    echo "  Integration bereits in ossec.conf vorhanden"
  fi

  # Wazuh Manager neu starten
  echo "  Wazuh Manager neu starten..."
  sudo systemctl restart wazuh-manager
  sleep 5
  sudo systemctl is-active wazuh-manager
REMOTE_HOOK
ok

# ── 9. Snapshot (Grundzustand sichern) ──────────────────────────────────────
log "Proxmox Snapshot anlegen (post-install-clean)"
qm snapshot "${VMID}" "post-install-clean" \
  --description "Wazuh All-in-One frisch installiert — $(date '+%Y-%m-%d %H:%M')" \
  2>/dev/null && step "Snapshot: post-install-clean" || step "Snapshot fehlgeschlagen (nicht kritisch)"
ok

# ── 10. Zusammenfassung ──────────────────────────────────────────────────────
kv() { printf '   %s%-13s%s %s\n' "${C_DIM}" "$1" "${C_RESET}" "$2"; }

printf '\n%s  ╔══════════════════════════════════════════════════════════╗%s\n' "${C_GREEN}${C_BOLD}" "${C_RESET}"
printf '%s  ║   ✓  Wazuh All-in-One — INSTALLIERT                       ║%s\n'   "${C_GREEN}${C_BOLD}" "${C_RESET}"
printf '%s  ╚══════════════════════════════════════════════════════════╝%s\n\n' "${C_GREEN}${C_BOLD}" "${C_RESET}"

printf '  %sZugang%s\n' "${C_CYAN}${C_BOLD}" "${C_RESET}"
kv "Dashboard"   "https://${VM_IP}"
kv "User"        "admin"
kv "Passwort"    "${C_YELLOW}${WAZUH_ADMIN_PASS}${C_RESET}"
echo
kv "VM-Login"    "ssh ${CI_USER}@${VM_IP}"
kv "VM-Passwort" "${C_YELLOW}${CI_PASSWORD}${C_RESET}"
echo
kv "Webhook"     "${SOC_WEBHOOK_URL}"
kv "Secret"      "${C_YELLOW}${WAZUH_WEBHOOK_SECRET}${C_RESET}"
echo
printf '  %sNÄCHSTE SCHRITTE%s\n' "${C_CYAN}${C_BOLD}" "${C_RESET}"
echo ""
echo "  1. SOC Tool .env.production — Wazuh-Secret eintragen:"
echo "     WEBHOOK_SECRET_WAZUH=${WAZUH_WEBHOOK_SECRET}"
echo "     Dann: docker-compose -f deploy/docker-compose.prod.yml"
echo "           --env-file deploy/.env.production up -d --force-recreate api"
echo ""
echo "  2. Wazuh Dashboard öffnen: https://${VM_IP}"
echo "     → Agenten registrieren (Windows/Linux Endpoints)"
echo ""
echo "  3. Smoke-Test Webhook (vom SOC-Tool-Host ausführen):"
echo "     BODY='{\"rule\":{\"id\":\"1002\",\"level\":5,\"description\":\"Smoke Test\"},"
echo "           \"agent\":{\"id\":\"000\",\"name\":\"wazuh-server\",\"ip\":\"${VM_IP}\"},"
echo "           \"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}'"
echo "     TS=\$(date +%s)"
echo "     SIG=\"sha256=\$(echo -n \"\${TS}.\${BODY}\" | openssl dgst -sha256 -hmac '${WAZUH_WEBHOOK_SECRET}' | cut -d' ' -f2)\""
echo "     curl -k -X POST ${SOC_WEBHOOK_URL}"
echo "          -H 'Content-Type: application/json'"
echo "          -H \"X-Webhook-Signature: \${SIG}\""
echo "          -H \"X-Webhook-Timestamp: \${TS}\""
echo "          -d \"\${BODY}\""
echo ""
printf '\n  %s4. Passwörter nach dem ersten Login ändern!%s\n' "${C_YELLOW}${C_BOLD}" "${C_RESET}"
printf '\n  %s↺ Proxmox Snapshot:%s post-install-clean (Rollback möglich)\n' "${C_DIM}" "${C_RESET}"
printf '%s  %s%s\n' "${C_GREEN}" "${RULE}" "${C_RESET}"
