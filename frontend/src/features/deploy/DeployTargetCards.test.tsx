import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeployTargetCards } from './DeployTargetCards';

describe('DeployTargetCards', () => {
  it('zeigt die Live-Kapazität und wählt ausschließlich den angeklickten Connector', () => {
    const onSelect = vi.fn();
    render(<DeployTargetCards
      connectors={[{ id: 'pve', type: 'proxmox', name: 'Proxmox PVE', host: '10.0.10.14', targetNode: 'pve', status: 'active', createdAt: '2026-08-02' }]}
      selectedId=""
      onSelect={onSelect}
      capacities={{ pve: { kind: 'proxmox', updatedAt: '2026-08-02', node: { name: 'pve', online: true, cpu: { used: 2, total: 8 }, memory: { usedBytes: 8 * 1024 ** 3, totalBytes: 32 * 1024 ** 3 } }, storage: { name: 'local-lvm', usedBytes: 20 * 1024 ** 3, totalBytes: 100 * 1024 ** 3, freeBytes: 80 * 1024 ** 3 }, guests: { vms: 4, containers: 8 }, templates: { vm: [{ vmid: 9000, name: 'Rocky 9' }], lxc: [] } } }}
    />);

    expect(screen.getByText(/24 GB frei/i)).toBeInTheDocument();
    expect(screen.getByText(/Rocky 9/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Diesen Connector wählen/i }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'pve' }));
  });
});
