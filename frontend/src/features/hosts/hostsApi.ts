import { api } from '../../lib/apiClient';
import type { HostAlert } from './hostTimeline';
import type { PackagesResponse } from './hostPackagesModel';
import type { ManualHostDto } from './manualHostModel';

export interface HostDetailInventory {
  installedPackages: number | null;
  openPorts: number | null;
  processes: number | null;
  cpu: string | null;
  cpuCores: number | null;
  ramGb: number | null;
  architecture: string | null;
}

export interface HostDetail {
  agentId: string;
  hostname: string;
  ip: string | null;
  status: string;
  os: string | null;
  agentVersion: string | null;
  lastHeartbeat: string | null;
  group: string[];
  inventory: HostDetailInventory | null;
}

interface DetailResponse { enabled: boolean; data: HostDetail | null; }
interface AlertsResponse { data: HostAlert[]; total: number; }

export type { HostPackage } from './hostPackagesModel';

export interface PackagesParams {
  limit?: number;
  offset?: number;
  search?: string;
}

// Host-Enrollment: registrierter Agent inkl. einmaligem Enrollment-Key.
export interface EnrolledHost {
  id: string;
  name: string;
  key: string;
}
export interface AddHostBody {
  name: string;
  ip?: string;
}
interface AddHostResponse { data: EnrolledHost; }

// Manual-Host-Quelle (Nicht-Wazuh-Assets).
export interface ManualHostBody {
  hostname: string;
  ipAddresses?: string[];
  os?: string;
  customer?: string;
  notes?: string;
}
interface ManualHostsResponse { data: ManualHostDto[]; }
interface ManualHostResponse { data: ManualHostDto; }

export const hostsApi = {
  detail: (agentId: string) => api.get<DetailResponse>(`/hosts/${agentId}`),
  alerts: (agentId: string, hostname?: string) =>
    api.get<AlertsResponse>(`/hosts/${agentId}/alerts`, hostname ? { hostname } : undefined),
  // Installierte Software eines Hosts — server-seitige Suche + Pagination.
  packages: (agentId: string, params: PackagesParams = {}) => {
    const { limit = 50, offset = 0, search = '' } = params;
    return api.get<PackagesResponse>(`/hosts/${agentId}/packages`, { limit, offset, search });
  },
  // POST /hosts — neuen Wazuh-Agent registrieren (admin). Liefert den Enrollment-Key.
  addHost: (body: AddHostBody) => api.post<AddHostResponse>('/hosts', body),
  // Manual-Host-Quelle: manuell gepflegte Assets (Nicht-Wazuh).
  manualHosts: () => api.get<ManualHostsResponse>('/hosts/manual'),
  addManualHost: (body: ManualHostBody) => api.post<ManualHostResponse>('/hosts/manual', body),
  deleteManualHost: (id: string) => api.del<{ ok: boolean }>(`/hosts/manual/${id}`),
};
