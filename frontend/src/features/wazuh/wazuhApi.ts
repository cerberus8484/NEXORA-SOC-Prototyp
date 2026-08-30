import { api } from '../../lib/apiClient';
import type { HostPosture } from '../hosts/hostsTypes';

export interface WazuhAgent {
  id: string;
  name: string;
  ip?: string;
  status?: string;                 // active | disconnected | never_connected | pending
  os?: { name?: string; version?: string; platform?: string };
  version?: string;
  lastKeepAlive?: string;
  dateAdd?: string;
  group?: string[];
  node_name?: string;
}

export interface WazuhInventory {
  os: { hostname?: string; os?: { name?: string; version?: string }; architecture?: string } | null;
  hardware: { cpu?: { name?: string; cores?: number }; ram?: { total?: number } } | null;
  interfaces: { name?: string; mac?: string; state?: string }[];
  packagesTotal: number;
  portsTotal: number;
  processesTotal: number;
}

interface AgentsResponse { enabled: boolean; data: WazuhAgent[]; total: number; }
interface InventoryResponse { enabled: boolean; data: WazuhInventory | null; }
interface PostureResponse { enabled: boolean; data: HostPosture | null; }

export const wazuhApi = {
  agents:    () => api.get<AgentsResponse>('/wazuh/agents'),
  inventory: (id: string) => api.get<InventoryResponse>(`/wazuh/agents/${id}/inventory`),
  posture:   (id: string) => api.get<PostureResponse>(`/wazuh/agents/${id}/posture`),
};
