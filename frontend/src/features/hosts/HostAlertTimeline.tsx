import { useEffect, useState, type CSSProperties } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { hostsApi } from './hostsApi';
import { buildTimeline, severityColor, type HostAlert, type TimelineItem } from './hostTimeline';

// Vertikale Alert-Timeline eines Hosts. Lädt die letzten Tickets/Alerts dieses
// Agents und stellt sie zeitlich (neueste zuerst), Severity-farbig dar.
// Keine externen Libs — reines CSS/inline.

const s: Record<string, CSSProperties> = {
  wrap:    { display: 'flex', flexDirection: 'column', gap: 14 },
  head:    { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' },
  empty:   { fontSize: 11.5, color: 'var(--text-dim)', padding: '8px 0' },
  list:    { position: 'relative', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 14 },
  rail:    { position: 'absolute', left: 5, top: 4, bottom: 4, width: 2, background: 'var(--border-soft)' },
  item:    { position: 'relative' },
  dot:     { position: 'absolute', left: -16, top: 4, width: 10, height: 10, borderRadius: 999, border: '2px solid var(--bg-card)' },
  row1:    { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  nr:      { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' },
  title:   { fontSize: 12.5, fontWeight: 600, color: 'var(--text)' },
  meta:    { fontSize: 11, color: 'var(--text-dim)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' },
  mitre:   { fontFamily: 'var(--font-mono)', color: 'var(--accent)' },
};

function relTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

interface Props {
  agentId: string;
  hostname?: string;
}

export function HostAlertTimeline({ agentId, hostname }: Props) {
  const [items, setItems]   = useState<TimelineItem[] | null>(null);
  const [error, setError]   = useState('');

  useEffect(() => {
    let active = true;
    setItems(null); setError('');
    hostsApi.alerts(agentId, hostname)
      .then((res) => { if (active) setItems(buildTimeline(res.data as HostAlert[])); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen'); });
    return () => { active = false; };
  }, [agentId, hostname]);

  return (
    <div style={s.wrap}>
      <div style={s.head}><Clock size={14} /> Alert-Historie (letzte 20)</div>
      {error && <div style={{ ...s.empty, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={13} /> {error}</div>}
      {!error && items === null && <div style={s.empty}>Alerts werden geladen …</div>}
      {!error && items?.length === 0 && <div style={s.empty}>Keine Alerts für diesen Host. Sobald Tickets diesem Agent zugeordnet sind, erscheinen sie hier.</div>}
      {items && items.length > 0 && (
        <div style={s.list}>
          <span style={s.rail} aria-hidden />
          {items.map((it) => (
            <div key={it.id} style={s.item}>
              <span style={{ ...s.dot, background: severityColor(it.priority) }} aria-hidden />
              <div style={s.row1}>
                {it.ticketNr && <span style={s.nr}>{it.ticketNr}</span>}
                <span style={s.title}>{it.title}</span>
              </div>
              <div style={s.meta}>
                <span style={{ color: severityColor(it.priority), fontWeight: 600 }}>{it.priority}</span>
                <span>{relTime(it.createdAt)}</span>
                {it.mitre && <span style={s.mitre}>{it.mitre}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
