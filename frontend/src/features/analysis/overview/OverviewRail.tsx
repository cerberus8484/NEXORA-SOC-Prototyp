import { Bot, Crosshair, Activity, Globe, Archive, Check, ArrowRight, ShieldCheck } from 'lucide-react';
import { Badge, Button, type Tone } from '../../../components/ui';
import { Card } from '../../../components/ui';
import type { ParsedEvidence, ThreatIntelResult } from '../analysisModel';
import type { RiskModel, SummaryBullet } from '../deckModel';
import { tiSourceBadge } from '../tiSourceBadge';
import { useTranslation } from 'react-i18next';

const head: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' };
const body: React.CSSProperties = { padding: '12px 14px' };
function RailCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <Card style={{ padding: 0, overflow: 'hidden' }}><div style={head}>{icon}{title}</div><div style={body}>{children}</div></Card>;
}

export interface RailHandlers {
  canAct: boolean;
  onSaveSnapshot: () => void;
  snapshotSaved: boolean;
  onEnrichTi: () => void;
  tiBusy: boolean;
  onOpenThreatIntel?: () => void;
  /** Legt ein verknüpftes Follow-up-Ticket an (parentId). Optional — sonst Button inert. */
  onCreateFollowUp?: () => void;
  followUpBusy?: boolean;
  /** Hebt die Ticket-Priorität auf „wichtig" (≥ high). Optional — sonst Button inert. */
  onMarkImportant?: () => void;
  isImportant?: boolean;
}

export function OverviewDecisionRail({ bullets, ev, risk, tiResult, confidence, h }: {
  bullets: SummaryBullet[]; ev: ParsedEvidence; risk: RiskModel | null;
  tiResult: ThreatIntelResult | null; confidence?: number | null; h: RailHandlers;
}) {
  const { t: tr } = useTranslation();
  const mitre = ev.metadata.mitreTechnique || ev.metadata.mitreTactic;
  const tactic = ev.metadata.mitreTactic;
  const confLabel = typeof confidence === 'number' ? (confidence >= 80 ? 'High' : confidence >= 50 ? 'Medium' : 'Low') : undefined;
  const repTone = (r?: string): Tone => r === 'malicious' ? 'danger' : r === 'suspicious' ? 'warning' : r === 'clean' || r === 'harmless' ? 'success' : 'muted';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Analyst Summary — Zusammenfassung + MITRE-/Confidence-Chips */}
      <RailCard title="Analyst Summary" icon={<Bot size={15} style={{ color: 'var(--accent)' }} />}>
        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.45 }}>
          {bullets[0]?.text || tr('analysis.noEvidenceBackedSummaryAvailable')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
            <Crosshair size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>MITRE{tactic ? `: ${tactic}` : ''}</span>
            {mitre ? <Badge tone="accent">{mitre}</Badge> : <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>—</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
            <ShieldCheck size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Confidence{confLabel ? `: ${confLabel}` : ''}</span>
            <span style={{ flex: 1, height: 5, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden', marginLeft: 4 }}>
              <span style={{ display: 'block', width: `${typeof confidence === 'number' ? confidence : 0}%`, height: '100%', background: 'var(--success)' }} />
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', width: 34, textAlign: 'right' }}>{typeof confidence === 'number' ? `${confidence}%` : '—'}</span>
          </div>
        </div>
      </RailCard>

      {/* Risk & Impact — nur belegte Werte */}
      <RailCard title="Risk & Impact" icon={<Activity size={15} style={{ color: 'var(--accent)' }} />}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ position: 'relative', width: 62, height: 62, borderRadius: '50%', border: '4px solid var(--danger)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{risk?.score ?? '—'}</span>
            <span style={{ position: 'absolute', bottom: 6, fontSize: 8, color: 'var(--text-dim)' }}>/100</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <MetricBar label="Business Impact" value={risk ? (risk.businessImpact === 'High' ? 8 : risk.businessImpact === 'Medium' ? 5 : 2) : null} />
            <MetricBar label="Severity" value={risk?.severity ?? null} />
            <MetricBar label="Criticality" value={risk?.magnitude ?? null} />
            <MetricBar label="Relevance" value={risk?.relevance ?? null} />
          </div>
        </div>
      </RailCard>

      {/* Threat Intel — nur echtes Enrichment */}
      <RailCard title="Threat Intel" icon={<Globe size={15} style={{ color: 'var(--accent)' }} />}>
        {tiResult ? (
          <>
            <RailRow label="Destination IP" value={<span className="mono">{tiResult.indicatorValue}</span>} />
            <RailRow label="Confidence" value={`${tiResult.confidence}%`} />
            <RailRow label="Source" value={(() => { const b = tiSourceBadge(tiResult.source); return <Badge tone={b.tone}>{b.label}</Badge>; })()} />
            <RailRow label="Reputation" value={<Badge tone={repTone(tiResult.verdict)}>{tiResult.verdict}</Badge>} />
            <button type="button" onClick={h.onOpenThreatIntel} style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, fontWeight: 600, padding: 0 }}>View details <ArrowRight size={13} /></button>
          </>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>{tr('text.noThreatIntelEnrichmentAvailable')}</div>
            <Button variant="ghost" size="sm" disabled={h.tiBusy || !(ev.destination.ip || ev.source.ip)} onClick={h.onEnrichTi}>{h.tiBusy ? 'Enriching …' : 'Enrich Destination IP'}</Button>
          </div>
        )}
      </RailCard>

      {/* Evidence Actions — nur echte Aktionen aktiv */}
      <RailCard title="Evidence Actions" icon={<Archive size={15} style={{ color: 'var(--accent)' }} />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button variant="primary" disabled={!h.canAct || h.snapshotSaved} onClick={h.onSaveSnapshot} icon={h.snapshotSaved ? <Check size={13} /> : undefined} style={{ width: '100%', justifyContent: 'center' }}>
            {h.snapshotSaved ? tr('analysis.savedAsEvidence') : 'Add evidence as Evidence'}
          </Button>
          <Button variant="ghost" disabled={!h.canAct || h.isImportant || !h.onMarkImportant} onClick={h.onMarkImportant}
            title={h.isImportant ? tr('tickets.alreadyPrioritised') : tr('analysis.raisesPriorityHigh')}
            style={{ width: '100%', justifyContent: 'center' }}>{h.isImportant ? tr('tickets.prioritisedCheck') : 'Mark as Important'}</Button>
          <Button variant="ghost" disabled={!h.canAct || h.followUpBusy || !h.onCreateFollowUp} onClick={h.onCreateFollowUp}
            title={h.onCreateFollowUp ? tr('analysis.createsLinkedFollowUpTicket') : tr('text.noBackendWorkflowAvailable')}
            style={{ width: '100%', justifyContent: 'center' }}>{h.followUpBusy ? tr('common.creating') : 'Create Follow-up Ticket'}</Button>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 10 }}>All actions are logged and auditable.</div>
      </RailCard>
    </div>
  );
}

function RailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function MetricBar({ label, value }: { label: string; value: number | null }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(10, value)) * 10;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10.5, color: 'var(--text-dim)', width: 92, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, height: 5, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--danger)' }} />
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text)', width: 30, textAlign: 'right' }}>{value == null ? '—' : `${value}/10`}</span>
    </div>
  );
}
