// ─────────────────────────────────────────────────────────────────────────
// Manual-Host-Quelle — Mapping Backend-DTO → RegisteredHost.
//
// Manuell gepflegte Assets (Nicht-Wazuh) haben bewusst KEINEN Heartbeat/
// Syscollector. Sie werden ehrlich als „unmonitored" (Heartbeat) und „missing"
// (Inventory) dargestellt — kein erfundener Status, kein Risk-Score.
// ─────────────────────────────────────────────────────────────────────────

import type { RegisteredHost } from './hostsTypes';

export interface ManualHostDto {
  id: string;
  hostname: string;
  ipAddresses?: string[];
  os?: string;
  customer?: string;
  notes?: string;
  source: 'manual';
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function manualHostToRegistered(m: ManualHostDto): RegisteredHost {
  return {
    id: m.id,
    hostname: m.hostname,
    customer: m.customer ? m.customer : undefined,
    source: 'manual',
    os: m.os ? { name: m.os } : undefined,
    ipAddresses: m.ipAddresses ?? [],
    heartbeatStatus: 'unmonitored',
    inventoryStatus: 'missing',
    // Kein lastHeartbeatAt, kein riskScore — für manuelle Assets nicht verfügbar (kein Fake).
  };
}
