import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { siemApi, type SiemTelemetry, type SiemRecentAlert, type SiemAgentSummary } from './siemApi';
import { TelemetryChart, type ChartSeries } from './TelemetryChart';
import { lastValue, seriesTotal } from './telemetryModel';
import { OpsSectionHead, glow } from './OpsSection';
import { KpiBadges } from './KpiBadges';
import { NetworkZonesPanel } from './NetworkZonesPanel';
import { QuickAccessPanel } from './QuickAccessPanel';
import { Card, CardHeader, CardBody, Badge, Spinner, EmptyState } from '../../components/ui';

const REFRESH_MS = 60_000;

const s: Record<string, CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14, marginBottom: 14 },
  box: {
    position: 'relative', background: 'linear-gradient(165deg, var(--bg-card-soft), var(--bg-card))',
    border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', padding: '14px 16px 12px',
  },
  boxTitle: {
    display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)',
    fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  },
  boxSub: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', marginTop: 2, marginBottom: 10 },
  liveVal: {
    position: 'absolute', top: 12, right: 16, textAlign: 'right',
    fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 700, lineHeight: 1.15,
  },
  liveUnit: {
    display: 'block', fontSize: 9, fontWeight: 500, letterSpacing: '0.12em',
    textTransform: 'uppercase', color: 'var(--text-dim)', textShadow: 'none',
  },
  legend: { display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' },
  legendItem: {
    display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)',
    fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)',
  },
  term: { background: 'var(--bg-terminal)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', overflow: 'hidden' },
  termHead: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
    background: 'linear-gradient(180deg, var(--bg-card-soft), var(--bg-card))',
    borderBottom: '1px solid var(--border-soft)',
    fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-dim)',
  },
  termBody: { padding: '10px 14px', maxHeight: 230, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.85 },
  termLine: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
};

const dot = (color: string): CSSProperties => ({ width: 9, height: 9, borderRadius: '50%', background: color, display: 'inline-block' });

/**
 * Live-Telemetrie fürs Dashboard im Nexora-Ops-Stil (Mono, Glow, Terminal) —
 * echte Zeitreihen + Eventstream aus dem Wazuh-Indexer, dazu KPI-Badges,
 * Netz-Zonen mit Live-Graph pro VLAN und Infrastruktur-Quick-Access.
 */
export function TelemetryPanel() {
  const [telemetry, setTelemetry] = useState<SiemTelemetry | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [agents, setAgents] = useState<SiemAgentSummary | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      siemApi.telemetry('wazuh')
        .then((r) => {
          if (!alive) return;
          setEnabled(r.enabled);
          setTelemetry(r.data);
        })
        .catch(() => { if (alive) setEnabled(false); });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    // Agent-Status (für Badges + Zonen-Chips) einmalig — das Dashboard-DTO ist
    // teurer als die Telemetrie; Status-Punkte brauchen kein 60s-Polling.
    siemApi.dashboard('wazuh')
      .then((r) => { if (alive && r.data) setAgents(r.data.agents); })
      .catch(() => { /* Badges/Chips zeigen dann ehrlich '—' bzw. unknown */ });
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (enabled === null) {
    return (
      <Card className="card-pad" style={{ marginBottom: 24 }}>
        <Spinner label="Telemetrie wird geladen …" />
      </Card>
    );
  }
  if (!enabled || !telemetry) {
    return (
      <Card style={{ marginBottom: 24 }}>
        <CardHeader title="Live-Telemetrie" actions={<Badge tone="muted">SIEM</Badge>} />
        <CardBody>
          <EmptyState
            title="SIEM-Telemetrie nicht verfügbar"
            message="Wazuh-Indexer nicht konfiguriert oder nicht erreichbar."
          />
        </CardBody>
      </Card>
    );
  }

  const sr = telemetry.series;
  const charts: { title: string; color: string; sub: string; live: string; unit: string; series: ChartSeries[] }[] = [
    {
      title: 'SIEM Events — Wazuh', color: 'var(--accent)', sub: '10.99.99.77 · Events pro 15 min',
      live: String(lastValue(sr.events)), unit: 'aktuell / 15min',
      series: [
        { label: 'Events', color: 'var(--accent)', points: sr.events },
        { label: 'Alerts ≥ Lvl 7', color: 'var(--warning)', points: sr.alerts, fill: false },
      ],
    },
    {
      title: 'Firewall — OPNsense', color: 'var(--danger)', sub: 'filterlog via Syslog · Pass/Block',
      live: String(seriesTotal(sr.fwBlock)), unit: 'Blocks / 24h',
      series: [
        { label: 'Pass', color: 'var(--success)', points: sr.fwPass },
        { label: 'Block', color: 'var(--danger)', points: sr.fwBlock },
      ],
    },
    {
      title: 'DC01 — Active Directory', color: 'var(--purple)', sub: '10.99.99.10 · Auth via WEF',
      live: String(seriesTotal(sr.dcLogons)), unit: 'Logons / 24h',
      series: [
        { label: 'Logons (4624/4768/4769)', color: 'var(--purple)', points: sr.dcLogons },
        { label: 'Failed (4625)', color: 'var(--danger)', points: sr.dcFailed, fill: false },
      ],
    },
    {
      title: 'Virus Detection — Defender', color: 'var(--accent-orange)', sub: 'Events 1116/1117 · alle Agents',
      live: String(seriesTotal(sr.defender)), unit: 'Detections / 24h',
      series: [
        { label: 'Detections', color: 'var(--accent-orange)', points: sr.defender },
      ],
    },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      <OpsSectionHead
        tag="[01]"
        title="Live-Telemetrie — Wazuh"
        right={`${telemetry.range.hours}h · refresh ${REFRESH_MS / 1000}s`}
      />

      <KpiBadges telemetry={telemetry} agents={agents} />

      <div style={s.grid}>
        {charts.map(({ title, color, sub, live, unit, series }) => (
          <div key={title} style={s.box}>
            <div style={{ ...s.boxTitle, color }}>
              <span>▮</span>
              <span style={{ color: 'var(--text)' }}>{title}</span>
            </div>
            <div style={s.boxSub}>{sub}</div>
            <div style={{ ...s.liveVal, ...glow(color) }}>
              {live}
              <span style={s.liveUnit}>{unit}</span>
            </div>
            <TelemetryChart series={series} height={170} />
            <div style={s.legend}>
              {series.map((line) => (
                <span key={line.label} style={s.legendItem}>
                  <span style={{ width: 12, height: 3, borderRadius: 2, background: line.color, display: 'inline-block' }} />
                  {line.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <EventStream recent={telemetry.recent} defenderRecent={telemetry.defenderRecent} />

      <NetworkZonesPanel telemetry={telemetry} agents={agents} />
      <QuickAccessPanel />
    </div>
  );
}

// ── Terminal-Eventstream (echte Alerts, neueste unten wie tail -f) ───────────
const SEV_STYLE: Record<SiemRecentAlert['severity'], CSSProperties> = {
  critical: glow('var(--danger)'),
  high:     { color: 'var(--accent-orange)' },
  medium:   { color: 'var(--warning)' },
  low:      { color: 'var(--text-dim)' },
};

function termTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('de-DE');
}

function EventStream({ recent, defenderRecent }: { recent: SiemRecentAlert[]; defenderRecent: SiemTelemetry['defenderRecent'] }) {
  const lines: ReactNode[] = [...recent]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((a) => (
      <div key={`${a.time}-${a.ruleId}-${a.host}`} style={s.termLine}>
        <span style={{ color: 'var(--text-dim)' }}>{termTime(a.time)} </span>
        <span style={{ color: 'var(--success)' }}>[wazuh] </span>
        <span style={{ fontWeight: 700, ...SEV_STYLE[a.severity] }}>{`lvl ${a.level} `}</span>
        <span style={{ color: 'var(--text-muted)' }}>
          {`rule ${a.ruleId ?? '—'} · ${a.description ?? ''}`}
          {a.host ? ` · ${a.host}` : ''}
          {a.srcIp ? ` · ${a.srcIp}` : ''}
        </span>
      </div>
    ));

  const defenderLines: ReactNode[] = defenderRecent.map((d) => (
    <div key={`def-${d.time}-${d.threat}`} style={s.termLine}>
      <span style={{ color: 'var(--text-dim)' }}>{termTime(d.time)} </span>
      <span style={{ color: 'var(--accent-orange)' }}>[defender] </span>
      <span style={{ fontWeight: 700, ...glow('var(--danger)') }}>{d.eventID === '1117' ? 'ACTION ' : 'DETECT '}</span>
      <span style={{ color: 'var(--text-muted)' }}>
        {d.threat ?? d.description ?? 'Detection'}
        {d.host ? ` · ${d.host}` : ''}
      </span>
    </div>
  ));

  return (
    <div style={s.term}>
      <div style={s.termHead}>
        <span style={{ display: 'flex', gap: 5 }}>
          <i style={dot('#ff5f57')} /><i style={dot('var(--warning)')} /><i style={dot('var(--success)')} />
        </span>
        tail -f wazuh-alerts — letzte 24h · wazuh · defender
      </div>
      <div style={s.termBody}>
        {lines.length + defenderLines.length === 0
          ? <div style={{ color: 'var(--text-dim)' }}>— keine Alerts im Zeitfenster —</div>
          : <>{defenderLines}{lines}</>}
      </div>
    </div>
  );
}
