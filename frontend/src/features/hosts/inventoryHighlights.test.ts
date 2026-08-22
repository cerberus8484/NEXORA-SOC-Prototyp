import { describe, test, expect } from 'vitest';
import { deriveInventoryHighlights, deriveHostRisk } from './inventoryHighlights';
import type { WazuhAgent, WazuhInventory } from '../wazuh/wazuhApi';
import type { HostPosture } from './hostsTypes';

// ── Fixtures ──────────────────────────────────────────────────────────

const baseAgent = (): WazuhAgent => ({
  id: '001',
  name: 'WindowsClient',
  status: 'active',
  ip: '10.99.99.20',
  version: '4.14.5',
  lastKeepAlive: new Date(Date.now() - 2 * 60_000).toISOString(), // 2 min ago
  os: { name: 'Windows 10 Pro', version: '10.0.19045', platform: 'windows' },
  group: ['nexora'],
});

const baseInventory = (): WazuhInventory => ({
  os: { hostname: 'WindowsClient', os: { name: 'Windows 10 Pro', version: '10.0.19045' }, architecture: 'x86_64' },
  hardware: { cpu: { name: 'Intel Core i7-11800H', cores: 8 }, ram: { total: 16_777_216 } },
  interfaces: [{ name: 'Ethernet', mac: 'aa:bb:cc:dd:ee:ff', state: 'up' }],
  packagesTotal: 142,
  portsTotal: 12,
  processesTotal: 98,
});

const basePosture = (): HostPosture => ({
  sca: {
    policies: [{ policyId: 'cis_win10', name: 'CIS Windows 10', score: 72, pass: 80, fail: 20, totalChecks: 100 }],
    worstScore: 72,
    totalFail: 20,
  },
  vulnerabilities: {
    critical: 2, high: 5, medium: 10, low: 8, total: 25,
    topCves: [{ cve: 'CVE-2024-1234', severity: 'critical', score: 9.8, package: 'openssl', version: '1.0.2' }],
  },
});

// ─────────────────────────────────────────────────────────────────────
// deriveInventoryHighlights
// ─────────────────────────────────────────────────────────────────────

describe('deriveInventoryHighlights', () => {

  // ── OS & Build ───────────────────────────────────────────────────
  test('leitet OS-Name und Build aus syscollector os.os ab', () => {
    const result = deriveInventoryHighlights(baseInventory());
    expect(result.osName).toBe('Windows 10 Pro');
    expect(result.osBuild).toBe('10.0.19045');
  });

  test('fehlt os.os → osName/osBuild sind null (ehrlich)', () => {
    const inv = baseInventory();
    inv.os = null;
    const result = deriveInventoryHighlights(inv);
    expect(result.osName).toBeNull();
    expect(result.osBuild).toBeNull();
  });

  test('os vorhanden aber os.os fehlt → null (ehrlich)', () => {
    const inv = baseInventory();
    inv.os = { hostname: 'host', os: undefined, architecture: 'x86_64' };
    const result = deriveInventoryHighlights(inv);
    expect(result.osName).toBeNull();
    expect(result.osBuild).toBeNull();
  });

  // ── Hardware ─────────────────────────────────────────────────────
  test('leitet CPU-Name und Kerne aus hardware.cpu ab', () => {
    const result = deriveInventoryHighlights(baseInventory());
    expect(result.cpuLabel).toBe('Intel Core i7-11800H (8 Kerne)');
  });

  test('CPU ohne Kerne → nur Name', () => {
    const inv = baseInventory();
    inv.hardware = { cpu: { name: 'ARM64' }, ram: { total: 8_388_608 } };
    const result = deriveInventoryHighlights(inv);
    expect(result.cpuLabel).toBe('ARM64');
  });

  test('kein hardware.cpu → cpuLabel ist null', () => {
    const inv = baseInventory();
    inv.hardware = null;
    const result = deriveInventoryHighlights(inv);
    expect(result.cpuLabel).toBeNull();
  });

  test('leitet RAM-Größe korrekt in GB ab (16 MB → ~16 GB)', () => {
    const result = deriveInventoryHighlights(baseInventory());
    // 16_777_216 KB → 16 GB
    expect(result.ramGb).toBeCloseTo(16, 0);
    expect(result.ramLabel).toBe('16.0 GB');
  });

  test('kein hardware.ram → ramLabel ist null', () => {
    const inv = baseInventory();
    inv.hardware = { cpu: { name: 'x86', cores: 4 }, ram: undefined };
    const result = deriveInventoryHighlights(inv);
    expect(result.ramLabel).toBeNull();
    expect(result.ramGb).toBeNull();
  });

  test('hardware null → ramLabel und cpuLabel beide null', () => {
    const inv = baseInventory();
    inv.hardware = null;
    const result = deriveInventoryHighlights(inv);
    expect(result.ramLabel).toBeNull();
    expect(result.cpuLabel).toBeNull();
  });

  // ── Software- und Port-Zähler ────────────────────────────────────
  test('pakete und ports korrekt abgelesen', () => {
    const result = deriveInventoryHighlights(baseInventory());
    expect(result.installedPackages).toBe(142);
    expect(result.openPorts).toBe(12);
  });

  test('packagesTotal 0 → 0 (kein undefined)', () => {
    const inv = baseInventory();
    inv.packagesTotal = 0;
    const result = deriveInventoryHighlights(inv);
    expect(result.installedPackages).toBe(0);
  });

  // ── AV-Erkennung ─────────────────────────────────────────────────
  test('avDetected ist immer false — AV-Paketerkennung erfordert Paketliste, die syscollector-Inventory nicht liefert', () => {
    // Ehrlichkeitsprüfung: syscollector gibt nur packagesTotal zurück,
    // keine einzelnen Pakete → AV-Erkennung ist technisch unmöglich.
    const result = deriveInventoryHighlights(baseInventory());
    expect(result.avDetected).toBe(false);
    expect(result.avDetectedReason).toContain('nicht verfügbar');
  });

  // ── MAC-Adresse ──────────────────────────────────────────────────
  test('leitet erste MAC-Adresse aus interfaces ab', () => {
    const result = deriveInventoryHighlights(baseInventory());
    expect(result.macAddress).toBe('aa:bb:cc:dd:ee:ff');
  });

  test('leere interfaces → macAddress ist null', () => {
    const inv = baseInventory();
    inv.interfaces = [];
    const result = deriveInventoryHighlights(inv);
    expect(result.macAddress).toBeNull();
  });

  // ── null/undefined Inventory ──────────────────────────────────────
  test('null-Inventory → alle Felder null/false (Ganzfeldfall)', () => {
    const result = deriveInventoryHighlights(null);
    expect(result.osName).toBeNull();
    expect(result.osBuild).toBeNull();
    expect(result.cpuLabel).toBeNull();
    expect(result.ramLabel).toBeNull();
    expect(result.installedPackages).toBeNull();
    expect(result.openPorts).toBeNull();
    expect(result.avDetected).toBe(false);
    expect(result.macAddress).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// deriveHostRisk
// ─────────────────────────────────────────────────────────────────────

describe('deriveHostRisk', () => {

  // ── happy path ───────────────────────────────────────────────────
  test('aktiver Agent mit frischem Heartbeat → level low', () => {
    const result = deriveHostRisk(baseAgent(), baseInventory(), basePosture());
    // SCA 72 → mittel (+10), CVE: 2 crit*8=16, 5 high*2=10 → 36 total
    expect(result.level).not.toBe('unknown');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test('disconnected Agent → level mindestens medium, Grund enthält "offline"', () => {
    const agent = baseAgent();
    agent.status = 'disconnected';
    const result = deriveHostRisk(agent, null, null);
    expect(['medium', 'high', 'critical']).toContain(result.level);
    expect(result.reasons.some((r) => r.toLowerCase().includes('offline'))).toBe(true);
  });

  // ── Heartbeat-Alter ──────────────────────────────────────────────
  test('Heartbeat älter als 15 min → Warnsignal im Grund', () => {
    const agent = baseAgent();
    agent.status = 'active';
    agent.lastKeepAlive = new Date(Date.now() - 20 * 60_000).toISOString();
    const result = deriveHostRisk(agent, null, null);
    expect(result.reasons.some((r) => r.includes('min'))).toBe(true);
  });

  test('Heartbeat fehlt → unknown (kein Fake-Score)', () => {
    const agent = baseAgent();
    agent.status = 'active';
    agent.lastKeepAlive = undefined;
    const result = deriveHostRisk(agent, null, null);
    // Ohne lastKeepAlive und ohne Posture → zu wenig Daten → unknown
    expect(result.level).toBe('unknown');
  });

  // ── CVEs ─────────────────────────────────────────────────────────
  test('kritische CVEs erhöhen das Risiko stark', () => {
    const agent = baseAgent();
    const posture: HostPosture = {
      sca: null,
      vulnerabilities: { critical: 3, high: 0, medium: 0, low: 0, total: 3, topCves: [] },
    };
    const result = deriveHostRisk(agent, null, posture);
    expect(['high', 'critical']).toContain(result.level);
    expect(result.reasons.some((r) => r.includes('CVE') || r.includes('krit'))).toBe(true);
  });

  test('keine CVEs und SCA > 75 → kein CVE/SCA-Faktor im Grund', () => {
    const agent = baseAgent();
    const posture: HostPosture = {
      sca: { policies: [{ policyId: 'p', name: 'P', score: 90, pass: 90, fail: 0, totalChecks: 90 }], worstScore: 90, totalFail: 0 },
      vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0, total: 0, topCves: [] },
    };
    const result = deriveHostRisk(agent, null, posture);
    expect(result.reasons.every((r) => !r.includes('CVE') && !r.includes('SCA'))).toBe(true);
  });

  // ── SCA ──────────────────────────────────────────────────────────
  test('SCA worstScore < 50 → SCA-Faktor taucht im Grund auf', () => {
    const agent = baseAgent();
    const posture: HostPosture = {
      sca: { policies: [], worstScore: 30, totalFail: 50 },
      vulnerabilities: null,
    };
    const result = deriveHostRisk(agent, null, posture);
    expect(result.reasons.some((r) => r.toLowerCase().includes('sca') || r.includes('30'))).toBe(true);
  });

  // ── unknown-Schwelle ─────────────────────────────────────────────
  test('kein Posture, kein Heartbeat-Alter → zu wenig Daten → unknown', () => {
    const agent = baseAgent();
    agent.lastKeepAlive = undefined;
    const result = deriveHostRisk(agent, null, null);
    expect(result.level).toBe('unknown');
    expect(result.reasons).toHaveLength(0);
  });

  test('active Agent mit frischem Heartbeat aber kein Posture → low (Heartbeat reicht)', () => {
    const agent = baseAgent(); // status: active, lastKeepAlive: 2 min ago
    const result = deriveHostRisk(agent, null, null);
    expect(result.level).toBe('low');
    expect(result.reasons).toHaveLength(0);
  });

  // ── never_connected ───────────────────────────────────────────────
  test('never_connected Agent → mindestens medium', () => {
    const agent = baseAgent();
    agent.status = 'never_connected';
    agent.lastKeepAlive = undefined;
    const result = deriveHostRisk(agent, null, null);
    expect(['medium', 'high', 'critical']).toContain(result.level);
  });

  // ── offene Ports aus Inventory ────────────────────────────────────
  test('viele offene Ports (>50) aus Inventory → Faktor erscheint', () => {
    const agent = baseAgent();
    const inv = baseInventory();
    inv.portsTotal = 60;
    const result = deriveHostRisk(agent, inv, null);
    expect(result.reasons.some((r) => r.includes('Port') || r.includes('60'))).toBe(true);
  });

  // ── reasons Transparenz ──────────────────────────────────────────
  test('reasons sind alle nicht-leere Strings', () => {
    const result = deriveHostRisk(baseAgent(), baseInventory(), basePosture());
    expect(result.reasons.every((r) => typeof r === 'string' && r.length > 0)).toBe(true);
  });
});
