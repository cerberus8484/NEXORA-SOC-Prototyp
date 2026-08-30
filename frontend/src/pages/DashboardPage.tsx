import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Ticket, Crosshair, Archive, HeartPulse, Bot, Settings, ArrowRight,
  FilePlus, FilePen, Trash2, ShieldCheck, LogIn, Activity as ActivityIcon, Gauge,
} from 'lucide-react';
import { ticketApi } from '../features/tickets/ticketApi';
import { auditApi, type AuditEntry } from '../features/audit/auditApi';
import { relTime, resolveActionLabel } from '../features/dashboard/activityFeedModel';
import { buildDetectionPanelState } from '../features/dashboard/detectionPanelModel';
import { buildDetectionSources, type DetectionSourceRow } from '../features/dashboard/detectionSourcesModel';
import { topSources, type SourceActivityRow } from '../features/dashboard/sourceActivityModel';
import { getCollectorActivity } from '../features/collectors/collectorsStatusApi';
import { socMetricsApi } from '../features/metrics/socMetricsApi';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { evidenceApi } from '../features/evidence/evidenceApi';
import { huntApi } from '../features/hunts/huntApi';
import { systemApi } from '../features/system/systemApi';
import { siemApi } from '../features/siem/siemApi';
import { resolveBufferTile, type BufferKpi, type BufferFetchOutcome } from '../features/siem/bufferModel';
import { TelemetryPanel } from '../features/siem/TelemetryPanel';
import { getStatus, testIntegration, type IntegrationStatus, type TestResult } from '../features/settings/integrationsApi';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  SectionHeader, StatCard, Card, CardHeader, CardBody, Badge,
  Donut, DonutLegend, Spinner, ErrorCard, EmptyState, type DonutSegment,
} from '../components/ui';

const OPEN_SESSION = new Set(['planned', 'active']);

const PRIORITY_DEF: { key: string; labelKey: string; color: string }[] = [
  { key: 'critical', labelKey: 'common.critical', color: 'var(--danger)' },
  { key: 'high', labelKey: 'tickets.priorities.high', color: 'var(--accent-orange)' },
  { key: 'medium', labelKey: 'tickets.priorities.medium', color: 'var(--warning)' },
  { key: 'low', labelKey: 'tickets.priorities.low', color: 'var(--success)' },
];

export function buildPrioritySegments(
  counts: Record<string, number>,
  translate: (key: string) => string,
): DonutSegment[] {
  return PRIORITY_DEF.map((priority) => ({
    label: translate(priority.labelKey),
    value: counts[priority.key] ?? 0,
    color: priority.color,
  }));
}

const huntStatusDef = (): { key: string; label: string; color: string }[] => [
  { key: 'active', label: i18n.t('common.active'), color: 'var(--success)' },
  { key: 'planned', label: i18n.t('common.planned'), color: 'var(--accent)' },
  { key: 'completed', label: 'Abgeschlossen', color: 'var(--chart-slate)' },
  { key: 'failed', label: i18n.t('common.failed'), color: 'var(--danger)' },
  { key: 'cancelled', label: 'Abgebrochen', color: 'var(--text-dim)' },
];

interface DashData {
  ticketsTotal: number;
  ticketsOpen: number;
  priorityCounts: Record<string, number>;
  priorityTotal: number;
  huntsTotal: number;
  huntsActive: number;
  huntSegments: DonutSegment[];
  healthValue: string;
  healthTone: 'success' | 'warning' | 'muted';
  health: string;
  evidenceCount: number;
  buffer: BufferKpi;
  detectionRows: DetectionSourceRow[];
  detectionError: boolean;
  sourceRows: SourceActivityRow[];
  sourceError: boolean;
}

const quick = () => [
  { to: '/tickets', icon: Ticket, title: 'Tickets', desc: i18n.t('dashboard.triageIncidents'), tone: 'accent' as const },
  { to: '/threat-hunts', icon: Crosshair, title: 'Threat Hunts', desc: i18n.t('dashboard.proactiveHunting'), tone: 'success' as const },
  { to: '/evidence', icon: Archive, title: 'Evidence Center', desc: i18n.t('dashboard.searchEvidence'), tone: 'accent' as const },
  { to: '/analysis', icon: Bot, title: 'Analyse-Deck', desc: i18n.t('nav.ticketAnalysisWithAi'), tone: 'purple' as const },
  { to: '/settings', icon: Settings, title: 'Settings', desc: i18n.t('dashboard.configAndSettings'), tone: 'muted' as const },
];

const LIVENESS_UI: Record<SourceActivityRow['liveness'], { tone: 'success' | 'warning' | 'muted'; label: string }> = {
  active: { tone: 'success', label: 'aktiv' },
  quiet: { tone: 'warning', label: 'still' },
  none: { tone: 'muted', label: 'keine' },
};

function describeDashboardHealth(
  backendHealth: string | undefined,
  integrations: readonly IntegrationStatus[] | null,
  liveTests: Partial<Record<'wazuh' | 'ollama', TestResult>>,
): Pick<DashData, 'healthValue' | 'healthTone' | 'health'> {
  if (backendHealth !== 'ok') {
    return { healthValue: '-', healthTone: 'muted', health: 'Backend-Status unbekannt' };
  }

  if (!integrations) {
    return { healthValue: 'OK', healthTone: 'success', health: 'Backend erreichbar' };
  }

  const warnings: string[] = [];
  const wazuh = integrations.find((item) => item.id === 'wazuh');
  const ollama = integrations.find((item) => item.id === 'ollama');
  const email = integrations.find((item) => item.id === 'email');

  if (!wazuh?.configured) warnings.push(i18n.t('dashboard.wazuhNotConfigured'));
  if (!email?.configured) warnings.push(i18n.t('dashboard.mailNotConfigured'));

  const wazuhTest = liveTests.wazuh;
  if (wazuh?.configured && wazuhTest && wazuhTest.reachable === false) {
    warnings.push(wazuhTest.message || i18n.t('dashboard.wazuhUnreachable'));
  }

  const ollamaTest = liveTests.ollama;
  if (ollama?.configured && ollamaTest) {
    if (ollamaTest.reason === 'model_missing' || ollamaTest.modelAvailable === false) {
      warnings.push(ollamaTest.message || i18n.t('settings.ollamaModelMissing'));
    } else if (ollamaTest.reachable === false) {
      warnings.push(ollamaTest.message || i18n.t('dashboard.ollamaUnreachable'));
    }
  }

  if (warnings.length > 0) {
    return {
      healthValue: i18n.t('common.checkCaps'),
      healthTone: 'warning',
      health: warnings.slice(0, 2).join(' · '),
    };
  }

  return { healthValue: 'OK', healthTone: 'success', health: 'Backend und Kernintegrationen wirken betriebsbereit' };
}

export function DashboardPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const canViewRuleMetrics = can.apply(user?.role);
  const isAdmin = can.admin(user?.role);
  const [data, setData] = useState<DashData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [all, open, crit, high, med, low, hunts, health, evCount, telemetry, collectorActivity, metrics, integrations] = await Promise.all([
          ticketApi.list({ limit: 1 }),
          ticketApi.list({ state: 'OPEN', limit: 1 }),
          ticketApi.list({ priority: 'critical', limit: 1 }),
          ticketApi.list({ priority: 'high', limit: 1 }),
          ticketApi.list({ priority: 'medium', limit: 1 }),
          ticketApi.list({ priority: 'low', limit: 1 }),
          huntApi.listSessions(),
          systemApi.health().catch(() => ({ status: 'unknown' })),
          evidenceApi.recent(500).then((r) => r.data.length).catch(() => 0),
          siemApi.telemetry('wazuh')
            .then((r): BufferFetchOutcome =>
              r.enabled ? { kind: 'ok', bufferAgents: r.data?.bufferAgents ?? [] } : { kind: 'disabled' })
            .catch((): BufferFetchOutcome => ({ kind: 'error' })),
          getCollectorActivity()
            .then((d) => ({ rows: topSources(d.sources), error: false }))
            .catch(() => ({ rows: [] as SourceActivityRow[], error: true })),
          canViewRuleMetrics
            ? socMetricsApi.get()
                .then((r) => ({ rows: buildDetectionSources(r.data.topRules), error: false }))
                .catch(() => ({ rows: [] as DetectionSourceRow[], error: true }))
            : Promise.resolve({ rows: [] as DetectionSourceRow[], error: false }),
          isAdmin ? getStatus().catch(() => null) : Promise.resolve(null),
        ]);

        if (!active) return;

        const liveTests: Partial<Record<'wazuh' | 'ollama', TestResult>> = {};
        if (integrations) {
          const liveTargets = integrations.filter((item) => (item.id === 'wazuh' || item.id === 'ollama') && item.configured && item.testable);
          const testResults = await Promise.all(
            liveTargets.map((item) =>
              testIntegration(item.id)
                .then((result) => [item.id, result] as const)
                .catch(() => [item.id, { reachable: false, testedAt: new Date().toISOString(), message: i18n.t('dashboard.liveUnreachable', { name: item.name }) }] as const),
            ),
          );
          if (!active) return;
          for (const [id, result] of testResults) {
            if (id === 'wazuh' || id === 'ollama') liveTests[id] = result;
          }
        }

        const counts: Record<string, number> = { critical: crit.total, high: high.total, medium: med.total, low: low.total };
        const priorityTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);

        const sessions = hunts.data ?? [];
        const huntCounts = sessions.reduce<Record<string, number>>((acc, item) => {
          acc[item.status] = (acc[item.status] ?? 0) + 1;
          return acc;
        }, {});
        const huntSegments = huntStatusDef()
          .map((item) => ({ label: item.label, value: huntCounts[item.key] ?? 0, color: item.color }))
          .filter((item) => item.value > 0);

        const dashboardHealth = describeDashboardHealth(health.status, integrations, liveTests);

        setData({
          ticketsTotal: all.total,
          ticketsOpen: open.total,
          priorityCounts: counts,
          priorityTotal,
          huntsTotal: sessions.length,
          huntsActive: sessions.filter((item) => OPEN_SESSION.has(item.status)).length,
          huntSegments,
          healthValue: dashboardHealth.healthValue,
          healthTone: dashboardHealth.healthTone,
          health: dashboardHealth.health,
          evidenceCount: evCount,
          buffer: resolveBufferTile(telemetry),
          detectionRows: metrics.rows,
          detectionError: metrics.error,
          sourceRows: collectorActivity.rows,
          sourceError: collectorActivity.error,
        });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : i18n.t('text.loadingFailed2'));
      }
    }

    void load();
    return () => { active = false; };
  }, [canViewRuleMetrics, isAdmin]);

  const prioritySegments = data ? buildPrioritySegments(data.priorityCounts, tr) : [];

  return (
    <div>
      <SectionHeader title="Dashboard" subtitle={tr('dashboard.situationSubtitle')} />

      {error ? <ErrorCard message={error} /> : !data ? <Spinner label={tr('dashboard.loadingSituation')} /> : (
        <>
          <div className="grid grid-kpi" style={{ marginBottom: 24 }}>
            <StatCard label="Offene Tickets" value={data.ticketsOpen} tone="accent" icon={<Ticket size={22} />} />
            <StatCard label={tr('dashboard.activeHunts')} value={data.huntsActive} tone="success" icon={<Crosshair size={22} />} />
            <StatCard label="Evidence Items" value={data.evidenceCount} tone="accent" icon={<Archive size={22} />} hint="Chain of Custody" />
            <StatCard label="Agent Buffer" value={data.buffer.value} tone={data.buffer.tone} icon={<Gauge size={22} />} hint={data.buffer.hint} hintDot={data.buffer.dot} />
            <StatCard label="System Health" value={data.healthValue} tone={data.healthTone} icon={<HeartPulse size={22} />} hint={data.health} hintDot />
          </div>

          <TelemetryPanel />

          <Card className="card-pad" style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Schnellzugriff</div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              {quick().map(({ to, icon: Icon, title, desc, tone }) => (
                <Link key={to} to={to} style={{ textDecoration: 'none' }}>
                  <Card hover className="card-pad" style={{ height: '100%', background: 'var(--bg-card-soft)' }}>
                    <span style={{ width: 42, height: 42, borderRadius: 10, display: 'grid', placeItems: 'center', color: `var(--${tone === 'muted' ? 'text-muted' : tone})`, background: tone === 'muted' ? 'var(--bg-elevated)' : `var(--${tone}-soft)` }}>
                      <Icon size={22} />
                    </span>
                    <div style={{ fontWeight: 600, color: 'var(--text)', marginTop: 12 }}>{title}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 3, marginBottom: 10 }}>{desc}</div>
                    <ArrowRight size={16} style={{ color: 'var(--text-dim)' }} />
                  </Card>
                </Link>
              ))}
            </div>
          </Card>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1.1fr' }}>
            <Card>
              <CardHeader title="Aktuelle Aktivitaeten" actions={<Badge tone="muted">Audit-Log</Badge>} />
              <CardBody>
                <ActivityFeed />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={tr('common.overview')} actions={<Badge tone="muted">{tr('common.currentState')}</Badge>} />
              <CardBody>
                <div className="grid grid-2" style={{ gap: 24 }}>
                  <ChartBlock title={tr('dashboard.ticketsByPriority')}>
                    <Donut segments={prioritySegments} centerTop={data.priorityTotal} centerBottom={tr('common.total')} />
                    <DonutLegend segments={prioritySegments} total={data.priorityTotal} />
                  </ChartBlock>
                  <ChartBlock title="Hunts Status">
                    <Donut segments={data.huntSegments} centerTop={data.huntsTotal} centerBottom={tr('common.total')} />
                    <DonutLegend segments={data.huntSegments} total={data.huntsTotal} />
                  </ChartBlock>
                </div>

                <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border-soft)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Top Erkennungsquellen</div>
                  <DetectionSources
                    canViewRules={canViewRuleMetrics}
                    rows={data.detectionRows}
                    ruleError={data.detectionError}
                    sourceRows={data.sourceRows}
                    sourceError={data.sourceError}
                  />
                </div>
              </CardBody>
            </Card>
          </div>

          <TopSourcesCard rows={data.sourceRows} error={data.sourceError} />
        </>
      )}
    </div>
  );
}

function TopSourcesCard({ rows, error }: { rows: SourceActivityRow[]; error: boolean }) {
  const { t: tr } = useTranslation();
  return (
    <Card style={{ marginTop: 24 }}>
      <CardHeader title={tr('collectors.topSources')} actions={<Badge tone="muted">Ingestion · 24h</Badge>} />
      <CardBody>
        {error ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{tr('dashboard.sourceActivityFailed')}</div>
        ) : rows.length === 0 ? (
          <EmptyState title={tr('app.noIngestionYet')} message={tr('app.noTicketsHaveArrivedFrom')} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map((row) => {
              const ui = LIVENESS_UI[row.liveness];
              return (
                <div key={row.source} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, minWidth: 150 }}>{row.label}</span>
                  <Badge tone={ui.tone} dot>{ui.label}</Badge>
                  <span style={{ marginLeft: 'auto', fontSize: 12.5 }}>
                    <strong>{row.recent.toLocaleString('de-DE')}</strong>
                    <span style={{ color: 'var(--text-dim)' }}> / {row.total.toLocaleString('de-DE')} gesamt</span>
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-dim)', minWidth: 90, textAlign: 'right' }}>
                    {row.lastSeen ? relTime(row.lastSeen) : '-'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DetectionSources({
  canViewRules,
  rows,
  ruleError,
  sourceRows,
  sourceError,
}: {
  canViewRules: boolean;
  rows: DetectionSourceRow[];
  ruleError: boolean;
  sourceRows: SourceActivityRow[];
  sourceError: boolean;
}) {
  const panel = buildDetectionPanelState({
    canViewRules,
    ruleRows: rows,
    ruleError,
    sourceRows,
    sourceError,
  });

  if (panel.mode === 'empty') {
    return <EmptyState title={panel.title} message={panel.description} />;
  }

  if (panel.mode === 'sources') {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Badge tone="muted">{panel.badge}</Badge>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{panel.description}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {panel.sourceRows.map((row) => (
            <div key={row.source} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: '0 0 38%', fontSize: 12, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
              <span style={{ flex: 1, height: 8, background: 'var(--bg-input)', borderRadius: 4, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.min(100, row.recent * 10 || 6)}%`, background: row.liveness === 'active' ? 'var(--success)' : row.liveness === 'quiet' ? 'var(--warning)' : 'var(--text-dim)' }} />
              </span>
              <span style={{ flex: '0 0 44px', textAlign: 'right', fontSize: 12, color: 'var(--text)' }}>{row.recent}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const max = Math.max(1, ...panel.ruleRows.map((row) => row.count));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Badge tone="muted">{panel.badge}</Badge>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{panel.description}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {panel.ruleRows.map((row) => (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: '0 0 38%', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
            <span style={{ flex: 1, height: 8, background: 'var(--bg-input)', borderRadius: 4, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${(row.count / max) * 100}%`, background: 'var(--accent)' }} />
            </span>
            <span style={{ flex: '0 0 32px', textAlign: 'right', fontSize: 12, color: 'var(--text)' }}>{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>{children}</div>
    </div>
  );
}

const ACTION_ICON: Record<string, { icon: ReactNode; tone: string }> = {
  TICKET_CREATE: { icon: <FilePlus size={14} />, tone: 'var(--success)' },
  TICKET_UPDATE: { icon: <FilePen size={14} />, tone: 'var(--accent)' },
  TICKET_DELETE: { icon: <Trash2 size={14} />, tone: 'var(--danger)' },
  'evidence.create': { icon: <Archive size={14} />, tone: 'var(--accent)' },
  'evidence.custody': { icon: <ShieldCheck size={14} />, tone: 'var(--success)' },
  LOGIN: { icon: <LogIn size={14} />, tone: 'var(--text-dim)' },
};

const fallbackIcon = { icon: <ActivityIcon size={14} />, tone: 'var(--text-dim)' };

function ActivityFeed() {
  const { t: tr } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    auditApi.recent(25, { signal: ctrl.signal })
      .then((r) => setEntries(r.data))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(true);
      });
    return () => ctrl.abort();
  }, []);

  if (error) return <EmptyState title={tr('dashboard.auditLogUnavailable')} message={tr('common.tryAgainLater')} />;
  if (!entries) return <Spinner label={tr('dashboard.loadingActivity')} />;
  if (entries.length === 0) return <EmptyState title={tr('dashboard.noActivityYet')} message={tr('dashboard.activityEmpty')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
      {entries.map((entry) => {
        const { icon, tone } = ACTION_ICON[entry.action] ?? fallbackIcon;
        const label = resolveActionLabel(entry.action);
        return (
          <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', borderBottom: '1px solid var(--border-soft)' }}>
            <span style={{ color: tone, flexShrink: 0 }}>{icon}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong>{label}</strong>
              {entry.targetType ? <span style={{ color: 'var(--text-dim)' }}> · {entry.targetType}</span> : null}
              {entry.actorLabel ? <span style={{ color: 'var(--text-dim)' }}> · {entry.actorLabel}</span> : null}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap', flexShrink: 0 }}>{relTime(entry.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
