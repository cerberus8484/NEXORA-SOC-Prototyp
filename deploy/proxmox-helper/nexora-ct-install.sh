#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexora SOC — Proxmox-Host-Helper (im Stil der Proxmox-VE-Helper-Scripts).
#
# EIN Befehl auf der PROXMOX-HOST-Shell (root) legt automatisch einen Debian-LXC
# an, installiert Docker + Nexora und startet die komplette SOC-Plattform.
# Copy-paste → die ganze Maschinerie läuft durch, am Ende steht die Login-URL.
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/cerberus8484/Nexora-Control-Plane/main/deploy/proxmox-helper/nexora-ct-install.sh)"
#
# oder aus einem Checkout:  ./deploy/proxmox-helper/nexora-ct-install.sh
#
# Alles über ENV überschreibbar. Beispiel (statische Lab-IP im 10.0.10.0/24):
#   CTID=120 CT_HOSTNAME=nexora-soc NET=static IP_CIDR=10.0.10.75/24 GATEWAY=10.0.10.1 \
#   BRIDGE=vmbr10 STORAGE=local-zfs DNS=10.0.10.1 \
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/.../nexora-ct-install.sh)"
#
# Der LXC ist unprivilegiert + nesting/keyctl/fuse; Docker nutzt fuse-overlayfs
# (robust auf ZFS-rootfs). Idempotenz-Grenze: eine bestehende CTID wird NICHT
# überschrieben — dann eine andere CTID wählen.
#
# PRIVATES Repo? Zwei Wege (jeweils via stdin in den CT — nie in 'ps'/Log):
#   • DEPLOY_KEY_FILE=/pfad/zum/deploy_key  (EMPFOHLEN) — Read-Only-SSH-Deploy-Key.
#     Landet im CT unter ~/.ssh, Clone via git@github.com, Key BLEIBT für spätere
#     Updates (release.sh git pull) erhalten.
#   • GH_TOKEN=<PAT> — Token nur für den Clone, danach gelöscht; Remote bleibt tokenlos.
#   Bei einem ÖFFENTLICHEN Repo ist beides unnötig (echtes Copy-paste ohne Secret).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Konfiguration (ENV überschreibt Defaults) ───────────────────────────────
CTID="${CTID:-}"                                  # leer → pvesh nextid
CT_HOSTNAME="${CT_HOSTNAME:-nexora-soc}"
DISK_GB="${DISK_GB:-40}"
RAM_MB="${RAM_MB:-8192}"
CORES="${CORES:-4}"
STORAGE="${STORAGE:-local-zfs}"                   # rootfs-Storage
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"     # wo das LXC-Template liegt
TEMPLATE_PREFIX="${TEMPLATE_PREFIX:-debian-12-standard}"
BRIDGE="${BRIDGE:-vmbr0}"
NET="${NET:-dhcp}"                                # dhcp | static
IP_CIDR="${IP_CIDR:-}"                             # static: z.B. 10.0.10.75/24
GATEWAY="${GATEWAY:-}"
DNS="${DNS:-1.1.1.1}"                              # DNS im CT (Install braucht Auflösung)
REPO="${REPO:-https://github.com/cerberus8484/Nexora-Control-Plane.git}"
BRANCH="${BRANCH:-main}"
GH_TOKEN="${GH_TOKEN:-}"                           # privates Repo via PAT (Alternative zum Deploy-Key)
DEPLOY_KEY_FILE="${DEPLOY_KEY_FILE:-}"             # privates Repo via Read-Only-SSH-Deploy-Key (empfohlen)
REPO_SSH="git@github.com:${REPO#https://github.com/}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@nexora.local}"
DOMAIN="${DOMAIN:-}"                               # leer → CT-IP als Domain/CORS/CN
# Deployment-Profil: core = API/Web/DB (Default, wie bisher).
#                    full = zusätzlich Korrelations-Engine als eigener Container.
PROFILE="${PROFILE:-core}"
case "$PROFILE" in core|full) ;; *) echo "FEHLER: PROFILE muss 'core' oder 'full' sein (war: $PROFILE)" >&2; exit 1;; esac
CT_PASSWORD="${CT_PASSWORD:-}"                     # root im CT (Konsole); leer → random

# ── Ausgabe-Helfer ──────────────────────────────────────────────────────────
GN="\033[1;32m"; YW="\033[1;33m"; RD="\033[1;31m"; CL="\033[0m"
info(){ echo -e "${GN}==>${CL} $*"; }
warn(){ echo -e "${YW}!! ${CL} $*"; }
die(){  echo -e "${RD}FEHLER:${CL} $*" >&2; exit 1; }

# ── 0. Vorbedingungen ───────────────────────────────────────────────────────
command -v pct  >/dev/null || die "Gehört auf die PROXMOX-HOST-Shell ('pct' nicht gefunden)."
command -v pveam >/dev/null || die "'pveam' nicht gefunden — kein Proxmox-Host?"
[ "$(id -u)" -eq 0 ] || die "Bitte als root ausführen."

[ -n "$CTID" ] || CTID="$(pvesh get /cluster/nextid)"
pct status "$CTID" >/dev/null 2>&1 && die "CTID $CTID existiert bereits — andere per CTID=… wählen."

# ── 1. Debian-Template sicherstellen ────────────────────────────────────────
info "Debian-Template sicherstellen ($TEMPLATE_PREFIX auf $TEMPLATE_STORAGE)"
TPL_VOLID="$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | awk -v p="$TEMPLATE_PREFIX" '$1 ~ p {print $1; exit}')"
if [ -z "$TPL_VOLID" ]; then
  pveam update >/dev/null 2>&1 || true
  TPL_NAME="$(pveam available --section system | awk -v p="$TEMPLATE_PREFIX" '$2 ~ p {print $2}' | sort -V | tail -1)"
  [ -n "$TPL_NAME" ] || die "Kein '$TEMPLATE_PREFIX'-Template verfügbar (pveam available)."
  info "Lade Template herunter: $TPL_NAME"
  pveam download "$TEMPLATE_STORAGE" "$TPL_NAME" >/dev/null
  TPL_VOLID="$TEMPLATE_STORAGE:vztmpl/$TPL_NAME"
fi
info "Template: $TPL_VOLID"

# ── 2. Netz-Konfiguration ───────────────────────────────────────────────────
if [ "$NET" = "static" ]; then
  [ -n "$IP_CIDR" ] || die "NET=static braucht IP_CIDR (z.B. 10.0.10.75/24)."
  NETCFG="name=eth0,bridge=$BRIDGE,ip=$IP_CIDR"
  [ -n "$GATEWAY" ] && NETCFG="$NETCFG,gw=$GATEWAY"
else
  NETCFG="name=eth0,bridge=$BRIDGE,ip=dhcp"
fi

# ── 3. LXC anlegen (unprivilegiert + Docker-tauglich) ───────────────────────
[ -n "$CT_PASSWORD" ] || CT_PASSWORD="$(openssl rand -base64 18)"
info "Lege LXC $CTID ($CT_HOSTNAME) an — ${CORES} Kerne / ${RAM_MB} MB / ${DISK_GB} G auf $STORAGE"
info "Netz: $NETCFG · DNS: $DNS"
pct create "$CTID" "$TPL_VOLID" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$RAM_MB" --swap 512 \
  --rootfs "$STORAGE:$DISK_GB" \
  --net0 "$NETCFG" \
  --nameserver "$DNS" \
  --unprivileged 1 \
  --features nesting=1,keyctl=1,fuse=1 \
  --onboot 1 \
  --password "$CT_PASSWORD" \
  --description "Nexora SOC (Docker-Stack) — angelegt via proxmox-helper" >/dev/null

info "Starte CT $CTID"
pct start "$CTID"

# ── 4. Auf Netz/DNS im CT warten ────────────────────────────────────────────
info "Warte auf Netzwerk/DNS im CT…"
for i in $(seq 1 45); do
  if pct exec "$CTID" -- getent hosts github.com >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" -eq 45 ] && die "CT hat keine DNS/Netz-Verbindung (DNS=$DNS, BRIDGE=$BRIDGE, GATEWAY prüfen)."
done

# ── 5. Ziel-Domain (CORS/TLS-CN) bestimmen ──────────────────────────────────
INSTALL_DOMAIN="$DOMAIN"
if [ -z "$INSTALL_DOMAIN" ]; then
  if [ "$NET" = "static" ]; then
    INSTALL_DOMAIN="${IP_CIDR%/*}"
  else
    INSTALL_DOMAIN="$(pct exec "$CTID" -- bash -lc "hostname -I | awk '{print \$1}'" | tr -d '[:space:]')"
  fi
fi
info "Ziel-Domain/CN: $INSTALL_DOMAIN"

# ── 5b. Optionales Repo-Secret für PRIVATES Repo sicher in den CT (via stdin) ──
# Immer über stdin (nicht als Argument) → weder in 'ps' noch im Install-Log sichtbar.
if [ -n "$DEPLOY_KEY_FILE" ]; then
  [ -s "$DEPLOY_KEY_FILE" ] || die "DEPLOY_KEY_FILE '$DEPLOY_KEY_FILE' fehlt oder ist leer."
  info "Read-Only-Deploy-Key in den CT bringen (SSH-Clone; via stdin, nicht geloggt)"
  pct exec "$CTID" -- bash -c 'umask 077; mkdir -p /root/.ssh; cat > /root/.ssh/id_ed25519 && chmod 600 /root/.ssh/id_ed25519' < "$DEPLOY_KEY_FILE"
elif [ -n "$GH_TOKEN" ]; then
  info "GitHub-Token für privaten Clone in den CT übertragen (via stdin, nicht geloggt)"
  printf '%s' "$GH_TOKEN" | pct exec "$CTID" -- bash -c 'umask 077; cat > /root/.ghtoken'
fi

# ── 6. Docker + Repo + Nexora im CT installieren ────────────────────────────
info "Installiere Docker + klone Repo + starte Nexora (dauert einige Minuten)…"
LOG="/tmp/nexora-install-${CTID}.log"
pct exec "$CTID" -- bash -lc "
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y git openssh-client openssl curl ca-certificates fuse-overlayfs
  # Docker im unprivilegierten LXC auf ZFS: fuse-overlayfs als Storage-Driver —
  # daemon.json VOR der Docker-Installation ablegen, damit der erste Start ihn nutzt.
  mkdir -p /etc/docker
  printf '{\"storage-driver\":\"fuse-overlayfs\"}\n' > /etc/docker/daemon.json
  # Docker offiziell (docker-ce inkl. Compose-v2-Plugin) — 'docker-compose-plugin'
  # liegt NICHT in den Debian/Ubuntu-Basis-Repos, sondern nur bei download.docker.com.
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl restart docker
  mkdir -p /opt
  if [ -d /opt/SOC-Orchestrator/.git ]; then
    git -C /opt/SOC-Orchestrator fetch origin '$BRANCH' -q
    git -C /opt/SOC-Orchestrator checkout '$BRANCH' -q
    git -C /opt/SOC-Orchestrator pull origin '$BRANCH' -q
  elif [ -f /root/.ssh/id_ed25519 ]; then
    # Privates Repo via Read-Only-Deploy-Key: github.com-Hostkey vertrauen, SSH-Clone.
    # Der Key bleibt im CT → spätere Updates (release.sh 'git pull') funktionieren.
    ssh-keyscan -t ed25519,rsa github.com >> /root/.ssh/known_hosts 2>/dev/null || true
    chmod 644 /root/.ssh/known_hosts 2>/dev/null || true
    git clone --branch '$BRANCH' '$REPO_SSH' /opt/SOC-Orchestrator
  elif [ -s /root/.ghtoken ]; then
    # Privates Repo via PAT: Token nur für den Clone, danach tokenlose Remote-URL
    # setzen (Token NICHT in .git/config persistieren) + Tokendatei löschen.
    T=\$(cat /root/.ghtoken)
    git clone --branch '$BRANCH' \"https://x-access-token:\${T}@${REPO#https://}\" /opt/SOC-Orchestrator
    git -C /opt/SOC-Orchestrator remote set-url origin '$REPO'
    shred -u /root/.ghtoken 2>/dev/null || rm -f /root/.ghtoken
  else
    git clone --branch '$BRANCH' '$REPO' /opt/SOC-Orchestrator
  fi
  cd /opt/SOC-Orchestrator
  # Ausführ-Bit absichern: die deploy/*.sh können ohne +x committet sein (Windows-Clients).
  chmod +x deploy/*.sh 2>/dev/null || true
  ./deploy/install-prod-fresh.sh --domain '$INSTALL_DOMAIN' --admin-email '$ADMIN_EMAIL' --profile '$PROFILE'
" 2>&1 | tee "$LOG"

# ── 7. Admin-Temp-PW herausfangen + Zusammenfassung ─────────────────────────
ADMIN_PW="$(grep -E 'Passwort:' "$LOG" | tail -1 | sed -E 's/.*Passwort:[[:space:]]*//' || true)"

echo ""
echo "============================================================"
echo "  NEXORA SOC LÄUFT — LXC $CTID ($CT_HOSTNAME)"
echo "  URL:        https://$INSTALL_DOMAIN/"
echo "  Login:      $ADMIN_EMAIL"
echo "  Temp-PW:    ${ADMIN_PW:-<siehe $LOG auf dem Host>}"
echo "              -> Passwortwechsel beim ERSTEN Login erzwungen."
echo "  CT betreten: pct enter $CTID"
echo "  CT-root-PW:  $CT_PASSWORD"
echo "  Install-Log: $LOG"
echo "============================================================"
