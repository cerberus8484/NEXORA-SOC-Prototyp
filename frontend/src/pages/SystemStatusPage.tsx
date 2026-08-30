import { useEffect, useState, type ReactNode } from 'react';
import {
  Database, HeartPulse, RefreshCw, Ticket, FileSearch, Crosshair, ShieldAlert,
  Activity, Users, ServerCog, HardDrive, PenLine,
} from 'lucide-react';
import { SectionHeader, Card, CardBody, StatCard, Badge, Button, EmptyState, Spinner, type Tone } from '../components/ui';
import { systemApi, type HealthResponse, type SystemStats, type SystemControlAction } from '../features/system/systemApi';
import { formatBytes, barHeights } from '../features/system/systemFormat';
import { buildStatusCounts, getStatus, testIntegration, type IntegrationStatus, type TestResult } from '../features/settings/integrationsApi';
import { deployApi } from '../features/deploy/deployApi';
import { ArmPasswordDialog } from '../features/services/ArmPasswordDialog';
import { ApiError } from '../lib/apiClient';
import { useTranslation } from 'react-i18next';

const PRIORITY_TONE: Record<string, string> = {
  critical: 'var(--danger)', high: 'var(--accent-orange)', medium: 'var(--warning)',
  low: 'var(--success)', info: 'var(--accent)',
};
const STATE_TONE: Record<string, string> = { OPEN: 'var(--accent)', CLOSED: 'var(--text-dim)' };

function fmtUptime(s?: number): string {
  if (!s) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function SystemStatusPage() {
  const { t: tr } = useTranslation();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);
  const [controlActions, setControlActions] = useState<SystemControlAction[] | null>(null);
  const [ollamaTest, setOllamaTest] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  function load() {
    setLoading(true);
    setError(false);
    Promise.all([
      systemApi.health().catch(() => null),
      systemApi.stats().then((r) => r.data).catch(() => null),
      getStatus().catch(() => null),
      systemApi.control().then((r) => r.data.actions).catch(() => null),
    ]).then(([h, s, i, control]) => {
      setHealth(h);
      setStats(s);
      setIntegrations(i);
      setControlActions(control);
      setOllamaTest(null);
      const ollama = i?.find((item) => item.id === 'ollama');
      if (ollama?.configured && ollama.testable) {
        void testIntegration('ollama')
          .then((result) => setOllamaTest(result))
          .catch(() => setOllamaTest({ reachable: false, testedAt: new Date().toISOString(), message: tr('settings.ollamaTestFailed') }));
      }
      if (!h && !s) setError(true);
    }).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const okTone = (v?: string): Tone => (v === 'ok' ? 'success' : v ? 'warning' : 'muted');
  const c = stats?.counts;

  return (
    <div>
      <SectionHeader
        title={tr('settings.systemDatabase')}
        subtitle={tr('app.liveStatusNexoraPlatformDatabase')}
        help="system"
        actions={
          <>
            {health && <Badge tone={okTone(health.status)} dot>{health.status === 'ok' ? 'Online' : health.status}</Badge>}
            <Button variant="ghost" size="sm" icon={<RefreshCw size={15} />} onClick={load}>{tr('common.refresh')}</Button>
          </>
        }
      />

      {error ? (
        <Card><CardBody><EmptyState icon={<ServerCog size={28} />} title={tr('text.unreachable')} message={tr('app.neitherHealthNorStatsRespond')} /></CardBody></Card>
      ) : loading && !health ? (
        <Card><CardBody><Spinner label={tr('common.loadingStatus')} /></CardBody></Card>
      ) : (
        <>
          {/* System-Health-Zeile */}
          <Card style={{ marginBottom: 16 }}>
            <CardBody>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px 18px' }}>
                <Kv k="API" v={<Badge tone={okTone(health?.status)}>{health?.status ?? '—'}</Badge>} icon={<HeartPulse size={14} />} />
                <Kv k={tr('settings.databaseLabel')} v={<Badge tone={okTone(health?.db)}>{health?.db ?? '—'}</Badge>} icon={<Database size={14} />} />
                <Kv k="Version" v={health?.version ?? '—'} />
                <Kv k={tr('common.environment')} v={health?.env ?? '—'} />
                <Kv k="Uptime" v={fmtUptime(health?.uptime)} />
              </div>
            </CardBody>
          </Card>

          {integrations && <IntegrationHealthCard items={integrations} ollamaTest={ollamaTest} />}
          {controlActions && <SystemOpsCard actions={controlActions} onReload={load} />}

          {stats && !stats.dbEnabled ? (
            <Card><CardBody><EmptyState icon={<Database size={28} />} title={tr('settings.dbModeDisabled')} message={tr('app.backendRunsWithoutDatabaseDb')} /></CardBody></Card>
          ) : (
            <>
              <PoolCard pool={stats?.pool} />

              {/* DB-Kennzahlen */}
              <div className="grid grid-kpi" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16 }}>
                <StatCard label="Tickets" value={c ? String(c.tickets) : '—'} tone="accent" icon={<Ticket size={20} />} hint={c ? `${c.ticketsOpen} offen` : ''} />
                <StatCard label="Evidence-Items" value={c ? String(c.evidence) : '—'} tone="accent" icon={<FileSearch size={20} />} />
                <StatCard label="Hunt-Sessions" value={c ? String(c.hunts) : '—'} tone="accent" icon={<Crosshair size={20} />} hint={c ? `${c.findings} Findings` : ''} />
                <StatCard label="FP-Ausnahmen" value={c ? String(c.fpExceptions) : '—'} tone="warning" icon={<ShieldAlert size={20} />} />
                <StatCard label="Audit (24h)" value={c ? String(c.audit24h) : '—'} tone="accent" icon={<Activity size={20} />} hint={tr('audit.events')} />
                <StatCard label={tr('common.users')} value={c ? String(c.users) : '—'} tone="muted" icon={<Users size={20} />} />
              </div>

              {/* Verteilungen */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <DistroCard title={tr('app.ticketsPriority')} data={stats?.byPriority} tones={PRIORITY_TONE} />
                <DistroCard title={tr('text.ticketsStatus')} data={stats?.byState} tones={STATE_TONE} />
              </div>

              {/* Speicherplatz + Schreib-Aktivität */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <StorageCard storage={stats?.storage} />
                <ActivityCard activity={stats?.activity} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function IntegrationHealthCard({ items, ollamaTest }: { items: IntegrationStatus[]; ollamaTest: TestResult | null }) {
  const { t: tr } = useTranslation();
  const counts = buildStatusCounts(items);
  const missing = items.filter((item) => item.status === 'not_configured').slice(0, 4);
  const ollama = items.find((item) => item.id === 'ollama');

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <ServerCog size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>{tr('settings.integrationHealth')}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone="success">{counts.connected} verbunden</Badge>
            <Badge tone="accent">{counts.configured} konfiguriert</Badge>
            <Badge tone={counts.not_configured > 0 ? 'warning' : 'muted'}>
              {counts.not_configured} offen
            </Badge>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{tr('system.integrationRowNote')}</div>
        {missing.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {missing.map((item) => (
              <Badge key={item.id} tone="warning">{item.name} fehlt</Badge>
            ))}
          </div>
        )}
        {ollama?.configured && ollamaTest && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Badge tone={
              ollamaTest.reason === 'model_missing' || ollamaTest.modelAvailable === false
                ? 'warning'
                : ollamaTest.reachable ? 'success' : 'danger'
            }
            >
              {ollamaTest.reason === 'model_missing' || ollamaTest.modelAvailable === false
                ? tr('dashboard.ollamaModelMissing')
                : ollamaTest.reachable ? 'Ollama: live erreichbar' : tr('app.ollamaUnreachable')}
            </Badge>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SystemOpsCard({ actions, onReload }: { actions: SystemControlAction[]; onReload: () => void }) {
  const { t: tr } = useTranslation();
  const [selected, setSelected] = useState<SystemControlAction | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  async function trigger(password: string) {
    if (!selected) return;
    setBusyId(selected.id);
    setError('');
    setFeedback('');
    try {
      const { data: reauth } = await deployApi.reauth(password);
      const { data } = await systemApi.runControlAction(selected.id, reauth.reauthToken);
      setFeedback(data.message);
      setDialogOpen(false);
      onReload();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 401 ? tr('app.freshPasswordConfirmationFailedExpired')
          : status === 403 ? tr('app.actionNotEnabledServer')
            : status === 409 ? tr('text.anotherSystemOperationAlreadyRunning')
              : status === 503 ? tr('app.hostChannelNotFullyConfigured')
                : tr('app.systemActionCouldNotStarted'),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <ServerCog size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>System-Operationen</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone="warning">Admin + Reauth</Badge>
            <Badge tone="muted">fail-closed</Badge>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 12 }}>{tr('system.hostCommandNote')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {actions.map((action) => (
            <div key={action.id} style={{ padding: '12px 14px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{action.name}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {action.running && <Badge tone="warning" dot>laeuft</Badge>}
                  <Badge tone={action.enabled ? 'success' : 'muted'}>{action.enabled ? 'bereit' : 'gesperrt'}</Badge>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{action.description}</div>
              {!action.enabled && (
                <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8, lineHeight: 1.5 }}>
                  {action.disabledReason}
                </div>
              )}
              {action.lastResult && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>
                  Letzter Status: {action.lastResult.status}
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <Button
                  size="sm"
                  variant={action.kind === 'update' ? 'primary' : 'ghost'}
                  disabled={!action.enabled || busyId !== null}
                  onClick={() => {
                    setSelected(action);
                    setError('');
                    setDialogOpen(true);
                  }}
                >
                  {action.kind === 'update' ? tr('services.triggerUpdate') : tr('services.triggerRestart')}
                </Button>
              </div>
            </div>
          ))}
        </div>
        {feedback && (
          <div style={{ fontSize: 11.5, color: 'var(--success)', marginTop: 12, lineHeight: 1.5 }}>
            {feedback}
          </div>
        )}

        <ArmPasswordDialog
          open={dialogOpen}
          busy={busyId !== null}
          error={error}
          title={selected?.kind === 'update' ? tr('services.triggerSystemUpdate') : tr('services.triggerSystemRestart')}
          description={
            selected?.kind === 'update'
              ? tr('app.confirmYourPasswordNexoraExchanges2')
              : tr('app.confirmYourPasswordNexoraExchanges')
          }
          confirmLabel={selected?.kind === 'update' ? tr('services.triggerUpdate') : tr('services.triggerRestart')}
          onConfirm={trigger}
          onCancel={() => setDialogOpen(false)}
        />
      </CardBody>
    </Card>
  );
}

function PoolCard({ pool }: { pool?: SystemStats['pool'] }) {
  const { t: tr } = useTranslation();
  if (!pool) return null;

  const statusTone: Tone = pool.saturated ? 'warning' : 'success';
  const statusLabel = pool.saturated ? tr('text.poolUnderPressure') : 'Pool stabil';

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Database size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Postgres-Pool</span>
          <div style={{ marginLeft: 'auto' }}>
            <Badge tone={statusTone} dot>{statusLabel}</Badge>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <PoolMetric label={tr('settings.connections')} value={pool.total} />
          <PoolMetric label="Idle" value={pool.idle} />
          <PoolMetric label="Waiting" value={pool.waiting} tone={pool.waiting > 0 ? 'var(--warning)' : 'var(--text)'} />
          <PoolMetric label="Max" value={pool.max} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.5 }}>
          {pool.saturated
            ? tr('app.leastOneRequestAlreadyWaiting')
            : tr('text.noWaitingDatabaseRequestsCurrent')}
        </div>
      </CardBody>
    </Card>
  );
}

function PoolMetric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: tone || 'var(--text)', marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Kv({ k, v, icon }: { k: string; v: ReactNode; icon?: ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-dim)' }}>{icon}{k}</div>
      <div style={{ fontSize: 13.5, marginTop: 3 }}>{v}</div>
    </div>
  );
}

// Horizontale Balken-Verteilung (anteilig am Maximum).
function DistroCard({ title, data, tones }: { title: string; data?: Record<string, number>; tones: Record<string, string> }) {
  const { t: tr } = useTranslation();
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const max = entries.reduce((m, [, n]) => Math.max(m, n), 0) || 1;
  return (
    <Card>
      <CardBody>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{title}</div>
        {entries.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('text.noData')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map(([key, n]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 80, fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{key}</span>
                <div style={{ flex: 1, height: 14, background: 'var(--bg-elevated)', borderRadius: 7, overflow: 'hidden' }}>
                  <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: tones[key] ?? 'var(--accent)', borderRadius: 7 }} />
                </div>
                <span style={{ width: 40, textAlign: 'right', fontSize: 12.5, fontWeight: 600 }}>{n}</span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// Speicherplatz: DB-Gesamtgröße + größte Tabellen (Balken nach Bytes).
function StorageCard({ storage }: { storage?: SystemStats['storage'] }) {
  const { t: tr } = useTranslation();
  const tables = storage?.tables ?? [];
  const max = tables.reduce((m, t) => Math.max(m, t.bytes), 0) || 1;
  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <HardDrive size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Speicherplatz</span>
          <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{storage ? formatBytes(storage.dbBytes) : '—'}</span>
        </div>
        {tables.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('text.noTableData')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {tables.map((t) => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 130, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <div style={{ flex: 1, height: 12, background: 'var(--bg-elevated)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${(t.bytes / max) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 6 }} />
                </div>
                <span style={{ width: 64, textAlign: 'right', fontSize: 11.5, fontWeight: 600 }}>{formatBytes(t.bytes)}</span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// Schreib-Aktivität pro Tag (audit_log) — Balkendiagramm der letzten 14 Tage.
function ActivityCard({ activity }: { activity?: SystemStats['activity'] }) {
  const { t: tr } = useTranslation();
  const data = activity ?? [];
  const CHART_H = 90;
  const heights = barHeights(data.map((d) => d.writes), CHART_H);
  const peak = data.reduce((m, d) => Math.max(m, d.writes), 0);
  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <PenLine size={15} style={{ color: 'var(--success)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>{tr('app.writeActivityDay')}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>Spitze {peak.toLocaleString('de-DE')}</span>
        </div>
        {data.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('app.noActivityData')}</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: CHART_H }}>
            {data.map((d, i) => (
              <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={tr('settings.writesOnDay', { day: d.day, count: d.writes })}>
                <div style={{ width: '100%', height: heights[i], minHeight: d.writes > 0 ? 2 : 0, background: 'linear-gradient(180deg, var(--success), color-mix(in srgb, var(--success) 55%, transparent))', borderRadius: '3px 3px 0 0' }} />
                <span style={{ fontSize: 8.5, color: 'var(--text-dim)', marginTop: 3 }}>{d.day.slice(8)}</span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
