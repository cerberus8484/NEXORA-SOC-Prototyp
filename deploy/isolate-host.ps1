# ─────────────────────────────────────────────────────────────────────────────
# Nexora Containment — Host-Isolation (ADR-042 Slice 3c, Windows-Firewall).
#
# Zweck: Netz-Isolation eines KOMPROMITTIERTEN Windows-Hosts (Lateral-Movement
# rein/raus kappen, C2 unterbinden), OHNE den Management-Kanal zu verlieren.
#
# KERN-INVARIANTE (MGMT-PRESERVATION): der Kanal, über den Nexora diesen Host steuert,
# bleibt erreichbar — sonst ist die spätere Freigabe (release-isolation.ps1) nicht mehr
# zustellbar. Zwei Quellen: PRIMÄR die tatsächliche SSH-Peer-IP + der echte Server-Port
# aus $env:SSH_CONNECTION, ERGÄNZEND das deklarierte NEXORA_MGMT_CIDR:NEXORA_MGMT_SSH_PORT.
#
# Mechanik: eigene Firewall-Regel-Gruppe "NexoraContainment" mit expliziten Allow-Regeln
# für den Mgmt-Kanal, DANN Default-Aktion beider Richtungen auf Block. Windows-Firewall ist
# zustandsbehaftet → die laufende SSH-Session (established) überlebt. Der VORHERIGE Default
# wird in eine State-Datei gesichert, damit die Freigabe ihn exakt wiederherstellt.
#
# Eigenschaften: fail-closed (ohne Mgmt-CIDR keine Isolation), idempotent (Gruppe wird
# vor dem Anlegen entfernt), self-verifying. Parameter kommen als ENV (sshExecRunner).
#
# ACHTUNG: admin-pflichtiger Firewall-Eingriff. Vor Scharfschaltung Lab-Smoke + Review.
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'

$GROUP     = 'NexoraContainment'
$stateDir  = Join-Path $env:ProgramData 'Nexora'
$stateFile = Join-Path $stateDir 'containment-fw-state.json'
$MGMT_CIDR = $env:NEXORA_MGMT_CIDR
$MGMT_PORT = if ($env:NEXORA_MGMT_SSH_PORT) { $env:NEXORA_MGMT_SSH_PORT } else { '22' }

function Log  { param($m) Write-Host "==> [nexora-containment] $m" }
function Fail { param($m) [Console]::Error.WriteLine("!! [nexora-containment] $m"); exit 1 }

try {
  # ── Live-Control-Channel aus der laufenden SSH-Session ableiten (Primärquelle) ─
  $CTRL_IP = $null; $CTRL_PORT = $null
  if ($env:SSH_CONNECTION) {
    $parts = $env:SSH_CONNECTION -split '\s+'
    if ($parts.Count -ge 4 -and $parts[0] -match '^\d{1,3}(\.\d{1,3}){3}$' -and
        $parts[3] -match '^\d{1,5}$' -and [int]$parts[3] -ge 1 -and [int]$parts[3] -le 65535) {
      $CTRL_IP = $parts[0]; $CTRL_PORT = $parts[3]
    }
  }

  # ── Vorbedingungen (fail-closed) ────────────────────────────────────────────
  if (-not $MGMT_CIDR) { Fail 'NEXORA_MGMT_CIDR fehlt — Isolation ohne Mgmt-Preservation verweigert (Selbst-Aussperr-Schutz).' }
  if ($MGMT_CIDR -notmatch '^\d{1,3}(\.\d{1,3}){3}(/\d{1,2})?$') { Fail "NEXORA_MGMT_CIDR ist kein gültiges IPv4/CIDR: $MGMT_CIDR" }
  if ($MGMT_PORT -notmatch '^\d{1,5}$' -or [int]$MGMT_PORT -lt 1 -or [int]$MGMT_PORT -gt 65535) { Fail "NEXORA_MGMT_SSH_PORT ist kein gültiger Port (1-65535): $MGMT_PORT" }
  if (-not (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue)) { Fail 'NetSecurity-Modul (New-NetFirewallRule) nicht verfügbar.' }

  # ── Vorherige Default-Aktionen sichern (für exakte Wiederherstellung bei Freigabe) ─
  # Nur beim ERSTEN Isolieren schreiben — ein Re-Isolate soll den echten Vor-Zustand nicht
  # mit bereits-blockierten Werten überschreiben.
  if (-not (Test-Path $stateFile)) {
    if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
    Get-NetFirewallProfile -All |
      Select-Object Name, DefaultInboundAction, DefaultOutboundAction |
      ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8
    Log "Vorheriger Firewall-Default gesichert: $stateFile"
  }

  # ── Regel-Gruppe idempotent zurücksetzen ────────────────────────────────────
  Get-NetFirewallRule -Group $GROUP -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

  # ── Mgmt-Preservation: explizite Allow-Regeln ZUERST (vor Default-Block) ──────
  # Deklariertes Mgmt-Subnetz (port-scoped in beide Richtungen).
  New-NetFirewallRule -DisplayName 'Nexora Mgmt In (CIDR)'  -Group $GROUP -Direction Inbound  -Action Allow -Protocol TCP -RemoteAddress $MGMT_CIDR -LocalPort $MGMT_PORT | Out-Null
  New-NetFirewallRule -DisplayName 'Nexora Mgmt Out (CIDR)' -Group $GROUP -Direction Outbound -Action Allow -Protocol TCP -RemoteAddress $MGMT_CIDR -RemotePort $MGMT_PORT | Out-Null
  # Tatsächlicher Live-SSH-Peer (schützt auch bei falschem/stalem CIDR): Peer-IP auf echtem Server-Port.
  if ($CTRL_IP) {
    New-NetFirewallRule -DisplayName 'Nexora Mgmt In (Peer)'  -Group $GROUP -Direction Inbound  -Action Allow -Protocol TCP -RemoteAddress $CTRL_IP -LocalPort  $CTRL_PORT | Out-Null
    New-NetFirewallRule -DisplayName 'Nexora Mgmt Out (Peer)' -Group $GROUP -Direction Outbound -Action Allow -Protocol TCP -RemoteAddress $CTRL_IP -RemotePort $CTRL_PORT | Out-Null
    Log "Live-Control-Channel erkannt: ${CTRL_IP}:${CTRL_PORT} (wird zusätzlich erhalten)."
  } else {
    Log 'Kein SSH_CONNECTION verfügbar — Preservation nur über NEXORA_MGMT_CIDR.'
  }

  # ── Isolation scharf: Default beider Richtungen auf Block, Firewall an ────────
  Set-NetFirewallProfile -All -Enabled True -DefaultInboundAction Block -DefaultOutboundAction Block

  # ── Self-Verify (Exit 0 nur bei bestätigter Isolation + erhaltenem Mgmt-Kanal) ─
  if (-not (Get-NetFirewallRule -Group $GROUP -ErrorAction SilentlyContinue)) { Fail 'Containment-Regelgruppe nach Anwendung nicht auffindbar.' }
  $blocked = Get-NetFirewallProfile -All | Where-Object { $_.DefaultOutboundAction -ne 'Block' }
  if ($blocked) { Fail 'Default-Outbound-Block nach Anwendung nicht überall gesetzt.' }
  Log "Host isoliert (Gruppe $GROUP aktiv, Default beidseitig Block); Mgmt-Kanal $MGMT_CIDR`:$MGMT_PORT erhalten."
  exit 0
}
catch {
  Fail "unerwarteter Fehler: $($_.Exception.Message)"
}
