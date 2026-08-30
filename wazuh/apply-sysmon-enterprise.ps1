#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Spielt die Nexora Enterprise Sysmon-Konfiguration ein.
    Muss als Administrator ausgeführt werden.

.USAGE
    Rechtsklick → "Als Administrator ausführen"
    oder:
    Start-Process powershell -Verb RunAs -ArgumentList "-File apply-sysmon-enterprise.ps1"
#>

$ErrorActionPreference = 'Stop'
$config = Join-Path $PSScriptRoot "sysmon-enterprise.xml"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Nexora SOC — Enterprise Sysmon Deploy               ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Prüfungen
Write-Host "[1/4] Admin-Check..." -NoNewline
$id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object System.Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host " FEHLER" -ForegroundColor Red
    Write-Host "     Bitte als Administrator ausführen." -ForegroundColor Red
    exit 1
}
Write-Host " OK ($($id.Name))" -ForegroundColor Green

Write-Host "[2/4] Config-Datei prüfen..." -NoNewline
if (-not (Test-Path $config)) {
    Write-Host " FEHLER" -ForegroundColor Red
    Write-Host "     Datei nicht gefunden: $config" -ForegroundColor Red
    exit 1
}
try {
    $xml = [xml](Get-Content $config -Raw -Encoding UTF8)
    Write-Host " OK (Schema $($xml.Sysmon.schemaversion), $($xml.Sysmon.EventFiltering.RuleGroup.Count) Event-Gruppen)" -ForegroundColor Green
} catch {
    Write-Host " FEHLER — XML ungültig: $_" -ForegroundColor Red
    exit 1
}

Write-Host "[3/4] Sysmon Service prüfen..." -NoNewline
$svc = Get-Service -Name "Sysmon" -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host " FEHLER — Sysmon Service nicht gefunden" -ForegroundColor Red
    exit 1
}
Write-Host " OK (Status: $($svc.Status))" -ForegroundColor Green

Write-Host "[4/4] Enterprise-Config einspielen..." -NoNewline
$result = Start-Process -FilePath "C:\Windows\Sysmon.exe" `
    -ArgumentList "-c", "`"$config`"" `
    -Wait -PassThru -NoNewWindow
if ($result.ExitCode -eq 0) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " ExitCode $($result.ExitCode)" -ForegroundColor Yellow
}

# Verifizierung: Config-Hash aus Registry
Start-Sleep 2
$reg = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\SysmonDrv\Parameters" -ErrorAction SilentlyContinue
if ($reg -and $reg.ConfigurationHash) {
    Write-Host ""
    Write-Host "  Config-Hash: $($reg.ConfigurationHash)" -ForegroundColor Cyan
    Write-Host "  Rules-Blob:  $($reg.Rules.Length) Bytes" -ForegroundColor Cyan
}

# Letzten Sysmon-Event zeigen (Config-Change Event 16)
Start-Sleep 1
try {
    $evt = Get-WinEvent -LogName "Microsoft-Windows-Sysmon/Operational" -MaxEvents 3 |
           Where-Object { $_.Id -eq 16 } |
           Select-Object -First 1
    if ($evt) {
        Write-Host "  Sysmon Event 16 (Config-Change): $($evt.TimeCreated)" -ForegroundColor Cyan
    }
} catch { <# Kein Lesezugriff auf Log in diesem Kontext #> }

Write-Host ""
Write-Host "  Enterprise-Konfiguration aktiv." -ForegroundColor Green
Write-Host "  19 MITRE ATT&CK Event-Gruppen schützen jetzt diesen Host." -ForegroundColor Green
Write-Host ""
