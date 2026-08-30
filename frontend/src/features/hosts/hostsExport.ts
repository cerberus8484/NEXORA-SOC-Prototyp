import type { RegisteredHost } from './hostsTypes';

// CSV-Export der (gefilterten) Host-Liste — rein, testbar.

const COLUMNS: [string, (h: RegisteredHost) => string][] = [
  ['Hostname', (h) => h.hostname],
  ['Customer', (h) => h.customer ?? ''],
  ['Source', (h) => h.source],
  ['OS', (h) => h.os?.name ?? ''],
  ['IP', (h) => (h.ipAddresses ?? []).join(' ')],
  ['Agent ID', (h) => h.agentId ?? ''],
  ['Agent Version', (h) => h.agentVersion ?? ''],
  ['Heartbeat', (h) => h.heartbeatStatus],
  ['Inventory', (h) => h.inventoryStatus],
  ['Risk Score', (h) => (h.riskScore != null ? String(h.riskScore) : '')],
  ['Risk Level', (h) => h.riskLevel ?? ''],
  ['Last Heartbeat', (h) => h.lastHeartbeatAt ?? ''],
];

/** Ein CSV-Feld quoten, wenn es Komma/Quote/Zeilenumbruch enthält. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function hostsToCsv(hosts: RegisteredHost[]): string {
  const header = COLUMNS.map(([name]) => name).join(',');
  const rows = hosts.map((h) => COLUMNS.map(([, get]) => csvCell(get(h))).join(','));
  return [header, ...rows].join('\n');
}
