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
          .catch(() => setOllamaTest({ reachable: false, testedAt: new Date().toISOString(), message: 'Ollama-Test fehlgeschlagen' }));
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
        title="System & Datenbank"
        subtitle="Live-Status der Nexora-Plattform und der Datenbank"
        help="system"
        actions={
          <>
            {health && <Badge tone={okTone(health.status)} dot>{health.status === 'ok' ? 'Online' : health.status}</Badge>}
            <Button variant="ghost" size="sm" icon={<RefreshCw size={15} />} onClick={load}>Aktualisieren</Button>
          </>
        }
      />

      {error ? (
        <Card><CardBody><EmptyState icon={<ServerCog size={28} />} title="Nicht erreichbar" message="Weder Health noch Stats antworten — Backend prüfen." /></CardBody></Card>
      ) : loading && !health ? (
        <Card><CardBody><Spinner label="Status wird geladen …" /></CardBody></Card>
      ) : (
        <>
          {/* System-Health-Zeile */}
          <Card style={{ marginBottom: 16 }}>
            <CardBody>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px 18px' }}>
                <Kv k="API" v={<Badge tone={okTone(health?.status)}>{health?.status ?? '—'}</Badge>} icon={<HeartPulse size={14} />} />
                <Kv k="Datenbank" v={<Badge tone={okTone(health?.db)}>{health?.db ?? '—'}</Badge>} icon={<Database size={14} />} />
                <Kv k="Version" v={health?.version ?? '—'} />
                <Kv k="Umgebung" v={health?.env ?? '—'} />
                <Kv k="Uptime" v={fmtUptime(health?.uptime)} />
              </div>
            </CardBody>
          </Card>

          {integrations && <IntegrationHealthCard items={integrations} ollamaTest={ollamaTest} />}
          {controlActions && <SystemOpsCard actions={controlActions} onReload={load} />}

          {stats && !stats.dbEnabled ? (
            <Card><CardBody><EmptyState icon={<Database size={28} />} title="DB-Modus deaktiviert" message="Das Backend läuft ohne Datenbank (DB_ENABLED=false) — keine Kennzahlen verfügbar." /></CardBody></Card>
          ) : (
            <>
              <PoolCard pool={stats?.pool} />

              {/* DB-Kennzahlen */}
              <div className="grid grid-kpi" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16 }}>
                <StatCard label="Tickets" value={c ? String(c.tickets) : '—'} tone="accent" icon={<Ticket size={20} />} hint={c ? `${c.ticketsOpen} offen` : ''} />
                <StatCard label="Evidence-Items" value={c ? String(c.evidence) : '—'} tone="accent" icon={<FileSearch size={20} />} />
                <StatCard label="Hunt-Sessions" value={c ? String(c.hunts) : '—'} tone="accent" icon={<Crosshair size={20} />} hint={c ? `${c.findings} Findings` : ''} />
                <StatCard label="FP-Ausnahmen" value={c ? String(c.fpExceptions) : '—'} tone="warning" icon={<ShieldAlert size={20} />} />
                <StatCard label="Audit (24h)" value={c ? String(c.audit24h) : '—'} tone="accent" icon={<Activity size={20} />} hint="Ereignisse" />
                <StatCard label="Benutzer" value={c ? String(c.users) : '—'} tone="muted" icon={<Users size={20} />} />
              </div>

              {/* Verteilungen */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <DistroCard title="Tickets nach Priorität" data={stats?.byPriority} tones={PRIORITY_TONE} />
                <DistroCard title="Tickets nach Status" data={stats?.byState} tones={STATE_TONE} />
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
  const counts = buildStatusCounts(items);
  const missing = items.filter((item) => item.status === 'not_configured').slice(0, 4);
  const ollama = items.find((item) => item.id === 'ollama');

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <ServerCog size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Integrations-Gesundheit</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone="success">{counts.connected} verbunden</Badge>
            <Badge tone="accent">{counts.configured} konfiguriert</Badge>
            <Badge tone={counts.not_configured > 0 ? 'warning' : 'muted'}>
              {counts.not_configured} offen
            </Badge>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          Diese Zeile spiegelt den effektiven Integrationsstatus aus der zentralen Konfiguration
          wider. So lassen sich Systemzustand und Integrationsseite direkt gegeneinander prüfen.
        </div>
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
                ? 'Ollama: Modell fehlt'
                : ollamaTest.reachable ? 'Ollama: live erreichbar' : 'Ollama: nicht erreichbar'}
            </Badge>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SystemOpsCard({ actions, onReload }: { actions: SystemControlAction[]; onReload: () => void }) {
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
        status === 401 ? 'Frische Passwort-Bestaetigung fehlgeschlagen oder abgelaufen.'
          : status === 403 ? 'Aktion ist serverseitig nicht freigeschaltet.'
            : status === 409 ? 'Es laeuft bereits eine andere System-Operation.'
              : status === 503 ? 'Host-Kanal ist noch nicht vollstaendig konfiguriert.'
                : 'System-Aktion konnte nicht gestartet werden.',
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
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 12 }}>
          Diese Aktionen stossen nur einen Host-Befehl an. Ohne explizite Server-Freigabe,
          Reauth und konfigurierten Host-Kanal bleiben sie gesperrt. Ein angenommener Start
          bestaetigt noch keinen erfolgreichen Abschluss.
        </div>
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
                  {action.kind === 'update' ? 'Aktualisierung anstossen' : 'Neustart anstossen'}
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
          title={selected?.kind === 'update' ? 'System-Aktualisierung anstossen' : 'System-Neustart anstossen'}
          description={
            selected?.kind === 'update'
              ? 'Bestaetige mit deinem Passwort. Nexora tauscht dies gegen eine frische deploy_reauth und uebergibt danach den serverseitig hinterlegten Update-Befehl an den Host.'
              : 'Bestaetige mit deinem Passwort. Nexora tauscht dies gegen eine frische deploy_reauth und uebergibt danach den serverseitig hinterlegten Restart-Befehl an den Host.'
          }
          confirmLabel={selected?.kind === 'update' ? 'Aktualisierung anstossen' : 'Neustart anstossen'}
          onConfirm={trigger}
          onCancel={() => setDialogOpen(false)}
        />
      </CardBody>
    </Card>
  );
}

function PoolCard({ pool }: { pool?: SystemStats['pool'] }) {
  if (!pool) return null;

  const statusTone: Tone = pool.saturated ? 'warning' : 'success';
  const statusLabel = pool.saturated ? 'Pool unter Druck' : 'Pool stabil';

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
          <PoolMetric label="Verbindungen" value={pool.total} />
          <PoolMetric label="Idle" value={pool.idle} />
          <PoolMetric label="Waiting" value={pool.waiting} tone={pool.waiting > 0 ? 'var(--warning)' : 'var(--text)'} />
          <PoolMetric label="Max" value={pool.max} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.5 }}>
          {pool.saturated
            ? 'Mindestens eine Anfrage wartet bereits auf eine DB-Verbindung oder alle Slots sind belegt. Lasttest / Query-Druck prüfen.'
            : 'Keine wartenden DB-Anfragen im aktuellen Snapshot.'}
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
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const max = entries.reduce((m, [, n]) => Math.max(m, n), 0) || 1;
  return (
    <Card>
      <CardBody>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{title}</div>
        {entries.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine Daten.</div>
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
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine Tabellendaten.</div>
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
  const data = activity ?? [];
  const CHART_H = 90;
  const heights = barHeights(data.map((d) => d.writes), CHART_H);
  const peak = data.reduce((m, d) => Math.max(m, d.writes), 0);
  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <PenLine size={15} style={{ color: 'var(--success)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Schreib-Aktivität / Tag</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>Spitze {peak.toLocaleString('de-DE')}</span>
        </div>
        {data.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine Aktivitätsdaten.</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: CHART_H }}>
            {data.map((d, i) => (
              <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`${d.day}: ${d.writes.toLocaleString('de-DE')} Schreibvorgänge`}>
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
