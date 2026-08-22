# ─────────────────────────────────────────────────────────────────────────────
# Nexora Containment — Isolation aufheben (ADR-042 Slice 3c, Windows-Firewall).
#
# Kehrt isolate-host.ps1 vollständig um: entfernt die Regel-Gruppe "NexoraContainment"
# und stellt die VORHERIGEN Default-Aktionen exakt aus der State-Datei wieder her.
#
# LOCKOUT-SCHUTZ (fail-closed): fehlt die State-Datei, obwohl eine Isolation aktiv ist,
# wird NICHT geraten (blindes In=Block + Regeln entfernen könnte den Mgmt-Kanal kappen) —
# stattdessen bricht die Freigabe LAUT ab und lässt die Isolation (inkl. Mgmt-Allow-Regeln)
# bestehen, bis ein Mensch manuell wiederherstellt.
#
# Eigenschaften: idempotent (kein Fehler ohne aktive Isolation), self-verifying.
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'

$GROUP     = 'NexoraContainment'
$stateFile = Join-Path (Join-Path $env:ProgramData 'Nexora') 'containment-fw-state.json'
$ALLOWED   = @('Allow', 'Block', 'NotConfigured')

function Log  { param($m) Write-Host "==> [nexora-containment] $m" }
function Fail { param($m) [Console]::Error.WriteLine("!! [nexora-containment] $m"); exit 1 }

try {
  if (-not (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) { Fail 'NetSecurity-Modul nicht verfügbar.' }

  $rules    = Get-NetFirewallRule -Group $GROUP -ErrorAction SilentlyContinue
  $hasState = Test-Path $stateFile

  if (-not $hasState) {
    if ($rules) {
      # Isolation aktiv, aber KEIN gesicherter Vor-Zustand → nicht raten (Lockout-Schutz).
      Fail 'Isolation aktiv, aber kein gesicherter Firewall-Zustand (State-Datei fehlt) — automatische Freigabe verweigert. Manuell prüfen/wiederherstellen.'
    }
    # Weder State noch Gruppe → Host war nicht isoliert, nichts zu tun.
    Log 'Keine aktive Isolation gefunden — nichts zu tun (idempotent).'
    exit 0
  }

  # State vorhanden → gegen erlaubtes Enum prüfen (kein blindes Vertrauen in die Datei).
  $prior = @(Get-Content $stateFile -Raw | ConvertFrom-Json)
  foreach ($p in $prior) {
    if ($ALLOWED -notcontains $p.DefaultInboundAction -or $ALLOWED -notcontains $p.DefaultOutboundAction) {
      Fail 'Gesicherter Firewall-Zustand ungültig (unerwartete Aktion) — Freigabe verweigert.'
    }
  }

  # Reihenfolge: erst die restriktive Containment-Gruppe entfernen, DANN Defaults restaurieren
  # (vermeidet ein Fenster mit gleichzeitig restriktivem Default + Allow-Regeln).
  if ($rules) {
    $rules | Remove-NetFirewallRule
    Log "Isolation aufgehoben (Gruppe $GROUP entfernt)."
  }
  foreach ($p in $prior) {
    Set-NetFirewallProfile -Name $p.Name -DefaultInboundAction $p.DefaultInboundAction -DefaultOutboundAction $p.DefaultOutboundAction
  }
  Remove-Item $stateFile -Force
  Log 'Vorherige Firewall-Default-Aktionen wiederhergestellt.'

  # Self-Verify: keine Containment-Regeln mehr vorhanden.
  if (Get-NetFirewallRule -Group $GROUP -ErrorAction SilentlyContinue) { Fail 'Containment-Regelgruppe nach Löschung noch vorhanden.' }
  Log 'Konnektivität wiederhergestellt.'
  exit 0
}
catch {
  Fail "unerwarteter Fehler: $($_.Exception.Message)"
}
