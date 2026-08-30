import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Activity, AlertCircle, Bot, CheckCircle, Info, Mail,
  RefreshCw, Search, Server, Shield, Ticket, WifiOff, Zap,
} from 'lucide-react';
import {
  Badge, Button, Card, CardBody, CardHeader,
  Donut, DonutLegend, EmptyState, Input, Spinner,
} from '../../components/ui';
import type { DonutSegment } from '../../components/ui';
import {
  getStatus, testIntegration,
  buildStatusCounts, filterIntegrations, paginate, stripHostFromEndpoint,
} from './integrationsApi';
import type {
  IntegrationStatus, IntegrationCategory, IntegrationStatusValue, TestResult,
} from './integrationsApi';
import { deriveDisplayedStatus } from '../integrations/integrationsView';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

// ── Konstanten ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 6;

const CATEGORY_ICON: Record<IntegrationCategory, ReactNode> = {
  siem:         <Server size={16} />,
  ticketing:    <Ticket size={16} />,
  threat_intel: <Shield size={16} />,
  llm:          <Bot size={16} />,
  email:        <Mail size={16} />,
};

const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  siem:         'SIEM',
  ticketing:    'Ticketing',
  threat_intel: 'Threat Intel',
  llm:          'KI / LLM',
  email:        'E-Mail',
};

const STATUS_TONE: Record<IntegrationStatusValue, 'success' | 'accent' | 'muted'> = {
  connected:      'success',
  configured:     'accent',
  not_configured: 'muted',
};

const statusLabel = (): Record<IntegrationStatusValue, string> => ({
  connected:      i18n.t('settings.connectedLabel'),
  configured:     i18n.t('common.configured'),
  not_configured: i18n.t('text.notConfigured'),
});

type FilterStatus = IntegrationStatusValue | 'all';

// ── Haupt-Komponente ──────────────────────────────────────────────────────────

export function IntegrationsPanel() {
  const { t: tr } = useTranslation();
  const [items, setItems]     = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [query, setQuery]     = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [page, setPage]       = useState(1);

  const [testState, setTestState]     = useState<Record<string, 'idle' | 'testing' | 'done'>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getStatus()
      .then((data) => { if (alive) { setItems(data); setLoading(false); } })
      .catch(() => { if (alive) { setError(i18n.t('settings.integrationsCouldNotLoaded')); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  // Filter-Wechsel → Seite 1
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  useEffect(() => {
    const ollama = items.find((item) => item.id === 'ollama');
    if (!ollama || !ollama.configured || !ollama.testable) return;
    if (testState.ollama === 'testing' || testResults.ollama) return;
    void handleTest('ollama');
  }, [items, testResults, testState]);

  const counts   = buildStatusCounts(items);
  const filtered = filterIntegrations(items, { query, statusFilter });
  const paged    = paginate(filtered, page, PAGE_SIZE);

  const donutSegments: DonutSegment[] = [
    { label: tr('settings.connectedLabel'),          value: counts.connected,      color: 'var(--success)' },
    { label: tr('common.configured'),       value: counts.configured,     color: 'var(--accent)' },
    { label: tr('text.notConfigured'), value: counts.not_configured, color: 'var(--border-soft)' },
  ];

  const handleTest = async (id: string) => {
    setTestState((s) => ({ ...s, [id]: 'testing' }));
    try {
      const result = await testIntegration(id);
      setTestResults((r) => ({ ...r, [id]: result }));
    } catch {
      setTestResults((r) => ({
        ...r,
        [id]: { reachable: false, testedAt: new Date().toISOString(), message: tr('common.requestFailed') },
      }));
    } finally {
      setTestState((s) => ({ ...s, [id]: 'done' }));
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardBody>
          <EmptyState icon={<AlertCircle size={28} />} title={tr('common.error')} message={error} />
        </CardBody>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Zeile 1: Donut-Übersicht + Gesundheitskacheln */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
        <OverviewDonut counts={counts} segments={donutSegments} />
        <HealthSummary counts={counts} items={items} />
      </div>

      {/* Zeile 2: Karten-Grid */}
      <Card>
        <CardHeader
          title="Integrationen"
          actions={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span
                title={tr('settings.pageShowsEffectiveStatusMaintenance')}
                style={{ cursor: 'help', color: 'var(--text-dim)' }}
              >
                <Info size={14} />
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled
                title={tr('settings.overviewOnlyConfigurationHappensIntegration')}
              >{tr('settings.goToConfiguration')}</Button>
            </div>
          }
        />
        <CardBody>
          {/* Filter-Zeile */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
              <Search
                size={13}
                style={{
                  position: 'absolute', left: 10,
                  top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text-dim)', pointerEvents: 'none',
                }}
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr('settings.searchIntegrationPlaceholder')}
                style={{ paddingLeft: 30 }}
              />
            </div>
            <StatusFilterBar value={statusFilter} onChange={setStatusFilter} counts={counts} />
          </div>

          {/* Grid */}
          {paged.items.length === 0 ? (
            <EmptyState title={tr('text.noMatches')} message={tr('settings.adjustFilterSearch')} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
              {paged.items.map((item) => (
                <IntegrationCard
                  key={item.id}
                  item={item}
                  testState={testState[item.id] ?? 'idle'}
                  testResult={testResults[item.id]}
                  onTest={handleTest}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {paged.totalPages > 1 && (
            <PaginationBar page={page} totalPages={paged.totalPages} onChange={setPage} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ── Übersicht-Donut ───────────────────────────────────────────────────────────

interface OverviewDonutProps {
  counts:   ReturnType<typeof buildStatusCounts>;
  segments: DonutSegment[];
}

function OverviewDonut({ counts, segments }: OverviewDonutProps) {
  const { t: tr } = useTranslation();
  return (
    <Card>
      <CardHeader title={tr('settings.integrationOverview')} />
      <CardBody>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Donut
            segments={segments}
            size={110}
            thickness={14}
            centerTop={counts.total}
            centerBottom="gesamt"
          />
          <DonutLegend segments={segments} total={counts.total} />
        </div>
      </CardBody>
    </Card>
  );
}

// ── Gesundheits-Kacheln ───────────────────────────────────────────────────────

interface HealthSummaryProps {
  counts: ReturnType<typeof buildStatusCounts>;
  items:  IntegrationStatus[];
}

function HealthSummary({ counts, items }: HealthSummaryProps) {
  const { t: tr } = useTranslation();
  const ok = counts.connected + counts.configured;
  const configuredPct = counts.total > 0 ? Math.round((ok / counts.total) * 100) : 0;

  return (
    <Card>
      <CardHeader title={tr('settings.integrationHealth')} />
      <CardBody>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <HealthTile icon={<CheckCircle size={18} />} color="var(--success)"  value={counts.connected}      label={tr('settings.connectedLabel')} />
          <HealthTile icon={<Activity size={18} />}    color="var(--accent)"   value={counts.configured}     label={tr('common.configured')} />
          <HealthTile icon={<WifiOff size={18} />}     color="var(--text-dim)" value={counts.not_configured} label="Ausstehend" />
          <HealthTile icon={<Zap size={18} />}         color="var(--warning)"  value={`${configuredPct}%`}   label="Rate" />
        </div>

        {/* Kategorie-Aufschlüsselung */}
        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(['siem', 'ticketing', 'threat_intel', 'llm', 'email'] as IntegrationCategory[]).map((cat) => {
            const catItems = items.filter((i) => i.category === cat);
            const catOk = catItems.filter((i) => i.status !== 'not_configured').length;
            return (
              <div key={cat} style={s.catPill}>
                <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center' }}>
                  {CATEGORY_ICON[cat]}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
                  {CATEGORY_LABEL[cat]}
                </span>
                <span style={{
                  fontSize: 11,
                  color: catOk > 0 ? 'var(--success)' : 'var(--text-dim)',
                  marginLeft: 6,
                  fontFamily: 'var(--font-mono)',
                }}>
                  {catOk}/{catItems.length}
                </span>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

interface HealthTileProps {
  icon:  ReactNode;
  color: string;
  value: string | number;
  label: string;
}

function HealthTile({ icon, color, value, label }: HealthTileProps) {
  return (
    <div style={s.healthTile}>
      <div style={{ color, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

// ── Integration-Karte ─────────────────────────────────────────────────────────

interface IntegrationCardProps {
  item:        IntegrationStatus;
  testState:   'idle' | 'testing' | 'done';
  testResult?: TestResult;
  onTest:      (id: string) => void;
}

function IntegrationCard({ item, testState, testResult, onTest }: IntegrationCardProps) {
  const { t: tr } = useTranslation();
  const displayHost = stripHostFromEndpoint(item.endpoint);
  const displayStatus = deriveDisplayedStatus(item.status, testResult);

  return (
    <div style={s.card}>
      {/* Header: Icon + Name + Status-Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={s.iconBox}>
          {CATEGORY_ICON[item.category]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {item.name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {CATEGORY_LABEL[item.category]}
          </div>
        </div>
        <Badge tone={STATUS_TONE[displayStatus]}>{statusLabel()[displayStatus]}</Badge>
      </div>

      {/* Endpunkt */}
      <div style={s.meta}>
        <span style={s.metaLabel}>Endpunkt</span>
        <span style={{ ...s.metaValue, fontFamily: displayHost ? 'var(--font-mono)' : undefined }}>
          {displayHost || '—'}
        </span>
      </div>

      {/* Letzter Test-Ergebnis */}
      {testResult && (
        <div style={s.meta}>
          <span style={s.metaLabel}>Test</span>
          <span style={{
            ...s.metaValue,
            color: testResult.reason === 'model_missing' || testResult.modelAvailable === false
              ? 'var(--warning)'
              : testResult.reachable ? 'var(--success)' : 'var(--danger)',
            fontSize: 11,
          }}>
            {testResult.reason === 'model_missing' || testResult.modelAvailable === false
              ? tr('settings.modelMissing')
              : testResult.reachable ? 'Erreichbar' : tr('text.unreachable')}
            {testResult.message ? ` — ${testResult.message}` : ''}
          </span>
        </div>
      )}

      {/* Aktionen */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {item.testable ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={testState === 'testing'}
            icon={testState === 'testing'
              ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
              : <Activity size={12} />
            }
            onClick={() => onTest(item.id)}
          >
            {testState === 'testing' ? 'Teste …' : tr('settings.testConnection')}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled
            title={tr('settings.noLiveTestAvailableCard')}
            icon={<Activity size={12} />}
          >
            Kein Live-Test
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          disabled
          title={tr('settings.notConfiguredHereUseIntegration')}
        >{tr('common.configure')}</Button>
      </div>
    </div>
  );
}

// ── Status-Filter-Bar ─────────────────────────────────────────────────────────

interface StatusFilterBarProps {
  value:    FilterStatus;
  onChange: (v: FilterStatus) => void;
  counts:   ReturnType<typeof buildStatusCounts>;
}

function StatusFilterBar({ value, onChange, counts }: StatusFilterBarProps) {
  const { t: tr } = useTranslation();
  const options: { label: string; value: FilterStatus; count: number }[] = [
    { label: tr('common.all'),               value: 'all',            count: counts.total },
    { label: tr('settings.connectedLabel'),          value: 'connected',      count: counts.connected },
    { label: tr('common.configured'),       value: 'configured',     count: counts.configured },
    { label: tr('text.notConfigured'), value: 'not_configured', count: counts.not_configured },
  ];

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          style={{
            padding: '4px 10px', fontSize: 11.5, borderRadius: 'var(--radius-sm)',
            border: '1px solid',
            borderColor: value === opt.value ? 'var(--accent)' : 'var(--border-soft)',
            background:  value === opt.value ? 'var(--accent-soft)' : 'transparent',
            color:       value === opt.value ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {opt.label} <span style={{ opacity: 0.7 }}>({opt.count})</span>
        </button>
      ))}
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

interface PaginationBarProps {
  page:       number;
  totalPages: number;
  onChange:   (p: number) => void;
}

function PaginationBar({ page, totalPages, onChange }: PaginationBarProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16 }}>
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        &laquo;
      </Button>
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          style={{
            width: 28, height: 28, borderRadius: 'var(--radius-sm)', border: '1px solid',
            borderColor: p === page ? 'var(--accent)' : 'var(--border-soft)',
            background:  p === page ? 'var(--accent-soft)' : 'transparent',
            color:       p === page ? 'var(--accent)' : 'var(--text-muted)',
            fontSize: 12, cursor: 'pointer',
          }}
        >
          {p}
        </button>
      ))}
      <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        &raquo;
      </Button>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  card: {
    background:    'var(--bg-card-soft)',
    border:        '1px solid var(--border-soft)',
    borderRadius:  'var(--radius)',
    padding:       14,
    display:       'flex',
    flexDirection: 'column',
  },
  iconBox: {
    width:          34,
    height:         34,
    borderRadius:   'var(--radius-sm)',
    background:     'var(--bg-input)',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    color:          'var(--accent)',
    flexShrink:     0,
  },
  meta: {
    display:    'flex',
    alignItems: 'baseline',
    gap:        6,
    marginTop:  6,
  },
  metaLabel: {
    fontSize:      10,
    color:         'var(--text-dim)',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    whiteSpace:    'nowrap' as const,
    flexShrink:    0,
  },
  metaValue: {
    fontSize:     12,
    color:        'var(--text-muted)',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  healthTile: {
    background:   'var(--bg-card-soft)',
    border:       '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    padding:      '12px 10px',
    textAlign:    'center' as const,
  },
  catPill: {
    display:      'flex',
    alignItems:   'center',
    padding:      '3px 10px',
    borderRadius: 20,
    background:   'var(--bg-input)',
    border:       '1px solid var(--border-soft)',
  },
};
