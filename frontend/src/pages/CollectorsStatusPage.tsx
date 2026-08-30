import { useEffect, useState, type CSSProperties } from 'react';
import { RefreshCw, Info, Plug, Antenna, Activity, Loader2 } from 'lucide-react';
import { SectionHeader, Card, CardBody, CardHeader, Badge, Button, Spinner, ErrorCard, EmptyState } from '../components/ui';
import { useAuth } from '../lib/auth';
import { can } from '../lib/rbac';
import { getCollectorActivity, sourceLiveness, type CollectorActivity } from '../features/collectors/collectorsStatusApi';
import { buildSourceHealthRows, summarizeSourceHealth } from '../features/collectors/sourceHealthModel';
import { getPipelineStatus, type PipelineStatus } from '../features/dataplane/dataplaneApi';
import { healthTone, healthLabel, collectorStatusTone, collectorStatusLabel, formatAge, formatTimestamp } from '../features/dataplane/dataplaneView';
import { getIntegrationStatus, testIntegration } from '../features/integrations/integrationsApi';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  buildIntegrationRow, configuredTone, configuredLabel, mapTestResult,
  type IntegrationStatus, type IntegrationRow, type TestResultView,
} from '../features/integrations/integrationsView';

const liveness = (): Record<string, { tone: 'success' | 'warning' | 'muted'; label: string }> => ({
  active: { tone: 'success', label: i18n.t('app.active24H') },
  quiet: { tone: 'warning', label: 'Still' },
  none: { tone: 'muted', label: i18n.t('text.noData2') },
});

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
  return { tone: 'danger', label: i18n.t('common.error'), message: i18n.t('common.testFailed') };
}

function SourceHealthSection({ isAdmin }: { isAdmin: boolean }) {
  const { t: tr } = useTranslation();
  const [rows, setRows] = useState<ReturnType<typeof buildSourceHealthRows> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([getIntegrationStatus(), getCollectorActivity()])
      .then(([integrations, activity]) => setRows(buildSourceHealthRows(integrations, activity.sources)))
      .catch(() => setError(tr('app.sourceHealthCouldNotLoaded')))
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
        <span>{tr('app.sourceHealthNeedsConfigurationData')}</span>
      </div>
    );
  }

  const summary = summarizeSourceHealth(rows ?? []);

  return (
    <>
      <div style={s.note}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>{tr('app.readSimplyGreenDeliveringTickets')}</span>
      </div>

      {loading && <Spinner />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && rows && (
        rows.length === 0 ? (
          <EmptyState title={tr('text.noTicketSources')} message={tr('app.thereCurrentlyNoMonitoredTicket')} />
        ) : (
          <Card>
            <CardBody>
              <div style={s.healthGrid}>
                <div style={s.healthTile}><div style={s.cLabel}>Gesund</div><div style={s.cVal}>{summary.healthy}</div></div>
                <div style={s.healthTile}><div style={s.cLabel}>Braucht Blick</div><div style={s.cVal}>{summary.attention}</div></div>
                <div style={s.healthTile}><div style={s.cLabel}>{tr('text.notConfigured')}</div><div style={s.cVal}>{summary.notConfigured}</div></div>
                <div style={s.healthTile}><div style={s.cLabel}>{tr('common.total')}</div><div style={s.cVal}>{summary.total}</div></div>
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
                      <span style={s.healthMeta}>{row.endpoint || tr('app.noEndpointStored')}</span>
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
  const { t: tr } = useTranslation();
  const [rows, setRows] = useState<IntegrationRow[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [rowState, setRowState] = useState<Record<string, IntegrationRowState>>({});

  const runAutoTests = (items: readonly IntegrationRow[]) => {
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
  };

  const load = () => {
    setLoading(true);
    setError('');
    setRowState({});
    getIntegrationStatus()
      .then((list: IntegrationStatus[]) => {
        const nextRows = list.map(buildIntegrationRow);
        setRows(nextRows);
        runAutoTests(nextRows);
      })
      .catch(() => setError(tr('app.integrationStatusCouldNotLoaded')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin]);

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
        <span>{tr('app.integrationStatusConfiguredSourcesEndpoints')}</span>
      </div>
    );
  }

  return (
    <>
      <div style={s.note}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>{tr('app.liveTestsRunAutomaticallyLoad')}</span>
      </div>

      {loading && <Spinner />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && rows && (
        rows.length === 0 ? (
          <EmptyState title={tr('text.noIntegrations')} message={tr('app.noIntegrationsDefined')} />
        ) : (
          <Card>
            <CardBody>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Integration</th>
                      <th style={s.th}>Kategorie</th>
                      <th style={s.th}>{tr('common.configured')}</th>
                      <th style={s.th}>Endpoint</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>{tr('common.connection')}</th>
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
                                title={row.testDisabledReason ?? tr('settings.testConnection')}
                              >
                                {st?.testing ? 'Teste...' : tr('settings.testConnection')}
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
  const { t: tr } = useTranslation();
  const [data, setData] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError('');
    getPipelineStatus()
      .then(setData)
      .catch(() => setError(tr('app.pipelineStatusCouldNotLoaded')))
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
                    <div style={s.counter}><span style={s.cLabel}>{tr('dataplane.intakeTotal')}</span><span style={s.cVal}>{(intake.total ?? 0).toLocaleString('de-DE')}</span></div>
                    <div style={s.counter}><span style={s.cLabel}>Intake abgelehnt</span><span style={s.cVal}>{(intake.rejected ?? 0).toLocaleString('de-DE')}</span></div>
                    <div style={s.counter}><span style={s.cLabel}>Outbox pending</span><span style={s.cVal}>{(outbox.pending ?? 0).toLocaleString('de-DE')}</span></div>
                    <div style={s.counter}><span style={s.cLabel}>Outbox failed</span><span style={{ ...s.cVal, color: (outbox.failed ?? 0) > 0 ? 'var(--danger)' : 'var(--text)' }}>{(outbox.failed ?? 0).toLocaleString('de-DE')}</span></div>
                  </div>
                  {node.collectors.length === 0 ? (
                    <EmptyState title={tr('text.noCollectorsReported')} message={tr('app.nodeHasNoCollectorStates')} />
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={s.table}>
                        <thead>
                          <tr>
                            <th style={s.th}>Kollektor</th>
                            <th style={s.th}>Art</th>
                            <th style={s.th}>Status</th>
                            <th style={{ ...s.th, textAlign: 'right' }}>{tr('dataplane.emitted')}</th>
                            <th style={s.th}>{tr('common.error')}</th>
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
            title={tr('app.noCollectorHubNodeReported')}
            message={tr('app.soonNodeReportsItsStatus')}
          />
        )
      )}
    </>
  );
}

function IngestActivitySection() {
  const { t: tr } = useTranslation();
  const [data, setData] = useState<CollectorActivity | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError('');
    getCollectorActivity()
      .then(setData)
      .catch(() => setError(tr('app.ingestionActivityCouldNotLoaded')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <>
      {loading && <Spinner />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && data && (
        data.sources.length === 0 ? (
          <EmptyState title={tr('app.noIngestionYet')} message={tr('app.noTicketsHaveArrivedFrom')} />
        ) : (
          <Card>
            <CardBody>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>{tr('common.source')}</th>
                      <th style={s.th}>Status</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Letzte 24h</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>{tr('common.total')}</th>
                      <th style={s.th}>Zuletzt gesehen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((src) => {
                      const live = liveness()[sourceLiveness(src)];
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
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const isAdmin = can.admin(user?.role);
  const [nonce, setNonce] = useState(0);

  return (
    <div style={s.page}>
      <SectionHeader
        title="Integrations & Collectors"
        subtitle={tr('app.readOnlyConfiguredIntegrationsRunning')}
        help="integrationen"
        actions={(
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => setNonce((n) => n + 1)}>{tr('common.reload')}</Button>
        )}
      />

      <div style={s.note}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>{tr('settings.integrationsReadOnly')}</span>
      </div>

      <div style={s.section}><Activity size={15} style={{ color: 'var(--accent)' }} /> Source Health</div>
      <SourceHealthSection key={`health-${nonce}`} isAdmin={isAdmin} />

      <div style={s.section}><Plug size={15} style={{ color: 'var(--accent)' }} /> Integrationen</div>
      <IntegrationsSection key={`int-${nonce}`} isAdmin={isAdmin} />

      <div style={s.section}><Antenna size={15} style={{ color: 'var(--accent)' }} /> Live-Kollektoren (Collector-Hub)</div>
      <LiveCollectorsSection key={`live-${nonce}`} />

      <div style={s.section}><Activity size={15} style={{ color: 'var(--accent)' }} /> {tr('collectors.ingestPerSource')}</div>
      <IngestActivitySection key={`act-${nonce}`} />
    </div>
  );
}
