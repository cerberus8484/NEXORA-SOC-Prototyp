#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 10 — Netzwerk-Bridges auf dem Proxmox-Host
#
# Legt WAN-Bridge (vmbr0) und VLAN-aware Trunk-Bridge (vmbr2) an, plus die
# MGMT-IP des Hosts in VLAN 99 + statische NAS-Route.
#
# SICHERHEIT (aus Lab-Memory): `ifreload -a` reisst die Firewall-Taps von
# OPNsense ab. Darum wird OPNsense VOR dem Reload gestoppt und danach gestartet.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
phase_network() {
  step "Phase 10: Netzwerk-Bridges"
  local IFACES="/etc/network/interfaces"

  if grep -q "auto ${BR_LAN}" "$IFACES" 2>/dev/null; then
    ok "Bridge ${BR_LAN} bereits in ${IFACES} — ueberspringe Schreiben."
  else
    log "Sichere ${IFACES} → ${IFACES}.bak.$(date +%s)"
    cp "$IFACES" "${IFACES}.bak.$(date +%s)"

    log "Schreibe Bridge-Definitionen (WAN ${BR_WAN}, Trunk ${BR_LAN}, MGMT ${PVE_MGMT_IP})"
    cat >> "$IFACES" <<EOF

# ─── Nexora SOC Lab (von deploy-lab.sh, Phase 10) ───
auto ${BR_WAN}
iface ${BR_WAN} inet manual
    bridge-ports ${BR_WAN_PORT}
    bridge-stp off
    bridge-fd 0

auto ${BR_LAN}
iface ${BR_LAN} inet manual
    bridge-ports ${BR_LAN_PORT}
    bridge-stp off
    bridge-fd 0
    bridge-vlan-aware yes
    bridge-vids 2-4094

auto ${BR_LAN}.${VLAN_MGMT}
iface ${BR_LAN}.${VLAN_MGMT} inet static
    address ${PVE_MGMT_IP}
    netmask 255.255.255.0
    gateway ${PVE_MGMT_GW}
    post-up ip route add ${NFS_SERVER}/32 via ${PVE_MGMT_GW} || true
EOF
    ok "Bridge-Definitionen angehaengt."
  fi

  step "ifreload — OPNsense wird vorher gestoppt (Tap-Schutz)"
  local opn_was_running=0
  if vm_running "$OPN_VMID"; then
    opn_was_running=1
    log "Stoppe OPNsense (VM ${OPN_VMID}) vor ifreload …"
    qm stop "$OPN_VMID"; sleep 5
  fi

  confirm "Gleich 'ifreload -a' auf dem Host. NIC-Namen in lab.conf geprueft?"
  ifreload -a || warn "ifreload meldete Fehler — pruefe 'ip link show' und NIC-Namen."

  if (( opn_was_running )); then
    log "Starte OPNsense (VM ${OPN_VMID}) wieder …"
    qm start "$OPN_VMID" || warn "OPNsense-Start fehlgeschlagen — ggf. 'qm reset ${OPN_VMID}'."
  fi

  ok "Phase 10 fertig. Pruefe: ip -br addr | grep ${BR_LAN}"
}
