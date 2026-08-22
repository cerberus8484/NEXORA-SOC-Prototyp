import type { RegisteredHost, RiskLevel } from './hostsTypes';

// Host-Risk-Heuristik aus REAL verfügbarer Telemetrie (kein Fake-CVE-Score).
// Nutzt Heartbeat, Inventory-Vollständigkeit, offene Ports — und, sobald die
// Wazuh-SCA/Vulnerability-Endpunkte verdrahtet sind, fehlende Patches +
// verdächtige Software. Jeder Punkt ist als „Faktor" nachvollziehbar.

export interface HostRisk {
  score: number;        // 0–100
  level: RiskLevel;
  factors: string[];    // nachvollziehbare Begründung
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function computeHostRisk(host: RegisteredHost): HostRisk {
  let score = 0;
  const factors: string[] = [];
  const add = (points: number, label: string) => { score += points; factors.push(label); };

  if (host.heartbeatStatus === 'offline') add(35, 'Agent offline (keine Sicht)');
  else if (host.heartbeatStatus === 'delayed') add(15, 'Heartbeat verzögert');

  if (host.inventoryStatus === 'missing') add(20, 'Inventory fehlt');
  else if (host.inventoryStatus === 'partial') add(10, 'Inventory unvollständig');

  // CVE-Befunde (echte Wazuh-Vulnerability-Daten) — stärkstes Signal.
  const crit = host.inventory?.cveCritical ?? 0;
  if (crit > 0) add(Math.min(crit * 8, 40), `${crit} kritische CVEs`);
  const high = host.inventory?.cveHigh ?? 0;
  if (high > 0) add(Math.min(high * 2, 20), `${high} hohe CVEs`);

  // SCA-Compliance (echte CIS-Benchmark-Bewertung) — niedriger Score = schlechte Härtung.
  const sca = host.inventory?.scaScore;
  if (typeof sca === 'number') {
    if (sca < 50) add(20, `SCA-Compliance niedrig (${sca}/100)`);
    else if (sca < 75) add(10, `SCA-Compliance mittel (${sca}/100)`);
  }

  const ports = host.inventory?.openPortsCount ?? 0;
  if (ports > 50) add(15, `${ports} offene Ports`);
  else if (ports > 20) add(8, `${ports} offene Ports`);

  const patches = host.inventory?.missingPatches ?? 0;
  if (patches > 0) add(Math.min(patches * 4, 20), `${patches} fehlende Patches`);

  const suspicious = host.inventory?.suspiciousSoftwareCount ?? 0;
  if (suspicious > 0) add(Math.min(suspicious * 10, 20), `${suspicious} verdächtige Programme`);

  if (!host.agentVersion) add(5, 'Agent-Version unbekannt');

  score = Math.min(score, 100);
  return { score, level: riskLevelFromScore(score), factors };
}

/** Hängt den berechneten Risk-Score/Level an den Host (für Tabelle + Filter). */
export function applyHostRisk(host: RegisteredHost): RegisteredHost {
  const r = computeHostRisk(host);
  return { ...host, riskScore: r.score, riskLevel: r.level };
}
