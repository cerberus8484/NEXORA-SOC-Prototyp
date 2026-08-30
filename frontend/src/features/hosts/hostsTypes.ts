// ─────────────────────────────────────────────────────────────────────────
// Registered Hosts — Datenmodell
// Daten kommen live aus der Wazuh-API (features/wazuh/wazuhApi).
// Später optional GET /v1/hosts für quellenübergreifende Hosts.
// ─────────────────────────────────────────────────────────────────────────

export type HostSource = 'wazuh' | 'splunk' | 'qradar' | 'soar' | 'manual';
// 'unmonitored' = manuell gepflegtes Asset ohne Agent → kein Heartbeat (ehrlich, kein Fake).
export type HeartbeatStatus = 'healthy' | 'delayed' | 'offline' | 'unmonitored';
export type InventoryStatus = 'complete' | 'partial' | 'missing';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RegisteredHost {
  id: string;
  hostname: string;
  customer?: string;
  source: HostSource;
  agentId?: string;
  agentVersion?: string;
  os?: { name?: string; version?: string; build?: string; platform?: string };
  ipAddresses?: string[];
  macAddress?: string;
  domain?: string;
  lastUser?: string;
  lastHeartbeatAt?: string;     // ISO
  expectedIntervalMin?: number;
  heartbeatStatus: HeartbeatStatus;
  inventoryStatus: InventoryStatus;
  riskScore?: number;
  riskLevel?: RiskLevel;
  // 24h Check-in-Reihe für die Sparkline. Wazuh liefert das NICHT (nur lastKeepAlive,
  // einen Zeitpunkt) → bleibt aktuell leer; die UI zeigt dann ehrlich "nicht verfügbar" (A8).
  heartbeatHistory?: number[];
  inventory?: {
    cpu?: string;
    ram?: string;
    disk?: string;
    kernelBuild?: string;
    architecture?: string;
    installedSoftwareCount?: number;
    openPortsCount?: number;
    antivirus?: string;
    avSignatures?: string;
    missingPatches?: number;
    suspiciousSoftwareCount?: number;
    softwareUpdates?: string;
    assetTags?: string[];
    // SCA/Vulnerability-Posture (echte Wazuh-Daten)
    cveCritical?: number;
    cveHigh?: number;
    cveMedium?: number;
    cveLow?: number;
    cveTotal?: number;
    scaScore?: number;      // 0–100 Compliance (schlechteste Policy)
    scaFail?: number;       // fehlgeschlagene Checks gesamt
  };
}

// CVE-Befund eines Hosts (schwerste zuerst).
export interface HostCve {
  cve: string;
  severity?: string;
  score?: number | null;
  package?: string;
  version?: string;
}

// Antwort von GET /v1/wazuh/agents/:id/posture.
export interface HostPosture {
  sca: { policies: { policyId: string; name: string; score: number | null; pass: number; fail: number; totalChecks: number }[]; worstScore: number | null; totalFail: number } | null;
  vulnerabilities: { critical: number; high: number; medium: number; low: number; total: number; topCves: HostCve[] } | null;
}
