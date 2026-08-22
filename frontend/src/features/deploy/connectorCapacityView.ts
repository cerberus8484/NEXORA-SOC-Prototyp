import type { ProxmoxConnectorCapacity } from './deployApi';

export function percentage(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 GB';
  return `${(value / (1024 ** 3)).toFixed(value >= 1024 ** 4 ? 1 : 0)} GB`;
}

export function capacityTemplates(capacity?: ProxmoxConnectorCapacity): string {
  if (!capacity) return 'Kapazität wird geladen …';
  const names = [
    ...capacity.templates.vm.map((template) => template.name),
    ...capacity.templates.lxc.map((template) => template.name),
  ];
  return names.length > 0 ? names.slice(0, 3).join(', ') : 'Keine Templates gefunden';
}
