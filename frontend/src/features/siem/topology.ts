import type { SiemTelemetry, TelemetryPoint } from './siemApi';
import { sumSeries } from './telemetryModel';
import i18n from '../../i18n';

// Lab-Topologie fürs Netz-Zonen-Panel — bewusst statische Frontend-Config:
// die VLAN-Struktur ist Infrastruktur-Wissen, kein SIEM-Datum. Die Graphen
// und Status-Punkte dagegen kommen live aus Wazuh (Agent-Serien + Agent-Status).

export interface ZoneHostDef {
  label: string;
  ip: string;
  /** Wazuh-Agent-Name für Live-Status; DC01 hat einen direkten Agent, zusätzlich fließt WEF über WEC01. */
  agent?: string;
  /** Zusatz-Tag am Chip, z.B. 'via WEF' oder 'kein Agent'. */
  note?: string;
}

export interface ZoneDef {
  key: string;
  label: string;
  color: string;
  subnet: string;
  /** Agent-Namen, deren Event-Serien in den Zonen-Graph summiert werden. */
  agents: string[];
  hosts: ZoneHostDef[];
  isolated?: boolean;
}

export const ZONES: ZoneDef[] = [
  {
    key: 'vlan10', label: 'VLAN 10 — Servers', color: 'var(--accent)',
    subnet: '10.99.99.0/24 · GW 10.99.99.1 · vmbr10',
    agents: [
      'WEC01', 'wazuh-server', 'OPNsense.localdomain', 'Nexora', 'ollama',
      'DC01', 'grafana', 'opensourcebackup', 'ids-sensor',
    ],
    hosts: [
      { label: 'Wazuh Manager', ip: '10.99.99.77', agent: 'wazuh-server' },
      { label: 'Nexora SOC',    ip: '10.99.99.75', agent: 'Nexora' },
      { label: 'Ollama LLM',    ip: '10.99.99.78', agent: 'ollama' },
      { label: 'BackupServer',  ip: '10.99.99.72', agent: 'opensourcebackup' },
      { label: 'Grafana',       ip: '10.99.99.55', agent: 'grafana' },
      { label: 'IDS-Sensor · Suricata', ip: '10.99.99.60', agent: 'ids-sensor' },
      { label: 'DC01 · AD nexora.example', ip: '10.99.99.10', agent: 'DC01', note: 'direkt + WEF' },
      { label: 'WEC01 · Event Collector', ip: '10.99.99.11', agent: 'WEC01' },
      { label: 'OPNsense GW',   ip: '10.99.99.1',  agent: 'OPNsense.localdomain' },
    ],
  },
  {
    key: 'vlan20', label: 'VLAN 20 — Clients', color: 'var(--warning)',
    subnet: '10.0.20.0/24',
    agents: ['WindowsClient'],
    hosts: [
      // Platzhalter-IP (Doku-Bereich). Reale Werte trägt der Operator in die git-ignorierte topology.json ein.
      { label: 'WindowsClient', ip: '10.0.20.102', agent: 'WindowsClient', note: 'Client' },
    ],
  },
  {
    key: 'vlan30', label: 'VLAN 30 — Pentest', color: 'var(--danger)',
    subnet: '10.0.30.0/24', isolated: true,
    agents: [],
    hosts: [
      { label: 'Kali', ip: '10.0.30.10', note: i18n.t('app.noAgent') },
    ],
  },
  {
    key: 'vlan99', label: 'VLAN 99 — Mgmt', color: 'var(--success)',
    subnet: '10.99.98.0/24',
    agents: ['Proxmox'],
    hosts: [
      { label: 'Proxmox VE', ip: '10.99.98.100', agent: 'Proxmox' },
    ],
  },
];

export interface QuickLink {
  label: string;
  url: string;
  desc: string;
}

export const QUICK_LINKS: QuickLink[] = [
  { label: 'OPNsense UI',     url: 'https://10.99.99.1',        desc: 'Firewall · VLANs · filterlog' },
  { label: 'Proxmox VE',      url: 'https://10.99.98.100:8006', desc: 'Hypervisor · VMs 110/111/117' },
  { label: 'Wazuh Dashboard', url: 'https://10.99.99.77',       desc: 'SIEM · Alerts · Agents' },
];

/** Summierte Event-Serie aller Agents einer Zone (leer, wenn keine Agents liefern). */
export function zoneSeries(zone: ZoneDef, agents: SiemTelemetry['agents']): TelemetryPoint[] {
  const matching = agents.filter((a) => zone.agents.includes(a.name)).map((a) => a.points);
  return sumSeries(matching);
}
