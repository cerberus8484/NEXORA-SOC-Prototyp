import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell, Activity, Server, ShieldAlert, ListChecks, Globe, RefreshCw, Calendar, ArrowRight,
} from 'lucide-react';
import {
  Card, CardHeader, CardBody, StatCard, Donut, DonutLegend, Spinner, ErrorCard, EmptyState,
  type DonutSegment, type Tone,
} from '../components/ui';
import { HelpTip } from '../components/ui';
import { siemApi, type SiemDashboard, type SiemRecentAlert } from '../features/siem/siemApi';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--danger)', high: 'var(--accent-orange)', medium: 'var(--warning)', low: 'var(--accent)',
};
const SEV_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

function num(v: number | null | undefined): string {
  return v == null ? '—' : v.toLocaleString('de-DE');
}
function delta(pct: number | null | undefined): string | undefined {
  if (pct == null) return undefined;
  return i18n.t('wazuh.vsYesterday', { arrow: pct >= 0 ? '▲' : '▼', pct: Math.abs(pct) });
}
function relTime(iso?: string): string {
  if (!iso) return '—';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(m)) return '—';
  if (m < 1) return 'gerade';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}
function clock(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function WazuhDashboardPage() {
  const { t: tr } = useTranslation();
  const [d, setD] = useState<SiemDashboard | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true); setError('');
    siemApi.dashboard('wazuh')
      .then((r) => { setEnabled(r.enabled); setD(r.data); })
      .catch((e) => setError(e instanceof Error ? e.message : tr('text.loadingFailed2')))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>Wazuh Dashboard<HelpTip topic="wazuh" /></h1>
          <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 4 }}>
            Real-time security monitoring and threat detection powered by Wazuh.
          </div>
        </div>
        <div className="page-actions">
          <span className="btn btn-ghost" style={{ cursor: 'default' }}><Calendar size={15} /> Last 24 hours</span>
          <button className="btn btn-primary" onClick={load}><RefreshCw size={15} /> Refresh</button>
        </div>
      </div>

      {loading && <Spinner label={tr('app.loadingWazuhData')} />}
      {!loading && error && <ErrorCard message={error} />}
      {!loading && !error && enabled === false && (
        <Card><CardBody>
          <EmptyState
            icon={<ShieldAlert size={28} />}
            title={tr('app.wazuhNotConnected')}
            message={tr('app.configureWazuhApiWazuhIndexer')}
          />
        </CardBody></Card>
      )}

      {!loading && !error && d && <DashboardBody d={d} />}
    </div>
  );
}

function DashboardBody({ d }: { d: SiemDashboard }) {
  const { t: tr } = useTranslation();
  const k = d.kpis;
  const a = d.alerts;

  const kpis = [
    { key: 'alerts', label: 'Total Alerts Today', value: num(k.alertsToday), tone: 'accent' as Tone, icon: <Bell size={22} />, delta: delta(k.alertsTodayDeltaPct) },
    { key: 'crit',   label: 'Critical Alerts',    value: num(k.critical),    tone: 'danger' as Tone, icon: <Activity size={22} />, delta: delta(k.criticalDeltaPct) },
    { key: 'agents', label: 'Active Agents',      value: num(k.activeAgents), tone: 'success' as Tone, icon: <Server size={22} />, delta: i18n.t('common.totalOf', { count: k.agentsTotal }) },
    { key: 'inc',    label: 'Open Incidents',     value: num(k.openIncidents), tone: 'warning' as Tone, icon: <ShieldAlert size={22} />, delta: undefined },
    { key: 'rules',  label: 'Rule Matches',       value: num(k.ruleMatches),  tone: 'accent' as Tone, icon: <ListChecks size={22} />, delta: undefined },
    { key: 'ti',     label: 'Threat Intel Matches', value: num(k.threatIntelMatches), tone: 'purple' as Tone, icon: <Globe size={22} />, delta: undefined },
  ];

  const sevSegments: DonutSegment[] = a ? [
    { label: 'Critical', value: a.severity.critical, color: SEV_COLOR.critical },
    { label: 'High',     value: a.severity.high,     color: SEV_COLOR.high },
    { label: 'Medium',   value: a.severity.medium,   color: SEV_COLOR.medium },
    { label: 'Low',      value: a.severity.low,      color: SEV_COLOR.low },
  ] : [];
  const sevTotal = sevSegments.reduce((s, x) => s + x.value, 0);
  const maxSeries = a ? Math.max(10, ...a.timeSeries.map((p) => p.count)) : 10;
  const topHostMax = a && a.topHosts.length ? Math.max(...a.topHosts.map((h) => h.count)) : 1;
  const tacticMax = a && a.topTactics.length ? Math.max(...a.topTactics.map((t) => t.count)) : 1;

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-kpi" style={{ marginBottom: 16 }}>
        {kpis.map((kp) => (
          <StatCard key={kp.key} label={kp.label} value={kp.value} tone={kp.tone} icon={kp.icon} delta={kp.delta} />
        ))}
      </div>

      {/* Row 2: Alerts over time · Severity · Active agents */}
      <div className="grid" style={{ gridTemplateColumns: '1.7fr 1fr 1.4fr', marginBottom: 16 }}>
        <Card>
          <CardHeader title="Alerts Over Time" actions={<span className="badge" style={{ color: 'var(--text-muted)' }}>1 Stunde</span>} />
          <CardBody>
            {a && a.timeSeries.length ? (
              <AreaChart series={a.timeSeries.map((p) => p.count)} labels={a.timeSeries.map((p) => clock(p.t))} max={maxSeries} />
            ) : <PanelEmpty />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Severity Distribution" />
          <CardBody>
            {a ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <Donut segments={sevSegments} centerTop={sevTotal.toLocaleString('de-DE')} centerBottom="Total" />
                <DonutLegend segments={sevSegments} total={sevTotal} />
              </div>
            ) : <PanelEmpty />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Active Agents (${d.agents.total})`}
            actions={<Link to="/hosts" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>View all <ArrowRight size={13} /></Link>} />
          <CardBody style={{ padding: 0 }}>
            {d.agents.list.length ? (
              <table className="table">
                <thead><tr><th>Agent</th><th>IP Address</th><th>Status</th><th>Last Seen</th></tr></thead>
                <tbody>
                  {d.agents.list.map((ag) => {
                    const online = ag.status === 'active';
                    return (
                      <tr key={ag.id}>
                        <td style={{ fontWeight: 600 }}>{ag.name}</td>
                        <td className="mono" style={{ color: 'var(--text-muted)' }}>{ag.ip || '—'}</td>
                        <td><Dot color={online ? 'var(--success)' : 'var(--danger)'} /> {online ? 'Online' : 'Offline'}</td>
                        <td className="mono" style={{ color: 'var(--text-dim)' }}>{relTime(ag.lastKeepAlive)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <div style={{ padding: 16 }}><PanelEmpty msg={tr('app.noAgentsManagerApiNot')} /></div>}
            <div style={{ display: 'flex', gap: 18, padding: '12px 16px', borderTop: '1px solid var(--border-soft)', fontSize: 12.5 }}>
              <span><Dot color="var(--success)" /> Online <b className="mono">{d.agents.online}</b></span>
              <span><Dot color="var(--danger)" /> Offline <b className="mono">{d.agents.offline}</b></span>
              <span><Dot color="var(--warning)" /> Pending <b className="mono">{d.agents.pending}</b></span>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Row 3: Recent alerts · MITRE */}
      <div className="grid" style={{ gridTemplateColumns: '1.9fr 1fr', marginBottom: 16 }}>
        <Card>
          <CardHeader title="Recent Alerts / Events" />
          <CardBody style={{ padding: 0 }}>
            {a && a.recent.length ? (
              <table className="table">
                <thead><tr>
                  <th>Time</th><th>Rule</th><th>Level</th><th>Description</th><th>Host</th><th>Source IP</th><th>Severity</th>
                </tr></thead>
                <tbody>
                  {a.recent.map((al: SiemRecentAlert) => (
                    <tr key={`${al.time}-${al.ruleId ?? ''}-${al.srcIp ?? ''}-${al.description ?? ''}`}>
                      <td className="mono" style={{ color: 'var(--text-muted)' }}>{clock(al.time)}</td>
                      <td className="mono">{al.ruleId || '—'}</td>
                      <td className="mono" style={{ color: 'var(--text-dim)' }}>{al.level}</td>
                      <td>{al.description || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{al.host || '—'}</td>
                      <td className="mono" style={{ color: 'var(--text-muted)' }}>{al.srcIp || '—'}</td>
                      <td><Pill color={SEV_COLOR[al.severity]}>{SEV_LABEL[al.severity]}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ padding: 16 }}><PanelEmpty /></div>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="MITRE ATT&CK (Top Tactics)"
            actions={<Link to="/analysis" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Analyse <ArrowRight size={13} /></Link>} />
          <CardBody>
            {a && a.topTactics.length ? (
              <table className="table" style={{ marginTop: -6 }}>
                <thead><tr><th>Tactic</th><th>Techniques</th><th style={{ width: '34%' }}>Alerts</th></tr></thead>
                <tbody>
                  {a.topTactics.map((m) => (
                    <tr key={m.tactic}>
                      <td style={{ fontWeight: 600 }}>{m.tactic}</td>
                      <td className="mono" style={{ color: 'var(--text-dim)' }}>{m.techniques.join(', ') || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Bar pct={(m.count / tacticMax) * 100} />
                          <span className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{m.count} ({m.pct}%)</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <PanelEmpty />}
          </CardBody>
        </Card>
      </div>

      {/* Row 4: Top hosts · Source IPs · Threat Intel · Rule Health */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginBottom: 16 }}>
        <Card>
          <CardHeader title="Top Offending Hosts" actions={<Link to="/hosts" style={{ fontSize: 12.5 }}>View all</Link>} />
          <CardBody style={{ padding: 0 }}>
            {a && a.topHosts.length ? (
              <table className="table">
                <thead><tr><th>Host</th><th>Alerts</th><th style={{ width: '45%' }} /></tr></thead>
                <tbody>
                  {a.topHosts.map((h) => (
                    <tr key={h.host}>
                      <td style={{ fontWeight: 600 }}>{h.host}</td>
                      <td className="mono">{h.count}</td>
                      <td><Bar pct={(h.count / topHostMax) * 100} color="var(--accent-orange)" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ padding: 16 }}><PanelEmpty /></div>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Source IP Reputation (Top)" />
          <CardBody style={{ padding: 0 }}>
            {a && a.topSourceIps.length ? (
              <table className="table">
                <thead><tr><th>Source IP</th><th>Reputation</th><th>Alerts</th></tr></thead>
                <tbody>
                  {a.topSourceIps.map((r) => (
                    <tr key={r.ip}>
                      <td className="mono" style={{ color: 'var(--text-muted)' }}>{r.ip}</td>
                      <td><Pill color="var(--text-dim)" soft>Unknown</Pill></td>
                      <td className="mono">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ padding: 16 }}><PanelEmpty /></div>}
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-soft)', fontSize: 11, color: 'var(--text-dim)' }}>
              Reputation folgt mit dem Threat-Intel-Service (P17).
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Threat Intel Matches" />
          <CardBody>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div className="mono" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{num(k.threatIntelMatches)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Matches (24h)</div>
              </div>
              <span style={{ color: 'var(--purple)' }}><Globe size={34} /></span>
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-dim)' }}>
              Heuristik aus <code>rule.groups</code>{tr('metrics.tiBreakdownLater')}</div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Wazuh Rule Health" />
          <CardBody>
            {d.ruleHealth ? (() => {
              const rh = d.ruleHealth!;
              const pct = rh.total > 0 ? Math.round((rh.enabled / rh.total) * 100) : 0;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <Donut size={110} thickness={14}
                    segments={[
                      { label: 'Enabled', value: pct, color: 'var(--success)' },
                      { label: 'Rest', value: 100 - pct, color: 'var(--border-soft)' },
                    ]}
                    centerTop={`${pct}%`} centerBottom="Enabled" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12.5 }}>
                    <KV label="Total Rules" value={rh.total.toLocaleString('de-DE')} />
                    <KV label="Enabled" value={rh.enabled.toLocaleString('de-DE')} />
                    <KV label="Disabled" value={rh.disabled.toLocaleString('de-DE')} />
                  </div>
                </div>
              );
            })() : <PanelEmpty msg={tr('app.ruleHealthManagerApiNot')} />}
          </CardBody>
        </Card>
      </div>

      {/* Geo-Map: bewusst Leerzustand bis GeoIP/TI */}
      <Card style={{ marginBottom: 16 }}>
        <CardHeader title="Map Overview (Top Sources)" />
        <CardBody>
          <EmptyState icon={<Globe size={24} />} title={tr('app.geoMapNotConnected')}
            message={tr('label.geolocationRequiresGeoipEnrichedAlerts')} />
        </CardBody>
      </Card>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-dim)', padding: '6px 2px' }}>
        <span><span style={{ color: 'var(--success)' }}>●</span> Aktualisiert {clock(d.generatedAt)}</span>
        <span className="mono">Quellen: Indexer {d.sources.indexer ? '✓' : '—'} · Manager-API {d.sources.api ? '✓' : '—'}</span>
      </div>
    </>
  );
}

/* ── kleine Bausteine ──────────────────────────────────── */

function PanelEmpty({ msg }: { msg?: string }) {
  const { t: tr } = useTranslation();
  return <div style={{ fontSize: 12.5, color: 'var(--text-dim)', padding: '12px 2px' }}>{msg ?? tr('app.indexerNotConnected')}.</div>;
}
function Dot({ color }: { color: string }) {
  return <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, marginRight: 6, verticalAlign: 'middle', boxShadow: `0 0 6px ${color}` }} />;
}
function Pill({ children, color, soft = false }: { children: ReactNode; color: string; soft?: boolean }) {
  return (
    <span className="badge" style={{ color, borderColor: color, background: soft ? 'transparent' : 'color-mix(in srgb, currentColor 14%, transparent)' }}>{children}</span>
  );
}
function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="mono" style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  );
}
function Bar({ pct, color = 'var(--accent)' }: { pct: number; color?: string }) {
  return (
    <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--bg-input)', minWidth: 60 }}>
      <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, pct))}%`, borderRadius: 999, background: color }} />
    </div>
  );
}

/** Leichter SVG-Area-Chart (kein Chart-Framework). */
function AreaChart({ series, labels, max }: { series: number[]; labels: string[]; max: number }) {
  const W = 700, H = 230, PAD_B = 24, PAD_L = 30;
  const innerW = W - PAD_L, innerH = H - PAD_B;
  const n = Math.max(1, series.length - 1);
  const x = (i: number) => PAD_L + (i / n) * innerW;
  const y = (v: number) => innerH - (v / max) * innerH;
  const line = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${innerH} L${PAD_L},${innerH} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const step = Math.max(1, Math.ceil(labels.length / 6));
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} y1={y(t)} x2={W} y2={y(t)} stroke="var(--border-soft)" strokeWidth="1" />
            <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-dim)">{t}</text>
          </g>
        ))}
        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: 30, fontSize: 10, color: 'var(--text-dim)' }}>
        {labels.filter((_, i) => i % step === 0).map((l, i) => (
          // Statische Chart-Achsenbeschriftung; Zeit-Labels können sich wiederholen → Index ist hier korrekt
          // eslint-disable-next-line react/no-array-index-key
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}
