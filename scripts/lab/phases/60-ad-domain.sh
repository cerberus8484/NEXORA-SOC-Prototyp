#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 60 — Active Directory: DC promoten, WEC joinen, WEC-Dienst aktivieren
#
# Setzt voraus, dass Phase 50 durchlief und beide Windows-VMs den Guest-Agent
# anbieten. Laeuft komplett ueber qm guest exec.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

_dc_vmid()  { for s in "${WIN_VMS[@]}"; do IFS='|' read -r id _ _ _ _ _ _ role _ <<<"$s"; [[ "$role" == "dc"  ]] && { echo "$id"; return; }; done; }
_wec_vmid() { for s in "${WIN_VMS[@]}"; do IFS='|' read -r id _ _ _ _ _ _ role _ <<<"$s"; [[ "$role" == "wec" ]] && { echo "$id"; return; }; done; }

# Wartet, bis der DC die Domaene wirklich bedient (LDAP/DNS), nicht nur bootet.
_wait_for_ad() {
  local vmid="$1" timeout=900 waited=0
  log "Warte auf AD-Dienst auf DC (max ${timeout}s) …"
  while (( waited < timeout )); do
    if qm guest exec "$vmid" -- powershell -NoProfile -Command \
       "(Get-Service NTDS -ErrorAction SilentlyContinue).Status" 2>/dev/null | grep -q Running; then
      ok "AD (NTDS) laeuft."; return 0
    fi
    sleep 20; waited=$((waited+20))
  done
  die "AD auf DC nach ${timeout}s nicht bereit."
}

phase_ad() {
  step "Phase 60: Active Directory"
  need_env AD_ADMIN_PW; need_env AD_DSRM_PW
  local dc wec; dc="$(_dc_vmid)"; wec="$(_wec_vmid)"
  [[ -n "$dc" && -n "$wec" ]] || die "DC/WEC VMID nicht in WIN_VMS gefunden."

  # ── DC: AD-Forest promoten (idempotent: nur wenn noch kein NTDS laeuft) ──
  wait_for_agent "$dc"
  if qm guest exec "$dc" -- powershell -NoProfile -Command \
     "(Get-Service NTDS -ErrorAction SilentlyContinue).Status" 2>/dev/null | grep -q Running; then
    ok "DC ist bereits Domain Controller — ueberspringe Promotion."
  else
    step "DC ${dc}: AD-Forest ${AD_DOMAIN} promoten"
    win_ps "$dc" "Install-WindowsFeature AD-Domain-Services,DNS -IncludeManagementTools"
    win_ps "$dc" "\$pw = ConvertTo-SecureString '${AD_DSRM_PW}' -AsPlainText -Force; \
      Install-ADDSForest -DomainName '${AD_DOMAIN}' -DomainNetbiosName '${AD_NETBIOS}' \
      -InstallDns -SafeModeAdministratorPassword \$pw -Force -NoRebootOnCompletion"
    log "Reboot DC fuer AD-Aktivierung …"
    qm guest exec "$dc" -- powershell -NoProfile -Command "Restart-Computer -Force" || true
    sleep 60
    wait_for_agent "$dc"
    _wait_for_ad "$dc"
  fi

  # ── WEC: Domain-Join (idempotent: nur wenn noch nicht Mitglied) ──
  wait_for_agent "$wec"
  if qm guest exec "$wec" -- powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).PartOfDomain" 2>/dev/null | grep -qi True; then
    ok "WEC ist bereits Domaenenmitglied — ueberspringe Join."
  else
    step "WEC ${wec}: Join nach ${AD_DOMAIN}"
    win_ps "$wec" "\$p = ConvertTo-SecureString '${AD_ADMIN_PW}' -AsPlainText -Force; \
      \$c = New-Object PSCredential('${AD_NETBIOS}\\Administrator', \$p); \
      Add-Computer -DomainName '${AD_DOMAIN}' -Credential \$c -Force -Restart"
    log "WEC rebootet fuer Domain-Join …"; sleep 90
    wait_for_agent "$wec"
  fi

  # ── WEC-Dienst aktivieren ──
  step "WEC ${wec}: Windows Event Collector aktivieren"
  win_ps "$wec" "wecutil qc /q; (Get-Service Wecsvc).Status"

  # AD-Zustand hat sich geaendert → Doku sofort neu spiegeln
  if declare -f phase_docs >/dev/null 2>&1; then
    log "AD geaendert → Doku wird aktualisiert (phase_docs)"
    phase_docs || warn "Doku-Generierung meldete Fehler — separat 'deploy-lab.sh docs' laufen lassen."
  fi

  ok "Phase 60 fertig — DC + WEC live, Doku aktualisiert."
}
