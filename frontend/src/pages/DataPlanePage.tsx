import { useEffect, useState, type CSSProperties } from 'react';
import { RefreshCw, Info, Antenna, Inbox, Send, AlertTriangle } from 'lucide-react';
import { SectionHeader, Card, CardBody, CardHeader, Badge, Button, Spinner, ErrorCard, EmptyState } from '../components/ui';
import { useTranslation } from 'react-i18next';
import {
  getPipelineStatus, type PipelineStatus, type PipelineNode,
} from '../features/dataplane/dataplaneApi';
import {
  healthTone, healthLabel, collectorStatusTone, collectorStatusLabel, formatAge, formatTimestamp,
} from '../features/dataplane/dataplaneView';

const s: Record<string, CSSProperties> = {
  page:   { padding: '24px 28px' },
  note:   { display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', marginBottom: 16 },
  kpis:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 },
  kpi:    { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-card)' },
  kpiIcon:{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 'var(--radius-sm)', flexShrink: 0 },
  kpiVal: { fontSize: 21, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)', lineHeight: 1.1 },
  kpiLbl: { fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginTop: 2 },
  nodeHead:{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  nodeId: { fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13.5, color: 'var(--text)' },
  meta:   { fontSize: 11.5, color: 'var(--text-dim)' },
  counters:{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14, fontSize: 12 },
  counter:{ display: 'flex', flexDirection: 'column', gap: 2 },
  cLabel: { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 },
  cVal:   { fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)' },
  table:  { width: '100%', borderCollapse: 'collapse' },
  th:     { textAlign: 'left', fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, padding: '0 10px 8px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' },
  td:     { fontSize: 12.5, color: 'var(--text)', padding: '9px 10px', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'middle' },
  num:    { fontFamily: 'var(--font-mono)', textAlign: 'right' },
  err:    { fontSize: 11.5, color: 'var(--danger)', fontFamily: 'var(--font-mono)' },
};

interface KpiProps { icon: React.ReactNode; tone: string; value: number | string; label: string; }
function Kpi({ icon, tone, value, label }: KpiProps) {
  return (
    <div style={s.kpi}>
      <div style={{ ...s.kpiIcon, background: `var(--${tone}-soft)`, color: `var(--${tone})` }}>{icon}</div>
      <div>
        <div style={s.kpiVal}>{value}</div>
        <div style={s.kpiLbl}>{label}</div>
      </div>
    </div>
  );
}

function NodeCard({ node }: { node: PipelineNode }) {
  const { t: tr } = useTranslation();
  const intake = node.intake || {};
  const outbox = node.outbox || {};
  return (
    <Card style={{ marginBottom: 14 }}>
      <CardHeader
        title={
          <span style={s.nodeHead}>
            <span style={s.nodeId}>{node.nodeId}</span>
            <Badge tone={healthTone(node.health)} dot>{healthLabel(node.health)}</Badge>
            <span style={s.meta}>{formatAge(node.ageMs)} · gemeldet {formatTimestamp(node.reportedAt)}</span>
          </span>
        }
      />
      <CardBody>
        <div style={s.counters}>
          <div style={s.counter}><span style={s.cLabel}>{tr('dataplane.intakeTotal')}</span><span style={s.cVal}>{(intake.total ?? 0).toLocaleString('de-DE')}</span></div>
          <div style={s.counter}><span style={s.cLabel}>Intake abgelehnt</span><span style={s.cVal}>{(intake.rejected ?? 0).toLocaleString('de-DE')}</span></div>
          <div style={s.counter}><span style={s.cLabel}>Outbox pending</span><span style={s.cVal}>{(outbox.pending ?? 0).toLocaleString('de-DE')}</span></div>
          <div style={s.counter}><span style={s.cLabel}>Outbox retrying</span><span style={s.cVal}>{(outbox.retrying ?? 0).toLocaleString('de-DE')}</span></div>
          <div style={s.counter}><span style={s.cLabel}>Outbox failed</span><span style={{ ...s.cVal, color: (outbox.failed ?? 0) > 0 ? 'var(--danger)' : 'var(--text)' }}>{(outbox.failed ?? 0).toLocaleString('de-DE')}</span></div>
        </div>

        {node.collectors.length === 0 ? (
          <EmptyState title={tr('text.noCollectorsReported')} message={tr('app.nodeHasNoCollectorStates2')} />
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
                {node.collectors.map((c) => (
                  <tr key={c.name}>
                    <td style={{ ...s.td, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{c.name}</td>
                    <td style={{ ...s.td, color: 'var(--text-muted)' }}>{c.kind || '—'}</td>
                    <td style={s.td}><Badge tone={collectorStatusTone(c.status)} dot>{collectorStatusLabel(c.status)}</Badge></td>
                    <td style={{ ...s.td, ...s.num }}>{(c.emitted ?? 0).toLocaleString('de-DE')}</td>
                    <td style={{ ...s.td }}>{c.error ? <span style={s.err}>{c.error}</span> : <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Data-Plane — Live-Status der Korrelations-Pipeline (Collector-Hub + Intake/Outbox)
 * über die Hub↔Backend-Status-Brücke. fail-honest: ohne frischen Snapshot wird das
 * ehrlich gezeigt (kein erfundener Prozessstatus).
 */
export function DataPlanePage() {
  const { t: tr } = useTranslation();
  const [data, setData] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    getPipelineStatus()
      .then(setData)
      .catch(() => setError(tr('app.pipelineStatusCouldNotLoaded')))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const agg = data?.aggregate;

  return (
    <div style={s.page}>
      <SectionHeader
        title="Data-Plane"
        help="dataplane"
        subtitle={tr('app.readOnlyLiveStatusCorrelation')}
        actions={
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={load} disabled={loading}>{tr('common.reload')}</Button>
        }
      />

      {data && !data.available && (
        <div style={s.note}>
          <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
          <span>
            Kein frischer Status-Snapshot von einem Data-Plane-Knoten (Schwelle {Math.round((data.staleAfterMs || 0) / 1000)}s).
            Der Push-Job des Knotens meldet periodisch an <code>POST /dataplane/status</code> — bis dahin wird hier nichts erfunden.
          </span>
        </div>
      )}

      {loading && <Spinner />}
      {error && <ErrorCard message={error} />}

      {!loading && !error && data && (
        agg && agg.nodes > 0 ? (
          <>
            <div style={s.kpis}>
              <Kpi icon={<Antenna size={18} />} tone="accent" value={`${agg.freshNodes}/${agg.nodes}`} label="Knoten frisch" />
              <Kpi icon={<Antenna size={18} />} tone="success" value={agg.collectorsRunning} label="Kollektoren laufend" />
              <Kpi icon={<Inbox size={18} />} tone="purple" value={agg.intake.total.toLocaleString('de-DE')} label={tr('dataplane.intakeTotal')} />
              <Kpi icon={<Send size={18} />} tone="warning" value={agg.outbox.pending.toLocaleString('de-DE')} label="Outbox pending" />
              <Kpi icon={<AlertTriangle size={18} />} tone={agg.collectorsFailed + agg.outbox.failed > 0 ? 'danger' : 'muted'} value={agg.collectorsFailed + agg.outbox.failed} label={tr('app.errorsCollectorOutbox')} />
            </div>

            {data.nodes.map((node) => <NodeCard key={node.nodeId} node={node} />)}
          </>
        ) : (
          <EmptyState
            title={tr('app.noDataPlaneNodeReported')}
            message={tr('app.soonNodeReportsItsStatus2')}
          />
        )
      )}
    </div>
  );
}
