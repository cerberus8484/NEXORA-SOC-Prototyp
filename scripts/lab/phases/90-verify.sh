#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 90 — End-to-End-Verifikation
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

_check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$label"; else warn "$label — FEHLGESCHLAGEN"; fi
}

phase_verify() {
  step "Phase 90: Verifikation"

  log "VM-Status:"
  qm list | awk 'NR==1 || /wazuh|nexora-soc|ollama|kali|DC01|WEC01|OPNsense/'

  step "Konnektivitaet (vom Proxmox-Host)"
  _check "Wazuh ${NET_SERVERS}.77 erreichbar"  ping -c1 -W2 "${NET_SERVERS}.77"
  _check "SOC ${NET_SERVERS}.75 erreichbar"     ping -c1 -W2 "${NET_SERVERS}.75"
  _check "Ollama ${NET_SERVERS}.78 erreichbar"  ping -c1 -W2 "${NET_SERVERS}.78"
  _check "DC ${DC_IP} erreichbar"               ping -c1 -W2 "${DC_IP}"
  _check "OPNsense Gateway ${GW_SERVERS}"        ping -c1 -W2 "${GW_SERVERS}"

  step "Dienste"
  _check "Ollama-API :11434"  curl -fsS "http://${NET_SERVERS}.78:11434/api/tags"
  if command -v nslookup >/dev/null 2>&1; then
    _check "DNS dc01.${AD_DOMAIN} via DC"  nslookup "dc01.${AD_DOMAIN}" "${DC_IP}"
    _check "DNS dc01.${AD_DOMAIN} via OPNsense"  nslookup "dc01.${AD_DOMAIN}" "${OPN_DNS}"
  fi

  echo
  ok "Verifikation abgeschlossen. Gelb markierte Punkte einzeln pruefen."
}
