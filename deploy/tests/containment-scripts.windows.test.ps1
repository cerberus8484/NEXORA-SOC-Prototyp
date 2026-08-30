# ─────────────────────────────────────────────────────────────────────────────
# ADR-042 Slice 3c — Struktur-Test der Windows-Isolationsskripte (Arming-Blocker H-2).
#
# Testet die generierte Firewall-LOGIK ohne echte Firewall: New-NetFirewallRule /
# Set-NetFirewallProfile / Get-NetFirewallProfile / Get-/Remove-NetFirewallRule werden
# durch zustandsbehaftete Fakes ersetzt (dot-sourced in einen Child-PowerShell, der das
# echte Skript aufruft). Die Fakes loggen ihre Aufrufe; der Test prüft Reihenfolge
# (Allow VOR Default-Block), Mgmt-Preservation, den Fail-closed-Pfad und — als Regression
# für Review-Fund C-2 — dass eine Freigabe OHNE State-Datei die Isolation NICHT blind auflöst.
#
# ABGRENZUNG: STRUKTUR-/Contract-Test. Echte Firewall-Semantik (überlebt eine SSH-Session?)
# bleibt der dokumentierte Lab-Smoke. Läuft mit Windows PowerShell 5.1. Exit 0 = alle grün.
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$deploy  = Split-Path -Parent $here
$isolate = Join-Path $deploy 'isolate-host.ps1'
$release = Join-Path $deploy 'release-isolation.ps1'

$work = Join-Path $env:TEMP ("nexora-fwtest-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$fakes  = Join-Path $work 'fakes.ps1'
$log    = Join-Path $work 'calls.log'
$stateFile = Join-Path $work 'Nexora\containment-fw-state.json'

# Fakes: zustandsbehaftet über $global im Child. Initialzustand via ENV steuerbar.
Set-Content -Encoding UTF8 -Path $fakes -Value @'
$global:profiles = @(
  [pscustomobject]@{ Name='Domain';  DefaultInboundAction='Block'; DefaultOutboundAction='Allow' },
  [pscustomobject]@{ Name='Private'; DefaultInboundAction='Block'; DefaultOutboundAction='Allow' },
  [pscustomobject]@{ Name='Public';  DefaultInboundAction='Block'; DefaultOutboundAction='Allow' }
)
$global:rules = @()
if ($env:NEXORA_FAKE_HAS_RULES -eq '1') { $global:rules = @([pscustomobject]@{ Group='NexoraContainment'; Direction='Inbound' }) }
function _log($s) { Add-Content -Path $env:NEXORA_TEST_LOG -Value $s }
function New-NetFirewallRule {
  param($DisplayName,$Group,$Direction,$Action,$Protocol,$RemoteAddress,$LocalPort,$RemotePort,$Enabled)
  _log "NEWRULE dir=$Direction action=$Action remote=$RemoteAddress lport=$LocalPort rport=$RemotePort"
  $global:rules += [pscustomobject]@{ Group=$Group; Direction=$Direction }
}
function Set-NetFirewallProfile {
  param($Name,[switch]$All,$Enabled,$DefaultInboundAction,$DefaultOutboundAction)
  _log "SETPROFILE in=$DefaultInboundAction out=$DefaultOutboundAction"
  foreach ($p in $global:profiles) {
    if ($All -or $p.Name -eq $Name) {
      if ($DefaultInboundAction)  { $p.DefaultInboundAction  = $DefaultInboundAction }
      if ($DefaultOutboundAction) { $p.DefaultOutboundAction = $DefaultOutboundAction }
    }
  }
}
function Get-NetFirewallProfile { param([switch]$All,$Name) $global:profiles }
function Get-NetFirewallRule { param($Group) $global:rules | Where-Object { $_.Group -eq $Group } }
function Remove-NetFirewallRule {
  param([Parameter(ValueFromPipeline=$true)]$InputObject)
  process { }
  end { _log "REMOVERULE"; $global:rules = @() }
}
'@

$env:NEXORA_TEST_LOG = $log
$env:ProgramData     = $work   # State-Datei landet unter $work\Nexora (nur für Kind-Prozesse relevant)

$pass = 0; $fail = 0
function Check($cond, $name) { if ($cond) { Write-Host "  ok   - $name"; $script:pass++ } else { Write-Host "  FAIL - $name"; $script:fail++ } }

function Invoke-Target($target) {
  Remove-Item $log -ErrorAction SilentlyContinue
  # Fakes + Ziel-Skript in EINE Datei und via -File fahren: so schatten die Fake-Funktionen die
  # echten Cmdlets UND `exit N` des Skripts propagiert als Prozess-Exit (`& script` täte das nicht).
  $combined = Join-Path $work 'combined.ps1'
  Set-Content -Encoding UTF8 -Path $combined -Value ((Get-Content $fakes -Raw) + "`n" + (Get-Content $target -Raw))
  # EAP=Continue lokal: der Fail-closed-Pfad schreibt bewusst nach stderr; in PS 5.1 würde das
  # sonst als NativeCommandError den Harness terminieren. $LASTEXITCODE bleibt korrekt.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & powershell -NoProfile -ExecutionPolicy Bypass -File $combined *> $null } finally { $ErrorActionPreference = $prev }
  $code = $LASTEXITCODE
  $text = if (Test-Path $log) { (Get-Content $log -Raw) } else { '' }
  return @{ Exit = $code; Log = $text }
}

Write-Host "== isolate-host.ps1 =="

# 1) Happy: gültige Mgmt-CIDR + Live-Peer → Exit 0, Allow-Regeln VOR Default-Block, State gesichert.
$env:NEXORA_MGMT_CIDR = '10.0.10.0/24'; $env:NEXORA_MGMT_SSH_PORT = '22'
$env:SSH_CONNECTION = '10.0.10.75 51000 10.0.10.80 22'; $env:NEXORA_FAKE_HAS_RULES = '0'
Remove-Item $stateFile -ErrorAction SilentlyContinue
$r = Invoke-Target $isolate
$lines = $r.Log -split "`r?`n"
$firstBlock = ($lines | Select-String 'SETPROFILE.*out=Block' | Select-Object -First 1).LineNumber
$firstRule  = ($lines | Select-String 'NEWRULE' | Select-Object -First 1).LineNumber
Check ($r.Exit -eq 0) "Exit 0 bei gültiger Isolation"
Check ($firstRule -and $firstBlock -and $firstRule -lt $firstBlock) "Allow-Regeln VOR Default-Block (Reihenfolge)"
Check ($r.Log -match 'remote=10\.0\.10\.0/24 lport=22') "Mgmt-CIDR-Allow (inbound, port-scoped)"
Check ($r.Log -match 'remote=10\.0\.10\.75 lport=22')   "Live-Control-Channel-Allow aus SSH_CONNECTION"
Check ($r.Log -match 'SETPROFILE in=Block out=Block')   "Default beidseitig Block"
Check (Test-Path $stateFile) "vorheriger Firewall-Zustand gesichert"

# 2) Fail-closed: ohne Mgmt-CIDR → Exit != 0, KEIN SETPROFILE (nichts angewandt).
$env:NEXORA_MGMT_CIDR = ''
Remove-Item $stateFile -ErrorAction SilentlyContinue
$r = Invoke-Target $isolate
Check ($r.Exit -ne 0) "Exit != 0 ohne NEXORA_MGMT_CIDR"
Check ($r.Log -notmatch 'SETPROFILE') "kein Default-Block ohne Mgmt-CIDR (fail-closed)"

Write-Host "== release-isolation.ps1 =="

# 3) Mit State-Datei → restauriert + entfernt Gruppe, Exit 0, State weg.
New-Item -ItemType Directory -Path (Split-Path $stateFile) -Force | Out-Null
'[{"Name":"Domain","DefaultInboundAction":"Block","DefaultOutboundAction":"Allow"}]' | Set-Content -Encoding UTF8 $stateFile
$env:NEXORA_FAKE_HAS_RULES = '1'
$r = Invoke-Target $release
Check ($r.Exit -eq 0) "Exit 0 bei aktiver Isolation mit State"
Check ($r.Log -match 'REMOVERULE') "Containment-Gruppe entfernt"
Check ($r.Log -match 'SETPROFILE in=Block out=Allow') "vorheriger Default wiederhergestellt"
Check (-not (Test-Path $stateFile)) "State-Datei nach Freigabe entfernt"

# 4) C-2-Regression: Isolation aktiv, aber KEINE State-Datei → fail-closed, NICHT auflösen.
Remove-Item $stateFile -ErrorAction SilentlyContinue
$env:NEXORA_FAKE_HAS_RULES = '1'
$r = Invoke-Target $release
Check ($r.Exit -ne 0) "Exit != 0 bei Isolation ohne State (Lockout-Schutz)"
Check ($r.Log -notmatch 'SETPROFILE') "kein blindes Default-Setzen ohne State (C-2)"
Check ($r.Log -notmatch 'REMOVERULE') "Gruppe NICHT entfernt ohne State (C-2)"

# 5) Idempotent: keine State, keine Gruppe → No-op, Exit 0.
$env:NEXORA_FAKE_HAS_RULES = '0'
$r = Invoke-Target $release
Check ($r.Exit -eq 0) "Exit 0 ohne aktive Isolation (idempotent)"

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Ergebnis: $pass ok, $fail fehlgeschlagen"
if ($fail -ne 0) { exit 1 } else { exit 0 }
