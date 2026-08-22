import type { CSSProperties } from 'react';
import type { SiemTelemetry, SiemAgentSummary } from './siemApi';
import { zoneSeries, type ZoneDef, type ZoneHostDef } from './topology';
import { useTopology } from './useTopology';
import { TelemetryChart } from './TelemetryChart';
import { seriesTotal } from './telemetryModel';
import { OpsSectionHead } from './OpsSection';

// Netz-Zonen & Hosts (Vorlage: docs/network/opnsense-dashboard.html, Sektion [04]) —
// VLAN-Karten mit Live-Graph (Events der Zonen-Agents) + echtem Agent-Status.

const s: Record<string, CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 14 },
  card: {
    background: 'linear-gradient(165deg, var(--bg-card-soft), var(--bg-card))',
    border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)',
    padding: '12px 14px',
  },
  head: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 },
  title: { fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' },
  subnet: { marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-dim)', letterSpacing: '0.04em' },
  isolated: {
    fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
    color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 4, padding: '1px 6px',
  },
  hosts: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: 'var(--bg-elevated)', border: '1px solid var(--border-soft)', borderRadius: 6,
    padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text)',
  },
  chipIp: { color: 'var(--text-dim)' },
  chipNote: { fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' },
  noData: {
    fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-dim)',
    padding: '24px 0', textAlign: 'center',
  },
  liveVal: { marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' },
};

type AgentStatus = 'active' | 'disconnected' | 'unknown';

function hostStatus(host: ZoneHostDef, agents: SiemAgentSummary | null): AgentStatus {
  if (!host.agent || !agents) return 'unknown';
  const a = agents.list.find((x) => x.name.toLowerCase() === host.agent!.toLowerCase());
  if (!a?.status) return 'unknown';
  return a.status === 'active' ? 'active' : 'disconnected';
}

const STATUS_COLOR: Record<AgentStatus, string> = {
  active: 'var(--success)',
  disconnected: 'var(--danger)',
  unknown: 'var(--text-dim)',
};

function statusDot(status: AgentStatus): CSSProperties {
  const color = STATUS_COLOR[status];
  return {
    width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0,
    boxShadow: status === 'active' ? `0 0 6px ${color}` : 'none',
  };
}

function ZoneCard({ zone, telemetry, agents }: { zone: ZoneDef; telemetry: SiemTelemetry; agents: SiemAgentSummary | null }) {
  const points = zoneSeries(zone, telemetry.agents);
  return (
    <div style={{ ...s.card, borderLeft: `3px solid ${zone.color}` }}>
      <div style={s.head}>
        <span style={{ ...s.title, color: zone.color }}>{zone.label}</span>
        {zone.isolated ? <span style={s.isolated}>⚠ isoliert</span> : null}
        <span style={s.subnet}>{zone.subnet}</span>
      </div>
      <div style={s.hosts}>
        {zone.hosts.map((h) => {
          const status = hostStatus(h, agents);
          return (
            <span key={h.ip + h.label} style={s.chip} title={`Agent-Status: ${status}`}>
              <i style={statusDot(status)} />
              {h.label}
              <span style={s.chipIp}>{h.ip}</span>
              {h.note ? <span style={s.chipNote}>{h.note}</span> : null}
            </span>
          );
        })}
      </div>
      {points.length > 0 ? (
        <>
          <div style={{ display: 'flex', marginBottom: 4 }}>
            <span style={s.liveVal}>{`${seriesTotal(points).toLocaleString('de-DE')} Events / 24h`}</span>
          </div>
          <TelemetryChart series={[{ label: 'Events', color: zone.color, points }]} height={90} />
        </>
      ) : (
        <div style={s.noData}>— keine Agenten-Telemetrie in dieser Zone —</div>
      )}
    </div>
  );
}

interface NetworkZonesPanelProps {
  telemetry: SiemTelemetry;
  agents: SiemAgentSummary | null;
}

export function NetworkZonesPanel({ telemetry, agents }: NetworkZonesPanelProps) {
  const { zones } = useTopology();
  return (
    <div style={{ marginTop: 14 }}>
      <OpsSectionHead tag="[02]" title="Netz-Zonen & Hosts" right="Events pro VLAN · live" />
      <div style={s.grid}>
        {zones.map((z) => (
          <ZoneCard key={z.key} zone={z} telemetry={telemetry} agents={agents} />
        ))}
      </div>
    </div>
  );
}
