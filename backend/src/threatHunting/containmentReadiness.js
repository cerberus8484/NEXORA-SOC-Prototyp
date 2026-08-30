'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// ADR-042 Arming-Blocker #1 — Containment-Real-Exec-Readiness (reine Funktion).
//
// Beim Boot aufgerufen, um eine Fehlkonfiguration FRÜH sichtbar zu machen: ist der
// echte Containment-Kanal scharf (HUNT_RESPONSE_REAL_EXEC_ENABLED), aber die Mgmt-
// Preservation-Config fehlt/ungültig, würde eine Isolation erst zur Laufzeit fail-closed
// abbrechen (E_NO_MGMT_PRESERVE) — ein Boot-Log macht das für Operatoren sofort klar.
//
// KEIN Boot-Abbruch: die Runtime ist ohnehin fail-closed; die ganze API wegen einer
// Containment-Fehlkonfiguration nicht starten zu lassen wäre unverhältnismäßig.
// ─────────────────────────────────────────────────────────────────────────────

const IPV4_CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;

/** Gültiges IPv4 (optional als CIDR) mit Oktett 0–255 und Prefix 0–32. */
function isValidIpv4Cidr(value) {
  const m = String(value || '').match(IPV4_CIDR_RE);
  if (!m) return false;
  for (let i = 1; i <= 4; i += 1) {
    if (Number(m[i]) > 255) return false;
  }
  if (m[5] !== undefined && Number(m[5]) > 32) return false;
  return true;
}

/** Gültiger TCP-Port 1–65535. */
function isValidPort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

/**
 * Prüft die Containment-Real-Exec-Readiness.
 * @param {{ huntResponse?: { realExecutionEnabled?: boolean, mgmtCidr?: (string|null), mgmtSshPort?: (string|number|null) } }} [cfg]
 * @returns {{ armed: boolean, issues: string[] }}  armed=Kill-Switch scharf; issues=konkrete Fehlkonfigurationen.
 */
function checkContainmentReadiness(cfg = {}) {
  const hr = (cfg && cfg.huntResponse) || {};
  const armed = hr.realExecutionEnabled === true;
  const issues = [];
  if (!armed) return { armed, issues };

  if (!hr.mgmtCidr) {
    issues.push('HUNT_RESPONSE_MGMT_CIDR fehlt — isolate_host wird zur Laufzeit verweigert (E_NO_MGMT_PRESERVE, Selbst-Aussperr-Schutz).');
  } else if (!isValidIpv4Cidr(hr.mgmtCidr)) {
    issues.push(`HUNT_RESPONSE_MGMT_CIDR ist kein gültiges IPv4/CIDR: ${hr.mgmtCidr}`);
  }
  if (hr.mgmtSshPort !== undefined && hr.mgmtSshPort !== null && !isValidPort(hr.mgmtSshPort)) {
    issues.push(`HUNT_RESPONSE_MGMT_SSH_PORT ist kein gültiger Port (1–65535): ${hr.mgmtSshPort}`);
  }
  return { armed, issues };
}

module.exports = { checkContainmentReadiness, isValidIpv4Cidr, isValidPort };
