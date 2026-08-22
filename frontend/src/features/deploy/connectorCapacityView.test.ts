import { describe, expect, it } from 'vitest';
import { capacityTemplates, formatBytes, percentage } from './connectorCapacityView';

describe('connectorCapacityView', () => {
  it('begrenzt Kapazitätsprozente robust auf 0 bis 100', () => {
    expect(percentage(4, 8)).toBe(50);
    expect(percentage(12, 8)).toBe(100);
    expect(percentage(1, 0)).toBe(0);
  });

  it('formatiert Bytes und fasst VM-/LXC-Templates zusammen', () => {
    expect(formatBytes(40 * 1024 ** 3)).toBe('40 GB');
    expect(capacityTemplates({
      kind: 'proxmox', updatedAt: '2026-08-02T10:00:00.000Z',
      node: { name: 'pve', online: true, cpu: { used: 2, total: 8 }, memory: { usedBytes: 0, totalBytes: 0 } },
      storage: { name: 'local-lvm', usedBytes: 0, totalBytes: 0, freeBytes: 0 },
      guests: { vms: 0, containers: 0 }, templates: { vm: [{ vmid: 9000, name: 'Rocky 9' }], lxc: [{ volid: 'local:vztmpl/debian.tar.xz', name: 'Debian 12' }] },
    })).toBe('Rocky 9, Debian 12');
  });
});
