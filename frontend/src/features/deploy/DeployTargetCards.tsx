import type { CSSProperties } from 'react';
import { CheckCircle2, Server } from 'lucide-react';
import type { DeployConnector, ProxmoxConnectorCapacity } from './deployApi';
import { capacityTemplates, formatBytes, percentage } from './connectorCapacityView';

const s: Record<string, CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 },
  card: { position: 'relative', minHeight: 235, textAlign: 'left', padding: 16, border: '1px solid var(--border)', borderRadius: 'calc(var(--radius) + 2px)', background: 'linear-gradient(145deg, var(--bg-card), var(--bg-card-soft))', color: 'var(--text)', cursor: 'pointer' },
  title: { display: 'flex', alignItems: 'center', gap: 9, fontWeight: 750, fontSize: 14 },
  meta: { marginTop: 5, fontSize: 11.5, color: 'var(--text-dim)' },
  metric: { display: 'grid', gridTemplateColumns: '66px 1fr', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 11 },
  track: { height: 5, overflow: 'hidden', borderRadius: 999, background: 'var(--border-soft)' },
  action: { position: 'absolute', right: 14, bottom: 14, left: 14, width: 'calc(100% - 28px)', padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', color: 'var(--accent-text)', background: 'var(--accent)', fontWeight: 700, fontSize: 12 },
};

interface DeployTargetCardsProps {
  connectors: DeployConnector[];
  capacities: Record<string, ProxmoxConnectorCapacity | undefined>;
  selectedId: string;
  onSelect: (connector: DeployConnector) => void;
}

function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const usedPercent = percentage(used, total);
  return (
    <div style={s.metric}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <span>{label === 'CPU' ? `${used.toFixed(1)} / ${total} Cores` : `${formatBytes(total - used)} frei`}</span>
          <span style={{ color: 'var(--text-dim)' }}>{usedPercent}%</span>
        </div>
        <div style={s.track}><div style={{ height: '100%', width: `${usedPercent}%`, background: usedPercent > 85 ? 'var(--danger)' : 'var(--success)' }} /></div>
      </div>
    </div>
  );
}

export function DeployTargetCards({ connectors, capacities, selectedId, onSelect }: DeployTargetCardsProps) {
  return (
    <div style={s.grid} aria-label="Verfügbare Deploy-Ziele">
      {connectors.map((connector) => {
        const capacity = capacities[connector.id];
        const selected = connector.id === selectedId;
        return (
          <button
            type="button"
            key={connector.id}
            onClick={() => onSelect(connector)}
            aria-pressed={selected}
            style={{ ...s.card, borderColor: selected ? 'var(--accent)' : 'var(--border)', boxShadow: selected ? '0 0 0 3px var(--accent-soft)' : 'var(--shadow-card)' }}
          >
            <div style={s.title}><Server size={22} color="var(--accent)" />{connector.name}{capacity?.node.online && <><CheckCircle2 size={15} color="var(--success)" /><span style={{ color: 'var(--success)', fontSize: 11 }}>Online</span></>}</div>
            <div style={s.meta}>Node {connector.targetNode ?? '–'} · {connector.host}</div>
            {capacity ? <>
              <Meter label="CPU" used={capacity.node.cpu.used} total={capacity.node.cpu.total} />
              <Meter label="RAM" used={capacity.node.memory.usedBytes} total={capacity.node.memory.totalBytes} />
              <Meter label="Storage" used={capacity.storage.usedBytes} total={capacity.storage.totalBytes} />
              <div style={{ ...s.meta, marginTop: 12 }}><strong>VMs / Container:</strong> {capacity.guests.vms} / {capacity.guests.containers}</div>
              <div style={{ ...s.meta, marginTop: 12 }}><strong>Templates:</strong> {capacityTemplates(capacity)}</div>
            </> : <div style={{ ...s.meta, marginTop: 18 }}>Kapazität wird geladen oder ist nicht abrufbar.</div>}
            <div style={s.action}>{selected ? 'Dieses Ziel gewählt' : 'Diesen Connector wählen'}</div>
          </button>
        );
      })}
    </div>
  );
}
