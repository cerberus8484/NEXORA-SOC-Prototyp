#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 50 — Windows-VMs (DC01 Desktop, WEC01 Core) unattended installieren
#
# Erzeugt pro VM eine autounattend-ISO (autounattend.xml + setup.ps1) und
# haengt sie neben Windows- und virtio-ISO an. Windows-Setup findet die
# Antwortdatei automatisch → Edition/Disk/Treiber/Admin-PW ohne Klicks.
# setup.ps1 (FirstLogon) installiert virtio-Guest-Tools, setzt die statische
# IP, aktiviert RDP. Danach steht der Guest-Agent fuer Phase 60 bereit.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Windows-Image-Index in der Eval-ISO:
#   3 = Datacenter Eval (Core) · 4 = Datacenter Eval (Desktop Experience)
_image_index() { [[ "$1" == "core" ]] && echo 3 || echo 4; }

# Baut die autounattend-ISO fuer eine VM.
_build_unattend_iso() {
  local vmid="$1" name="$2" edition="$3" ip="$4" gw="$5" dns="$6"
  local idx; idx="$(_image_index "$edition")"
  local build; build="$(mktemp -d)"
  local iso_out="${PVE_ISO_DIR}/autounattend-${vmid}.iso"

  # ── setup.ps1 (laeuft beim ersten Login als Administrator) ──
  cat > "${build}/setup.ps1" <<PS1
# Auto-Provisioning ${name} (${edition})
\$ErrorActionPreference = 'Continue'
Start-Transcript -Path C:\\Windows\\Temp\\lab-setup.log -Append

# 1) virtio-Guest-Tools von der virtio-CD installieren (silent) — bringt auch den QEMU-Guest-Agent
foreach (\$v in (Get-Volume | Where-Object { \$_.DriveLetter })) {
  \$exe = "\$(\$v.DriveLetter):\\virtio-win-guest-tools.exe"
  if (Test-Path \$exe) { Start-Process \$exe -ArgumentList '/S' -Wait; break }
}

# 2) Statische IP auf dem ersten aktiven Adapter
\$nic = Get-NetAdapter | Where-Object { \$_.Status -eq 'Up' } | Select-Object -First 1
if (\$nic) {
  Remove-NetIPAddress -InterfaceIndex \$nic.ifIndex -Confirm:\$false -ErrorAction SilentlyContinue
  New-NetIPAddress -InterfaceIndex \$nic.ifIndex -IPAddress '${ip}' -PrefixLength 24 -DefaultGateway '${gw}'
  Set-DnsClientServerAddress -InterfaceIndex \$nic.ifIndex -ServerAddresses ${dns}
}

# 3) RDP aktivieren (Remote-Zugang fuers Lab)
Set-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 0
Enable-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue

# 4) AutoLogon wieder deaktivieren (Sicherheit)
Set-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -Name AutoAdminLogon -Value 0 -ErrorAction SilentlyContinue
Stop-Transcript
PS1

  # ── autounattend.xml ──
  cat > "${build}/autounattend.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <SetupUILanguage><UILanguage>en-US</UILanguage></SetupUILanguage>
      <InputLocale>de-DE</InputLocale><SystemLocale>en-US</SystemLocale>
      <UILanguage>en-US</UILanguage><UserLocale>de-DE</UserLocale>
    </component>
    <component name="Microsoft-Windows-PnpCustomizationsWinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <DriverPaths>
        <PathAndCredentials wcm:action="add" wcm:keyValue="1"><Path>D:\\vioscsi\\2k22\\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="2"><Path>E:\\vioscsi\\2k22\\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="3"><Path>F:\\vioscsi\\2k22\\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="4"><Path>D:\\NetKVM\\2k22\\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="5"><Path>E:\\NetKVM\\2k22\\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="6"><Path>F:\\NetKVM\\2k22\\amd64</Path></PathAndCredentials>
      </DriverPaths>
    </component>
    <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>0</DiskID><WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <CreatePartition wcm:action="add"><Order>1</Order><Type>EFI</Type><Size>200</Size></CreatePartition>
            <CreatePartition wcm:action="add"><Order>2</Order><Type>MSR</Type><Size>128</Size></CreatePartition>
            <CreatePartition wcm:action="add"><Order>3</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>FAT32</Format><Label>System</Label></ModifyPartition>
            <ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>2</PartitionID></ModifyPartition>
            <ModifyPartition wcm:action="add"><Order>3</Order><PartitionID>3</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>
      <ImageInstall>
        <OSImage>
          <InstallFrom><MetaData wcm:action="add"><Key>/IMAGE/INDEX</Key><Value>${idx}</Value></MetaData></InstallFrom>
          <InstallTo><DiskID>0</DiskID><PartitionID>3</PartitionID></InstallTo>
        </OSImage>
      </ImageInstall>
      <UserData>
        <ProductKey><WillShowUI>OnError</WillShowUI></ProductKey>
        <AcceptEula>true</AcceptEula>
      </UserData>
    </component>
  </settings>

  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <ComputerName>${name}</ComputerName>
    </component>
  </settings>

  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <InputLocale>de-DE</InputLocale><SystemLocale>en-US</SystemLocale>
      <UILanguage>en-US</UILanguage><UserLocale>de-DE</UserLocale>
    </component>
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <UserAccounts>
        <AdministratorPassword><Value>${WIN_LOCAL_ADMIN_PW}</Value><PlainText>true</PlainText></AdministratorPassword>
      </UserAccounts>
      <AutoLogon>
        <Password><Value>${WIN_LOCAL_ADMIN_PW}</Value><PlainText>true</PlainText></Password>
        <Enabled>true</Enabled><LogonCount>1</LogonCount><Username>Administrator</Username>
      </AutoLogon>
      <OOBE>
        <HideEULAPage>true</HideEULAPage><HideLocalAccountScreen>true</HideLocalAccountScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <NetworkLocation>Work</NetworkLocation><ProtectYourPC>3</ProtectYourPC>
      </OOBE>
      <FirstLogonCommands>
        <SynchronousCommand wcm:action="add">
          <Order>1</Order>
          <CommandLine>powershell -ExecutionPolicy Bypass -Command "foreach($v in (Get-Volume | ? DriveLetter)){ $p=\"$($v.DriveLetter):\setup.ps1\"; if(Test-Path $p){ &amp; $p; break } }"</CommandLine>
          <Description>Lab provisioning</Description>
        </SynchronousCommand>
      </FirstLogonCommands>
    </component>
  </settings>
</unattend>
XML

  log "Baue autounattend-ISO → $(basename "$iso_out")"
  if command -v genisoimage >/dev/null 2>&1; then
    genisoimage -quiet -J -r -V "UNATTEND${vmid}" -o "$iso_out" "$build"
  elif command -v mkisofs >/dev/null 2>&1; then
    mkisofs -quiet -J -r -V "UNATTEND${vmid}" -o "$iso_out" "$build"
  else
    die "genisoimage/mkisofs fehlt — 'apt install genisoimage'."
  fi
  rm -rf "$build"
  ok "autounattend-ISO erstellt: ${iso_out}"
}

_create_windows_vm() {
  local vmid="$1" name="$2" cpu="$3" ram="$4" disk="$5" vlan="$6" host="$7" role="$8" edition="$9"
  local ip="${NET_SERVERS}.${host}" gw="${GW_SERVERS}"
  # DC nutzt sich selbst als DNS, WEC nutzt den DC
  local dns; if [[ "$role" == "dc" ]]; then dns="'127.0.0.1','${OPN_DNS}'"; else dns="'${DC_IP}'"; fi

  if vm_exists "$vmid"; then ok "VM ${vmid} (${name}) existiert — ueberspringe."; return 0; fi
  [[ -s "${PVE_ISO_DIR}/${ISO_WINSERVER}" ]] || die "Windows-ISO fehlt: ${PVE_ISO_DIR}/${ISO_WINSERVER} (Phase 30)."
  [[ -s "${PVE_ISO_DIR}/${ISO_VIRTIO}" ]] || die "virtio-ISO fehlt (Phase 30)."

  step "Windows-VM ${vmid} — ${name} (${edition}) → ${ip}/24"
  _build_unattend_iso "$vmid" "$name" "$edition" "$ip" "$gw" "$dns"

  qm create "$vmid" --name "$name" --ostype win11 --machine q35 --bios ovmf \
    --cores "$cpu" --memory "$ram" --sockets 1 --numa 0 \
    --efidisk0 "${PVE_STORAGE_EFI}:0,efitype=4m,pre_enrolled_keys=1" \
    --tpmstate0 "${PVE_STORAGE_EFI}:0" \
    --scsihw virtio-scsi-single \
    --scsi0 "${PVE_STORAGE_VM}:${disk},cache=writethrough,discard=on,iothread=1,ssd=1" \
    --net0 "virtio,bridge=${BR_LAN},tag=${vlan}" \
    --agent enabled=1,type=isa \
    --ide0 "${PVE_STORAGE_VM}:iso/${ISO_VIRTIO},media=cdrom" \
    --ide2 "${PVE_STORAGE_VM}:iso/${ISO_WINSERVER},media=cdrom" \
    --ide3 "${PVE_STORAGE_VM}:iso/autounattend-${vmid}.iso,media=cdrom" \
    --boot order='ide2;scsi0' \
    || die "qm create ${vmid} fehlgeschlagen."

  qm start "$vmid" || die "VM-Start ${vmid} fehlgeschlagen."
  ok "VM ${vmid} (${name}) startet unattended-Setup (~15-25 Min, dann FirstLogon-Provisioning)."
}

phase_windows_vms() {
  step "Phase 50: Windows-VMs (unattended)"
  need_env WIN_LOCAL_ADMIN_PW
  for spec in "${WIN_VMS[@]}"; do
    IFS='|' read -r vmid name cpu ram disk vlan host role edition <<<"$spec"
    _create_windows_vm "$vmid" "$name" "$cpu" "$ram" "$disk" "$vlan" "$host" "$role" "$edition"
  done
  warn "Hinweis: Windows-Setup laeuft jetzt eigenstaendig. Phase 60 (AD) wartet automatisch auf den Guest-Agent."
  ok "Phase 50 angestossen."
}
