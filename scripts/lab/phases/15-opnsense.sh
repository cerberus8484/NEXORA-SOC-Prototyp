#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 15 — OPNsense-VM erstellen (Firewall + VLAN-Terminator)
#
# Die VM-Erstellung ist scriptbar; die Erstkonfiguration (VLANs, DHCP,
# Firewall, Unbound) erfolgt einmalig in der GUI ODER per config.xml-Import.
# Liegt scripts/lab/assets/opnsense-config.xml vor, wird beim Setup darauf
# verwiesen. Sonst: gefuehrte Checkliste an einem manuellen Tor.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

phase_opnsense() {
  step "Phase 15: OPNsense-VM ${OPN_VMID}"

  if vm_exists "$OPN_VMID"; then
    ok "OPNsense (VM ${OPN_VMID}) existiert — ueberspringe Erstellung."
  else
    [[ -s "${PVE_ISO_DIR}/${ISO_OPNSENSE}" ]] || die "OPNsense-ISO fehlt (Phase 30)."
    log "Erstelle OPNsense-VM (WAN=${BR_WAN}, LAN-Trunk=${BR_LAN})"
    qm create "$OPN_VMID" --name "$OPN_NAME" --ostype l26 --machine q35 --bios ovmf \
      --cores "$OPN_CORES" --memory "$OPN_RAM" --sockets 1 \
      --efidisk0 "${PVE_STORAGE_EFI}:0,efitype=4m" \
      --scsihw virtio-scsi-single \
      --scsi0 "${PVE_STORAGE_VM}:${OPN_DISK},cache=writethrough" \
      --net0 "virtio,bridge=${BR_WAN}" \
      --net1 "virtio,bridge=${BR_LAN}" \
      --ide2 "${PVE_STORAGE_VM}:iso/${ISO_OPNSENSE},media=cdrom" \
      --boot order='ide2;scsi0' \
      || die "qm create OPNsense fehlgeschlagen."
    qm start "$OPN_VMID" || die "OPNsense-Start fehlgeschlagen."
    ok "OPNsense gestartet."
  fi

  echo
  warn "════════ MANUELLES TOR: OPNsense-Erstkonfiguration ════════"
  cat <<EOF
  1. Console (Proxmox GUI → VM ${OPN_VMID}): 'Install (UFS)' → Reboot
  2. Web-UI https://<OPNsense-IP>  (root / opnsense)
  3. Interfaces → Assignments:  net0=WAN (DHCP), net1=LAN (10.99.99.1/24)
  4. Interfaces → Devices → VLAN:  Tags ${VLAN_SERVERS},${VLAN_CLIENTS},${VLAN_PENTEST},${VLAN_MGMT} auf LAN-Parent
  5. Interfaces zuweisen + Static IPs: ${GW_SERVERS}, ${GW_CLIENTS}, ${GW_PENTEST}, ${GW_MGMT}
  6. Services → DHCPv4:  Ranges .100-.200 je VLAN (Servers optional ohne DHCP)
  7. Services → Unbound → General:  ALLE Interfaces auswaehlen
     Advanced → Query Forwarding:  ${AD_DOMAIN} → ${DC_IP}:53
  8. Firewall → Rules:  Servers/Clients/MGMT → any PASS; Pentest isoliert; NAS-Route freigeben
EOF
  [[ -s "$(lab_root)/assets/opnsense-config.xml" ]] \
    && log "config.xml gefunden → System → Configuration → Backups → Restore importieren."
  warn "═══════════════════════════════════════════════════════════"
  confirm "OPNsense fertig konfiguriert & VLAN-Gateways pingbar?"
  ok "Phase 15 fertig."
}
