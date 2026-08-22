import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, UserCheck, Activity, ArrowRight, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Spinner } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/rbac';
import { agentApi, type Guardrails, type AgentMetricsSnapshot } from '../aiAgent/agentApi';
import { formatLatency, formatCostUsd, formatTokens, errorRatePct } from './kiGuardrailsModel';

/**
 * KI-Settings Welle 2: read-only Transparenz der aktiven Safety-Guardrails
 * (Evidence-/Benign-Floor, Anti-Halluzination), Confidence-Schwellen,
 * Human-in-the-Loop-Status (+ Link zu Autonomy-Policies) sowie Nutzungs-/
 * Latenz-Metriken (engineer/admin). Die Floors sind bewusst NICHT abschaltbar —
 * sie laufen fix auf der Pipeline; hier wird nur ihr echter Zustand gezeigt.
 */
export function KiGuardrailsMetrics() {
  const { user } = useAuth();
  const canMetrics = can.apply(user?.role); // engineer/admin — spiegelt Route-RBAC von /agent/metrics

  const [g, setG] = useState<Guardrails | null>(null);
  const [m, setM] = useState<AgentMetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    const tasks: Promise<unknown>[] = [
      agentApi.guardrails().then((r) => { if (alive) setG(r.data); }),
    ];
    if (canMetrics) {
      tasks.push(agentApi.metrics().then((r) => { if (alive) setM(r.data); }).catch(() => { /* Metriken sind optional */ }));
    }
    Promise.all(tasks)
      .catch(() => { if (alive) setErr('Guardrails konnten nicht geladen werden.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [canMetrics]);

  if (loading) {
    return <Card><CardHeader title="4. Guardrails, Confidence & Nutzung" /><CardBody><Spinner /></CardBody></Card>;
  }

  return (
    <Card>
      <CardHeader
        title="4. Guardrails, Confidence & Nutzung"
        actions={<span style={s.hint}><ShieldCheck size={12} /> read-only</span>}
      />
      <CardBody>
        {err && <div style={s.err}><AlertTriangle size={13} /> {err}</div>}

        {g && (
          <>
            {/* Guardrails — aktive Safety-Floors (fix, nicht abschaltbar) */}
            <div style={s.section}>Guardrails (aktiv, deterministisch)</div>
            <Row
              label="Evidence-Floor (VirusTotal)"
              value={`≥ ${g.evidenceFloor.confirmedVtMin} Engines → bestätigt · ≥ ${g.evidenceFloor.suspiciousVtMin} → verdächtig`}
              active={g.evidenceFloor.enabled}
            />
            <Row
              label="Benign-Floor (Scanner-Betriebsfehler)"
              value="AV-Selbstfehler ohne Fund → False Positive"
              active={g.benignFloor.enabled}
            />
            <Row
              label="Anti-Halluzination"
              value="Nur belegte confirmed_facts · FP-Konsistenz-Guard"
              active={g.antiHallucination.enabled}
            />
            <div style={s.note}>
              Diese Floors überstimmen ein zu mildes/zu strenges Modell deterministisch und sind bewusst
              fest verdrahtet (nicht abschaltbar). Die KI bleibt Erzähler, die Evidenz entscheidet.
            </div>

            {/* Confidence-Schwellen */}
            <div style={s.section}>Confidence-Schwellen (Mindest-Konfidenz beim Override)</div>
            <Row label="Bestätigter Incident (VT-Floor)" value={g.evidenceFloor.confirmedConfidenceFloor.toFixed(2)} />
            <Row label="Verdächtig (VT-Floor)" value={g.evidenceFloor.suspiciousConfidenceFloor.toFixed(2)} />
            <Row label="False Positive (Benign-Floor)" value={g.benignFloor.confidenceFloor.toFixed(2)} />

            {/* Human-in-the-Loop */}
            <div style={s.section}><UserCheck size={12} style={{ marginRight: 4 }} /> Human-in-the-Loop</div>
            <Row
              label="Freigabepflicht aller KI-Vorschläge"
              value="pending → approve/reject — der Mensch entscheidet"
              active={g.humanInTheLoop.allSuggestionsRequireApproval}
            />
            <Row
              label="Gestufte Autonomie"
              value={g.humanInTheLoop.autonomyEnabled ? 'aktiviert (richtliniengesteuert)' : 'aus (default) — alles freigabepflichtig'}
              active={g.humanInTheLoop.autonomyEnabled}
              neutral={!g.humanInTheLoop.autonomyEnabled}
            />
            <Link to="/autonomy-policies" style={s.link}>
              Autonomie-Richtlinien verwalten <ArrowRight size={12} />
            </Link>
          </>
        )}

        {/* Metrik-Sidebar — Nutzung & Latenz */}
        <div style={s.section}><Activity size={12} style={{ marginRight: 4 }} /> Nutzung & Latenz (seit Start)</div>
        {!canMetrics && (
          <div style={s.note}>Nutzungs- und Kostenmetriken sind nur für Engineer/Admin sichtbar.</div>
        )}
        {canMetrics && !m && (
          <div style={s.note}>Noch keine Metriken — sobald KI-Vorschläge laufen, erscheinen hier Calls, Latenz und Schätzungen.</div>
        )}
        {canMetrics && m && (
          <>
            <div style={s.metricGrid}>
              <Metric label="KI-Calls" value={String(m.totals.calls)} />
              <Metric label="Ø Latenz" value={formatLatency(m.totals.avgLatencyMs)} />
              <Metric label="Fehlerrate" value={`${errorRatePct(m.totals.calls, m.totals.errors)} %`} />
              <Metric label="Tokens (geschätzt)" value={formatTokens(m.totals.estPromptTokens + m.totals.estCompletionTokens)} />
              <Metric label="Kosten (geschätzt)" value={formatCostUsd(m.totals.estCostUsd)} />
            </div>
            {m.byProvider.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {m.byProvider.map((p) => (
                  <Row
                    key={`${p.provider}:${p.model}`}
                    label={`${p.provider} · ${p.model}`}
                    value={`${p.calls} Calls · Ø ${formatLatency(p.avgLatencyMs)} · ~${formatTokens(p.estTokens)} Tok · ~${formatCostUsd(p.estCostUsd)}`}
                  />
                ))}
              </div>
            )}
            {m.estimated && (
              <div style={s.estimateBadge}>
                <Badge tone="muted">Schätzung</Badge>
                <span>Tokens &amp; Kosten sind Schätzwerte (≈ Zeichen/4), nicht abrechnungsgenau. Lokales Ollama = $0.</span>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Row({ label, value, active, neutral }: { label: string; value: ReactNode; active?: boolean; neutral?: boolean }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      <span style={s.rowRight}>
        <span style={s.rowValue}>{value}</span>
        {active !== undefined && (
          <Badge tone={active ? (neutral ? 'muted' : 'success') : 'muted'}>{active ? 'Aktiv' : 'Aus'}</Badge>
        )}
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.metricCell}>
      <div style={s.metricValue}>{value}</div>
      <div style={s.metricLabel}>{label}</div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  hint:        { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)' },
  section:     { display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border-soft)', paddingBottom: 6, marginTop: 16, marginBottom: 8 },
  row:         { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '5px 0', fontSize: 12.5, borderBottom: '1px solid var(--border-soft)' },
  rowLabel:    { color: 'var(--text)' },
  rowRight:    { display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  rowValue:    { color: 'var(--text-dim)', fontSize: 11.5, textAlign: 'right' },
  note:        { fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 },
  link:        { display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 10, fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 },
  err:         { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--danger)', fontSize: 12, marginBottom: 8 },
  metricGrid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 },
  metricCell:  { background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' },
  metricValue: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  metricLabel: { fontSize: 10.5, color: 'var(--text-dim)', marginTop: 2 },
  estimateBadge: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 10.5, color: 'var(--text-dim)' },
};
