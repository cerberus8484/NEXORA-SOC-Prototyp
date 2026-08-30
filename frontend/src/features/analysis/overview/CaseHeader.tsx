import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ShieldAlert, HardDriveDownload, MoreVertical, XCircle, Trash2, Monitor } from 'lucide-react';
import { Badge, Button, Card } from '../../../components/ui';
import { badge } from '../../../lib/badges';
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, TicketTimeline } from '../analysisModel';
import type { CollectEvidenceFeedback } from '../../evidence/collectEvidenceFeedback';
import { hostContext } from '../hostContext';
import { useTranslation } from 'react-i18next';

const fmtDate = (iso?: string) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const lbl: React.CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };
const FB: Record<CollectEvidenceFeedback['tone'], string> = { success: 'var(--success)', warning: 'var(--warning)', error: 'var(--danger)' };

function Meta({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  const empty = value === undefined || value === null || value === '';
  return (
    <div style={{ minWidth: 0 }}>
      <div style={lbl}>{label}</div>
      <div style={{ fontSize: 12, color: empty ? 'var(--text-dim)' : 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{empty ? '—' : value}</div>
    </div>
  );
}

export function CaseHeader({ t, ev, tl, canAct, canAdmin, busy, collecting, collectFeedback, onCollect, onClose, onDelete }: {
  t: Ticket; ev: ParsedEvidence; tl: TicketTimeline | null;
  canAct: boolean; canAdmin: boolean; busy: boolean; collecting: boolean;
  collectFeedback: CollectEvidenceFeedback | null;
  onCollect: () => void; onClose: () => void; onDelete: () => void;
}) {
  const { t: tr } = useTranslation();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const o = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', o); return () => document.removeEventListener('mousedown', o);
  }, [menu]);

  const proto = (ev.network.protocol || ev.network.transport || '').toUpperCase() || undefined;
  const host = hostContext(t, ev);
  const isOpen = (t.state ?? 'OPEN') === 'OPEN';
  const railColor = t.priority === 'critical' ? 'var(--danger)' : t.priority === 'high' ? 'var(--accent-orange)' : 'var(--accent)';

  return (
    <Card style={{ padding: '16px 20px', borderLeft: `3px solid ${railColor}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
          <ShieldAlert size={26} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{t.title || tr('tickets.untitled')}</span>
              <Badge tone={badge.severity(t.priority).tone}>{badge.severity(t.priority).label}</Badge>
              <Badge tone={badge.ticketState(t.state ?? 'OPEN').tone} dot>{badge.ticketState(t.state ?? 'OPEN').label}</Badge>
              <Badge tone={badge.ticketStatus(t.status).tone}>{badge.ticketStatus(t.status).label}</Badge>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>
              {[ev.detection.sourceSystem || t.source, ev.detection.ruleId ? `Rule ${ev.detection.ruleId}` : null, t.description || ev.detection.description].filter(Boolean).join(' — ') || tr('text.noShortDescriptionAvailable')}
            </div>
            {/* W2: Host-Kontext prominent — auf welchem Endpoint läuft der Incident.
                Nur echte Werte; fehlt der Host-Bezug komplett, bleibt der Chip aus. */}
            {host.hasAny && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 9, padding: '5px 10px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
                <Monitor size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{host.hostname ?? host.ip ?? '—'}</span>
                {host.ip && host.hostname && <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{host.ip}</span>}
                {host.user && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>· {host.user}</span>}
                {host.agentName && <Badge tone="muted">Agent {host.agentName}</Badge>}
                {host.agentId && <Badge tone="muted">ID {host.agentId}</Badge>}
              </div>
            )}
          </div>
        </div>

        {canAct && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="ghost" size="sm" icon={<HardDriveDownload size={14} />} disabled={busy || collecting} onClick={onCollect}
                title={tr('analysis.collectProcessesPortsNetworkConnections')}>
                {collecting ? 'Sammelt …' : 'Collect Artifacts'}
              </Button>
              <div ref={ref} style={{ position: 'relative' }}>
                <Button variant="ghost" size="sm" icon={<MoreVertical size={15} />} aria-label={tr('text.moreActions')} onClick={() => setMenu((m) => !m)} />
                {menu && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,.3)', zIndex: 50, minWidth: 180, padding: '4px 0' }}>
                    {canAdmin
                      ? <button onClick={() => { setMenu(false); onDelete(); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 12.5 }}><Trash2 size={13} /> {tr('analysis.deleteTicket')}</button>
                      : <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-dim)' }}>{tr('text.noFurtherActions')}</div>}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {isOpen && <Button variant="ghost" size="sm" icon={<XCircle size={14} />} disabled={busy} onClick={onClose}>Close</Button>}
              {canAdmin && <Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={onDelete}>Delete</Button>}
            </div>
          </div>
        )}
      </div>

      {collectFeedback && <div role="status" style={{ marginTop: 8, fontSize: 12, color: FB[collectFeedback.tone] }}>{collectFeedback.message}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 12, borderTop: '1px solid var(--border-soft)', paddingTop: 12, marginTop: 12 }}>
        <Meta label="Start Time" value={fmtDate(t.createdAt)} />
        <Meta label="Last Update" value={fmtDate(t.updatedAt)} />
        <Meta label="Assigned To" value={t.analyst || 'unassigned'} />
        <Meta label="Source" value={ev.detection.sourceSystem || t.source || 'manual'} />
        <Meta label="Signals / Events" value={tl ? tl.count.toLocaleString('de-DE') : (t.alertCount ?? '—')} />
        <Meta label="Category" value={t.category || t.mitre} />
        <Meta label="Ticket ID" value={<span className="mono">{t.ticketNr || t.id.slice(0, 8)}</span>} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 12, paddingTop: 10 }}>
        <Meta label="Host" value={host.hostname} />
        <Meta label="User" value={host.user} />
        <Meta label="Source IP" value={ev.source.ip || t.srcIp} mono />
        <Meta label="Destination IP" value={ev.destination.ip || t.dstIp} mono />
        <Meta label="Protocol" value={proto} />
        <Meta label="First Seen" value={ev.firstSeen || fmtDate(t.createdAt)} />
        <Meta label="Last Seen" value={ev.lastSeen || fmtDate(t.updatedAt)} />
      </div>
    </Card>
  );
}
