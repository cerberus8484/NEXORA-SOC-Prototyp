import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Timer, ShieldOff, Layers, Crosshair, Users, AlertTriangle, RefreshCw } from 'lucide-react';
import { SectionHeader, StatCard, Card, CardBody, Badge, EmptyState, Spinner, type Tone } from '../components/ui';
import { socMetricsApi, formatDuration, formatRate, type SocMetrics } from '../features/metrics/socMetricsApi';
import { rangeToSince, RANGE_OPTIONS, DEFAULT_RANGE, type MetricsRange } from '../features/metrics/metricsRange';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

/** Extrahiert eine lesbare Fehlermeldung aus unbekanntem Fehler (Audit #4). */
function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return i18n.t('app.unknownErrorWhileLoadingMetrics');
}

export function SocMetricsDashboardPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const allowed = can.apply(user?.role); // engineer/admin (RBAC der Route)

  const [data, setData] = useState<SocMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  // Audit #4: konkreter Fehlergrund statt boolean → im UI anzeigbar.
  const [error, setError] = useState<string | null>(null);
  // Audit #2: aktiver Zeitraum. Default 30 Tage (typischer SOC-Reporting-Horizont).
  const [range, setRange] = useState<MetricsRange>(DEFAULT_RANGE);

  const load = useCallback((selected: MetricsRange): (() => void) => {
    let alive = true;
    setLoading(true);
    setError(null);
    socMetricsApi.get(rangeToSince(selected))
      .then((r) => { if (alive) setData(r.data); })
      .catch((err: unknown) => { if (alive) setError(errorText(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    // Audit #2: Zeitraumwechsel triggert Neuladen.
    return load(range);
  }, [allowed, range, load]);

  if (!allowed) {
    return (
      <div>
        <SectionHeader title="SOC-Metriken" subtitle={tr('app.teamPerformanceDetectionQuality')} />
        <Card><CardBody><EmptyState icon={<ShieldOff size={28} />} title={tr('common.accessDenied')} message={tr('app.socMetricsReservedEngineersAdministrators')} /></CardBody></Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="SOC-Metriken" subtitle={tr('app.teamPerformanceDetectionQualityMttr')} help="soc-metrics"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {data?.meta?.capped && (
              <Badge tone="warning"><AlertTriangle size={12} /> Stichprobe ({data.meta.sampledTickets}/{data.meta.totalTickets})</Badge>
            )}
            <RangePicker value={range} onChange={setRange} disabled={loading} />
            <button
              type="button"
              onClick={() => load(range)}
              disabled={loading}
              aria-label={tr('metrics.refresh')}
              title={tr('common.refresh')}
              style={refreshBtn(loading)}
            >
              <RefreshCw size={13} />{tr('common.refresh2')}</button>
          </div>
        } />

      {error ? (
        <Card><CardBody><EmptyState icon={<Timer size={28} />} title={tr('app.couldNotLoadMetrics')} message={error} /></CardBody></Card>
      ) : loading || !data ? (
        <Card><CardBody><Spinner label={tr('app.calculatingMetrics')} /></CardBody></Card>
      ) : (
        <>
          <div className="grid grid-kpi" style={{ marginBottom: 16 }}>
            <StatCard label="MTTR (Median)" value={formatDuration(data.mttr.medianMs)} tone="accent" icon={<Timer size={18} />} hint={`Ø ${formatDuration(data.mttr.meanMs)} · n=${data.mttr.sampleSize}`} />
            <StatCard label={tr('metrics.fpClassifiedClosed')} value={formatRate(data.fpRate.rate)} tone={fpTone(data.fpRate.rate)} icon={<ShieldOff size={18} />} hint={`${data.fpRate.fpCount}/${data.fpRate.classifiedCount} klassifiziert`} />
            <StatCard label={tr('metrics.open')} value={String(data.byState.OPEN ?? 0)} tone="warning" icon={<Layers size={18} />} hint={tr('metrics.closedCount', { count: data.byState.CLOSED ?? 0 })} />
            <StatCard label={tr('metrics.ticketsTotal')} value={String(data.meta.totalTickets)} tone="accent" icon={<Layers size={18} />} hint={data.meta.capped ? 'Stichprobe' : tr('app.complete')} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Panel title={tr('app.topRulesMostFrequentOffenses')} icon={<Crosshair size={15} style={{ color: 'var(--accent)' }} />}>
              {data.topRules.length === 0 ? <Dim>{tr('text.noData')}</Dim> : (
                <BarList items={data.topRules.map((r) => ({ label: r.key, value: r.count }))} tone="accent" />
              )}
            </Panel>

            <Panel title="Last pro Analyst" icon={<Users size={15} style={{ color: 'var(--accent)' }} />}>
              {data.analystLoad.length === 0 ? <Dim>{tr('text.noAssignments')}</Dim> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Analyst', tr('common.total'), 'Offen'].map((h) => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.analystLoad.map((a) => (
                      <tr key={a.analyst}>
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{a.analyst === '_unassigned' ? tr('app.unassigned') : a.analyst}</td>
                        <td style={TD}>{a.total}</td>
                        <td style={TD}><Badge tone={a.open > 0 ? 'warning' : 'muted'}>{a.open}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title={tr('text.status')} icon={<Layers size={15} style={{ color: 'var(--text-muted)' }} />}>
              <BarList items={Object.entries(data.byStatus).map(([k, v]) => ({ label: k, value: v }))} tone="muted" />
            </Panel>

            <Panel title={tr('text.state')} icon={<Layers size={15} style={{ color: 'var(--text-muted)' }} />}>
              <BarList items={Object.entries(data.byState).map(([k, v]) => ({ label: k, value: v }))} tone="muted" />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

const fpTone = (r: number | null): Tone => r == null ? 'muted' : r > 0.3 ? 'danger' : r > 0.1 ? 'warning' : 'success';

// Audit #2 — Zeitraum-Umschalter (7d / 30d / 90d / Alle). Reine Präsentation:
// meldet den gewählten Zeitraum nach oben, hält keinen eigenen Zustand.
interface RangePickerProps {
  value: MetricsRange;
  onChange: (r: MetricsRange) => void;
  disabled?: boolean;
}

function RangePicker({ value, onChange, disabled }: RangePickerProps) {
  return (
    <div role="group" aria-label="Zeitraum" style={{ display: 'inline-flex', gap: 2, background: 'var(--bg-input)', borderRadius: 6, padding: 2 }}>
      {RANGE_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            disabled={disabled}
            aria-pressed={active}
            style={{
              border: 'none',
              cursor: disabled ? 'default' : 'pointer',
              borderRadius: 5,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 600,
              color: active ? 'var(--bg-primary)' : 'var(--text-muted)',
              background: active ? 'var(--accent)' : 'transparent',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const refreshBtn = (disabled: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  border: '1px solid var(--border-soft)',
  background: 'var(--bg-input)',
  color: 'var(--text-muted)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>{icon}{title}</div>
        {children}
      </CardBody>
    </Card>
  );
}

function BarList({ items, tone }: { items: { label: string; value: number }[]; tone: Tone }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const color = tone === 'accent' ? 'var(--accent)' : 'var(--text-dim)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((i) => (
        <div key={i.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: '0 0 45%', fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.label}</span>
          <span style={{ flex: 1, height: 8, background: 'var(--bg-input)', borderRadius: 4, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${(i.value / max) * 100}%`, background: color }} />
          </span>
          <span style={{ flex: '0 0 32px', textAlign: 'right', fontSize: 12, color: 'var(--text)' }}>{i.value}</span>
        </div>
      ))}
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{children}</span>;
}

const TH: CSSProperties = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-dim)', padding: '6px 8px', fontWeight: 700, borderBottom: '1px solid var(--border-soft)' };
const TD: CSSProperties = { padding: '6px 8px', fontSize: 12.5, color: 'var(--text)', borderBottom: '1px solid var(--border-soft)' };
