import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useFocusTrap, useReturnFocus } from '../hooks/useFocusTrap';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, UserPlus, UserMinus, XCircle, X, Search, FilterX, ShieldOff, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { ticketApi } from '../features/tickets/ticketApi';
import { DEFAULT_FILTERS, PAGE_SIZE, buildTicketListParams, buildSelectAllParams, hasActiveFilters, currentPage, totalPages, type TicketFilters } from '../features/tickets/ticketFilterModel';
import { canDeleteTicket } from '../features/tickets/ticketDeleteGate';
import { formatBulkDeleteResult, type BulkDeleteNotice } from '../features/tickets/bulkDeleteModel';
import { chunkIds, mergeBulkResults, BULK_DELETE_CHUNK_SIZE } from '../features/tickets/bulkDeleteChunks';
import { computeHeaderStats, PRIORITY_ORDER } from '../features/tickets/ticketsHeaderStats';
import { relTime } from '../features/dashboard/activityFeedModel';
import type { Ticket } from '../lib/types';
import { SectionHeader, Card, Button, Badge, Select, Input, Toggle, EmptyState, Spinner, ErrorCard } from '../components/ui';
import { badge } from '../lib/badges';
import { sourceLabel, isCorrelatedSource } from '../lib/sourceLabel';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';

const STATE_FILTER = [
  { value: 'OPEN', label: 'Open' },
  { value: 'CLOSED', label: 'Closed' },
  { value: '', label: 'Alle' },
];
const STATUS_FILTER = [
  { value: '', label: 'Alle Status' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'awaiting_customer', label: 'Awaiting Customer' },
];
const PRIORITY_FILTER = [
  { value: '', label: 'Alle Prioritäten' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'info', label: 'Info' },
];

const SOURCE_FILTER = [
  { value: '', label: 'Alle Quellen' },
  { value: 'dataplane', label: 'Korrelierter Vorfall' },
  { value: 'wazuh', label: 'Wazuh' },
  { value: 'qradar', label: 'QRadar' },
  { value: 'splunk', label: 'Splunk' },
  { value: 'crowdsec', label: 'CrowdSec' },
  { value: 'email', label: 'E-Mail' },
  { value: 'threat_hunt', label: 'Threat Hunt' },
  { value: 'manual', label: 'Manuell' },
];
const SEARCH_DEBOUNCE_MS = 300;

const filterLabel: CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' };

interface CtxMenu { x: number; y: number; ticket: Ticket; }
interface FpModal { ticket: Ticket; }

export function TicketsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canAct = can.act(user?.role);
  const canDelete = canDeleteTicket(user?.role);

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<TicketFilters>(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [fpModal, setFpModal] = useState<FpModal | null>(null);
  const [fpReason, setFpReason] = useState('');
  const [deleteModal, setDeleteModal] = useState<Ticket | null>(null);
  const [busy, setBusy] = useState(false);
  const deletePanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(deletePanelRef, !!deleteModal, () => { if (!busy) setDeleteModal(null); });
  useReturnFocus(!!deleteModal);
  // Sammel-Löschung (admin): eigenes Confirm-Modal, eigener Fehler-/Ergebnis-State.
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkNotice, setBulkNotice] = useState<BulkDeleteNotice | null>(null);
  // „Alle gefilterten auswählen" (über die Seitengrenze) + Fortschritt der gechunkten Löschung.
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectAllError, setSelectAllError] = useState('');
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const bulkPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(bulkPanelRef, bulkDeleteOpen, () => { if (!busy) setBulkDeleteOpen(false); });
  useReturnFocus(bulkDeleteOpen);
  const reqId = useRef(0);

  // Filter-Änderungen (außer offset selbst) setzen immer auf Seite 1 zurück.
  const patchFilters = (patch: Partial<TicketFilters>) =>
    setFilters((f) => ({ ...f, ...patch, ...('offset' in patch ? {} : { offset: 0 }) }));

  const myName = user?.displayName || user?.email || '';

  const load = useCallback(async () => {
    const myReq = ++reqId.current;
    setError('');
    try {
      const res = await ticketApi.list(buildTicketListParams(filters, myName));
      if (myReq !== reqId.current) return;
      setTickets(res.data ?? []);
      setTotal(res.total);
      setSelected(new Set());
    } catch (err) {
      if (myReq === reqId.current) setError(err instanceof Error ? err.message : 'Fehler');
    }
  }, [filters, myName]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => f.search === searchInput ? f : { ...f, search: searchInput, offset: 0 });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtx(null); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', onKey); };
  }, [ctx]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) => s.size === (tickets?.length ?? 0) ? new Set() : new Set((tickets ?? []).map((t) => t.id)));
  }

  async function mutate(ids: string[], body: Partial<Ticket> & Record<string, unknown>) {
    if (!ids.length) return;
    setBusy(true);
    setCtx(null);
    try {
      await Promise.all(ids.map((id) => ticketApi.update(id, body)));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  const assign   = (t: Ticket) => mutate([t.id], { analyst: myName, status: 'in_progress' });
  const unassign = (t: Ticket) => mutate([t.id], { analyst: '' });
  const closeSelected = () => mutate([...selected], { state: 'CLOSED' });

  function openFpModal(ticket: Ticket) {
    setCtx(null);
    setFpReason('');
    setFpModal({ ticket });
  }

  async function confirmFp() {
    if (!fpModal || !fpReason.trim()) return;
    const note = fpReason.trim();
    await mutate([fpModal.ticket.id], {
      state: 'CLOSED',
      closeReason: 'false_positive',
      notes: fpModal.ticket.notes ? `${fpModal.ticket.notes}\n[False Positive] ${note}` : `[False Positive] ${note}`,
    });
    setFpModal(null);
    setFpReason('');
  }

  function openDeleteModal(ticket: Ticket) {
    setCtx(null);
    setDeleteModal(ticket);
  }

  async function confirmDelete() {
    if (!deleteModal) return;
    const id = deleteModal.id;
    setBusy(true);
    setError('');
    try {
      await ticketApi.delete(id);
      setDeleteModal(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ticket konnte nicht gelöscht werden');
    } finally {
      setBusy(false);
    }
  }

  // Alle aktuell gefilterten Tickets auswählen — auch über die Seitengrenze hinaus.
  // Holt die IDs aller Treffer (ein hoch-limitierter, aber begrenzter Request) und
  // selektiert sie. Bei Fehler: Auswahl unverändert + ehrliche Meldung.
  async function selectAllFiltered() {
    setSelectingAll(true);
    setSelectAllError('');
    try {
      const res = await ticketApi.listIds(buildSelectAllParams(filters, myName));
      setSelected(new Set(res.ids ?? []));
    } catch (err) {
      setSelectAllError(err instanceof Error ? err.message : 'Auswahl konnte nicht geladen werden');
    } finally {
      setSelectingAll(false);
    }
  }

  function openBulkDelete() {
    setBulkError('');
    setBulkNotice(null);
    setBulkProgress(null);
    setBulkDeleteOpen(true);
  }

  // Sammel-Löschung: Das Backend cappt einen Request auf 100 IDs. Bei großer Auswahl
  // (z. B. „alle gefilterten") zerlegen wir in Blöcke zu ≤100 und senden sie SEQUENZIELL,
  // mit sichtbarem Fortschritt. Teilergebnisse werden ehrlich zusammengeführt. Bei Fehler
  // in einem Block: Abbruch, bereits Gelöschtes wird im Notice ehrlich ausgewiesen,
  // Auswahl bleibt erhalten. Erst am Ende genau einmal load().
  async function confirmBulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    const chunks = chunkIds(ids);
    setBusy(true);
    setBulkError('');
    setBulkProgress({ done: 0, total: chunks.length });
    const partials = [];
    try {
      for (let i = 0; i < chunks.length; i++) {
        const res = await ticketApi.bulkDelete(chunks[i]);
        partials.push(res.data);
        setBulkProgress({ done: i + 1, total: chunks.length });
      }
      setBulkDeleteOpen(false);
      setBulkNotice(formatBulkDeleteResult(mergeBulkResults(partials)));
      await load();
    } catch (err) {
      // Bereits gelöschte Blöcke ehrlich melden, bevor der Fehler angezeigt wird.
      if (partials.length > 0) setBulkNotice(formatBulkDeleteResult(mergeBulkResults(partials)));
      setBulkError(err instanceof Error ? err.message : 'Sammel-Löschung fehlgeschlagen');
    } finally {
      setBusy(false);
      setBulkProgress(null);
    }
  }

  return (
    // Seiten-Wrapper unterdrückt nur das native Kontextmenü, solange unser eigenes offen ist — keine interaktive Rolle
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div onContextMenu={(e) => { if (ctx) e.preventDefault(); }}>
      <SectionHeader
        title="Tickets"
        help="tickets"
        subtitle={tickets ? `${total} Incidents` : undefined}
        actions={canAct && (
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/tickets/new')}>Neues Ticket</Button>
        )}
      />

      {/* Smart-Header: Kennzahlen aus der aktuell geladenen Liste (offen · zugewiesen · Priorität). */}
      {tickets && tickets.length > 0 && <TicketsStatsHeader tickets={tickets} totalAll={total} />}

      {/* Filter */}
      <Card style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={filterLabel}>State</span>
        <div style={{ minWidth: 130 }}><Select options={STATE_FILTER} value={filters.state} onChange={(e) => patchFilters({ state: e.target.value })} /></div>
        <span style={{ ...filterLabel, marginLeft: 8 }}>Status</span>
        <div style={{ minWidth: 170 }}><Select options={STATUS_FILTER} value={filters.status} onChange={(e) => patchFilters({ status: e.target.value })} /></div>
        <span style={{ ...filterLabel, marginLeft: 8 }}>Priorität</span>
        <div style={{ minWidth: 160 }}><Select options={PRIORITY_FILTER} value={filters.priority} onChange={(e) => patchFilters({ priority: e.target.value })} /></div>
        <span style={{ ...filterLabel, marginLeft: 8 }}>Quelle</span>
        <div style={{ minWidth: 180 }}><Select options={SOURCE_FILTER} value={filters.source} onChange={(e) => patchFilters({ source: e.target.value })} /></div>
        <div style={{ position: 'relative', marginLeft: 8, flex: '1 1 220px', maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }} />
          <Input
            type="search"
            aria-label="Tickets durchsuchen"
            placeholder="Suche: Titel, Ticket-Nr., Analyst, Offense …"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ paddingLeft: 32, width: '100%' }}
          />
        </div>
        {myName && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, cursor: 'pointer' }}>
            <Toggle checked={filters.mineOnly} onChange={(next) => patchFilters({ mineOnly: next })} label="Nur meine Tickets" />
            <span style={filterLabel}>Nur meine</span>
          </label>
        )}
        {(hasActiveFilters(filters) || searchInput) && (
          <Button
            variant="ghost" size="sm" icon={<FilterX size={14} />}
            style={{ marginLeft: 'auto' }}
            onClick={() => { setFilters({ ...DEFAULT_FILTERS, offset: 0 }); setSearchInput(''); }}
          >
            Filter zurücksetzen
          </Button>
        )}
      </Card>

      {/* Bulk-Aktionsleiste */}
      {canAct && selected.size > 0 && (
        <Card style={{ padding: '10px 16px', marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderColor: 'var(--accent)' }}>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>{selected.size} ausgewählt</span>
          {/* „Alle gefilterten auswählen" über die Seitengrenze hinaus — nur sinnvoll, wenn es
              mehr Treffer als die aktuelle Auswahl gibt. */}
          {total > selected.size && (
            <Button variant="ghost" size="sm" disabled={busy || selectingAll} onClick={() => void selectAllFiltered()}>
              {selectingAll ? 'Lade …' : `Alle ${total} (gefiltert) auswählen`}
            </Button>
          )}
          <Button variant="danger" size="sm" icon={<XCircle size={14} />} disabled={busy} onClick={closeSelected}>Ausgewählte schließen</Button>
          {canDelete && (
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={openBulkDelete}>Ausgewählte löschen</Button>
          )}
          <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setSelected(new Set())}>Auswahl aufheben</Button>
        </Card>
      )}

      {/* Ehrliche Meldung, falls das Laden aller gefilterten IDs fehlschlug. */}
      {selectAllError && (
        <Card style={{ padding: '8px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', borderColor: 'var(--warning)' }}>
          <span role="status" style={{ fontSize: 13, color: 'var(--warning)' }}>{selectAllError}</span>
          <Button variant="ghost" size="sm" icon={<X size={14} />} style={{ marginLeft: 'auto' }} onClick={() => setSelectAllError('')}>Schließen</Button>
        </Card>
      )}

      {/* Ehrliche Ergebnis-Meldung der Sammel-Löschung (gelöscht / nicht gefunden) */}
      {bulkNotice && (
        <Card style={{ padding: '8px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', borderColor: bulkNotice.tone === 'ok' ? 'var(--accent)' : 'var(--warning)' }}>
          <span role="status" style={{ fontSize: 13, color: bulkNotice.tone === 'ok' ? 'var(--text)' : 'var(--warning)' }}>{bulkNotice.text}</span>
          <Button variant="ghost" size="sm" icon={<X size={14} />} style={{ marginLeft: 'auto' }} onClick={() => setBulkNotice(null)}>Schließen</Button>
        </Card>
      )}

      <Card>
        {error ? <ErrorCard message={error} /> : !tickets ? <Spinner /> : tickets.length === 0 ? (
          <EmptyState title="Keine Tickets" message="Kein Ticket für diesen Filter — Filter ändern oder neues Ticket anlegen." />
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  {canAct && (
                    <th style={{ width: 36 }}>
                      <input type="checkbox" aria-label="Alle auswählen"
                        checked={selected.size > 0 && selected.size === tickets.length}
                        ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < tickets.length; }}
                        onChange={toggleAll} />
                    </th>
                  )}
                  <th>Nr.</th><th>Titel</th><th>Priorität</th><th>State</th><th>Status</th><th>Quelle</th><th>Analyst</th><th>Erstellt</th>
                  {canDelete && <th style={{ width: 44 }} aria-label="Aktionen" />}
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const sel = selected.has(t.id);
                  return (
                    <tr key={t.id}
                      style={{ cursor: 'pointer', background: sel ? 'var(--accent-soft)' : undefined }}
                      onClick={() => navigate(`/tickets/${t.id}`)}
                      onContextMenu={(e) => { if (!canAct) return; e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, ticket: t }); }}>
                      {canAct && (
                        <td onClick={(e) => { e.stopPropagation(); toggle(t.id); }}>
                          <input type="checkbox" aria-label={`Ticket ${t.ticketNr || t.id} auswählen`} checked={sel} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} />
                        </td>
                      )}
                      <td className="mono" style={{ color: 'var(--text-muted)' }}>{t.ticketNr || '—'}</td>
                      <td><Link to={`/tickets/${t.id}`} style={{ color: 'var(--text)' }} onClick={(e) => e.stopPropagation()}>{t.title || '(ohne Titel)'}</Link></td>
                      <td><Badge tone={badge.severity(t.priority).tone}>{badge.severity(t.priority).label}</Badge></td>
                      <td><Badge tone={badge.ticketState(t.state ?? 'OPEN').tone} dot>{badge.ticketState(t.state ?? 'OPEN').label}</Badge></td>
                      <td><Badge tone={badge.ticketStatus(t.status).tone}>{badge.ticketStatus(t.status).label}</Badge></td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {isCorrelatedSource(t.source)
                          ? <Badge tone="accent">{sourceLabel(t.source)}</Badge>
                          : sourceLabel(t.source)}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{t.analyst || '—'}</td>
                      <td style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }} title={fmtAbsDate(t.createdAt)}>
                        {t.createdAt ? relTime(t.createdAt) : '—'}
                      </td>
                      {canDelete && (
                        <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            aria-label={`Ticket ${t.ticketNr || t.id} löschen`}
                            title="Ticket löschen"
                            onClick={(e) => { e.stopPropagation(); openDeleteModal(t); }}
                            style={iconBtn}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {(() => {
              const page = currentPage(filters.offset);
              const pages = totalPages(total);
              return (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid var(--border-soft)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    {total} Tickets · Seite {page}/{pages}
                    {total > PAGE_SIZE && <span> · {PAGE_SIZE} pro Seite</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <Button
                      variant="ghost" size="sm" icon={<ChevronLeft size={14} />}
                      disabled={filters.offset === 0}
                      onClick={() => patchFilters({ offset: Math.max(0, filters.offset - PAGE_SIZE) })}
                    >Zurück</Button>
                    <Button
                      variant="ghost" size="sm" icon={<ChevronRight size={14} />}
                      disabled={page >= pages}
                      onClick={() => patchFilters({ offset: filters.offset + PAGE_SIZE })}
                    >Weiter</Button>
                  </span>
                </div>
              );
            })()}
          </>
        )}
      </Card>

      {/* Rechtsklick-Kontextmenü */}
      {ctx && (
        // onClick nur zur Event-Eindämmung (stopPropagation); die Menüeinträge sind echte <button>
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
        <div style={ctxMenuStyle(ctx.x, ctx.y)} onClick={(e) => e.stopPropagation()}>
          <button style={ctxItem} onClick={() => assign(ctx.ticket)}>
            <UserPlus size={14} /> Assign Case {myName ? `(an mich)` : ''}
          </button>
          <button style={ctxItem} onClick={() => unassign(ctx.ticket)}>
            <UserMinus size={14} /> Unassign Case
          </button>
          {(ctx.ticket.state ?? 'OPEN') === 'OPEN' && (
            <>
              <div style={{ height: 1, background: 'var(--border-soft)', margin: '4px 0' }} />
              <button style={{ ...ctxItem, color: 'var(--warning)' }} onClick={() => openFpModal(ctx.ticket)}>
                <ShieldOff size={14} /> Als False Positive schließen
              </button>
              <button style={{ ...ctxItem, color: 'var(--danger)' }} onClick={() => mutate([ctx.ticket.id], { state: 'CLOSED' })}>
                <XCircle size={14} /> Case schließen (resolved)
              </button>
            </>
          )}
          {canDelete && (
            <>
              <div style={{ height: 1, background: 'var(--border-soft)', margin: '4px 0' }} />
              <button style={{ ...ctxItem, color: 'var(--danger)' }} onClick={() => openDeleteModal(ctx.ticket)}>
                <Trash2 size={14} /> Ticket löschen
              </button>
            </>
          )}
        </div>
      )}

      {/* False-Positive-Begründungs-Modal */}
      {fpModal && (
        // a11y: Backdrop-Klick schließt (Maus-Ergänzung); Tastaturpfad ist der fokussierbare Abbrechen-Button
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setFpModal(null)}>
          {/* onClick nur zur Event-Eindämmung (stopPropagation), keine Aktion */}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: 24, width: 440, maxWidth: '90vw', boxShadow: 'var(--shadow-pop)' }}
            role="dialog" aria-modal="true" aria-labelledby="fp-modal-title"
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', flexShrink: 0 }}>
                <ShieldOff size={16} />
              </span>
              <div>
                <div id="fp-modal-title" style={{ fontSize: 14, fontWeight: 700 }}>Als False Positive schließen</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                  {fpModal.ticket.ticketNr && <span className="mono">{fpModal.ticket.ticketNr} · </span>}
                  {fpModal.ticket.title || '(ohne Titel)'}
                </div>
              </div>
            </div>

            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}>
              Begründung (Pflicht)
            </label>
            <textarea
              autoFocus
              aria-label="Begründung (Pflicht)"
              value={fpReason}
              onChange={(e) => setFpReason(e.target.value)}
              placeholder="Warum ist das ein False Positive? (z. B. lokaler Multicast-Traffic, bekannter Scanner, erwartetes Verhalten …)"
              style={{ width: '100%', minHeight: 80, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '8px 10px', fontSize: 13, lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void confirmFp(); }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, marginBottom: 16 }}>
              Das Ticket wird mit Schließgrund <code>false_positive</code> geschlossen. Die Begründung wird in den Notizen gespeichert.
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setFpModal(null)}>Abbrechen</Button>
              <Button variant="danger" icon={<ShieldOff size={14} />} disabled={!fpReason.trim() || busy} onClick={() => void confirmFp()}>
                {busy ? 'Wird gespeichert …' : 'Als False Positive schließen'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Lösch-Bestätigung (admin only, statt window.confirm — eigenes Modal mit Focus/Escape) */}
      {deleteModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="del-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape' && !busy) setDeleteModal(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { if (!busy) setDeleteModal(null); }}>
          {/* onClick nur zur Event-Eindämmung (stopPropagation); Dialog-Rolle + ESC liegen am Wrapper */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div ref={deletePanelRef} style={{ background: 'var(--bg-card)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: 24, width: 440, maxWidth: '90vw', boxShadow: 'var(--shadow-pop)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', flexShrink: 0 }}>
                <Trash2 size={16} />
              </span>
              <div>
                <div id="del-modal-title" style={{ fontSize: 14, fontWeight: 700 }}>Ticket löschen?</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                  {deleteModal.ticketNr && <span className="mono">{deleteModal.ticketNr} · </span>}
                  {deleteModal.title || '(ohne Titel)'}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
              Das Ticket wird endgültig gelöscht. Diese Aktion kann nicht rückgängig gemacht werden und wird im Audit-Log protokolliert.
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button variant="ghost" disabled={busy} onClick={() => setDeleteModal(null)}>Abbrechen</Button>
              <Button variant="danger" icon={<Trash2 size={14} />} autoFocus disabled={busy} onClick={() => void confirmDelete()}>
                {busy ? 'Wird gelöscht …' : 'Endgültig löschen'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Sammel-Lösch-Bestätigung (admin only) — ein Request, ehrliche Fehler/Ergebnisse */}
      {bulkDeleteOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="bulk-del-title"
          onKeyDown={(e) => { if (e.key === 'Escape' && !busy) setBulkDeleteOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { if (!busy) setBulkDeleteOpen(false); }}>
          {/* onClick nur zur Event-Eindämmung (stopPropagation); Dialog-Rolle + ESC liegen am Wrapper */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div ref={bulkPanelRef} style={{ background: 'var(--bg-card)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: 24, width: 460, maxWidth: '90vw', boxShadow: 'var(--shadow-pop)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', flexShrink: 0 }}>
                <Trash2 size={16} />
              </span>
              <div>
                <div id="bulk-del-title" style={{ fontSize: 14, fontWeight: 700 }}>{selected.size} Tickets löschen?</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Sammel-Löschung in einem Schritt.</div>
              </div>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
              Die ausgewählten Tickets werden endgültig gelöscht. Diese Aktion kann nicht rückgängig gemacht werden und wird als Sammel-Eintrag im Audit-Log protokolliert.
            </div>

            {/* Ehrliche Warnung bei großer Auswahl — Löschung läuft dann in mehreren Blöcken. */}
            {selected.size > BULK_DELETE_CHUNK_SIZE && (
              <div style={{ fontSize: 12, color: 'var(--warning)', background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', marginBottom: 14, lineHeight: 1.5 }}>
                Große Auswahl: {selected.size} Tickets werden in {chunkIds([...selected]).length} Blöcken zu je höchstens {BULK_DELETE_CHUNK_SIZE} nacheinander gelöscht. Das kann einen Moment dauern — bitte das Fenster offen lassen.
              </div>
            )}

            {/* Fortschritt der gechunkten Löschung. */}
            {bulkProgress && bulkProgress.total > 1 && (
              <div role="status" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
                Lösche Block {bulkProgress.done} von {bulkProgress.total} …
              </div>
            )}

            {bulkError && (
              <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', marginBottom: 14 }}>
                {bulkError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button variant="ghost" disabled={busy} onClick={() => setBulkDeleteOpen(false)}>Abbrechen</Button>
              <Button variant="danger" icon={<Trash2 size={14} />} autoFocus disabled={busy} onClick={() => void confirmBulkDelete()}>
                {busy ? 'Wird gelöscht …' : `Endgültig löschen (${selected.size})`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Absolutes Datum für den Tooltip der relativen Zeitangabe. */
function fmtAbsDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE');
}

const PRIORITY_BADGE_TONE = badge.severity;

/**
 * Smart-Header: leitet Kennzahlen aus der aktuell geladenen Liste ab und zeigt
 * offen · zugewiesen/unzugewiesen · Prioritätsverteilung. Bewusst aus der geladenen
 * Liste — der Subtitle nennt die Gesamtzahl, hier zählt das aktuell Sichtbare.
 */
function TicketsStatsHeader({ tickets, totalAll }: { tickets: Ticket[]; totalAll: number }) {
  const s = computeHeaderStats(tickets);
  const partial = totalAll > tickets.length;
  return (
    <Card style={{ padding: '10px 16px', marginBottom: 16, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <StatChip label="Offen" value={s.open} tone="success" />
      <StatChip label="Zugewiesen" value={s.assigned} tone="accent" />
      <StatChip label="Unzugewiesen" value={s.unassigned} tone={s.unassigned > 0 ? 'warning' : 'muted'} />
      <div style={{ width: 1, height: 26, background: 'var(--border-soft)' }} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Priorität</span>
        {PRIORITY_ORDER.filter((p) => s.priority[p] > 0).map((p) => (
          <Badge key={p} tone={PRIORITY_BADGE_TONE(p).tone}>{PRIORITY_BADGE_TONE(p).label} {s.priority[p]}</Badge>
        ))}
        {PRIORITY_ORDER.every((p) => s.priority[p] === 0) && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>—</span>
        )}
      </div>
      {partial && (
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>
          Kennzahlen für die {tickets.length} sichtbaren von {totalAll}
        </span>
      )}
    </Card>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: 'success' | 'accent' | 'warning' | 'muted' }) {
  const color = tone === 'success' ? 'var(--success)' : tone === 'accent' ? 'var(--accent)' : tone === 'warning' ? 'var(--warning)' : 'var(--text-muted)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
      <span style={{ fontSize: 18, fontWeight: 800, color }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{label}</span>
    </div>
  );
}

function ctxMenuStyle(x: number, y: number): CSSProperties {
  return {
    position: 'fixed', top: y, left: x, zIndex: 1000,
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-pop)', padding: 4, minWidth: 200, display: 'flex', flexDirection: 'column',
  };
}

const ctxItem: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 13,
  background: 'transparent', border: 'none', color: 'var(--text)', textAlign: 'left',
  cursor: 'pointer', borderRadius: 'var(--radius-sm)', width: '100%',
};

const iconBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4,
};
