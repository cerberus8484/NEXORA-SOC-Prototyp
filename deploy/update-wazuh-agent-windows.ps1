# ─────────────────────────────────────────────────────────────────────────────
# Nexora SOC — Wazuh-Agent auf DIESEM Windows-Host AKTUALISIEREN (idempotent).
#
# Update-Pendant zu install-wazuh-agent.ps1. Wird vom Deployment Center über den
# Control-Adapter `ssh-powershell` (OpenSSH) auf einen bereits verwalteten Windows-
# Server gepiped und via `powershell -NoProfile -NonInteractive -Command -` ausgeführt.
# Ziel-Version aus der validierten $env:-Preamble (WAZUH_AGENT_VERSION) — KEINE
# Nutzereingabe in der Command-Zeile.
#
# IDEMPOTENT: Ist der Agent bereits auf der Ziel-Version, tut das Skript NICHTS
#             (self-skip, Exit 0). Sonst: Ziel-MSI laden → Signatur prüfen → upgraden.
# NICHT INSTALLIEREN: Ist gar kein Agent vorhanden, bricht das Skript ab (Update ≠
#             Erstinstallation — dafür ist install-wazuh-agent.ps1 zuständig).
#
# HÄRTUNG (analog zum Installer): die Wazuh-MSI wird über HTTPS (TLS 1.2) geladen UND
# ihre Authenticode-Signatur nach dem Download geprüft (Get-AuthenticodeSignature:
# gültige Kette + Publisher "Wazuh, Inc") — sonst Abbruch OHNE Ausführung.
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'

$Version = if ($env:WAZUH_AGENT_VERSION) { $env:WAZUH_AGENT_VERSION } else { '4.14.6' }
$SvcName = 'WazuhSvc'
$MsiUrl  = "https://packages.wazuh.com/4.x/windows/wazuh-agent-$Version-1.msi"

function Info($m) { Write-Host "==> [wazuh-update] $m" }
function Die($m)  { Write-Error "FEHLER: [wazuh-update] $m"; exit 1 }

# ── 0. Agent muss existieren (Update ≠ Install) ──────────────────────────────
$svc = Get-Service -Name $SvcName -ErrorAction SilentlyContinue
if (-not $svc) { Die "Wazuh-Agent nicht installiert — Update abgebrochen (Erstinstallation: install-wazuh-agent.ps1)." }

# ── 1. Bereits auf Ziel-Version? → nichts tun (idempotent) ───────────────────
$installed = (Get-CimInstance -ClassName Win32_Product -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -like 'Wazuh Agent*' } | Select-Object -First 1).Version
if ($installed -and ($installed -split '-')[0] -eq $Version) {
  Info "Agent bereits auf $Version — keine Aktion (idempotent)."
  if ($svc.Status -ne 'Running') { Start-Service $SvcName }
  exit 0
}
Info "Update $installed -> $Version"

# ── 2. Ziel-MSI laden (TLS 1.2) ──────────────────────────────────────────────
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocol]::Tls12
$msi = Join-Path $env:TEMP "wazuh-agent-$Version.msi"
Info "Lade MSI: $MsiUrl"
Invoke-WebRequest -Uri $MsiUrl -OutFile $msi -UseBasicParsing

# ── 3. Authenticode-Signatur prüfen (gültige Kette + Publisher Wazuh) ─────────
$sig = Get-AuthenticodeSignature -FilePath $msi
if ($sig.Status -ne 'Valid') {
  Remove-Item $msi -Force -ErrorAction SilentlyContinue
  throw "MSI-Signatur ungültig (Status=$($sig.Status)) — Authenticode-Prüfung fehlgeschlagen, Abbruch."
}
if ($sig.SignerCertificate.Subject -notmatch 'Wazuh, Inc') {
  Remove-Item $msi -Force -ErrorAction SilentlyContinue
  throw "MSI-Publisher unerwartet ($($sig.SignerCertificate.Subject)) — nicht 'Wazuh, Inc', Abbruch."
}
Info "Authenticode verifiziert (Publisher Wazuh, Inc)."

# ── 4. Upgrade (msiexec /i über die vorhandene Installation) ─────────────────
Info "Upgrade via msiexec…"
$p = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') -Wait -PassThru
if ($p.ExitCode -ne 0) { Die "msiexec-Upgrade fehlgeschlagen (ExitCode $($p.ExitCode))." }
Remove-Item $msi -Force -ErrorAction SilentlyContinue

# ── 5. Dienst sicherstellen ──────────────────────────────────────────────────
Set-Service -Name $SvcName -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service -Name $SvcName -ErrorAction SilentlyContinue
Info "Wazuh-Agent aktualisiert auf $Version."
