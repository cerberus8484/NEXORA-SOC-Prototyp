#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 70 — Auto-Doku: Live-Zustand von DC01 & WEC01 nach Markdown spiegeln
#
# Fragt die Windows-Hosts per qm guest exec ab (Dienste, DNS, AD, Netzwerk,
# WEC-Subscriptions, Wazuh-Agent) und schreibt docs/07-operations/network/dc01-config.md
# und wec01-config.md NEU. Die Dateien sind generiert — nicht manuell editieren.
#
# Damit ist die Doku immer ein echter Spiegel: laeuft nach Phase 'ad', per
# './deploy-lab.sh docs' und per Cron (install-doc-cron.sh).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Zielverzeichnis aufloesen (siehe lab.conf DOC_OUT_DIR)
_resolve_doc_dir() {
  if [[ -n "${DOC_OUT_DIR:-}" ]]; then echo "$DOC_OUT_DIR"; return; fi
  local repo_docs; repo_docs="$(cd "$(lab_root)/../.." 2>/dev/null && pwd)/docs/07-operations/network"
  if [[ -d "$repo_docs" ]]; then echo "$repo_docs"; else echo "$(lab_root)/generated-docs"; fi
}

# Rendert eine Doku-Sektion: ## Titel + Code-Block mit Live-Ausgabe.
# $1=outfile  $2=titel  $3=ausgabe (leer → Hinweis)
_section() {
  local out="$1" title="$2" body="$3"
  { echo "## ${title}"; echo; echo '```text';
    if [[ -n "${body//[$'\t\r\n ']/}" ]]; then echo "$body"; else echo "(keine Daten — Host offline oder Befehl n/a)"; fi
    echo '```'; echo;
  } >> "$out"
}

_doc_header() {
  local out="$1" host="$2" ip="$3"
  : > "$out"
  {
    echo "# ${host} — Live-Konfiguration (AUTO-GENERIERT)"
    echo
    echo "> ⚠️ **Generierte Datei — nicht manuell editieren.** Wird von"
    echo "> \`scripts/lab/deploy-lab.sh docs\` aus dem Live-Zustand neu geschrieben."
    echo
    echo "| | |"
    echo "|---|---|"
    echo "| **Host** | ${host} |"
    echo "| **IP** | ${ip} |"
    echo "| **Domain** | ${AD_DOMAIN} (${AD_NETBIOS}) |"
    echo "| **Generiert** | $(date '+%Y-%m-%d %H:%M:%S %Z') |"
    echo "| **Quelle** | qm guest exec (Proxmox) |"
    echo
  } >> "$out"
}

_gen_dc() {
  local vmid="$1" ip="$2" out="$3"
  step "Doku DC (${vmid}) → ${out}"
  _doc_header "$out" "DC01" "$ip"

  _section "$out" "Identität & Domäne" "$(win_capture "$vmid" \
    "Get-CimInstance Win32_ComputerSystem | Select-Object Name,Domain,DomainRole,PartOfDomain | Format-List | Out-String")"

  _section "$out" "Netzwerk (IP / Gateway / DNS)" "$(win_capture "$vmid" \
    "Get-NetIPConfiguration | Format-List InterfaceAlias,IPv4Address,IPv4DefaultGateway,DNSServer | Out-String")"

  _section "$out" "Installierte Rollen / Features" "$(win_capture "$vmid" \
    "Get-WindowsFeature | Where-Object Installed | Select-Object Name,DisplayName | Format-Table -Auto | Out-String -Width 160")"

  _section "$out" "Kern-Dienste (Status / Starttyp)" "$(win_capture "$vmid" \
    "Get-Service NTDS,DNS,Netlogon,kdc,W32Time,DFSR,DFS,IsmServ,ADWS -ErrorAction SilentlyContinue | Select-Object Name,DisplayName,Status,StartType | Format-Table -Auto | Out-String -Width 160")"

  _section "$out" "DNS-Zonen" "$(win_capture "$vmid" \
    "Get-DnsServerZone | Select-Object ZoneName,ZoneType,IsDsIntegrated,IsReverseLookupZone | Format-Table -Auto | Out-String -Width 160")"

  _section "$out" "DNS-Forwarder" "$(win_capture "$vmid" \
    "Get-DnsServerForwarder | Format-List | Out-String")"

  _section "$out" "AD-Forest / Domain" "$(win_capture "$vmid" \
    "Get-ADForest | Select-Object Name,ForestMode,DomainNamingMaster,SchemaMaster | Format-List | Out-String; Get-ADDomain | Select-Object DNSRoot,NetBIOSName,DomainMode,PDCEmulator,RIDMaster,InfrastructureMaster | Format-List | Out-String")"

  _section "$out" "FSMO-Rollen" "$(win_capture "$vmid" \
    "netdom query fsmo")"

  _section "$out" "Domain Controller" "$(win_capture "$vmid" \
    "Get-ADDomainController -Filter * | Select-Object Name,IPv4Address,Site,OperatingSystem | Format-Table -Auto | Out-String -Width 160")"

  _section "$out" "Letzte Änderungen (Directory Service Log, 10)" "$(win_capture "$vmid" \
    "Get-WinEvent -LogName 'Directory Service' -MaxEvents 10 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,LevelDisplayName,Message | Format-Table -Wrap -Auto | Out-String -Width 160")"

  ok "DC-Doku geschrieben."
}

_gen_wec() {
  local vmid="$1" ip="$2" out="$3"
  step "Doku WEC (${vmid}) → ${out}"
  _doc_header "$out" "WEC01" "$ip"

  _section "$out" "Identität & Domänen-Mitgliedschaft" "$(win_capture "$vmid" \
    "Get-CimInstance Win32_ComputerSystem | Select-Object Name,Domain,PartOfDomain | Format-List | Out-String")"

  _section "$out" "Netzwerk (IP / Gateway / DNS)" "$(win_capture "$vmid" \
    "Get-NetIPConfiguration | Format-List InterfaceAlias,IPv4Address,IPv4DefaultGateway,DNSServer | Out-String")"

  _section "$out" "Kern-Dienste (WEC / WinRM)" "$(win_capture "$vmid" \
    "Get-Service Wecsvc,WinRM -ErrorAction SilentlyContinue | Select-Object Name,DisplayName,Status,StartType | Format-Table -Auto | Out-String -Width 160")"

  _section "$out" "WEC-Subscriptions" "$(win_capture "$vmid" \
    "wecutil es 2>\$null | ForEach-Object { \$_; '  RuntimeStatus:'; wecutil gr \$_ 2>\$null }")"

  _section "$out" "Subscription-Details (XML)" "$(win_capture "$vmid" \
    "wecutil es 2>\$null | ForEach-Object { '=== ' + \$_ + ' ==='; wecutil gs \$_ /f:xml 2>\$null }")"

  _section "$out" "ForwardedEvents (Anzahl / neueste)" "$(win_capture "$vmid" \
    "\$c=(Get-WinEvent -LogName 'ForwardedEvents' -ErrorAction SilentlyContinue | Measure-Object).Count; \"Events im Channel: \$c\"; Get-WinEvent -LogName 'ForwardedEvents' -MaxEvents 5 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,MachineName | Format-Table -Auto | Out-String -Width 160")"

  _section "$out" "Wazuh-Agent" "$(win_capture "$vmid" \
    "Get-Service Wazuh -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType | Format-Table -Auto | Out-String; if(Test-Path 'C:\\Program Files (x86)\\ossec-agent\\VERSION'){ Get-Content 'C:\\Program Files (x86)\\ossec-agent\\VERSION' }")"

  _section "$out" "eventchannel-localfiles (ossec.conf)" "$(win_capture "$vmid" \
    "if(Test-Path 'C:\\Program Files (x86)\\ossec-agent\\ossec.conf'){ Select-String -Path 'C:\\Program Files (x86)\\ossec-agent\\ossec.conf' -Pattern 'location|log_format' | ForEach-Object { \$_.Line.Trim() } }")"

  ok "WEC-Doku geschrieben."
}

# Sucht die VMID einer Rolle in WIN_VMS.
_role_vmid() { local want="$1"; for s in "${WIN_VMS[@]}"; do IFS='|' read -r id _ _ _ _ _ _ role _ <<<"$s"; [[ "$role" == "$want" ]] && { echo "$id"; return; }; done; }
_role_ip()   { local want="$1"; for s in "${WIN_VMS[@]}"; do IFS='|' read -r _ _ _ _ _ _ host role _ <<<"$s"; [[ "$role" == "$want" ]] && { echo "${NET_SERVERS}.${host}"; return; }; done; }

phase_docs() {
  step "Phase 70: Auto-Doku Windows-Hosts"
  need_cmd python3
  local doc_dir; doc_dir="$(_resolve_doc_dir)"; mkdir -p "$doc_dir"
  log "Zielverzeichnis: ${doc_dir}"

  local dc wec dc_ip wec_ip
  dc="$(_role_vmid dc)"; wec="$(_role_vmid wec)"
  dc_ip="$(_role_ip dc)"; wec_ip="$(_role_ip wec)"

  if [[ -n "$dc" ]] && vm_running "$dc"; then _gen_dc "$dc" "$dc_ip" "${doc_dir}/dc01-config.md"; else warn "DC nicht aktiv — DC-Doku uebersprungen."; fi
  if [[ -n "$wec" ]] && vm_running "$wec"; then _gen_wec "$wec" "$wec_ip" "${doc_dir}/wec01-config.md"; else warn "WEC nicht aktiv — WEC-Doku uebersprungen."; fi

  # Optionaler Auto-Commit
  if [[ "${DOC_GIT_COMMIT:-0}" == "1" ]] && git -C "$doc_dir" rev-parse --git-dir >/dev/null 2>&1; then
    if ! git -C "$doc_dir" diff --quiet -- dc01-config.md wec01-config.md 2>/dev/null; then
      log "Aenderungen erkannt → committe Doku …"
      git -C "$doc_dir" add dc01-config.md wec01-config.md
      git -C "$doc_dir" commit -m "docs(network): Auto-Update DC01/WEC01 Live-Konfiguration" >/dev/null 2>&1 \
        && ok "Doku committet." || warn "git commit fehlgeschlagen."
    else
      ok "Keine Aenderungen — nichts zu committen."
    fi
  fi

  ok "Phase 70 fertig."
}
