// ── Inventory Highlights + transparenter Risiko-Indikator ─────────────────
// Beide Funktionen leiten ausschließlich aus echten API-Feldern ab (ADR-009).
// Wenn ein Signal fehlt, wird ehrlich null / 'unknown' zurückgegeben — kein Fake.

import type { WazuhAgent, WazuhInventory } from '../wazuh/wazuhApi';
import type { HostPosture } from './hostsTypes';
import i18n from '../../i18n';

// ─────────────────────────────────────────────────────────────────────────────
// Typen
// ─────────────────────────────────────────────────────────────────────────────

export interface InventoryHighlightsResult {
  /** OS-Name aus syscollector os.os.name */
  osName: string | null;
  /** OS-Build/Version aus syscollector os.os.version */
  osBuild: string | null;
  /** CPU-Label aus hardware.cpu (Name + Kerne) */
  cpuLabel: string | null;
  /** RAM in GB (numerisch) aus hardware.ram.total (KB) */
  ramGb: number | null;
  /** RAM-Label für Anzeige, z. B. "16.0 GB" */
  ramLabel: string | null;
  /** Anzahl installierter Pakete aus packagesTotal */
  installedPackages: number | null;
  /** Anzahl offener Ports aus portsTotal */
  openPorts: number | null;
  /** CPU-Architektur aus syscollector os.architecture (z. B. "x86_64") */
  architecture: string | null;
  /**
   * Immer false — AV-Erkennung erfordert die Paketliste pro Host,
   * die der syscollector-Inventory-Endpunkt nicht liefert (nur packagesTotal).
   * Wird nicht erraten.
   */
  avDetected: false;
  /** Erläuterung, warum AV nicht erkennbar ist */
  avDetectedReason: string;
  /** Erste MAC-Adresse aus interfaces[0].mac */
  macAddress: string | null;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export interface HostRiskResult {
  /**
   * Transparentes Risiko-Level aus echten Signalen.
   * 'unknown' wenn zu wenig Daten vorhanden sind (statt Fake-Wert).
   */
  level: RiskLevel;
  /**
   * Auflistung aller Signale, die das Level bestimmt haben.
   * Leer bei 'low' (kein erhöhtes Signal) und bei 'unknown'.
   */
  reasons: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveInventoryHighlights — reine Funktion
// ─────────────────────────────────────────────────────────────────────────────

const AV_NOT_AVAILABLE_REASON =
  i18n.t('app.antivirusDetectionNotAvailableSyscollector');

/**
 * Leitet anzeigbare Highlights aus dem syscollector-Inventory ab.
 * Akzeptiert null als Eingabe (kein Inventory geladen) → alle Felder null.
 */
export function deriveInventoryHighlights(inv: WazuhInventory | null): InventoryHighlightsResult {
  if (!inv) {
    return {
      osName: null,
      osBuild: null,
      cpuLabel: null,
      ramGb: null,
      ramLabel: null,
      installedPackages: null,
      openPorts: null,
      architecture: null,
      avDetected: false,
      avDetectedReason: AV_NOT_AVAILABLE_REASON,
      macAddress: null,
    };
  }

  const osName = inv.os?.os?.name ?? null;
  const osBuild = inv.os?.os?.version ?? null;
  const architecture = inv.os?.architecture?.trim() || null;

  const cpuLabel = buildCpuLabel(inv.hardware?.cpu);
  const { ramGb, ramLabel } = buildRam(inv.hardware?.ram);

  const macAddress = inv.interfaces?.[0]?.mac ?? null;

  return {
    osName,
    osBuild,
    cpuLabel,
    ramGb,
    ramLabel,
    installedPackages: inv.packagesTotal ?? null,
    openPorts: inv.portsTotal ?? null,
    architecture,
    avDetected: false,
    avDetectedReason: AV_NOT_AVAILABLE_REASON,
    macAddress,
  };
}

function buildCpuLabel(cpu?: { name?: string; cores?: number }): string | null {
  if (!cpu || !cpu.name) return null;
  const name = cpu.name.trim();
  if (!name) return null;
  return cpu.cores ? `${name} (${cpu.cores} Kerne)` : name;
}

function buildRam(ram?: { total?: number }): { ramGb: number | null; ramLabel: string | null } {
  const totalKb = ram?.total;
  if (totalKb == null || totalKb <= 0) return { ramGb: null, ramLabel: null };
  const gb = totalKb / 1024 / 1024;
  return { ramGb: gb, ramLabel: `${gb.toFixed(1)} GB` };
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveHostRisk — reine Funktion
// Ableitungslogik: nur echte, belegbare Signale aus Wazuh-API-Feldern.
// Score-System: kumulativ, transparent durch reasons-Liste.
// Schwelle 'unknown': wenn weder Heartbeat-Alter noch Posture vorliegen und
//   der Agent nicht definitiv disconnected ist.
// ─────────────────────────────────────────────────────────────────────────────

const HEARTBEAT_STALE_MIN = 15; // Minuten bis Heartbeat als verzögert gilt
const PORTS_HIGH_THRESHOLD = 50;
const PORTS_MED_THRESHOLD = 20;

/**
 * Transparenter Risiko-Indikator aus echten Wazuh-Daten.
 * Alle Faktoren werden in reasons aufgelistet (UI: Tooltip "warum").
 */
export function deriveHostRisk(
  agent: WazuhAgent,
  inv: WazuhInventory | null,
  posture: HostPosture | null,
): HostRiskResult {
  let score = 0;
  const reasons: string[] = [];
  const add = (pts: number, label: string) => { score += pts; reasons.push(label); };

  // ── Agent-Status ─────────────────────────────────────────────────────────
  const status = agent.status ?? 'unknown';
  const isOffline = status === 'disconnected' || status === 'never_connected';
  if (isOffline) {
    add(35, i18n.t('hosts.agentNoVisibility', { state: status === 'never_connected' ? i18n.t('hosts.neverConnected') : 'offline' }));
  }

  // ── Heartbeat-Alter ──────────────────────────────────────────────────────
  const keepAliveAge = agent.lastKeepAlive
    ? Math.round((Date.now() - new Date(agent.lastKeepAlive).getTime()) / 60_000)
    : null;

  if (keepAliveAge !== null && !isOffline) {
    if (keepAliveAge > HEARTBEAT_STALE_MIN) {
      add(15, i18n.t('hosts.lastHeartbeatStale', { count: keepAliveAge }));
    }
  }

  // ── CVEs aus Posture ─────────────────────────────────────────────────────
  const vuln = posture?.vulnerabilities;
  if (vuln) {
    // Kritische CVEs: stark gewichtet — schon 3 CVEs = HIGH (≥50 Punkte).
    const crit = vuln.critical ?? 0;
    if (crit > 0) add(Math.min(crit * 18, 50), `${crit} kritische CVEs`);
    const high = vuln.high ?? 0;
    if (high > 0) add(Math.min(high * 2, 20), `${high} hohe CVEs`);
  }

  // ── SCA-Compliance ───────────────────────────────────────────────────────
  const scaScore = posture?.sca?.worstScore;
  if (typeof scaScore === 'number') {
    if (scaScore < 50) add(20, `SCA-Compliance niedrig (${scaScore}/100)`);
    else if (scaScore < 75) add(10, `SCA-Compliance mittel (${scaScore}/100)`);
  }

  // ── Offene Ports aus Inventory ───────────────────────────────────────────
  const ports = inv?.portsTotal ?? 0;
  if (ports > PORTS_HIGH_THRESHOLD) add(15, `${ports} offene Ports (>${PORTS_HIGH_THRESHOLD})`);
  else if (ports > PORTS_MED_THRESHOLD) add(8, `${ports} offene Ports (>${PORTS_MED_THRESHOLD})`);

  // ── 'unknown' wenn zu wenig Datenbasis ──────────────────────────────────
  // Bedingung: Agent ist nicht definitiv offline, kein Heartbeat-Alter bekannt
  // UND kein Posture vorhanden → wir haben zu wenig Information für eine
  // ehrliche Einstufung.
  if (!isOffline && keepAliveAge === null && !posture) {
    return { level: 'unknown', reasons: [] };
  }

  score = Math.min(score, 100);
  return { level: levelFromScore(score), reasons };
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}
