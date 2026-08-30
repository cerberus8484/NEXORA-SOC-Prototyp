import type { CSSProperties } from 'react';
import type { SiemTelemetry, SiemAgentSummary } from './siemApi';
import { seriesTotal } from './telemetryModel';
import { glow } from './OpsSection';
import { useTranslation } from 'react-i18next';

// KPI-Badge-Leiste im Ops-Stil (Vorlage: docs/network/opnsense-dashboard.html) —
// alle Werte echt aus der Telemetrie (24h-Summen) bzw. dem Wazuh-Agent-Status.

const s: Record<string, CSSProperties> = {
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 12, marginBottom: 14 },
  badge: {
    background: 'linear-gradient(165deg, var(--bg-card-soft), var(--bg-card))',
    border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)',
    padding: '12px 14px 10px', fontFamily: 'var(--font-mono)',
  },
  label: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
    textTransform: 'uppercase', marginBottom: 6,
  },
  value: { fontSize: 22, fontWeight: 700, lineHeight: 1.1 },
  sub: { fontSize: 10, color: 'var(--text-dim)', marginTop: 5, letterSpacing: '0.04em' },
};

const fmt = (n: number) => n.toLocaleString('de-DE');

interface KpiBadgesProps {
  telemetry: SiemTelemetry;
  agents: SiemAgentSummary | null;
}

export function KpiBadges({ telemetry, agents }: KpiBadgesProps) {
  const { t: tr } = useTranslation();
  const sr = telemetry.series;
  const badges: { label: string; color: string; value: string; sub: string }[] = [
    {
      label: 'Agents online', color: 'var(--success)',
      value: agents ? `${agents.online} / ${agents.total}` : '—',
      sub: agents ? tr('text.wazuhAgentsActive') : tr('app.agentStatusNotAvailable'),
    },
    {
      label: 'Wazuh Events', color: 'var(--accent)',
      value: fmt(seriesTotal(sr.events)),
      sub: 'Manager 10.99.99.77 · 24h',
    },
    {
      label: 'FW Blocks', color: 'var(--danger)',
      value: fmt(seriesTotal(sr.fwBlock)),
      sub: 'OPNsense filterlog · 24h',
    },
    {
      label: 'DC01 Logons', color: 'var(--purple)',
      value: fmt(seriesTotal(sr.dcLogons)),
      sub: 'Kerberos · nexora.example · 24h',
    },
    {
      label: 'WEF Forwarded', color: 'var(--accent-orange)',
      value: fmt(seriesTotal(sr.wef)),
      sub: 'DC01 → WEC01 → Wazuh · 24h',
    },
  ];

  return (
    <div style={s.row}>
      {badges.map((b) => (
        <div key={b.label} style={{ ...s.badge, borderTop: `2px solid ${b.color}` }}>
          <div style={{ ...s.label, color: b.color }}>{b.label}</div>
          <div style={{ ...s.value, ...glow(b.color) }}>{b.value}</div>
          <div style={s.sub}>{b.sub}</div>
        </div>
      ))}
    </div>
  );
}
