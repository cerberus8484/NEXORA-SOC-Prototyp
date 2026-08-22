import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ArrowLeft, ArrowRight, Search, ExternalLink, UserCheck } from 'lucide-react';
import { Badge } from '../../components/ui';
import { ticketApi } from '../tickets/ticketApi';
import { badge } from '../../lib/badges';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/rbac';
import { myTickets } from './assignedTickets';
import type { Ticket } from '../../lib/types';

// Aktiver Ticket-Kontext im globalen Header. Quelle der Wahrheit ist der URL-Param
// ?ticket= — Switcher und AnalysisPage bleiben dadurch synchron. Die Analyse-Workbench
// zeigt ausschließlich die DEM NUTZER zugewiesenen Tickets (RBAC-Scoping, konsistent mit
// AnalysisPage). Die volle Queue erreicht man über „Alle Tickets öffnen". Keine Fake-Daten.

function ctxOf(t: Ticket): string {
  return t.customer || t.srcIp || (t.title ? (t.title.length > 24 ? t.title.slice(0, 24) + '…' : t.title) : '');
}

const s: Record<string, CSSProperties> = {
  chip: { display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', cursor: 'pointer', maxWidth: 360, minWidth: 0 },
  arrow: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', color: 'var(--text-muted)', cursor: 'pointer' },
  pop: { position: 'absolute', top: 'calc(100% + 8px)', left: 0, width: 380, maxWidth: '90vw', background: 'var(--bg-elevated)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', boxShadow: '0 8px 32px rgba(0,0,0,.35)', zIndex: 200, overflow: 'hidden' },
  input: { width: '100%', boxSizing: 'border-box', paddingLeft: 30, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px 7px 30px', fontSize: 13 },
  row: { display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-soft)' },
};

export function ActiveTicketSwitcher() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    ticketApi.list({ limit: 100, sort: 'updatedAt', order: 'desc' })
      .then((r) => { if (alive) setTickets(r.data ?? []); })
      .catch(() => { if (alive) setTickets([]); });
    return () => { alive = false; };
  }, []);

  // Scoping wie die AnalysisPage: Analysten sehen nur ihre zugewiesenen Tickets (robuster
  // Match: Anzeigename ODER E-Mail), Admins zur Lead-/Oversight-Arbeit alle. Ohne Zuweisung
  // bleibt der Switcher für Analysten leer — man weist sich Tickets auf der Tickets-Seite zu.
  const seeAll = can.admin(user?.role);
  const visibleTickets = useMemo(() => (seeAll ? tickets : myTickets(tickets, user)), [tickets, user, seeAll]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  // Aktives Ticket wird aus der (gescopten) eigenen Liste aufgelöst — ein Fremd-Ticket
  // per Deep-Link erscheint hier bewusst NICHT (Scoping konsistent mit dem Deck).
  const activeId = params.get('ticket') ?? visibleTickets[0]?.id ?? null;
  const active = visibleTickets.find((t) => t.id === activeId) ?? null;
  const idx = active ? visibleTickets.findIndex((t) => t.id === active.id) : -1;

  function go(id: string) {
    const next = new URLSearchParams(params);
    next.set('ticket', id);
    setParams(next, { replace: true });
    setOpen(false);
  }
  function step(delta: number) {
    if (idx < 0 || visibleTickets.length === 0) return;
    const ni = (idx + delta + visibleTickets.length) % visibleTickets.length;
    go(visibleTickets[ni].id);
  }

  const filtered = useMemo(() => {
    if (!q.trim()) return visibleTickets.slice(0, 30);
    const needle = q.toLowerCase();
    return visibleTickets.filter((t) => [t.ticketNr, t.title, t.customer, t.srcIp, t.offenseId].filter(Boolean).join(' ').toLowerCase().includes(needle)).slice(0, 30);
  }, [visibleTickets, q]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label="Aktives Ticket wechseln"
        style={s.chip} onClick={() => setOpen((o) => !o)}>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
          {active?.ticketNr || active?.id?.slice(0, 8) || 'Kein Ticket'}
        </span>
        {active && <Badge tone={badge.severity(active.priority).tone}>{badge.severity(active.priority).label}</Badge>}
        {active && ctxOf(active) && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{ctxOf(active)}</span>
        )}
        <ChevronDown size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
      </button>
      <button type="button" aria-label="Vorheriges Ticket" style={s.arrow} disabled={visibleTickets.length < 2} onClick={() => step(-1)}><ArrowLeft size={15} /></button>
      <button type="button" aria-label="Nächstes Ticket" style={s.arrow} disabled={visibleTickets.length < 2} onClick={() => step(1)}><ArrowRight size={15} /></button>

      {open && (
        <div role="dialog" aria-label="Ticket-Auswahl" style={s.pop}>
          {/* Ehrlicher Header: Analyst sieht nur eigene zugewiesene Tickets, Admin alle. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            <UserCheck size={13} style={{ color: 'var(--accent)' }} /> {seeAll ? 'Alle Tickets' : 'Meine zugewiesenen Tickets'}
            <Badge tone="accent">{visibleTickets.length}</Badge>
          </div>
          <div style={{ padding: 10, borderBottom: '1px solid var(--border-soft)', position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 20, top: 19, color: 'var(--text-dim)' }} />
            <input autoFocus placeholder={seeAll ? 'Tickets suchen …' : 'Meine Tickets suchen …'} value={q} onChange={(e) => setQ(e.target.value)} style={s.input} />
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text-dim)', textAlign: 'center' }}>
                {visibleTickets.length === 0 ? (seeAll ? 'Keine Tickets vorhanden.' : 'Dir ist derzeit kein Ticket zugewiesen. Weise dir auf der Tickets-Seite eines zu.') : 'Keine Tickets gefunden.'}
              </div>
            ) : filtered.map((t) => (
              <button key={t.id} type="button" style={{ ...s.row, background: t.id === activeId ? 'var(--accent-soft)' : 'transparent' }} onClick={() => go(t.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)' }}>{t.ticketNr || t.id.slice(0, 8)}</span>
                  <Badge tone={badge.severity(t.priority).tone}>{badge.severity(t.priority).label}</Badge>
                  <Badge tone={badge.ticketState(t.state ?? 'OPEN').tone}>{badge.ticketState(t.state ?? 'OPEN').label}</Badge>
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-dim)' }}>{t.updatedAt ? new Date(t.updatedAt).toLocaleDateString('de-DE') : '—'}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || '(ohne Titel)'}</div>
                {ctxOf(t) && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>{ctxOf(t)}</div>}
              </button>
            ))}
          </div>
          <button type="button" style={{ ...s.row, borderBottom: 'none', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 12.5, fontWeight: 600 }}
            onClick={() => { setOpen(false); navigate('/tickets'); }}>
            <ExternalLink size={13} /> Alle Tickets öffnen
          </button>
        </div>
      )}
    </div>
  );
}
