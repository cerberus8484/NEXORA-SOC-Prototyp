import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { X, Crosshair } from 'lucide-react';
import { Badge, Button, type Tone } from '../../components/ui';
import { huntApi, type CreateHuntBody, type HuntCatalogItem } from './huntApi';
import { HUNT_TYPES } from './huntTypeCatalog';
import { ticketApi } from '../tickets/ticketApi';
import type { Ticket } from '../../lib/types';
import { useFocusTrap, useReturnFocus } from '../../hooks/useFocusTrap';

/** Vorbelegung für Follow-up-Hunts (Audit-Fund #1/#2). Alle Felder optional. */
export interface HuntModalInitialValues {
  targetHost?: string;
  huntType?: string;
  sourceIp?: string;
  ticketId?: string;
}

interface NewHuntModalProps {
  onClose: () => void;
  onCreate: (body: CreateHuntBody) => Promise<void>;
  /** Wenn gesetzt, werden Felder vorbelegt (z.B. Follow-up auf ein Finding). */
  initialValues?: HuntModalInitialValues;
}

// Anzahl jüngster offener Tickets im Verknüpfungs-Dropdown (bewusst begrenzt).
const TICKET_LIMIT = 50;

const riskTone = (r: string): Tone => r === 'critical' || r === 'high' ? 'danger' : r === 'medium' ? 'warning' : 'muted';

// Fallback-Katalog (falls API nicht erreichbar) aus der statischen Liste.
const FALLBACK: HuntCatalogItem[] = HUNT_TYPES.map((t) => ({
  key: t.key, label: t.label, description: t.description, category: '', mitre: '',
  dataSources: [], targetType: t.defaultTargetType, defaultTarget: t.defaultTarget,
  defaultIp: '', riskLevel: t.riskLevel,
}));

const s: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 1000 },
  modal:   { width: 720, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' },
  head:    { display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border-soft)' },
  body:    { padding: 20 },
  grid:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 },
  card:    { textAlign: 'left' as const, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', cursor: 'pointer' },
  cardOn:  { borderColor: 'var(--accent)', background: 'var(--accent-soft)' },
  label:   { fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 5 },
  input:   { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' as const },
  foot:    { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 20px', borderTop: '1px solid var(--border-soft)' },
};

export function NewHuntModal({ onClose, onCreate, initialValues }: NewHuntModalProps) {
  const initTarget = initialValues?.targetHost?.trim() || '';
  const initHuntType = initialValues?.huntType?.trim() || '';
  const [catalog, setCatalog] = useState<HuntCatalogItem[]>(FALLBACK);
  const [selKey, setSelKey] = useState(
    initHuntType && FALLBACK.some((i) => i.key === initHuntType) ? initHuntType : (FALLBACK[0]?.key ?? ''),
  );
  const [target, setTarget] = useState(initTarget || FALLBACK[0]?.defaultTarget || '');
  const [sourceIp, setSourceIp] = useState(initialValues?.sourceIp?.trim() || '');
  const [ticketId, setTicketId] = useState(initialValues?.ticketId?.trim() || '');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketQuery, setTicketQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  // A11y: focus trap + Escape + focus-return (WCAG 2.4.3).
  useFocusTrap(modalRef, true, onClose);
  useReturnFocus(true);

  useEffect(() => {
    huntApi.catalog()
      .then((r) => {
        const items = r.data ?? [];
        if (items.length) {
          setCatalog(items);
          setSelKey((prev) => items.some((i) => i.key === prev) ? prev : items[0].key);
          // Vorbelegtes Target NICHT überschreiben; sonst Default aus dem Katalog.
          setTarget((prev) => prev || items[0].defaultTarget);
        }
      })
      .catch(() => { /* Fallback bleibt */ });
  }, []);

  // Jüngste OFFENE Tickets für das optionale Verknüpfungs-Dropdown laden.
  // „leer" ≠ „Fehler": bei Ladefehler bleibt die Liste leer, das Feld ist trotzdem
  // bedienbar (kein Ticket verknüpfen).
  useEffect(() => {
    ticketApi.list({ state: 'open', limit: TICKET_LIMIT, sort: 'createdAt', order: 'desc' })
      .then((r) => setTickets(r.data ?? []))
      .catch(() => setTickets([]));
  }, []);

  const sel = catalog.find((c) => c.key === selKey);

  // Durchsuchbares Ticket-Dropdown: nach Nummer/Titel filtern. Das aktuell gewählte
  // Ticket bleibt immer sichtbar, auch wenn es nicht zum Suchbegriff passt.
  const ticketNeedle = ticketQuery.trim().toLowerCase();
  const filteredTickets = ticketNeedle
    ? tickets.filter(
        (t) =>
          t.id === ticketId ||
          `${t.ticketNr} ${t.title}`.toLowerCase().includes(ticketNeedle),
      )
    : tickets;

  function pick(item: HuntCatalogItem) {
    setSelKey(item.key);
    setTarget(item.defaultTarget);
  }

  async function submit() {
    if (!sel) return;
    if (!target.trim()) { setError('Target ist Pflicht'); return; }
    setBusy(true); setError('');
    try {
      await onCreate({
        huntType: sel.key,
        targetHost: target.trim(),
        targetType: sel.targetType,
        riskLevel: sel.riskLevel,
        sourceIp: sourceIp.trim() || undefined,
        ticketId: ticketId.trim() || undefined,
        scope: 'Vorgefertigter Hunt · Safe Collectors · mock-backed',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen');
      setBusy(false);
    }
  }

  return (
    <div style={s.overlay} onClick={onClose} aria-hidden="true">
      {/* onClick nur zur Event-Eindämmung (stopPropagation), keine Aktion; ESC via useFocusTrap */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-hunt-modal-title"
        style={s.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={s.head}>
          <Crosshair size={18} style={{ color: 'var(--accent)' }} />
          <span id="new-hunt-modal-title" style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Neuer Hunt — Vorgefertigte Hunts</span>
          <button aria-label="Schließen" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><X size={18} /></button>
        </div>

        <div style={s.body}>
          <div style={s.label}>Hunt auswählen</div>
          <div style={s.grid}>
            {catalog.map((item) => (
              <button key={item.key} type="button" style={{ ...s.card, ...(item.key === selKey ? s.cardOn : {}) }} onClick={() => pick(item)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{item.label}</span>
                  <Badge tone={riskTone(item.riskLevel)}>{item.riskLevel}</Badge>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 6 }}>{item.description}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {item.category && <Badge tone="muted">{item.category}</Badge>}
                  {item.mitre && <Badge tone="muted">{item.mitre}</Badge>}
                </div>
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={s.label}>Target ({sel?.targetType ?? 'host'})</div>
              <input style={s.input} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Windows-01" />
            </div>
            <div>
              <div style={s.label}>Source IP (optional)</div>
              <input style={s.input} value={sourceIp} onChange={(e) => setSourceIp(e.target.value)} placeholder="192.168.240.109" />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={s.label}>Linked Ticket (optional)</div>
            {tickets.length > 0 && (
              <input
                style={{ ...s.input, marginBottom: 6 }}
                value={ticketQuery}
                onChange={(e) => setTicketQuery(e.target.value)}
                placeholder="Tickets durchsuchen (Nummer oder Titel)…"
                aria-label="Tickets durchsuchen"
              />
            )}
            <select
              style={{ ...s.input, cursor: 'pointer' }}
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              aria-label="Ticket verknüpfen"
            >
              <option value="">Kein Ticket verknüpfen</option>
              {filteredTickets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.ticketNr} · {t.title.length > 60 ? `${t.title.slice(0, 60)}…` : t.title}
                </option>
              ))}
            </select>
            {/* „leer" ≠ „Fehler": Leere Liste bedeutet nur „keine offenen Tickets geladen". */}
            {tickets.length === 0 && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-dim)' }}>
                Keine offenen Tickets geladen — verknüpfen ist optional.
              </div>
            )}
          </div>

          {sel && sel.dataSources.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-dim)' }}>
              Datenquellen: {sel.dataSources.join(', ')} · Safe Collectors (keine Remote-Exec)
            </div>
          )}
          {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        </div>

        <div style={s.foot}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>{busy ? 'Starte …' : 'Hunt starten'}</Button>
        </div>
      </div>
    </div>
  );
}
