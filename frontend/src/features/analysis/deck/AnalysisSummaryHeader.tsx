// Breite Summary-Card über dem Deck — Was/Wer/Wann auf einen Blick.
import type { ReactNode } from 'react';
import { UserPlus, XCircle, Trash2, HardDriveDownload } from 'lucide-react';
import { Badge, Button, Card } from '../../../components/ui';
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, TicketTimeline } from '../analysisModel';
import type { CollectEvidenceFeedback } from '../../evidence/collectEvidenceFeedback';
import { badge } from '../../../lib/badges';
import { sourceLabel, isCorrelatedSource } from '../../../lib/sourceLabel';
import { LABEL } from './deckUi';

const FEEDBACK_COLOR: Record<CollectEvidenceFeedback['tone'], string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--danger)',
};

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function Field({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={LABEL}>{label}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, marginTop: 2 }}>{value ?? '—'}</div>
    </div>
  );
}

export function AnalysisSummaryHeader({
  t, ev, tl, canAct, canAdmin, busy, collecting, collectFeedback,
  onAssign, onClose, onCollectEvidence, onDelete,
}: {
  t: Ticket; ev: ParsedEvidence; tl: TicketTimeline | null;
  canAct: boolean; canAdmin: boolean; busy: boolean; collecting: boolean;
  collectFeedback: CollectEvidenceFeedback | null;
  onAssign: () => void; onClose: () => void;
  onCollectEvidence: () => void; onDelete: () => void;
}) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      {/* Titelzeile */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)' }}>{t.ticketNr || t.id.slice(0, 8)}</span>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>{t.title || '(ohne Titel)'}</span>
            <Badge tone={badge.severity(t.priority).tone}>{badge.severity(t.priority).label}</Badge>
            <Badge tone={badge.ticketState(t.state ?? 'OPEN').tone} dot>{badge.ticketState(t.state ?? 'OPEN').label}</Badge>
            <Badge tone={badge.ticketStatus(t.status).tone}>{badge.ticketStatus(t.status).label}</Badge>
          </div>
          {(t.description || ev.detection.description) && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, maxWidth: 760, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {t.description || ev.detection.description}
            </div>
          )}
        </div>
        {canAct && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" icon={<UserPlus size={14} />} disabled={busy} onClick={onAssign}>Mir zuweisen</Button>
            <Button variant="ghost" size="sm" icon={<HardDriveDownload size={14} />} disabled={busy || collecting} onClick={onCollectEvidence}
              title="Prozesse, Ports und Netzwerkverbindungen vom Endpoint sammeln (Wazuh)">
              {collecting ? 'Sammelt …' : 'Endpoint-Artefakte sammeln'}
            </Button>
            {(t.state ?? 'OPEN') === 'OPEN' && <Button variant="danger" size="sm" icon={<XCircle size={14} />} disabled={busy} onClick={onClose}>Schließen</Button>}
            {canAdmin && <Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={onDelete}
              title="Ticket dauerhaft löschen (nur Admin)">Löschen</Button>}
          </div>
        )}
      </div>

      {collectFeedback && (
        <div role="status" style={{ marginTop: 10, fontSize: 12, color: FEEDBACK_COLOR[collectFeedback.tone] }}>
          {collectFeedback.message}
        </div>
      )}

      {/* Kennzahlen-Raster */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 12, borderTop: '1px solid var(--border-soft)', paddingTop: 12, marginTop: 12 }}>
        <Field label="Start Time" value={fmtDate(t.createdAt)} />
        <Field label="Last Updated" value={fmtDate(t.updatedAt)} />
        <Field label="Assigned To" value={t.analyst || 'unassigned'} />
        <Field label="Customer" value={t.customer || '—'} />
        <Field label="Source" value={isCorrelatedSource(t.source)
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{sourceLabel(t.source)}<Badge tone="accent">Cross-Domain</Badge></span>
          : sourceLabel(ev.detection.sourceSystem || t.source)} />
        <Field label="Offense" value={t.offenseId ? <span className="mono">{t.offenseId}</span> : '—'} />
        <Field label="Events" value={tl ? tl.count.toLocaleString('de-DE') : '—'} />
        <Field label="Category" value={t.category || t.mitre || '—'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 12, paddingTop: 10 }}>
        <Field label="Host" value={ev.source.host || '—'} />
        <Field label="User" value={ev.source.user || '—'} />
        <Field label="Source IP" value={ev.source.ip || t.srcIp || '—'} mono />
        <Field label="Destination IP" value={ev.destination.ip || t.dstIp || '—'} mono />
        <Field label="Dst Port" value={ev.destination.port ?? '—'} mono />
        <Field label="Protocol" value={(ev.network.protocol || ev.network.transport || '—').toUpperCase()} />
        <Field label="First Seen" value={ev.firstSeen || fmtDate(t.createdAt)} />
        <Field label="Last Seen" value={ev.lastSeen || fmtDate(t.updatedAt)} />
      </div>
    </Card>
  );
}
