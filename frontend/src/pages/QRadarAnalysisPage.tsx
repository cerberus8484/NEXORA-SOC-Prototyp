import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Search, Globe, ShieldCheck, Copy, AlertTriangle, FileText, ListChecks,
  Clock, XCircle, ShieldAlert, RefreshCw, ExternalLink,
  Activity, Zap, Database, ChevronRight, Shield, Send,
} from 'lucide-react';
import { Card, Badge, Button, EmptyState, Spinner, ErrorCard, HelpTip, type Tone } from '../components/ui';
import { qradarApi, type QRadarOffense, type QRadarEvent, type QRadarStats, type QRadarPriority, type OffenseNote } from '../features/qradar/qradarApi';
import { resolvePanelState } from '../features/qradar/offensePanelState';
import { useCreateTicketFromOffense } from '../features/qradar/useCreateTicketFromOffense';
import { threatIntelApi } from '../features/threatIntel/threatIntelApi';
import type { ThreatIntelResult } from '../features/analysis/analysisModel';
import { can } from '../lib/rbac';
import { canViewQRadar } from '../lib/pageGates';
import { useAuth } from '../lib/auth';
import { loadChecks, saveChecks } from '../features/qradar/checklistPersistence';

// Konfigurierbare QRadar-Basis-URL (via Umgebungsvariable).
// VITE_QRADAR_URL z.B. "https://qradar.intern:8443"
const QRADAR_BASE_URL = (import.meta.env.VITE_QRADAR_URL as string | undefined) ?? '';

// ── Helpers ────────────────────────────────────────────────────────────────
// localStorage defensiv beschaffen: in manchen Umgebungen (SSR, gehärteter
// Browser-Modus) ist der Zugriff blockiert → dann null, Persistenz fällt sauber weg.
function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function relTime(iso?: string) {
  if (!iso) return '—';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'gerade';
  if (m < 60) return `vor ${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `vor ${h}h` : `vor ${Math.round(h / 24)}d`;
}

const PRIORITY_TONE: Record<QRadarPriority, Tone> = {
  critical: 'danger', high: 'warning', medium: 'accent', low: 'success', info: 'muted',
};
const PRIORITY_COLOR: Record<QRadarPriority, string> = {
  critical: 'var(--danger)', high: 'var(--accent-orange)', medium: 'var(--accent)', low: 'var(--success)', info: 'var(--text-dim)',
};

const LABEL: CSSProperties = { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };
const PANEL_H: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 };

// ── Tabs ───────────────────────────────────────────────────────────────────
const TABS = ['summary', 'events', 'iocs', 'notes', 'report'] as const;
type Tab = typeof TABS[number];
const TAB_LABEL: Record<Tab, string> = {
  summary: 'SUMMARY', events: 'EVENTS', iocs: 'IOCs', notes: 'NOTES', report: 'REPORT',
};

// ── Stat Kachel ────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon, color }: { label: string; value: ReactNode; icon: ReactNode; color: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: `color-mix(in srgb, ${color} 15%, transparent)`, color, flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

// ── Offense Queue Item ─────────────────────────────────────────────────────
function OffenseRow({ o, active, onClick }: { o: QRadarOffense; active: boolean; onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer',
        borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
        background: active ? 'var(--accent-soft)' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
        <Badge tone={PRIORITY_TONE[o.priority]}>{o.priority.toUpperCase()}</Badge>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{relTime(o.lastUpdated)}</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        #{o.id} — {o.offenseName}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
        <span>{o.sourceIps[0] || '—'}</span>·
        <span>{o.categories[0] || '—'}</span>·
        <span>{o.eventCount} Events</span>
      </div>
    </div>
  );
}

// ── Offense Header ─────────────────────────────────────────────────────────
function HeadField({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return <div><div style={LABEL}>{label}</div><div style={{ fontSize: 12.5, color: 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, marginTop: 2 }}>{value ?? '—'}</div></div>;
}

function openInQRadar(offenseId: number): void {
  if (!QRADAR_BASE_URL) return;
  window.open(`${QRADAR_BASE_URL}/console/qradar/jsp/QRadar.jsp?appName=Sem&pageId=OffenseSummary&summaryId=${offenseId}`, '_blank', 'noopener,noreferrer');
}

function QRadarLinkButton({ offenseId }: { offenseId: number }) {
  if (!QRADAR_BASE_URL) {
    return (
      <span title="QRadar-Basis-URL nicht konfiguriert (VITE_QRADAR_URL)">
        <Button variant="ghost" size="sm" icon={<ExternalLink size={13} />} disabled>In QRadar öffnen</Button>
      </span>
    );
  }
  return (
    <Button variant="ghost" size="sm" icon={<ExternalLink size={13} />} onClick={() => openInQRadar(offenseId)}>In QRadar öffnen</Button>
  );
}

function OffenseHeader({ o }: { o: QRadarOffense }) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <HeadField label="Offense ID" value={<span className="mono" style={{ color: 'var(--accent)' }}>#{o.id}</span>} />
          <HeadField label="Priority" value={<Badge tone={PRIORITY_TONE[o.priority]} dot>{o.priority.toUpperCase()}</Badge>} />
          <HeadField label="Status" value={<Badge tone={o.status === 'OPEN' ? 'success' : 'muted'}>{o.status}</Badge>} />
          <HeadField label="Severity" value={`${o.severity}/10`} />
          <HeadField label="Magnitude" value={`${o.magnitude}/10`} />
          <HeadField label="Assigned" value={o.assignedTo || 'unassigned'} />
        </div>
        <QRadarLinkButton offenseId={o.id} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
        <HeadField label="Source IP" value={o.sourceIps[0]} mono />
        <HeadField label="Destination" value={o.destIps[0]} mono />
        <HeadField label="Events" value={o.eventCount.toLocaleString('de-DE')} />
        <HeadField label="Start" value={fmtDate(o.startTime)} />
        <HeadField label="Last Update" value={fmtDate(o.lastUpdated)} />
      </div>
    </Card>
  );
}

// ── SUMMARY Tab ────────────────────────────────────────────────────────────
function SummaryTab({ o }: { o: QRadarOffense }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {/* Beschreibung */}
      <Card style={{ padding: '14px 16px', gridColumn: '1 / -1' }}>
        <div style={PANEL_H}><FileText size={15} style={{ color: 'var(--accent)' }} />Offense Description</div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{o.description}</p>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
          Log Sources: <strong style={{ color: 'var(--text-muted)' }}>{o.logSources.join(', ')}</strong>
        </div>
      </Card>

      {/* QRadar Scores */}
      <Card style={{ padding: '14px 16px' }}>
        <div style={PANEL_H}><Activity size={15} style={{ color: 'var(--warning)' }} />QRadar Scoring</div>
        {[
          { label: 'Severity', value: o.severity, max: 10, color: PRIORITY_COLOR[o.priority] },
          { label: 'Credibility', value: o.credibility, max: 10, color: 'var(--accent)' },
          { label: 'Relevance', value: o.relevance, max: 10, color: 'var(--purple)' },
          { label: 'Magnitude', value: o.magnitude, max: 10, color: 'var(--warning)' },
        ].map(({ label, value, max, color }) => (
          <div key={label} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span className="mono" style={{ color: 'var(--text)', fontWeight: 700 }}>{value}/{max}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-input)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(value / max) * 100}%`, background: color, borderRadius: 3, transition: 'width .4s ease' }} />
            </div>
          </div>
        ))}
      </Card>

      {/* Kategorien & MITRE */}
      <Card style={{ padding: '14px 16px' }}>
        <div style={PANEL_H}><ShieldAlert size={15} style={{ color: 'var(--danger)' }} />Categories &amp; MITRE</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ ...LABEL, marginBottom: 6 }}>QRadar Categories</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {o.categories.map((c) => <Badge key={c} tone="warning">{c}</Badge>)}
          </div>
        </div>
        <div>
          <div style={{ ...LABEL, marginBottom: 6 }}>MITRE ATT&amp;CK Techniques</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {o.mitreT.length > 0
              ? o.mitreT.map((t) => <Badge key={t} tone="danger">{t}</Badge>)
              : <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine Techniken verknüpft.</span>}
          </div>
        </div>
      </Card>

      {/* Netzwerk */}
      <Card style={{ padding: '14px 16px' }}>
        <div style={PANEL_H}><Globe size={15} style={{ color: 'var(--success)' }} />Network Context</div>
        <div style={{ marginBottom: 8 }}>
          <div style={LABEL}>Source IPs</div>
          {o.sourceIps.length > 0
            ? o.sourceIps.map((ip) => <div key={ip} className="mono" style={{ fontSize: 12, color: 'var(--text)', marginTop: 3 }}>{ip}</div>)
            : <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>—</div>}
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={LABEL}>Destination IPs</div>
          {o.destIps.length > 0
            ? o.destIps.map((ip) => <div key={ip} className="mono" style={{ fontSize: 12, color: 'var(--text)', marginTop: 3 }}>{ip}</div>)
            : <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>—</div>}
        </div>
        <div>
          <div style={LABEL}>Log Sources</div>
          {o.logSources.map((ls) => <div key={ls} style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{ls}</div>)}
        </div>
      </Card>

      {/* Timeline Preview */}
      <Card style={{ padding: '14px 16px' }}>
        <div style={PANEL_H}><Clock size={15} style={{ color: 'var(--purple)' }} />Timeline</div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <div><div style={LABEL}>Start</div><div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 2 }}>{fmtDate(o.startTime)}</div></div>
          <div><div style={LABEL}>Last Event</div><div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 2 }}>{fmtDate(o.lastUpdated)}</div></div>
          <div><div style={LABEL}>Events</div><div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 2 }}>{o.eventCount.toLocaleString('de-DE')}</div></div>
          <div><div style={LABEL}>Flows</div><div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 2 }}>{o.flowCount.toLocaleString('de-DE')}</div></div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-dim)' }}>Detaillierte Event-Timeline im Tab „EVENTS".</div>
      </Card>
    </div>
  );
}

// ── EVENTS Tab ─────────────────────────────────────────────────────────────
function EventsTab({ offenseId }: { offenseId: number }) {
  const [events, setEvents] = useState<QRadarEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setLoading(true); setEvents(null); setHasError(false);
    let alive = true;
    qradarApi.events(offenseId)
      .then((r) => { if (alive) setEvents(r.data); })
      // „leer" ≠ „Fehler": Abruf-Fehler als Fehlerzustand markieren, nicht als „keine Events".
      .catch(() => { if (alive) setHasError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [offenseId]);

  const state = resolvePanelState({ loading, hasError, itemCount: events?.length ?? 0 });
  if (state === 'loading') return <Card style={{ padding: '14px 16px' }}><Spinner label="Events werden geladen …" /></Card>;
  if (state === 'error') return <Card style={{ padding: '14px 16px' }}><EmptyState icon={<AlertTriangle size={28} style={{ color: 'var(--danger)' }} />} title="Events nicht ladbar" message="Der Abruf der QRadar-Events ist fehlgeschlagen. Bitte später erneut versuchen — dies ist KEIN leeres Ergebnis." /></Card>;
  if (state === 'empty') return <Card style={{ padding: '14px 16px' }}><EmptyState title="Keine Events" message="Keine Events für diese Offense verfügbar." /></Card>;
  if (!events) return null;

  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={PANEL_H}><Database size={15} style={{ color: 'var(--accent)' }} />Event Log ({events.length} Events)</div>
      {events.map((e) => (
        <div key={e.time} style={{ padding: '9px 0', borderBottom: '1px solid var(--border-soft)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono" style={{ color: 'var(--accent)', fontSize: 11, minWidth: 130 }}>{fmtDate(e.time)}</span>
            <Badge tone="muted">{e.log_source}</Badge>
            <Badge tone="warning">{e.category}</Badge>
            {e.src_ip && <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{e.src_ip}{e.src_port ? `:${e.src_port}` : ''}{e.dst_ip ? ` → ${e.dst_ip}` : ''}{e.dst_port ? `:${e.dst_port}` : ''}</span>}
            {e.username && <Badge tone="muted">{e.username}</Badge>}
          </div>
          <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', lineHeight: 1.4 }}>{e.message}</div>
        </div>
      ))}
    </Card>
  );
}

// ── IOCs Tab ───────────────────────────────────────────────────────────────
function IocRow({ ip }: { ip: string }) {
  const [res, setRes] = useState<ThreatIntelResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrichError, setEnrichError] = useState('');
  const tiTone = (v?: string): Tone => v === 'malicious' ? 'danger' : v === 'suspicious' ? 'warning' : v === 'clean' ? 'success' : 'muted';
  const btn: CSSProperties = { background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 3, display: 'inline-flex' };

  async function enrich() {
    setBusy(true); setEnrichError('');
    try { const r = await threatIntelApi.enrich('ip', ip); setRes(r.data); }
    catch (e) { setEnrichError(e instanceof Error ? e.message : 'Threat-Intel-Abfrage fehlgeschlagen'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge tone="muted">ip</Badge>
        <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>{ip}</span>
        {res && <Badge tone={tiTone(res.verdict)}>{res.verdict}</Badge>}
        <button style={{ ...btn, color: 'var(--accent)' }} disabled={busy} onClick={() => void enrich()} title="Threat Intel"><Globe size={14} /></button>
        <button style={btn} onClick={() => navigator.clipboard?.writeText(ip)} title="Copy"><Copy size={14} /></button>
      </div>
      {busy && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Enriching …</div>}
      {enrichError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{enrichError}</div>}
      {res && (
        <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', fontSize: 11 }}>
          <div style={{ display: 'flex', gap: 12, color: 'var(--text-muted)', marginBottom: 3 }}>
            <span>Score <b style={{ color: 'var(--text)' }}>{res.score}</b></span>
            <span>Confidence <b style={{ color: 'var(--text)' }}>{res.confidence}%</b></span>
          </div>
          <div style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>{res.summary}</div>
        </div>
      )}
    </div>
  );
}

function IoCsTab({ o }: { o: QRadarOffense }) {
  const ips = useMemo(() => [...new Set([...o.sourceIps, ...o.destIps])], [o]);
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={PANEL_H}><AlertTriangle size={15} style={{ color: 'var(--warning)' }} />Indicators of Compromise ({ips.length})</div>
      {ips.length === 0
        ? <EmptyState title="Keine IPs" message="Keine Source/Dest-IPs in dieser Offense." />
        : ips.map((ip) => <IocRow key={ip} ip={ip} />)}
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-dim)' }}>Threat Intel = Kontext. Kein automatisches Verdict.</div>
    </Card>
  );
}

// ── NOTES Tab ──────────────────────────────────────────────────────────────
const CHECKLIST = [
  'Source IP in Threat Intel geprüft',
  'Log Sources validiert',
  'Betroffene Hosts isoliert / geprüft',
  'MITRE-Techniken verifiziert',
  'Korrelation zu anderen Offenses geprüft',
  'Eskalation entschieden',
  'Ticket in Nexora angelegt',
  'Bericht erstellt',
];

const s: Record<string, CSSProperties> = {
  notesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: 320,
    overflowY: 'auto',
    marginBottom: 12,
  },
  noteItem: {
    background: 'var(--bg-input)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 10px',
  },
  noteMeta: {
    fontSize: 10.5,
    color: 'var(--text-dim)',
    marginBottom: 4,
    display: 'flex',
    gap: 8,
  },
  noteContent: {
    fontSize: 12.5,
    color: 'var(--text)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  ta: {
    width: '100%',
    minHeight: 80,
    background: 'var(--bg-input)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text)',
    padding: 8,
    fontSize: 12.5,
    resize: 'vertical' as const,
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  },
};

function fmtNote(iso: string) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function NotesTab({ offenseId, canAct }: { offenseId: number; canAct: boolean }) {
  const [notes, setNotes]       = useState<OffenseNote[]>([]);
  const [draft, setDraft]       = useState('');
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState('');
  // #2: Checklisten-Haken je Offense persistiert (localStorage) — überleben Offense-Wechsel + Reload.
  // Lazy-Init aus dem Storage für die initiale Offense; bei Offense-Wechsel lädt der Effekt neu.
  const [checks, setChecks]     = useState<boolean[]>(() => loadChecks(safeLocalStorage(), offenseId, CHECKLIST.length));
  const listRef                 = useRef<HTMLDivElement>(null);

  // Beim Offense-Wechsel: gespeicherten Checklisten-Stand dieser Offense laden.
  useEffect(() => {
    setChecks(loadChecks(safeLocalStorage(), offenseId, CHECKLIST.length));
  }, [offenseId]);

  // Checkbox umschalten + sofort je Offense persistieren (defensiv gegen Storage-Fehler).
  function toggleCheck(index: number) {
    setChecks((prev) => {
      const next = prev.map((v, i) => (i === index ? !v : v));
      saveChecks(safeLocalStorage(), offenseId, next);
      return next;
    });
  }

  useEffect(() => {
    setLoading(true);
    setNotes([]);
    setLoadError(false);
    let alive = true;
    qradarApi.getOffenseNotes(String(offenseId))
      .then((r) => { if (alive) setNotes(r.data); })
      // „leer" ≠ „Fehler": fehlgeschlagenen Abruf markieren, nicht als „keine Notizen" tarnen.
      .catch(() => { if (alive) setLoadError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [offenseId]);

  const notesState = resolvePanelState({ loading, hasError: loadError, itemCount: notes.length });

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await qradarApi.addOffenseNote(String(offenseId), trimmed);
      setNotes((prev) => [...prev, res.data]);
      setDraft('');
      // Scroll zur neuesten Notiz
      setTimeout(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
      }, 50);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {/* Persistente Analyst Notes */}
      <Card style={{ padding: '14px 16px' }}>
        <div style={PANEL_H}><FileText size={15} style={{ color: 'var(--accent)' }} />Analyst Notes</div>

        {notesState === 'loading'
          ? <Spinner label="Notizen werden geladen …" />
          : notesState === 'error'
            ? <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>Notizen nicht ladbar — Abruf fehlgeschlagen. Dies ist kein leerer Zustand; bitte später erneut versuchen.</div>
            : notesState === 'empty'
            ? <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>Noch keine Notizen.</div>
            : (
              <div ref={listRef} style={s.notesList}>
                {notes.map((n) => (
                  <div key={n.id} style={s.noteItem}>
                    <div style={s.noteMeta}>
                      <span>{fmtNote(n.createdAt)}</span>
                      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{n.author.slice(0, 8)}…</span>
                    </div>
                    <div style={s.noteContent}>{n.content}</div>
                  </div>
                ))}
              </div>
            )
        }

        {canAct && (
          <div style={{ marginTop: 6 }}>
            <textarea
              style={s.ta}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Neue Notiz zur Offense …"
              disabled={saving}
              maxLength={5000}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{draft.length}/5000</span>
              <Button
                variant="primary"
                size="sm"
                icon={<Send size={12} />}
                disabled={saving || !draft.trim()}
                onClick={() => void handleSave()}
              >
                {saving ? 'Speichern …' : 'Speichern'}
              </Button>
            </div>
            {saveError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{saveError}</div>}
          </div>
        )}

        {!canAct && (
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8 }}>
            Notizen schreiben erfordert Analyst-Rolle.
          </div>
        )}
      </Card>

      {/* Investigation Checklist */}
      <Card style={{ padding: '14px 16px' }}>
        <div style={PANEL_H}><ListChecks size={15} style={{ color: 'var(--success)' }} />Investigation Checklist</div>
        {CHECKLIST.map((c, n) => (
          <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '4px 0', cursor: 'pointer', color: checks[n] ? 'var(--text-dim)' : 'var(--text)' }}>
            <input type="checkbox" checked={checks[n]} onChange={() => toggleCheck(n)} />
            <span style={{ textDecoration: checks[n] ? 'line-through' : 'none' }}>{c}</span>
          </label>
        ))}
      </Card>
    </div>
  );
}

// ── REPORT Tab ─────────────────────────────────────────────────────────────
function ReportTab({ o, canAct }: { o: QRadarOffense; canAct: boolean }) {
  const { create, busy, error } = useCreateTicketFromOffense();
  // Analyst-Notes selbst laden (gleiche Quelle wie der Notes-Tab) — damit der
  // Report-Abschnitt „Analyst Notes" echte Notizen enthält statt dauerhaft „—".
  const [notes, setNotes] = useState<OffenseNote[]>([]);
  const [notesError, setNotesError] = useState(false);
  useEffect(() => {
    let alive = true;
    setNotesError(false);
    qradarApi.getOffenseNotes(String(o.id))
      .then((r) => { if (alive) setNotes(r.data); })
      // „leer" ≠ „Fehler": Abrufproblem im Report ehrlich vermerken, nicht als „—".
      .catch(() => { if (alive) setNotesError(true); });
    return () => { alive = false; };
  }, [o.id]);
  const notesText = notesError
    ? '_Notizen nicht ladbar — Abruf fehlgeschlagen (kein leerer Zustand)._'
    : notes.length > 0
      ? notes.map((n) => `- [${fmtNote(n.createdAt)}] ${n.content}`).join('\n')
      : '—';

  const md = useMemo(() => [
    `# QRadar Offense Report — #${o.id}`, '',
    '## Summary', o.offenseName, '',
    '## Description', o.description, '',
    `## QRadar Scores`,
    `- Severity: ${o.severity}/10`,
    `- Credibility: ${o.credibility}/10`,
    `- Relevance: ${o.relevance}/10`,
    `- Magnitude: ${o.magnitude}/10`,
    '',
    '## Affected Assets',
    `- Source IPs: ${o.sourceIps.join(', ') || '—'}`,
    `- Destination IPs: ${o.destIps.join(', ') || '—'}`,
    '',
    '## Categories', ...o.categories.map((c) => `- ${c}`), '',
    '## MITRE ATT&CK', o.mitreT.length > 0 ? o.mitreT.map((t) => `- ${t}`).join('\n') : '—', '',
    '## Log Sources', o.logSources.join(', '), '',
    '## Timeline',
    `- Start: ${fmtDate(o.startTime)}`,
    `- Last Update: ${fmtDate(o.lastUpdated)}`,
    `- Event Count: ${o.eventCount}`,
    '',
    '## Analyst Notes', notesText,
  ].join('\n'), [o, notesText]);

  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary" size="sm" onClick={() => navigator.clipboard?.writeText(md)}>Copy to Clipboard</Button>
        <Button variant="ghost" size="sm" onClick={() => { const b = new Blob([md], { type: 'text/markdown' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `qradar-offense-${o.id}.md`; a.click(); }}>Export Markdown</Button>
        {canAct && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void create(o)}>{busy ? 'Erstelle …' : 'Create Nexora Ticket'}</Button>}
        {error && <span style={{ fontSize: 11.5, color: 'var(--danger)' }}>{error}</span>}
      </div>
      <pre style={{ margin: 0, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: 12, fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>{md}</pre>
    </Card>
  );
}

// ── Enrichment Sidebar ─────────────────────────────────────────────────────
function EnrichmentSidebar({ o, canAct }: { o: QRadarOffense | null; canAct: boolean }) {
  const [tiResult, setTiResult] = useState<ThreatIntelResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrichError, setEnrichError] = useState('');
  const { create, busy: ticketBusy, error: ticketError } = useCreateTicketFromOffense();
  const targetIp = o?.sourceIps[0] || '';
  const tiTone = (v: string): Tone => v === 'malicious' ? 'danger' : v === 'suspicious' ? 'warning' : v === 'clean' ? 'success' : 'muted';

  useEffect(() => { setTiResult(null); setEnrichError(''); }, [o?.id]);

  async function enrich() {
    if (!targetIp) return;
    setBusy(true); setEnrichError('');
    try { const r = await threatIntelApi.enrich('ip', targetIp); setTiResult(r.data); }
    catch (e) { setEnrichError(e instanceof Error ? e.message : 'Threat-Intel-Abfrage fehlgeschlagen'); }
    finally { setBusy(false); }
  }

  if (!o) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card style={{ padding: '12px 14px' }}><EmptyState title="Kein Offense" message="Offense auswählen." /></Card>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Threat Intel */}
      <Card style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ ...PANEL_H, marginBottom: 0 }}><Globe size={14} style={{ color: 'var(--accent)' }} />Threat Intel</span>
        </div>
        {!targetIp ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Keine Source-IP verfügbar.</div>
        ) : !tiResult ? (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>Source IP: <span className="mono" style={{ color: 'var(--text)' }}>{targetIp}</span></div>
            <Button variant="primary" size="sm" icon={<Globe size={13} />} disabled={busy} onClick={() => void enrich()} style={{ width: '100%' }}>{busy ? 'Enriching …' : 'Enrich'}</Button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Badge tone={tiTone(tiResult.verdict)} dot>{tiResult.verdict}</Badge>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tiResult.indicatorValue}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>{tiResult.summary}</div>
            {tiResult.tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>{tiResult.tags.map((t) => <Badge key={t} tone="muted">{t}</Badge>)}</div>}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void enrich()} style={{ width: '100%' }}>Erneut prüfen</Button>
          </>
        )}
        {enrichError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{enrichError}</div>}
      </Card>

      {/* Offense Quick-Facts */}
      <Card style={{ padding: '12px 14px' }}>
        <div style={PANEL_H}><Zap size={14} style={{ color: 'var(--warning)' }} />Quick Facts</div>
        {[
          { label: 'Offense ID', value: `#${o.id}` },
          { label: 'Priority', value: <Badge tone={PRIORITY_TONE[o.priority]}>{o.priority.toUpperCase()}</Badge> },
          { label: 'Event Count', value: o.eventCount.toLocaleString('de-DE') },
          { label: 'Sources', value: o.sourceCount },
          { label: 'Assigned To', value: o.assignedTo || '(unassigned)' },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 12 }}>
            <span style={{ color: 'var(--text-dim)' }}>{label}</span>
            <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{value}</span>
          </div>
        ))}
      </Card>

      {/* Actions */}
      <Card style={{ padding: '12px 14px' }}>
        <div style={PANEL_H}><ShieldCheck size={14} style={{ color: 'var(--success)' }} />Actions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <QRadarLinkButton offenseId={o.id} />
          {canAct && (
            <Button variant="primary" size="sm" icon={<ChevronRight size={13} />} disabled={ticketBusy} onClick={() => void create(o)}>
              {ticketBusy ? 'Erstelle …' : 'Nexora Ticket erstellen'}
            </Button>
          )}
          {canAct && (
            <Button variant="ghost" size="sm" icon={<XCircle size={13} />} disabled={ticketBusy} onClick={() => void create(o, { asFalsePositive: true })}>
              Als False Positive schließen
            </Button>
          )}
          {ticketError && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{ticketError}</span>}
        </div>
      </Card>
    </div>
  );
}

// ── KPI Bar ────────────────────────────────────────────────────────────────
function KpiBar({ stats }: { stats: QRadarStats }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
      <KpiCard label="Offenses offen" value={stats.openCount} icon={<ShieldAlert size={18} />} color="var(--danger)" />
      <KpiCard label="Critical" value={stats.criticalCount} icon={<AlertTriangle size={18} />} color="var(--danger)" />
      <KpiCard label="High" value={stats.highCount} icon={<Activity size={18} />} color="var(--accent-orange)" />
      <KpiCard label="Total Events" value={stats.totalEvents.toLocaleString('de-DE')} icon={<Database size={18} />} color="var(--accent)" />
    </div>
  );
}

// ── Not-Connected EmptyState ────────────────────────────────────────────────
function QRadarNotConnected() {
  return (
    <Card style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'grid', placeItems: 'center', width: 56, height: 56, borderRadius: 16, background: 'color-mix(in srgb, var(--text-dim) 12%, transparent)', color: 'var(--text-dim)' }}>
          <Shield size={28} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            QRadar nicht konfiguriert
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', maxWidth: 480, lineHeight: 1.6 }}>
            Diese Integration erfordert eine QRadar-SIEM-Instanz. Konfigurieren Sie{' '}
            <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', padding: '1px 5px', borderRadius: 4 }}>QRADAR_URL</code>{' '}
            und{' '}
            <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', padding: '1px 5px', borderRadius: 4 }}>QRADAR_TOKEN</code>{' '}
            in den Umgebungsvariablen.
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export function QRadarAnalysisPage() {
  const { user } = useAuth();
  const canAct = can.act(user?.role);

  // Full-page RBAC gate: analyst+ (mirrors server-side /qradar/* route).
  // Enforcement is server-side; this gate prevents unnecessary data fetches for
  // viewer-role users and provides a clear "no permission" state (defense-in-depth).
  const hasAccess = canViewQRadar(user?.role);

  const [offenses, setOffenses] = useState<QRadarOffense[] | null>(null);
  const [stats, setStats] = useState<QRadarStats | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('summary');

  const load = () => {
    // Guard: skip all data fetches for users below analyst level.
    if (!hasAccess) { setLoading(false); return; }
    setLoading(true); setError('');
    Promise.all([qradarApi.offenses(filter), qradarApi.stats()])
      .then(([o, s]) => {
        setOffenses(o.data);
        setStats(s.data);
        setConnected(s.data.connected ?? false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter, hasAccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => offenses ?? [], [offenses]);
  useEffect(() => { if (!selId && all.length) setSelId(all[0].id); }, [all, selId]);

  const queue = useMemo(() => all.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [o.offenseName, o.description, ...o.sourceIps, ...o.categories, String(o.id)].join(' ').toLowerCase().includes(q);
  }), [all, search]);

  const active = all.find((o) => o.id === selId) ?? null;

  const statusBadge = connected === null
    ? null
    : connected
      ? <Badge tone="success">VERBUNDEN</Badge>
      : <Badge tone="muted">NICHT VERBUNDEN</Badge>;

  // Full-page gate: viewers see a clear empty state, no data is loaded.
  if (!hasAccess) {
    return (
      <div style={{ padding: '32px 20px' }}>
        <EmptyState
          title="Keine Berechtigung"
          message="Das QRadar Analysis Center erfordert mindestens die Analyst-Rolle."
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 8, background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)' }}><ShieldAlert size={16} /></div>
            QRadar Analysis Center
            <HelpTip topic="qradar" />
            {statusBadge}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>IBM QRadar SIEM — Offense Triage &amp; Investigation</div>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={load}>Aktualisieren</Button>
      </div>

      {error && <div style={{ marginBottom: 14 }}><ErrorCard message={error} /></div>}
      {loading && <Spinner label="QRadar Offenses werden geladen …" />}

      {/* Nicht konfiguriert — klarer EmptyState */}
      {!loading && !error && connected === false && <QRadarNotConnected />}

      {/* KPI Bar nur wenn verbunden und Daten vorhanden */}
      {!loading && connected && stats && offenses && offenses.length > 0 && <KpiBar stats={stats} />}

      {/* Verbunden aber keine Offenses */}
      {!loading && !error && connected && offenses && offenses.length === 0 && (
        <Card style={{ padding: '36px 16px' }}>
          <EmptyState
            title="Keine offenen Offenses"
            message="QRadar ist verbunden. Aktuell sind keine Offenses im gewählten Filter vorhanden."
          />
        </Card>
      )}

      {!loading && !error && connected && offenses && offenses.length > 0 && (
        <>
          {/* Offense Header */}
          {active && <div style={{ marginBottom: 14 }}><OffenseHeader o={active} /></div>}

          {/* 3-Spalten Deck */}
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 300px', gap: 14, flex: 1, alignItems: 'start' }}>
            {/* Offense Queue */}
            <Card style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '72vh' }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700 }}>Offense Queue</div>

              {/* Filter + Search */}
              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  {(['OPEN', 'ALL'] as const).map((f) => (
                    <button key={f} onClick={() => { setFilter(f); setSelId(null); }} style={{ flex: 1, fontSize: 10.5, fontWeight: 600, padding: '5px 4px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid', background: filter === f ? 'var(--accent-soft)' : 'transparent', borderColor: filter === f ? 'var(--accent)' : 'var(--border-soft)', color: filter === f ? 'var(--accent)' : 'var(--text-muted)' }}>{f} {filter === f && `(${queue.length})`}</button>
                  ))}
                </div>
                <div style={{ position: 'relative' }}>
                  <Search size={12} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--text-dim)' }} />
                  <input placeholder="Suche…" value={search} onChange={(e) => setSearch(e.target.value)}
                    style={{ width: '100%', paddingLeft: 26, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '5px 8px 5px 26px', fontSize: 11.5 }} />
                </div>
              </div>

              <div style={{ overflowY: 'auto', flex: 1 }}>
                {queue.length === 0
                  ? <div style={{ padding: 20, fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>Keine Offenses</div>
                  : queue.map((o) => (
                    <OffenseRow key={o.id} o={o} active={selId === o.id} onClick={() => { setSelId(o.id); setTab('summary'); }} />
                  ))}
              </div>
            </Card>

            {/* Analysis Deck */}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {active ? (
                <>
                  <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-soft)', marginBottom: 14, overflowX: 'auto' }}>
                    {TABS.map((t) => (
                      <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', color: tab === t ? 'var(--accent)' : 'var(--text-muted)' }}>{TAB_LABEL[t]}</button>
                    ))}
                  </div>
                  {tab === 'summary' && <SummaryTab o={active} />}
                  {tab === 'events' && <EventsTab offenseId={active.id} />}
                  {tab === 'iocs' && <IoCsTab o={active} />}
                  {tab === 'notes' && <NotesTab offenseId={active.id} canAct={canAct} />}
                  {tab === 'report' && <ReportTab o={active} canAct={canAct} />}
                </>
              ) : <EmptyState title="Kein Offense ausgewählt" message="Wähle links eine Offense aus der Queue." />}
            </div>

            {/* Enrichment Sidebar */}
            <EnrichmentSidebar o={active} canAct={canAct} />
          </div>
        </>
      )}
    </div>
  );
}
