#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 40 — Linux-VMs (Wazuh, SOC, Ollama, Kali) via cloud-init
#
# Voll automatisch: Ubuntu-Cloud-Image klonen, statische VLAN-IP, SSH-Key,
# qemu-guest-agent, dann rollenspezifischer Software-Bootstrap (runcmd).
# Idempotent: existierende VMIDs werden uebersprungen.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Rollen-spezifische cloud-init runcmd-Zeilen (Bootstrap). Bewusst schlank —
# die volle App-Konfig steht in docs/07-operations/network.
_role_bootstrap() {
  case "$1" in
    wazuh)  echo 'curl -sO https://packages.wazuh.com/4.7/wazuh-install.sh && bash ./wazuh-install.sh -a -i || true' ;;
    soc)    echo 'curl -fsSL https://get.docker.com | sh && systemctl enable --now docker || true' ;;
    ollama) echo 'curl -fsSL https://ollama.com/install.sh | sh && (echo "[Service]"; echo "Environment=OLLAMA_HOST=0.0.0.0:11434") > /etc/systemd/system/ollama.service.d/override.conf && systemctl daemon-reload && systemctl restart ollama && ollama pull llama3.2:3b || true' ;;
    kali)   echo 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y kali-linux-headless || true' ;;
    *)      echo 'true' ;;
  esac
}

_create_linux_vm() {
  local vmid="$1" name="$2" cpu="$3" ram="$4" disk="$5" vlan="$6" host="$7" role="$8"
  local ip="${NET_SERVERS}.${host}" gw="${GW_SERVERS}"
  case "$vlan" in
    "$VLAN_CLIENTS") ip="${NET_CLIENTS}.${host}"; gw="${GW_CLIENTS}" ;;
    "$VLAN_PENTEST") ip="${NET_PENTEST}.${host}"; gw="${GW_PENTEST}" ;;
    "$VLAN_MGMT")    ip="${NET_MGMT}.${host}";    gw="${GW_MGMT}" ;;
  esac

  if vm_exists "$vmid"; then ok "VM ${vmid} (${name}) existiert — ueberspringe."; return 0; fi

  step "Linux-VM ${vmid} — ${name} (${role}) → ${ip}/24 VLAN ${vlan}"
  [[ -s "${PVE_IMG_DIR}/${IMG_UBUNTU}" ]] || die "Ubuntu-Image fehlt: ${PVE_IMG_DIR}/${IMG_UBUNTU} (Phase 30)."
  [[ -s "$SSH_PUBKEY_FILE" ]] || die "SSH-Public-Key fehlt: ${SSH_PUBKEY_FILE}"

  qm create "$vmid" --name "$name" --ostype l26 --machine q35 \
    --cores "$cpu" --memory "$ram" --sockets 1 \
    --net0 "virtio,bridge=${BR_LAN},tag=${vlan}" \
    --scsihw virtio-scsi-single --agent enabled=1 \
    || die "qm create ${vmid} fehlgeschlagen."

  log "Importiere Disk + cloud-init …"
  qm set "$vmid" --scsi0 "${PVE_STORAGE_VM}:0,import-from=${PVE_IMG_DIR}/${IMG_UBUNTU}" || die "Disk-Import fehlgeschlagen."
  qm disk resize "$vmid" scsi0 "${disk}G" || warn "Resize fehlgeschlagen."
  qm set "$vmid" --ide2 "${PVE_STORAGE_VM}:cloudinit" --boot order=scsi0 --serial0 socket --vga serial0

  # Rollen-Bootstrap als vendor snippet uebergeben wir ueber ciuser + custom user-data nicht trivial;
  # einfache, robuste Variante: ciuser/sshkey + nachgelagertes runcmd via cicustom-Snippet.
  local snip_dir="/var/lib/vz/snippets"; mkdir -p "$snip_dir"
  local snip="${snip_dir}/lab-${vmid}-${role}.yaml"
  cat > "$snip" <<EOF
#cloud-config
package_update: true
packages: [qemu-guest-agent, curl]
runcmd:
  - systemctl enable --now qemu-guest-agent
  - $(_role_bootstrap "$role")
EOF

  qm set "$vmid" \
    --ciuser "$CLOUD_INIT_USER" \
    --cipassword "$(openssl passwd -6 "${LINUX_USER_PW}")" \
    --sshkeys "$SSH_PUBKEY_FILE" \
    --ipconfig0 "ip=${ip}/24,gw=${gw}" \
    --nameserver "${DC_IP} ${OPN_DNS}" \
    --cicustom "user=local:snippets/lab-${vmid}-${role}.yaml" \
    || die "cloud-init-Setup fehlgeschlagen."

  qm start "$vmid" || die "VM-Start ${vmid} fehlgeschlagen."
  ok "VM ${vmid} (${name}) gestartet — Bootstrap laeuft beim ersten Boot (${role})."
}

phase_linux_vms() {
  step "Phase 40: Linux-VMs"
  need_cmd openssl
  need_env LINUX_USER_PW
  for spec in "${LINUX_VMS[@]}"; do
    IFS='|' read -r vmid name cpu ram disk vlan host role <<<"$spec"
    [[ "$role" == "kali" && -z "$IMG_KALI_URL" ]] && { warn "Kali: nutzt Ubuntu-Base + kali-Repo-Bootstrap."; }
    _create_linux_vm "$vmid" "$name" "$cpu" "$ram" "$disk" "$vlan" "$host" "$role"
  done
  ok "Phase 40 fertig. SSH: ssh ${CLOUD_INIT_USER}@${NET_SERVERS}.<host>"
}
