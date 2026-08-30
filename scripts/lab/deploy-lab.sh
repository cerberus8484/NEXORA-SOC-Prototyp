#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexora SOC Lab — Master-Deployer
#
# Faehrt das komplette Lab in Phasen. Idempotent: jede Phase ueberspringt, was
# schon existiert. Einzelne Phasen oder Phasen-Listen sind direkt aufrufbar.
#
# AUSFUEHRUNG: auf dem PROXMOX-HOST als root.
#
#   set -a; source secrets.env; set +a      # Secrets laden
#   ./deploy-lab.sh all                      # komplettes Lab
#   ./deploy-lab.sh network storage isos     # nur diese Phasen
#   ./deploy-lab.sh --yes all                # ohne Rueckfragen (manuelle Tore!)
#   ./deploy-lab.sh list                     # Phasen anzeigen
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/lib/common.sh"
source "${HERE}/lab.conf"
for f in "${HERE}"/phases/*.sh; do source "$f"; done

# Phasen-Reihenfolge:  Schluessel → Funktion
declare -A PHASES=(
  [network]=phase_network
  [storage]=phase_storage
  [isos]=phase_isos
  [opnsense]=phase_opnsense
  [linux]=phase_linux_vms
  [windows]=phase_windows_vms
  [ad]=phase_ad
  [docs]=phase_docs
  [verify]=phase_verify
)
ORDER=(network storage isos opnsense linux windows ad docs verify)

usage() {
  cat <<EOF
Nexora SOC Lab Deployer

  ./deploy-lab.sh [--yes] all|<phase> [<phase> ...]

Phasen (in dieser Reihenfolge bei 'all'):
  network    Bridges vmbr0/vmbr2 + MGMT-IP + NAS-Route (stoppt OPNsense vor ifreload)
  storage    NFS-Storage '${PVE_STORAGE_VM}' registrieren
  isos       OPNsense/virtio/Ubuntu laden; Windows-ISO pruefen
  opnsense   OPNsense-VM erstellen (GUI-Erstkonfig = manuelles Tor)
  linux      Wazuh, SOC, Ollama, Kali via cloud-init (voll automatisch)
  windows    DC01 + WEC01 unattended (autounattend.xml)
  ad         AD-Forest promoten, WEC joinen, WEC-Dienst aktivieren
  docs       Live-Doku von DC01/WEC01 nach docs/07-operations/network/*.md spiegeln
  verify     End-to-End-Checks

Optionen:
  --yes      Manuelle Tore automatisch bestaetigen (Vorsicht!)
  list       Phasen anzeigen und beenden
EOF
}

main() {
  assert_proxmox
  ASSUME_YES=0
  local args=()
  for a in "$@"; do
    case "$a" in
      --yes|-y) ASSUME_YES=1 ;;
      -h|--help) usage; exit 0 ;;
      list) usage; exit 0 ;;
      *) args+=("$a") ;;
    esac
  done
  export ASSUME_YES
  [[ ${#args[@]} -gt 0 ]] || { usage; die "Keine Phase angegeben."; }

  local run=()
  if [[ "${args[0]}" == "all" ]]; then run=("${ORDER[@]}"); else run=("${args[@]}"); fi

  log "Starte Deploy: ${run[*]}"
  for p in "${run[@]}"; do
    [[ -n "${PHASES[$p]:-}" ]] || die "Unbekannte Phase: '$p' (siehe ./deploy-lab.sh list)"
    "${PHASES[$p]}"
  done

  echo
  ok "Deploy fertig: ${run[*]}"
}

main "$@"
