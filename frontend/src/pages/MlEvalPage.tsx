import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { RefreshCw, FlaskConical, Info } from 'lucide-react';
import { SectionHeader, Card, CardBody, Badge, Button, Spinner, ErrorCard, EmptyState } from '../components/ui';
import { ApiError } from '../lib/apiClient';
import {
  getMlEvalStatus,
  previewEvalSnapshot,
  type MlEvalStatus,
  type MlEvalSnapshotMeta,
} from '../features/mlEval/mlEvalApi';
import { explainRoutingPolicy, explainSnapshot } from '../features/mlEval/mlEvalViewModel';

function roleHint(err: unknown): string {
  return err instanceof ApiError && err.status === 403 ? ' (Admin-Rolle noetig)' : '';
}

const s: Record<string, CSSProperties> = {
  page: { padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 },
  note: { display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' },
  cardTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border-soft)' },
  key: { fontSize: 12, color: 'var(--text-dim)' },
  val: { fontSize: 12.5, color: 'var(--text)', fontFamily: 'var(--font-mono)' },
  counts: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pill: { fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: '4px 9px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' },
  explain: { padding: '10px 12px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', marginBottom: 12 },
  explainTitle: { fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 4 },
  explainBody: { fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 },
};

function CountPills({ label, map }: { label: string; map: Record<string, number> }) {
  const entries = Object.entries(map || {});
  if (entries.length === 0) return null;
  return (
    <div>
      <div style={{ ...s.key, marginTop: 12 }}>{label}</div>
      <div style={s.counts}>
        {entries.map(([k, v]) => (
          <span key={k} style={s.pill}>{k}: {v.toLocaleString('de-DE')}</span>
        ))}
      </div>
    </div>
  );
}

export function MlEvalPage() {
  const [status, setStatus] = useState<MlEvalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [snapshot, setSnapshot] = useState<MlEvalSnapshotMeta | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapError, setSnapError] = useState('');

  const loadStatus = useCallback(() => {
    setLoading(true);
    setError('');
    getMlEvalStatus()
      .then(setStatus)
      .catch((err) => setError(`ML-Eval-Status konnte nicht geladen werden${roleHint(err)}.`))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const runSnapshot = useCallback(() => {
    setSnapLoading(true);
    setSnapError('');
    previewEvalSnapshot()
      .then(setSnapshot)
      .catch((err) => setSnapError(`Eval-Snapshot konnte nicht erzeugt werden${roleHint(err)}.`))
      .finally(() => setSnapLoading(false));
  }, []);

  const policy = status?.routingPolicy;
  const policyCard = explainRoutingPolicy(policy);
  const snapshotCard = explainSnapshot(snapshot);

  return (
    <div style={s.page}>
      <SectionHeader
        title="ML-Evaluation"
        subtitle="Read-only - Routing-Policy und Eval-Snapshot (Admin)"
        help="ki-agent"
        actions={(
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={loadStatus} disabled={loading}>
            Neu laden
          </Button>
        )}
      />

      <div style={s.note}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>
          Dies ist die Daten- und Evaluationsschicht fuer Offline-Gold-Eval, kein Modelltraining.
          Auch mit aktiver Policy bleibt alles advisory - es wird nie automatisch gehandelt.
        </span>
      </div>

      {loading && <Spinner />}
      {error && <ErrorCard message={error} />}

      {!loading && !error && policy && (
        <Card>
          <CardBody>
            <div style={s.cardTitle}>Aktive Routing-Policy</div>
            <div style={s.explain}>
              <div style={s.explainTitle}>{policyCard.title}</div>
              <div style={s.explainBody}>{policyCard.body}</div>
            </div>
            {policy.active ? (
              <>
                <div style={s.row}>
                  <span style={s.key}>Status</span>
                  <Badge tone="success" dot>Aktiv</Badge>
                </div>
                <div style={s.row}>
                  <span style={s.key}>Policy</span>
                  <span style={s.val}>{policy.policyName}</span>
                </div>
                <div style={{ ...s.row, borderBottom: 'none' }}>
                  <span style={s.key}>Accept-Threshold</span>
                  <span style={s.val}>&ge;{policy.threshold}</span>
                </div>
              </>
            ) : (
              <div style={s.row}>
                <span style={s.key}>Status</span>
                <Badge tone="muted" dot>Inaktiv ({policy.reason})</Badge>
              </div>
            )}
            {!policy.active && (
              <div style={{ ...s.note, marginTop: 10 }}>
                <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
                <span>
                  Keine Policy aktiv. Per <code>ML_ROUTING_POLICY_PATH</code> eine
                  <code> recommended-routing-policy.json</code> mit <code>status=ready</code> hinterlegen,
                  um die advisory Routing-Empfehlung zu aktivieren.
                </span>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={s.cardTitle}>Eval-Snapshot (Vorschau)</div>
            <Button variant="ghost" size="sm" icon={<FlaskConical size={14} />} onClick={runSnapshot} disabled={snapLoading}>
              Snapshot erzeugen
            </Button>
          </div>

          <div style={s.explain}>
            <div style={s.explainTitle}>{snapshotCard.title}</div>
            <div style={s.explainBody}>{snapshotCard.body}</div>
          </div>

          {snapLoading && <Spinner />}
          {snapError && <ErrorCard message={snapError} />}

          {!snapLoading && !snapError && snapshot && (
            snapshot.returned === 0 ? (
              <EmptyState
                title="Noch keine Eval-Daten"
                message="Es liegen noch keine reviewten KI-Vorschlaege oder geschlossenen Tickets fuer einen Snapshot vor."
              />
            ) : (
              <>
                <div style={s.row}>
                  <span style={s.key}>Records</span>
                  <span style={s.val}>{snapshot.returned.toLocaleString('de-DE')} / {snapshot.exportLimit}</span>
                </div>
                <div style={s.row}>
                  <span style={s.key}>Schema</span>
                  <span style={s.val}>{snapshot.schemaVersion}</span>
                </div>
                <div style={{ ...s.row, borderBottom: 'none' }}>
                  <span style={s.key}>Signatur (SHA-256)</span>
                  <span style={s.val}>{snapshot.recordSha256.slice(0, 16)}...</span>
                </div>
                <CountPills label="Record-Typen" map={snapshot.counts} />
                <CountPills label="Human-Labels" map={snapshot.humanLabelCounts} />
              </>
            )
          )}
        </CardBody>
      </Card>
    </div>
  );
}
