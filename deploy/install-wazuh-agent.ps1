# ─────────────────────────────────────────────────────────────────────────────
# Nexora SOC — Wazuh-Agent auf DIESEM Windows-Host installieren (optional, idempotent).
#
# Pendant zu install-wazuh-agent.sh (Linux). Wird vom Deployment Center über den
# Control-Adapter `ssh-powershell` per OpenSSH auf das Ziel gepiped und via
# `powershell -NoProfile -NonInteractive -Command -` ausgeführt. Liest die
# Konfiguration aus der Umgebung (WAZUH_MANAGER/-AGENT_NAME/-AGENT_VERSION), die der
# SSH-Runner als validierte `$env:`-Preamble voranstellt — KEINE Nutzereingabe in der
# Command-Zeile.
#
# OPTIONAL: Ohne WAZUH_MANAGER tut das Skript NICHTS (self-skip, Exit 0).
# IDEMPOTENT: Ist der Agent-Dienst bereits vorhanden, wird die Konfiguration NICHT
#             überschrieben; das Skript stellt nur sicher, dass der Dienst läuft.
#
# HÄRTUNG (analog zum GPG-Pin bei Linux): die Wazuh-MSI wird über verifiziertes HTTPS
# (TLS 1.2) geladen UND ihre Authenticode-Signatur wird nach dem Download geprüft
# (Get-AuthenticodeSignature: gültige Kette + Publisher "Wazuh, Inc") — sonst Abbruch
# ohne Installation. Publisher gegen die live-signierte MSI verifiziert (2026-07-04).
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'

$Manager   = $env:WAZUH_MANAGER
$AgentName = if ($env:WAZUH_AGENT_NAME)    { $env:WAZUH_AGENT_NAME }    else { $env:COMPUTERNAME }
$Version   = if ($env:WAZUH_AGENT_VERSION) { $env:WAZUH_AGENT_VERSION } else { '4.14.6' }
$SvcName   = 'WazuhSvc'

function Info($m) { Write-Host "==> [wazuh-agent] $m" }

# ── 0. Ohne Manager nichts tun (self-skip) ───────────────────────────────────
if ([string]::IsNullOrWhiteSpace($Manager)) {
  Info 'WAZUH_MANAGER nicht gesetzt - Wazuh-Agent-Setup uebersprungen (optional).'
  exit 0
}

# ── 0b. Defense-in-Depth: ENV-Werte SELBST validieren ────────────────────────
# Nicht nur dem Aufrufer (SSH-Runner) vertrauen — falls das Skript je über einen
# anderen Pfad mit rohen Werten liefe, darf nichts Ungültiges in die msiexec-Zeile.
if ($Manager   -notmatch '^[A-Za-z0-9_.:/@-]{1,255}$') { throw 'ungueltiger WAZUH_MANAGER' }
if ($AgentName -notmatch '^[A-Za-z0-9_.-]{1,64}$')     { throw 'ungueltiger WAZUH_AGENT_NAME' }
if ($Version   -notmatch '^[A-Za-z0-9_.:/@-]{1,64}$')  { throw 'ungueltige WAZUH_AGENT_VERSION' }

# ── 1. Bereits installiert? → nur Dienst sicherstellen (idempotent) ──────────
$svc = Get-Service -Name $SvcName -ErrorAction SilentlyContinue
if ($svc) {
  Info 'wazuh-agent ist bereits installiert - Konfiguration bleibt unangetastet.'
  if ($svc.Status -ne 'Running') { Info 'Dienst starten...'; Start-Service -Name $SvcName }
  else { Info 'Dienst laeuft bereits - keine Aenderung.' }
  Info 'Fertig (idempotenter Lauf).'
  exit 0
}

# ── 2. MSI laden (TLS 1.2 erzwingen) ─────────────────────────────────────────
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Msi = Join-Path $env:TEMP 'wazuh-agent.msi'
$Url = "https://packages.wazuh.com/4.x/windows/wazuh-agent-$Version-1.msi"
Info "MSI laden: $Url"
Invoke-WebRequest -Uri $Url -OutFile $Msi -UseBasicParsing

# ── 2b. Authenticode-Signatur der MSI prüfen (Defense-in-Depth, kein TOFU) ────
# HTTPS/TLS 1.2 allein reicht nicht: die heruntergeladene MSI MUSS eine gültige
# Signatur-Kette tragen UND von Wazuh signiert sein. Werte gegen die live-signierte
# MSI verifiziert (2026-07-04): Publisher-Subject "CN=Wazuh, Inc" (Issuer DigiCert
# Trusted G4 Code Signing). Bei ungültiger/fremder Signatur hart abbrechen und die
# MSI wegräumen — es wird NICHTS installiert.
$Expected = 'Wazuh, Inc'
$Sig = Get-AuthenticodeSignature -FilePath $Msi
if ($Sig.Status -ne 'Valid') {
  Remove-Item $Msi -ErrorAction SilentlyContinue
  throw "MSI-Authenticode-Signatur ungueltig (Status $($Sig.Status)) - Abbruch, nichts installiert."
}
$Subject = $Sig.SignerCertificate.Subject
if ($Subject -notmatch [regex]::Escape($Expected)) {
  Remove-Item $Msi -ErrorAction SilentlyContinue
  throw "MSI-Publisher unerwartet (Subject '$Subject', erwartet '$Expected') - Abbruch, nichts installiert."
}
Info "MSI-Signatur verifiziert (Publisher: $Expected)."

# ── 3. Silent-Install; Manager/Name als MSI-Properties (vom postinst gelesen) ─
Info "Installiere Agent (Manager=$Manager, Name=$AgentName, Version=$Version)"
$MsiArgs = @('/i', "`"$Msi`"", '/q', "WAZUH_MANAGER=$Manager", "WAZUH_AGENT_NAME=$AgentName")
$Proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $MsiArgs -Wait -PassThru
if ($Proc.ExitCode -ne 0) { throw "msiexec fehlgeschlagen (ExitCode $($Proc.ExitCode))" }

# ── 4. Dienst aktivieren + starten → Auto-Enrollment (1515) ──────────────────
Info "Dienst aktivieren + starten (Auto-Enrollment am Manager $Manager ueber 1515)..."
Set-Service -Name $SvcName -StartupType Automatic
Start-Service -Name $SvcName
Remove-Item $Msi -ErrorAction SilentlyContinue

Info "Wazuh-Agent installiert - Manager=$Manager - Name=$AgentName - Version=$Version."
Info "Pruefen: am Manager erscheint '$AgentName' als 'active' (kann kurz dauern)."
