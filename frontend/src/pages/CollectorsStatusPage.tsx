import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { RefreshCw, Info, Plug, Antenna, Activity, Loader2 } from 'lucide-react';
import { SectionHeader, Card, CardBody, CardHeader, Badge, Button, Spinner, ErrorCard, EmptyState } from '../components/ui';
import { useAuth } from '../lib/auth';
import { can } from '../lib/rbac';
import { getCollectorActivity, sourceLiveness, type CollectorActivity } from '../features/collectors/collectorsStatusApi';
import { buildSourceHealthRows, summarizeSourceHealth } from '../features/collectors/sourceHealthModel';
import { getPipelineStatus, type PipelineStatus } from '../features/dataplane/dataplaneApi';
import { healthTone, healthLabel, collectorStatusTone, collectorStatusLabel, formatAge, formatTimestamp } from '../features/dataplane/dataplaneView';
import { getIntegrationStatus, testIntegration } from '../features/integrations/integrationsApi';
import {
  buildIntegrationRow, configuredTone, configuredLabel, mapTestResult,
  type IntegrationStatus, type IntegrationRow, type TestResultView,
} from '../features/integrations/integrationsView';

const LIVENESS: Record<string, { tone: 'success' | 'warning' | 'muted'; label: string }> = {
  active: { tone: 'success', label: 'Aktiv (24h)' },
  quiet: { tone: 'warning', label: 'Still' },
  none: { tone: 'muted', label: 'Keine Daten' },
};

const s: Record<string, CSSProperties> = {
  page: { padding: '24px 28px' },
  note: {
    display: 'flex',
    gap: 8,
    fontSize: 12,
    color: 'var(--text-muted)',
    lineHeight: 1.5,
    padding: '10px 12px',
    background: 'var(--bg-card-soft)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 18,
  },
  section: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    margin: '26px 0 12px',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    fontSize: 10.5,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: 600,
    padding: '0 10px 8px',
    borderBottom: '1px solid var(--border-soft)',
    whiteSpace: 'nowrap',
  },
  td: {
    fontSize: 12.5,
    color: 'var(--text)',
    padding: '9px 10px',
    borderBottom: '1px solid var(--border-soft)',
    verticalAlign: 'middle',
  },
  num: { fontFamily: 'var(--font-mono)', textAlign: 'right' },
  mono: { fontFamily: 'var(--font-mono)' },
  host: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' },
  testMsg: { fontSize: 11, marginTop: 3 },
  err: { fontSize: 11.5, color: 'var(--danger)', fontFamily: 'var(--font-mono)' },
  counters: { display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14, fontSize: 12 },
  counter: { display: 'flex', flexDirection: 'column', gap: 2 },
  cLabel: { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 },
  cVal: { fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)' },
  nodeHead: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  nodeId: { fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13.5, color: 'var(--text)' },
  meta: { fontSize: 11.5, color: 'var(--text-dim)' },
  healthGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', marginBottom: 16 },
  healthTile: { padding: '10px 12px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' },
  healthRows: { display: 'flex', flexDirection: 'column', gap: 8 },
  healthRow: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' },
  healthName: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  healthHint: { fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2 },
  healthMeta: { fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' },
};

function fmtLastSeen(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface IntegrationRowState {
  testing: boolean;
  result: TestResultView | null;
}

function integrationTestFailure(): TestResultView {
  return { tone: 'danger', label: 'Fehler', message: 'Test fehlgeschlagen' };
}

function SourceHealthSection({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<ReturnType<typeof buildSourceHealthRows> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([getIntegrationStatus(), getCollectorActivity()])
      .then(([integrations, activity]) => setRows(buildSourceHealthRows(integrations, activity.sources)))
      .catch(() => setError('Source-Health konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div style={s.note}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>Source Health braucht Konfigurationsdaten und ist deshalb der Admin-Rolle vorbehalten.</span>
      </div>
    );
  }

  const summary = summarizeSourceHealth(rows ?? []);

  return (
    <>
      <div style={s.note}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>Einfach lesen: gruen = liefert Tickets, gelb = war frueher aktiv aber ist aktuell still, rot = konfiguriert aber noch nie gesehen.</span>
      </div>

      {loading && <Spinner />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && rows && (
        rows.length === 0 ? (
          <EmptyState title="Keine Ticket-Quellen" message="Es sind aktuell keine ueberwachten Ticket-Quellen definiert." />
        ) : (
          <Card>
            <CardBody>
              <div style={s.healthGrid}>
                <div style={s.healthTile}><div style={s.cLabel}>Gesund</div><div style={s.cVal}>{summary.healthy}</div></div>
                <div style={s.healthTile}><div style={s.cLabel}>Braucht Blick</div><div style={s.cVal}>{summary.attention}</div></div>
                <div style={s.healthTile}><div style={s.cLabel}>Nicht konfiguriert</div><div style={s.cVal}>{summary.notConfigured}</div></div>
                <div style={s.healthTile}><div style={s.cLabel}>Gesamt</div><div style={s.cVal}>{summary.total}</div></div>
              </div>

              <div style={s.healthRows}>
                {rows.map((row) => (
                  <div key={row.source} style={s.healthRow}>
                    <div style={{ minWidth: 180 }}>
                      <div style={s.healthName}>{row.label}</div>
                      <div style={s.healthHint}>{row.detail}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <Badge tone={row.tone} dot>{row.statusLabel}</Badge>
                      <span style={s.healthMeta}>{row.endpoint || 'kein Endpoint hinterlegt'}</span>
                    </div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <div style={s.healthMeta}>24h: {row.recent.toLocaleString('de-DE')}</div>
                      <div style={s.healthMeta}>Gesamt: {row.total.toLocaleString('de-DE')}</div>
                      <div style={s.healthMeta}>Zuletzt: {fmtLastSeen(row.lastSeen)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )
      )}
    </>
  );
}

function IntegrationsSection({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<IntegrationRow[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [rowState, setRowState] = useState<Record<string, IntegrationRowState>>({});

  const runAutoTests = useCallback((items: readonly IntegrationRow[]) => {
    const autoTestRows = items.filter((row) => row.canTest);
    if (autoTestRows.length === 0) return;

    setRowState((prev) => {
      const next = { ...prev };
      for (const row of autoTestRows) {
        next[row.id] = { testing: true, result: null };
      }
      return next;
    });

    for (const row of autoTestRows) {
      void testIntegration(row.id)
        .then((res) => setRowState((prev) => ({ ...prev, [row.id]: { testing: false, result: mapTestResult(res) } })))
        .catch(() => setRowState((prev) => ({ ...prev, [row.id]: { testing: false, result: integrationTestFailure() } })));
    }
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    setRowState({});
    getIntegrationStatus()
      .then((list: IntegrationStatus[]) => {
        const nextRows = list.map(buildIntegrationRow);
        setRows(nextRows);
        runAutoTests(nextRows);
      })
      .catch(() => setError('Integrations-Status konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, [runAutoTests]);

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin, load]);

  const runTest = (id: string) => {
    setRowState((prev) => ({ ...prev, [id]: { testing: true, result: null } }));
    testIntegration(id)
      .then((res) => setRowState((prev) => ({ ...prev, [id]: { testing: false, result: mapTestResult(res) } })))
      .catch(() => setRowState((prev) => ({ ...prev, [id]: { testing: false, result: integrationTestFailure() } })));
  };

  if (!isAdmin) {
    return (
      <div style={s.note}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>Der Integrations-Status (konfigurierte Quellen, Endpoints, Verbindungstest) ist der Admin-Rolle vorbehalten.</span>
      </div>
    );
  }

  return (
    <>
      <div style={s.note}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>Live-Tests laufen beim Laden automatisch fuer alle testbaren, konfigurierten Integrationen. Der Button prueft dieselbe Verbindung bei Bedarf erneut.</span>
      </div>

      {loading && <Spinner />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && rows && (
        rows.length === 0 ? (
          <EmptyState title="Keine Integrationen" message="Es sind keine Integrationen definiert." />
        ) : (
          <Card>
            <CardBody>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Integration</th>
                      <th style={s.th}>Kategorie</th>
                      <th style={s.th}>Konfiguriert</th>
                      <th style={s.th}>Endpoint</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Verbindung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const st = rowState[row.id];
                      return (
                        <tr key={row.id}>
                          <td style={{ ...s.td, fontWeight: 700 }}>{row.name}</td>
                          <td style={{ ...s.td, color: 'var(--text-muted)' }}>{row.categoryLabel}</td>
                          <td style={s.td}>
                            <Badge tone={configuredTone(row.configured)} dot>{configuredLabel(row.configured)}</Badge>
                          </td>
                          <td style={s.td}><span style={s.host}>{row.endpointDisplay}</span></td>
                          <td style={{ ...s.td, textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={st?.testing ? <Loader2 size={13} style={{ animation: 'spin .7s linear infinite' }} /> : <Plug size={13} />}
                                onClick={() => runTest(row.id)}
                                disabled={!row.canTest || st?.testing}
                                title={row.testDisabledReason ?? 'Verbindung testen'}
                              >
                                {st?.testing ? 'Teste...' : 'Verbindung testen'}
                              </Button>
                              {st?.result && (
                                <span style={{ ...s.testMsg, color: `var(--${st.result.tone === 'muted' ? 'text-muted' : st.result.tone})` }}>
                                  {st.result.label}: {st.result.message}
                                </span>
                              )}
                              {!row.canTest && !st?.result && (
                                <span style={{ ...s.testMsg, color: 'var(--text-dim)' }}>{row.testDisabledReason}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        )
      )}
    </>
  );
}

function LiveCollectorsSection() {
  const [data, setData] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError('');
    getPipelineStatus()
      .then(setData)
      .catch(() => setError('Pipeline-Status konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <>
      {data && !data.available && (
        <div style={s.note}>
          <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
          <span>
            Kein frischer Status-Snapshot eines Collector-Hub-Knotens (Schwelle {Math.round((data.staleAfterMs || 0) / 1000)}s).
            Die Hub-Backend-Status-Bruecke ist aktiv - sobald der Push-Job eines Knotens meldet, erscheinen hier laufende Kollektoren und Zaehler.
          </span>
        </div>
      )}

      {loading && <Spinner />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && data && (
        data.aggregate && data.aggregate.nodes > 0 ? (
          data.nodes.map((node) => {
            const intake = node.intake || {};
            const outbox = node.outbox || {};
            return (
              <Card key={node.nodeId} style={{ marginBottom: 14 }}>
                <CardHeader
                  title={(
                    <span style={s.nodeHead}>
                      <span style={s.nodeId}>{node.nodeId}</span>
                      <Badge tone={healthTone(node.health)} dot>{healthLabel(node.health)}</Badge>
                      <span style={s.meta}>{formatAge(node.ageMs)} - gemeldet {formatTimestamp(node.reportedAt)}</span>
                    </span>
                  )}
                />
                <CardBody>
                  <div style={s.counters}>
                    <div style={s.counter}><span style={s.cLabel}>Intake gesamt</span><span style={s.cVal}>{(intake.total ?? 0).toLocaleString('de-DE')}</span></div>
                    <div style={s.counter}><span style={s.cLabel}>Intake abgelehnt</span><span style={s.cVal}>{(intake.rejected ?? 0).toLocaleString('de-DE')}</span></div>
                    <div style={s.counter}><span style={s.cLabel}>Outbox pending</span><span style={s.cVal}>{(outbox.pending ?? 0).toLocaleString('de-DE')}</span></div>
                    <div style={s.counter}><span style={s.cLabel}>Outbox failed</span><span style={{ ...s.cVal, color: (outbox.failed ?? 0) > 0 ? 'var(--danger)' : 'var(--text)' }}>{(outbox.failed ?? 0).toLocaleString('de-DE')}</span></div>
                  </div>
                  {node.collectors.length === 0 ? (
                    <EmptyState title="Keine Kollektoren gemeldet" message="Dieser Knoten hat keine Collector-Zustaende im Snapshot." />
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={s.table}>
                        <thead>
                          <tr>
                            <th style={s.th}>Kollektor</th>
                            <th style={s.th}>Art</th>
                            <th style={s.th}>Status</th>
                            <th style={{ ...s.th, textAlign: 'right' }}>Emittiert</th>
                            <th style={s.th}>Fehler</th>
                          </tr>
                        </thead>
                        <tbody>
                          {node.collectors.map((collector) => (
                            <tr key={collector.name}>
                              <td style={{ ...s.td, ...s.mono, fontWeight: 600 }}>{collector.name}</td>
                              <td style={{ ...s.td, color: 'var(--text-muted)' }}>{collector.kind || '-'}</td>
                              <td style={s.td}><Badge tone={collectorStatusTone(collector.status)} dot>{collectorStatusLabel(collector.status)}</Badge></td>
                              <td style={{ ...s.td, ...s.num }}>{(collector.emitted ?? 0).toLocaleString('de-DE')}</td>
                              <td style={s.td}>{collector.error ? <span style={s.err}>{collector.error}</span> : <span style={{ color: 'var(--text-dim)' }}>-</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })
        ) : (
          <EmptyState
            title="Noch kein Collector-Hub-Knoten gemeldet"
            message="Sobald ein Knoten seinen Status ueber die Bruecke meldet, erscheinen hier laufende Kollektoren und Pipeline-Zaehler."
          />
        )
      )}
    </>
  );
}

function IngestActivitySection() {
  const [data, setData] = useState<CollectorActivity | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError('');
    getCollectorActivity()
      .then(setData)
      .catch(() => setError('Ingestion-Aktivitaet konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <>
      {loading && <Spinner />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && data && (
        data.sources.length === 0 ? (
          <EmptyState title="Noch keine Ingestion" message="Es sind noch keine Tickets aus einer Quelle eingegangen." />
        ) : (
          <Card>
            <CardBody>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Quelle</th>
                      <th style={s.th}>Status</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Letzte 24h</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Gesamt</th>
                      <th style={s.th}>Zuletzt gesehen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((src) => {
                      const live = LIVENESS[sourceLiveness(src)];
                      return (
                        <tr key={src.source}>
                          <td style={{ ...s.td, ...s.mono, fontWeight: 700 }}>{src.source}</td>
                          <td style={s.td}><Badge tone={live.tone} dot>{live.label}</Badge></td>
                          <td style={{ ...s.td, ...s.num }}>{src.recent.toLocaleString('de-DE')}</td>
                          <td style={{ ...s.td, ...s.num, color: 'var(--text-muted)' }}>{src.total.toLocaleString('de-DE')}</td>
                          <td style={{ ...s.td, color: 'var(--text-muted)' }}>{fmtLastSeen(src.lastSeen)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        )
      )}
    </>
  );
}

export function CollectorsStatusPage() {
  const { user } = useAuth();
  const isAdmin = can.admin(user?.role);
  const [nonce, setNonce] = useState(0);

  return (
    <div style={s.page}>
      <SectionHeader
        title="Integrations & Collectors"
        subtitle="Read-only - konfigurierte Integrationen, laufende Kollektoren und Ingest-Aktivitaet"
        help="integrationen"
        actions={(
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => setNonce((n) => n + 1)}>
            Neu laden
          </Button>
        )}
      />

      <div style={s.note}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>
          Diese Seite ist read-only inklusive Verbindungstest. Das Hinzufuegen, Konfigurieren oder Deployen von
          Quellen (Schreib- oder Deploy-Aktionen) ist eine separate, sicherheitssensible Ausbaustufe (Deploy-Center) und hier bewusst nicht enthalten.
        </span>
      </div>

      <div style={s.section}><Activity size={15} style={{ color: 'var(--accent)' }} /> Source Health</div>
      <SourceHealthSection key={`health-${nonce}`} isAdmin={isAdmin} />

      <div style={s.section}><Plug size={15} style={{ color: 'var(--accent)' }} /> Integrationen</div>
      <IntegrationsSection key={`int-${nonce}`} isAdmin={isAdmin} />

      <div style={s.section}><Antenna size={15} style={{ color: 'var(--accent)' }} /> Live-Kollektoren (Collector-Hub)</div>
      <LiveCollectorsSection key={`live-${nonce}`} />

      <div style={s.section}><Activity size={15} style={{ color: 'var(--accent)' }} /> Ingest-Aktivitaet je Quelle</div>
      <IngestActivitySection key={`act-${nonce}`} />
    </div>
  );
}
