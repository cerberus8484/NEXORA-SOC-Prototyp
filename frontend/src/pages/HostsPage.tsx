import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Server, WifiOff, Activity, CheckCircle2, Download, Plus, RefreshCw,
  Search, X, Cpu, Network, ShieldCheck, HardDrive, Filter, Trash2,
} from 'lucide-react';
import { SectionHeader, Card, Button, Badge, EmptyState, ErrorCard, type Tone } from '../components/ui';
import type { RegisteredHost, HeartbeatStatus, InventoryStatus, HostPosture } from '../features/hosts/hostsTypes';
import { wazuhApi, type WazuhAgent, type WazuhInventory } from '../features/wazuh/wazuhApi';
import { applyHostRisk, computeHostRisk } from '../features/hosts/hostRisk';
import { deriveInventoryHighlights, deriveHostRisk } from '../features/hosts/inventoryHighlights';
import { hostsToCsv } from '../features/hosts/hostsExport';
import { hostsApi } from '../features/hosts/hostsApi';
import { manualHostToRegistered } from '../features/hosts/manualHostModel';
import { HostAlertTimeline } from '../features/hosts/HostAlertTimeline';
import { HostPackagesTable } from '../features/hosts/HostPackagesTable';
import { AddHostModal } from '../features/hosts/AddHostModal';
import { useAuth } from '../lib/auth';
import { can } from '../lib/rbac';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

// ── Echte Wazuh-Agents → RegisteredHost ───────────────────────────────
function mapAgent(a: WazuhAgent): RegisteredHost {
  const hb: HeartbeatStatus = a.status === 'active' ? 'healthy' : a.status === 'disconnected' ? 'offline' : 'delayed';
  return {
    id: a.id,
    hostname: a.name,
    customer: a.group && a.group.length ? a.group.join(', ') : undefined,
    source: 'wazuh',
    agentId: a.id,
    agentVersion: a.version ? `v${String(a.version).replace(/^v/i, '')}` : undefined,
    os: { name: a.os?.name, version: a.os?.version, platform: a.os?.platform },
    ipAddresses: a.ip ? [a.ip] : [],
    lastHeartbeatAt: a.lastKeepAlive,
    expectedIntervalMin: 5,
    heartbeatStatus: hb,
    inventoryStatus: a.status === 'active' ? 'complete' : 'partial',
    // riskScore/AV/patches: liefert die Wazuh-API nicht → bleibt leer (kein Fake)
  };
}

// Detail-Inventory (syscollector) in den Host mergen
// SCA-Compliance + CVE-Counts in die Host-Inventory mergen (speist computeHostRisk).
function withPosture(host: RegisteredHost, posture: HostPosture | null): RegisteredHost {
  if (!posture) return host;
  const v = posture.vulnerabilities;
  const s = posture.sca;
  return {
    ...host,
    inventory: {
      ...host.inventory,
      cveCritical: v?.critical, cveHigh: v?.high, cveMedium: v?.medium, cveLow: v?.low, cveTotal: v?.total,
      scaScore: s?.worstScore ?? undefined, scaFail: s?.totalFail,
    },
  };
}

function withInventory(host: RegisteredHost, inv: WazuhInventory | null): RegisteredHost {
  if (!inv) return host;
  // Echte Felder aus syscollector ableiten — nur was die API wirklich liefert.
  const h = deriveInventoryHighlights(inv);
  return {
    ...host,
    os: { ...host.os, build: h.osBuild || host.os?.build },
    macAddress: h.macAddress || host.macAddress,
    inventory: {
      ...host.inventory,
      kernelBuild: h.osBuild ?? undefined,
      architecture: h.architecture ?? undefined,
      cpu: h.cpuLabel ?? undefined,
      ram: h.ramLabel ?? undefined,
      installedSoftwareCount: h.installedPackages ?? undefined,
      openPortsCount: h.openPorts ?? undefined,
      // AV: syscollector liefert keine Paketliste → nicht ableitbar (kein Fake).
      // antivirus/avSignatures bleiben undefined.
    },
  };
}

// ── Mappings ──────────────────────────────────────────────────────────
const HB: Record<HeartbeatStatus, { tone: Tone; label: string }> = {
  healthy:     { tone: 'success', label: 'Healthy' },
  delayed:     { tone: 'warning', label: 'Delayed' },
  offline:     { tone: 'danger',  label: 'Offline' },
  unmonitored: { tone: 'muted',   label: 'Unmonitored' },
};
const INV: Record<InventoryStatus, { tone: Tone; label: string }> = {
  complete: { tone: 'success', label: 'Complete' },
  partial:  { tone: 'warning', label: 'Partial' },
  missing:  { tone: 'danger',  label: 'Missing' },
};
function riskColor(s = 0): string {
  if (s >= 85) return 'var(--danger)';
  if (s >= 70) return 'var(--accent-orange)';
  if (s >= 50) return 'var(--warning)';
  return 'var(--success)';
}
const riskLevelLabel = (l?: string) => (l ? l.charAt(0).toUpperCase() + l.slice(1) : '—');

function relTime(iso?: string): string {
  if (!iso) return '—';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return i18n.t('time.justNow');
  if (m < 60) return i18n.t('time.minutesAgoShort', { count: m });
  const h = Math.round(m / 60);
  if (h < 24) return i18n.t('time.hoursAgoShort', { count: h });
  return i18n.t('time.daysAgoShort', { count: Math.round(h / 24) });
}

// ── kleine SVG-Helfer ─────────────────────────────────────────────────
function Spark({ data, color, w = 84, h = 26 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 3) - 1.5}`).join(' ');
  return <svg width={w} height={h} style={{ display: 'block' }}><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" /></svg>;
}
function RiskRing({ score = 0 }: { score?: number }) {
  const r = 32, c = 2 * Math.PI * r, color = riskColor(score);
  return (
    <svg width={80} height={80}>
      <circle cx={40} cy={40} r={r} fill="none" stroke="var(--bg-input)" strokeWidth={7} />
      <circle cx={40} cy={40} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform="rotate(-90 40 40)" />
      <text x={40} y={38} textAnchor="middle" fontSize={20} fontWeight={700} fill="var(--text)">{score}</text>
      <text x={40} y={53} textAnchor="middle" fontSize={9} fill="var(--text-dim)">/ 100</text>
    </svg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────
const TD: CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'middle', whiteSpace: 'nowrap' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };
const SEL: CSSProperties = { background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, width: '100%' };
const FLABEL: CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };
function chip(active: boolean, color = 'var(--accent)'): CSSProperties {
  return { padding: '6px 14px', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 600, border: '1px solid',
    cursor: 'pointer', background: active ? color : 'transparent', borderColor: active ? color : 'var(--border)',
    color: active ? 'var(--on-accent)' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 };
}

// ── Filter-State ──────────────────────────────────────────────────────
interface Filters { customer: string; source: string; os: string; hostStatus: string; heartbeat: string; risk: string; inventory: string; search: string; quick: '' | 'online' | 'issues' | 'offline'; }
const DEFAULTS: Filters = { customer: '', source: '', os: '', hostStatus: '', heartbeat: '', risk: '', inventory: '', search: '', quick: '' };

export function HostsPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const isAdmin = can.admin(user?.role);
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [showMore, setShowMore] = useState(false);
  const [tab, setTab] = useState('overview');
  const set = (k: keyof Filters, v: string) => setF((p) => ({ ...p, [k]: v }));

  const [agents, setAgents]   = useState<WazuhAgent[] | null>(null);
  const [manualHosts, setManualHosts] = useState<RegisteredHost[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [error, setError]     = useState('');
  const [selId, setSelId]     = useState<string | null>(null);
  const [invById, setInvById] = useState<Record<string, WazuhInventory | null>>({});
  const [postById, setPostById] = useState<Record<string, HostPosture | null>>({});
  const [invLoading, setInvLoading] = useState(false);

  // Echte Wazuh-Agents laden; wenn API nicht konfiguriert → leer + Hinweis (kein Demo).
  const reload = () => {
    setAgents(null); setError(''); setInvById({});
    wazuhApi.agents()
      .then((res) => { setEnabled(res.enabled); setAgents(res.data ?? []); })
      .catch((err) => setError(err instanceof Error ? err.message : tr('text.loadingFailed2')));
    // Manuell gepflegte Assets (Nicht-Wazuh-Quelle) — unabhängig von der Wazuh-API.
    hostsApi.manualHosts()
      .then((res) => setManualHosts((res.data ?? []).map(manualHostToRegistered)))
      .catch(() => setManualHosts([]));
  };
  useEffect(() => { reload(); }, []);

  const notConfigured = !enabled;
  // Wazuh-Agents + manuelle Assets zu einer Host-Liste vereinen (Source-Filter unterscheidet).
  const hosts: RegisteredHost[] = useMemo(
    () => [...(agents ?? []).map((a) => applyHostRisk(mapAgent(a))), ...manualHosts],
    [agents, manualHosts],
  );

  useEffect(() => { if (!selId && hosts.length) setSelId(hosts[0].id); }, [hosts, selId]);

  // Inventory des gewählten echten Hosts nachladen (syscollector). Nur Wazuh-Hosts —
  // manuelle Assets haben keinen Syscollector (kein Wazuh-Call).
  useEffect(() => {
    if (notConfigured || !selId || invById[selId] !== undefined) return;
    if (hosts.find((h) => h.id === selId)?.source !== 'wazuh') return;
    let active = true;
    setInvLoading(true);
    wazuhApi.inventory(selId)
      .then((res) => { if (active) setInvById((m) => ({ ...m, [selId]: res.data })); })
      .catch(() => { if (active) setInvById((m) => ({ ...m, [selId]: null })); })
      .finally(() => { if (active) setInvLoading(false); });
    return () => { active = false; };
  }, [notConfigured, selId, invById, hosts]);

  // SCA-Compliance + CVE-Befunde des gewählten Hosts (für echten Risk-Score). Nur Wazuh.
  useEffect(() => {
    if (notConfigured || !selId || postById[selId] !== undefined) return;
    if (hosts.find((h) => h.id === selId)?.source !== 'wazuh') return;
    let active = true;
    wazuhApi.posture(selId)
      .then((res) => { if (active) setPostById((m) => ({ ...m, [selId]: res.data })); })
      .catch(() => { if (active) setPostById((m) => ({ ...m, [selId]: null })); });
    return () => { active = false; };
  }, [notConfigured, selId, postById, hosts]);

  const customers = useMemo(() => [...new Set(hosts.map((h) => h.customer).filter(Boolean) as string[])].sort(), [hosts]);
  const osList    = useMemo(() => [...new Set(hosts.map((h) => h.os?.name).filter(Boolean) as string[])].sort(), [hosts]);

  const kpi = useMemo(() => ({
    total:    hosts.length,
    // „Online" = Agents, die einchecken. Manuelle Assets (unmonitored) zählen ehrlich weder online noch offline.
    online:   hosts.filter((h) => h.heartbeatStatus === 'healthy' || h.heartbeatStatus === 'delayed').length,
    offline:  hosts.filter((h) => h.heartbeatStatus === 'offline').length,
    issues:   hosts.filter((h) => h.heartbeatStatus === 'delayed').length,
    invComplete: hosts.filter((h) => h.inventoryStatus === 'complete').length,
  }), [hosts]);
  const pct = (n: number) => (kpi.total > 0 ? `${Math.round((n / kpi.total) * 100)}%` : '—');

  const filtered = useMemo(() => hosts.filter((h) => {
    if (f.customer && h.customer !== f.customer) return false;
    if (f.source && h.source !== f.source) return false;
    if (f.os && h.os?.name !== f.os) return false;
    if (f.hostStatus === 'online' && h.heartbeatStatus === 'offline') return false;
    if (f.hostStatus === 'offline' && h.heartbeatStatus !== 'offline') return false;
    if (f.heartbeat && h.heartbeatStatus !== f.heartbeat) return false;
    if (f.risk && h.riskLevel !== f.risk) return false;
    if (f.inventory && h.inventoryStatus !== f.inventory) return false;
    if (f.quick === 'online'  && h.heartbeatStatus === 'offline') return false;
    if (f.quick === 'offline' && h.heartbeatStatus !== 'offline') return false;
    if (f.quick === 'issues'  && !(h.heartbeatStatus !== 'healthy' || h.inventoryStatus !== 'complete' || (h.riskScore ?? 0) >= 80)) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = [h.hostname, h.customer, h.agentId, h.domain, h.lastUser, h.os?.name, ...(h.ipAddresses ?? [])].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [hosts, f]);

  const selRaw = hosts.find((h) => h.id === selId) ?? null;
  // Mit Inventory neu bewerten — der Detail-Host kennt offene Ports/Patches etc.
  const selPosture = selRaw ? (postById[selRaw.id] ?? null) : null;
  const sel = selRaw ? applyHostRisk(withPosture(withInventory(selRaw, invById[selRaw.id] ?? null), selPosture)) : null;

  async function removeManualHost(id: string) {
    try {
      await hostsApi.deleteManualHost(id);
      if (selId === id) setSelId(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('common.removeFailed'));
    }
  }

  function exportCsv() {
    const blob = new Blob([hostsToCsv(filtered)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hosts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <SectionHeader
        title="Registered Hosts"
        help="hosts"
        subtitle="Monitor enrolled agents, inventory, and heartbeat status"
        actions={
          <>
            <Button variant="ghost" icon={<Download size={15} />} disabled={filtered.length === 0} onClick={exportCsv} title="Gefilterte Hosts als CSV">Export</Button>
            <Button variant="success" icon={<Plus size={15} />} disabled={!isAdmin} onClick={() => setShowAdd(true)} title={isAdmin ? tr('hosts.registerNewAgent') : tr('text.administratorsOnly')}>Add Host</Button>
            <Button variant="ghost" icon={<RefreshCw size={15} />} onClick={() => { setF(DEFAULTS); reload(); }}>Refresh</Button>
          </>
        }
      />

      {showAdd && <AddHostModal onClose={() => setShowAdd(false)} onEnrolled={reload} />}

      {error && <div style={{ marginBottom: 16 }}><ErrorCard message={error} /></div>}
      {notConfigured && agents && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card-soft)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12.5 }}>
          <strong style={{ color: 'var(--text-muted)' }}>{tr('text.notConnected')}</strong>{tr('hosts.wazuhApiMissing')}</div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 18 }}>
        <Kpi icon={<Server size={20} />} tone="accent"  label="Total Hosts"        value={kpi.total} />
        <Kpi icon={<CheckCircle2 size={20} />} tone="success" label="Online Hosts"  value={kpi.online} sub={pct(kpi.online)} />
        <Kpi icon={<WifiOff size={20} />} tone="danger"  label="Offline Hosts"      value={kpi.offline} sub={pct(kpi.offline)} />
        <Kpi icon={<Activity size={20} />} tone="warning" label="Heartbeat Issues"  value={kpi.issues} />
        <Kpi icon={<HardDrive size={20} />} tone="accent" label="Inventory Complete" value={kpi.invComplete} sub={pct(kpi.invComplete)} />
      </div>

      {/* Filter */}
      <Card style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 12 }}>
          <Field label="Customer"><select style={SEL} value={f.customer} onChange={(e) => set('customer', e.target.value)}><option value="">All Customers</option>{customers.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Source / Platform"><select style={SEL} value={f.source} onChange={(e) => set('source', e.target.value)}><option value="">All Sources</option><option value="wazuh">Wazuh</option><option value="manual">Manual</option><option value="splunk" disabled>Splunk (bald)</option><option value="qradar" disabled>QRadar (bald)</option><option value="soar" disabled>SOAR (bald)</option></select></Field>
          <Field label="Operating System"><select style={SEL} value={f.os} onChange={(e) => set('os', e.target.value)}><option value="">All OS</option>{osList.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
          <Field label="Host Status"><select style={SEL} value={f.hostStatus} onChange={(e) => set('hostStatus', e.target.value)}><option value="">All Statuses</option><option value="online">Online</option><option value="offline">Offline</option></select></Field>
          <Field label="Heartbeat Status"><select style={SEL} value={f.heartbeat} onChange={(e) => set('heartbeat', e.target.value)}><option value="">All</option><option value="healthy">Healthy</option><option value="delayed">Delayed</option><option value="offline">Offline</option></select></Field>
          <Field label="Risk Level"><select style={SEL} value={f.risk} onChange={(e) => set('risk', e.target.value)}><option value="">All</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></Field>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-dim)' }} />
            <input style={{ ...SEL, paddingLeft: 30 }} placeholder="Search hostname, IP, user, domain …" value={f.search} onChange={(e) => set('search', e.target.value)} />
          </div>
          <button style={chip(f.quick === 'online', 'var(--success)')} onClick={() => set('quick', f.quick === 'online' ? '' : 'online')}>● Online only</button>
          <button style={chip(f.quick === 'issues', 'var(--warning)')} onClick={() => set('quick', f.quick === 'issues' ? '' : 'issues')}>⚠ With issues</button>
          <button style={chip(f.quick === 'offline', 'var(--danger)')} onClick={() => set('quick', f.quick === 'offline' ? '' : 'offline')}>⊘ Offline only</button>
          <button style={chip(showMore, 'var(--accent)')} onClick={() => setShowMore((v) => !v)}><Filter size={12} /> More Filters</button>
          <button style={{ ...chip(false), borderColor: 'transparent', color: 'var(--text-dim)' }} onClick={() => { setF(DEFAULTS); setShowMore(false); }}><X size={12} /> Clear Filters</button>
        </div>
        {showMore && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
            <Field label="Inventory Status"><select style={SEL} value={f.inventory} onChange={(e) => set('inventory', e.target.value)}><option value="">All Inventory</option><option value="complete">Complete</option><option value="partial">Partial</option><option value="missing">Missing</option></select></Field>
          </div>
        )}
      </Card>

      {/* Tabelle + Detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 440px', gap: 16, flex: 1 }}>
        <Card style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-soft)', fontSize: 13, fontWeight: 600 }}>
            Hosts <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({filtered.length})</span>
          </div>
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Hostname', 'Customer', 'Source', 'OS', 'IP Address', 'Last Heartbeat', 'Heartbeat', 'Inventory', 'Risk', 'Agent'].map((h) => <th key={h} style={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} style={{ ...TD, textAlign: 'center', padding: 48, color: 'var(--text-dim)' }}>
                    {agents === null ? tr('app.loadingHosts') : notConfigured ? tr('app.wazuhApiNotConfigured') : tr('app.noHostsFilter')}
                  </td></tr>
                ) : filtered.map((h) => (
                  <tr key={h.id} onClick={() => { setSelId(h.id); setTab('overview'); }}
                    style={{ cursor: 'pointer', background: selId === h.id ? 'var(--success-soft)' : undefined, borderLeft: selId === h.id ? '2px solid var(--success)' : '2px solid transparent' }}>
                    <td style={{ ...TD, color: 'var(--text)', fontWeight: 600 }}>
                      <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 999, marginRight: 7, background: h.heartbeatStatus === 'offline' ? 'var(--danger)' : h.heartbeatStatus === 'delayed' ? 'var(--warning)' : 'var(--success)' }} />
                      {h.hostname}
                    </td>
                    <td style={{ ...TD, color: 'var(--text-muted)' }}>{h.customer || '—'}</td>
                    <td style={TD}><Badge tone="muted">{h.source}</Badge></td>
                    <td style={{ ...TD, color: 'var(--text-muted)' }}>{h.os?.name} {h.os?.version}</td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' }}>{h.ipAddresses?.[0] || '—'}</td>
                    <td style={{ ...TD, fontSize: 12, color: 'var(--text-dim)' }}>{relTime(h.lastHeartbeatAt)}</td>
                    <td style={TD}><Badge tone={HB[h.heartbeatStatus].tone} dot>{HB[h.heartbeatStatus].label}</Badge></td>
                    <td style={TD}><Badge tone={INV[h.inventoryStatus].tone}>{INV[h.inventoryStatus].label}</Badge></td>
                    <td style={TD}><span className="mono" style={{ fontWeight: 700, color: riskColor(h.riskScore) }}>{h.riskScore ?? '—'}</span></td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-dim)' }}>{h.agentVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-dim)' }}>
            {filtered.length} von {hosts.length} Hosts
          </div>
        </Card>

        {/* Detail */}
        {sel ? <HostDetail host={sel} posture={selPosture} tab={tab} onTab={setTab} loading={invLoading && !notConfigured} isAdmin={isAdmin} onDelete={removeManualHost} /> : (
          <Card style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EmptyState title={tr('app.noHostSelected')} message={tr('app.clickHostInventoryHeartbeat')} />
          </Card>
        )}
      </div>
    </div>
  );
}

// ── KPI-Card mit Sparkline ────────────────────────────────────────────
function Kpi({ icon, tone, label, value, sub }: { icon: ReactNode; tone: Tone; label: string; value: number; sub?: string }) {
  const color = tone === 'muted' ? 'var(--text-muted)' : `var(--${tone})`;
  return (
    <Card className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ width: 36, height: 36, borderRadius: 9, display: 'grid', placeItems: 'center', color, background: tone === 'muted' ? 'var(--bg-elevated)' : `var(--${tone}-soft)` }}>{icon}</span>
      </div>
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{value.toLocaleString('de-DE')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}{sub ? <span style={{ color, marginLeft: 6 }}>{sub}</span> : null}</div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><label style={FLABEL}>{label}</label>{children}</div>;
}

// ── Detail-Panel ──────────────────────────────────────────────────────
const TABS = ['overview', 'inventory', 'network', 'security', 'timeline'] as const;
const TAB_LABEL: Record<string, string> = { overview: 'Overview', inventory: 'Inventory', network: 'Network', security: 'Security', timeline: 'Timeline' };

function HostDetail({ host, posture, tab, onTab, loading, isAdmin, onDelete }: { host: RegisteredHost; posture: HostPosture | null; tab: string; onTab: (t: string) => void; loading?: boolean; isAdmin?: boolean; onDelete?: (id: string) => void }) {
  const { t: tr } = useTranslation();
  const inv = host.inventory ?? {};
  const isManual = host.source === 'manual';
  // Highlights zeigen, wenn echte syscollector-Daten vorhanden sind.
  const hasHighlights = Boolean(inv.cpu || inv.ram || inv.installedSoftwareCount != null || inv.kernelBuild);
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Server size={17} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>{host.hostname}</span>
          <Badge tone={HB[host.heartbeatStatus].tone} dot>{HB[host.heartbeatStatus].label}</Badge>
          {isManual && isAdmin && onDelete && (
            <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => onDelete(host.id)}
              style={{ marginLeft: 'auto', color: 'var(--danger)' }} title={tr('hosts.removeManualAsset')}>{tr('common.remove')}</Button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Badge tone="muted">Source: {host.source}</Badge>
          {host.customer && <Badge tone="muted">{host.customer}</Badge>}
          <Badge tone="muted">{host.os?.name} {host.os?.version}</Badge>
          <Badge tone={riskColor(host.riskScore) === 'var(--danger)' ? 'danger' : riskColor(host.riskScore) === 'var(--accent-orange)' ? 'warning' : 'muted'}>{riskLevelLabel(host.riskLevel)} Risk</Badge>
          <Badge tone={INV[host.inventoryStatus].tone}>Inventory {INV[host.inventoryStatus].label}</Badge>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '6px 12px', borderBottom: '1px solid var(--border-soft)', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => onTab(t)}
            style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', color: tab === t ? 'var(--accent)' : 'var(--text-muted)' }}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <div style={{ padding: '14px 18px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tab === 'overview' && (
          <>
            <KvBlock title="Overview">
              <Kv k="Hostname" v={host.hostname} />
              <Kv k="Agent ID" v={host.agentId} />
              <Kv k="Operating System" v={`${host.os?.name} ${host.os?.version} (${host.os?.build})`} />
              <Kv k="Kernel / Build" v={inv.kernelBuild} />
              <Kv k="CPU" v={inv.cpu} />
              <Kv k="RAM" v={inv.ram} />
              <Kv k="Disk" v={inv.disk} />
              <Kv k="Installed Software" v={inv.installedSoftwareCount?.toString()} />
              <Kv k="Open Ports" v={inv.openPortsCount?.toString()} />
              <Kv k="Last User" v={host.lastUser} />
              <Kv k="Domain" v={host.domain} />
              <Kv k="MAC Address" v={host.macAddress} mono />
              <Kv k="IP Addresses" v={host.ipAddresses?.join(', ')} mono />
            </KvBlock>
            {loading && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('app.loadingInventory')}</div>}
            <HeartbeatCard host={host} />
            <TransparentRiskBadge host={host} posture={posture} />
            {hasHighlights && <InventoryHighlights inv={inv} />}
            {host.riskScore != null && <RiskSummary host={host} />}
            <VulnPanel posture={posture} loading={loading} />
          </>
        )}

        {tab === 'inventory' && (
          <>
            <KvBlock title="Hardware & Betriebssystem" icon={<Cpu size={14} />}>
              <Kv k="Hostname" v={host.hostname} />
              <Kv k="Operating System" v={host.os?.name ? `${host.os.name}${host.os.version ? ` ${host.os.version}` : ''}` : undefined} />
              <Kv k="Kernel / Build" v={inv.kernelBuild} />
              <Kv k="Architektur" v={inv.architecture} />
              <Kv k="CPU" v={inv.cpu} />
              <Kv k="RAM" v={inv.ram} />
              <Kv k="Disk" v={inv.disk} />
              <Kv k="Installierte Pakete" v={inv.installedSoftwareCount?.toString()} />
              <Kv k="Offene Ports" v={inv.openPortsCount?.toString()} />
              {inv.assetTags && inv.assetTags.length > 0 && <Kv k="Asset Tags" v={inv.assetTags.join(', ')} />}
            </KvBlock>
            {loading && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('app.loadingInventory')}</div>}
            <HostPackagesTable agentId={host.agentId || host.id} />
          </>
        )}

        {tab === 'network' && (
          <KvBlock title="Network" icon={<Network size={14} />}>
            <Kv k="IP Addresses" v={host.ipAddresses?.join(', ')} mono />
            <Kv k="MAC Address" v={host.macAddress} mono />
            <Kv k="Domain" v={host.domain} />
            <Kv k="Open Ports" v={inv.openPortsCount?.toString()} />
          </KvBlock>
        )}

        {tab === 'security' && (
          <>
            <TransparentRiskBadge host={host} posture={posture} />
            <InventoryHighlights inv={inv} title="Security & Hygiene" expanded />
          </>
        )}

        {tab === 'timeline' && (
          <>
            <HostAlertTimeline agentId={host.agentId || host.id} hostname={host.hostname} />
            <HeartbeatCard host={host} expanded />
          </>
        )}
      </div>
    </Card>
  );
}

function HeartbeatCard({ host, expanded }: { host: RegisteredHost; expanded?: boolean }) {
  const tone = HB[host.heartbeatStatus];
  // A8: Heartbeat-Verlauf nur zeigen, wenn echte Zeitreihen-Daten vorliegen. Die Wazuh-API
  // liefert NUR lastKeepAlive (einen Zeitpunkt), keine 24h-Reihe → kein Fake-Sparkline.
  const history = host.heartbeatHistory ?? [];
  return (
    <Panel title="Heartbeat" icon={<Activity size={14} />}>
      <Kv k="Last Heartbeat" v={relTime(host.lastHeartbeatAt)} />
      <Kv k="Expected Interval" v={`${host.expectedIntervalMin ?? 5} Minuten`} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
        <span style={{ color: 'var(--text-dim)' }}>Status</span>
        <Badge tone={tone.tone} dot>{tone.label}</Badge>
      </div>
      {history.length > 0 ? (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, marginBottom: 4 }}>Heartbeat (letzte 24h)</div>
          <Spark data={history} color={`var(--${tone.tone === 'muted' ? 'text-muted' : tone.tone})`} w={expanded ? 360 : 380} h={expanded ? 60 : 40} />
        </>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-soft)' }}>
          Heartbeat-Verlauf nicht verfügbar — die Wazuh-API liefert nur den letzten Check-in
          {' '}(<span style={{ color: 'var(--text-muted)' }}>{relTime(host.lastHeartbeatAt)}</span>), keine 24-Stunden-Zeitreihe.
        </div>
      )}
    </Panel>
  );
}

function InventoryHighlights({ inv, title = 'Inventory Highlights', expanded }: { inv: NonNullable<RegisteredHost['inventory']>; title?: string; expanded?: boolean }) {
  const { t: tr } = useTranslation();
  // Felder, die der syscollector-Endpunkt tatsächlich liefert:
  // cpu, ram, installedSoftwareCount, openPortsCount, kernelBuild, macAddress.
  // NICHT ableitbar aus dem aktuellen Inventory-Endpunkt (ehrlich kennzeichnen):
  //   • antivirus / avSignatures → braucht Paketliste, nicht in WazuhInventory
  //   • missingPatches / softwareUpdates → braucht Patch-Management-Quelle (nicht verfügbar)
  //   • suspiciousSoftwareCount → braucht Paketliste
  return (
    <Panel title={title} icon={<ShieldCheck size={14} />}>
      <KvDot k="CPU" v={inv.cpu || '—'} />
      <KvDot k="RAM" v={inv.ram || '—'} />
      <KvDot k="Installierte Pakete" v={inv.installedSoftwareCount != null ? String(inv.installedSoftwareCount) : '—'} />
      {expanded && <KvDot k="Offene Ports" v={inv.openPortsCount != null ? String(inv.openPortsCount) : '—'} warn={(inv.openPortsCount ?? 0) > 50} />}
      <KvDot k="Kernel / Build" v={inv.kernelBuild || '—'} />
      <KvDot
        k="Antivirus"
        v={tr('app.notSyscollector')}
        title={tr('app.antivirusDetectionNeedsPackageList')}
      />
      <KvDot
        k="Fehlende Patches"
        v={tr('app.noPatchEndpoint')}
        title={tr('app.patchStatusNotAvailableWazuh')}
      />
      {inv.assetTags && inv.assetTags.length > 0 && <Kv k="Asset Tags" v={inv.assetTags.join(', ')} />}
    </Panel>
  );
}

// Echte SCA-Compliance + CVE-Befunde aus Wazuh (API + Indexer).
function VulnPanel({ posture, loading }: { posture: HostPosture | null; loading?: boolean }) {
  const { t: tr } = useTranslation();
  if (loading && !posture) return null;
  const v = posture?.vulnerabilities;
  const s = posture?.sca;
  if (!v && !s) {
    return (
      <Panel title="Vulnerabilities & SCA" icon={<ShieldCheck size={14} />}>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{tr('app.noScaCveDataHost')}</div>
      </Panel>
    );
  }
  const sevPill = (label: string, n: number, color: string) => (
    <div style={{ flex: 1, textAlign: 'center', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', padding: '6px 4px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: n > 0 ? color : 'var(--text-dim)' }}>{n}</div>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-dim)' }}>{label}</div>
    </div>
  );
  return (
    <Panel title="Vulnerabilities & SCA" icon={<ShieldCheck size={14} />}>
      {v && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {sevPill('Critical', v.critical, 'var(--danger)')}
            {sevPill('High', v.high, 'var(--accent-orange)')}
            {sevPill('Medium', v.medium, 'var(--warning)')}
            {sevPill('Low', v.low, 'var(--text-muted)')}
          </div>
          <Kv k={tr('hosts.cvesTotal')} v={String(v.total)} />
          {v.topCves.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-dim)', marginBottom: 4 }}>Schwerste CVEs</div>
              {v.topCves.slice(0, 5).map((c) => (
                <div key={`${c.cve}-${c.package}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '3px 0' }}>
                  <a href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(c.cve)}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', textDecoration: 'none' }}>{c.cve}</a>
                  {c.score != null && <Badge tone={c.score >= 9 ? 'danger' : c.score >= 7 ? 'warning' : 'muted'}>{c.score}</Badge>}
                  <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{c.package}{c.version ? ` ${c.version}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {s && s.worstScore != null && (
        <div style={{ marginTop: v ? 10 : 0, paddingTop: v ? 10 : 0, borderTop: v ? '1px solid var(--border-soft)' : 'none' }}>
          <Kv k="SCA-Compliance" v={`${s.worstScore} / 100 (schlechteste Policy)`} />
          <Kv k="Fehlgeschlagene Checks" v={String(s.totalFail)} />
          {s.policies[0] && <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 2 }}>{s.policies[0].name}</div>}
        </div>
      )}
    </Panel>
  );
}

function RiskSummary({ host }: { host: RegisteredHost }) {
  const { t: tr } = useTranslation();
  const risk = computeHostRisk(host);
  return (
    <Panel title="Risk Summary" icon={<ShieldCheck size={14} />}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <RiskRing score={host.riskScore} />
        <div style={{ flex: 1 }}>
          <Kv k="Risk Score" v={`${host.riskScore ?? 0} / 100`} />
          <Kv k="Risk Level" v={riskLevelLabel(host.riskLevel)} />
          <Kv k="Risk Factors" v={String(risk.factors.length)} />
        </div>
      </div>
      {risk.factors.length > 0 ? (
        <ul style={{ margin: '10px 0 0', padding: '0 0 0 16px', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {risk.factors.map((fac) => <li key={fac}>{fac}</li>)}
        </ul>
      ) : (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-dim)' }}>{tr('app.noElevatedRiskFactorsFrom')}</div>
      )}
      <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-dim)' }}>{tr('hosts.riskHeuristic')}</div>
    </Panel>
  );
}

// ── Transparenter Risiko-Indikator ────────────────────────────────────
// Leitet das Risiko-Level ausschließlich aus echten Wazuh-Signalen ab.
// Alle berücksichtigten Faktoren werden im Tooltip (title) offengelegt.
const RISK_LEVEL_COLOR: Record<string, string> = {
  low:      'var(--success)',
  medium:   'var(--warning)',
  high:     'var(--accent-orange)',
  critical: 'var(--danger)',
  unknown:  'var(--text-dim)',
};

/** Adapter: RegisteredHost → WazuhAgent-kompatibles Objekt für deriveHostRisk */
function toAgentLike(host: RegisteredHost): { id: string; name: string; status?: string; lastKeepAlive?: string } {
  // heartbeatStatus 'offline' → 'disconnected'; 'delayed'/'healthy' → 'active'
  const status = host.heartbeatStatus === 'offline' ? 'disconnected' : 'active';
  return { id: host.id, name: host.hostname, status, lastKeepAlive: host.lastHeartbeatAt };
}

function TransparentRiskBadge({ host, posture }: { host: RegisteredHost; posture: HostPosture | null }) {
  const { t: tr } = useTranslation();
  const agent = toAgentLike(host);
  const risk = deriveHostRisk(agent, null, posture);
  const color = RISK_LEVEL_COLOR[risk.level] ?? 'var(--text-dim)';
  const label = risk.level === 'unknown' ? 'Unbekannt' : risk.level.charAt(0).toUpperCase() + risk.level.slice(1);
  const tooltip = risk.level === 'unknown'
    ? tr('app.tooLittleDataHonestRating')
    : risk.reasons.length === 0
      ? tr('app.noElevatedRiskSignalsFrom')
      : `Risiko-Signale:\n${risk.reasons.map((r) => `• ${r}`).join('\n')}`;

  return (
    <Panel title="Transparentes Risiko-Level" icon={<ShieldCheck size={14} />}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          title={tooltip}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'help',
            padding: '4px 12px', borderRadius: 'var(--radius-pill)',
            background: `${color}22`, border: `1px solid ${color}`,
            color, fontWeight: 700, fontSize: 13,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
          {label}
          <span style={{ fontSize: 10, color, opacity: 0.7 }}>ⓘ</span>
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
          {risk.level === 'unknown'
            ? tr('text.notEnoughData')
            : risk.reasons.length === 0
              ? tr('text.noRiskSignals')
              : `${risk.reasons.length} Signal${risk.reasons.length !== 1 ? 'e' : ''}`}
        </span>
      </div>
      {risk.reasons.length > 0 && (
        <ul style={{ margin: '8px 0 0', padding: '0 0 0 14px', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          {risk.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-dim)', fontStyle: 'italic' }}>{tr('hosts.postureDerivedFrom')}</div>
    </Panel>
  );
}

// ── kleine Bausteine ──────────────────────────────────────────────────
function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>{icon}{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}
function KvBlock({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>{icon}{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}
function Kv({ k, v, mono }: { k: string; v?: string; mono?: boolean }) {
  if (!v) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
      <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{k}</span>
      <span style={{ color: 'var(--text)', textAlign: 'right', wordBreak: 'break-word', fontFamily: mono ? 'var(--font-mono)' : undefined, fontSize: mono ? 11.5 : undefined }}>{v}</span>
    </div>
  );
}
function KvDot({ k, v, good, bad, warn, title }: { k: string; v: string; good?: boolean; bad?: boolean; warn?: boolean; title?: string }) {
  const color = bad ? 'var(--danger)' : warn ? 'var(--warning)' : good ? 'var(--success)' : 'var(--text)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }} title={title}>
      <span style={{ color: 'var(--text-dim)' }}>{k}</span>
      <span style={{ color, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {v}{(good || bad || warn) && <span style={{ width: 7, height: 7, borderRadius: 999, background: color }} />}
        {title && <span style={{ fontSize: 10, color: 'var(--text-dim)', cursor: 'help' }}>ⓘ</span>}
      </span>
    </div>
  );
}
