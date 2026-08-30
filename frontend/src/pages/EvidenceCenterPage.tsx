import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive, FileText, Database, Link2, ShieldCheck, Clock, Search, Upload, Download,
  CheckCircle2, Flag, ChevronDown, ChevronRight, X, RotateCcw, StickyNote, ExternalLink,
} from 'lucide-react';
import { SectionHeader, StatCard, Card, CardBody, Badge, Button, EmptyState, Spinner, type Tone } from '../components/ui';
import { evidenceApi, type EvidenceItem, type EvidenceDetail } from '../features/evidence/evidenceApi';
import { EvidenceImportModal } from '../features/evidence/EvidenceImportModal';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { useTranslation } from 'react-i18next';

// ── Ableitungen aus echten Evidence-Daten (rawText = ParsedEvidence ODER ThreatIntelResult) ──
type Verdict = 'clean' | 'suspicious' | 'malicious' | 'unknown';

function safeParse(s?: string): Record<string, unknown> | null {
  if (!s) return null;
  try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch { return null; }
}
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const asStr = (v: unknown): string => (v == null || v === '' ? '' : String(v));

function deriveVerdict(p: Record<string, unknown> | null): Verdict {
  if (p && typeof p.verdict === 'string') return (p.verdict as Verdict);
  const rep = asStr(asObj(p?.destination).reputation);
  if (rep === 'malicious' || rep === 'suspicious') return rep;
  if (rep === 'harmless' || rep === 'clean') return 'clean';
  return 'unknown';
}
function deriveIndicator(item: EvidenceItem, p: Record<string, unknown> | null): string {
  if (p && typeof p.indicatorValue === 'string') return p.indicatorValue;
  const d = asObj(p?.destination); const s = asObj(p?.source);
  if (asStr(d.ip)) return `${asStr(s.ip) ? `${asStr(s.ip)} → ` : ''}${asStr(d.ip)}${d.port ? `:${asStr(d.port)}` : ''}`;
  return asStr(asObj(p?.file).name) || asStr(asObj(p?.process).image) || asStr(asObj(p?.dns).query) || item.eventId || item.title || '—';
}
function deriveKind(item: EvidenceItem): string {
  if (item.source === 'threatIntel') return 'Threat Intel';
  if (item.source === 'firewall') return 'Firewall';
  if (item.source === 'sysmon') return 'Sysmon';
  if (item.type === 'file') return 'File';
  if (item.type === 'network') return 'Network';
  if (item.type === 'process') return 'Process';
  if (item.type === 'dns') return 'DNS';
  if (/wazuh/i.test(item.logSource) || item.source === 'qradar') return 'Wazuh Alert';
  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

const verdictTone = (v: string): Tone => v === 'malicious' ? 'danger' : v === 'suspicious' ? 'warning' : v === 'clean' ? 'success' : 'muted';
const statusTone = (s: string): Tone => s === 'verified' ? 'success' : s === 'reviewed' ? 'accent' : s === 'flagged' ? 'danger' : 'muted';
const statusLabel = (s?: string): string => s === 'verified' ? 'Verified' : s === 'reviewed' ? 'Reviewed' : s === 'flagged' ? 'Flagged' : 'Open';
const sourceTone = (s: string): Tone => s === 'threatIntel' || s === 'sysmon' ? 'accent' : s === 'firewall' || s === 'edr' ? 'warning' : s === 'manual' ? 'success' : 'muted';
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('de-DE') : '—');

const ALL_TYPES = ['Threat Intel', 'Firewall', 'Sysmon', 'File', 'Network', 'Process', 'DNS', 'Wazuh Alert'];
const ALL_VERDICTS: Verdict[] = ['clean', 'suspicious', 'malicious', 'unknown'];
const ALL_STATUS = ['open', 'reviewed', 'verified', 'flagged'];
const RANGES: Record<string, number> = { '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000, all: Infinity };

export function EvidenceCenterPage() {
  const { t: tr } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canAct = can.act(user?.role);
  const [items, setItems] = useState<EvidenceItem[] | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [sel, setSel] = useState<EvidenceDetail | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const [fType, setFType] = useState('all');
  const [fSource, setFSource] = useState('all');
  const [fVerdict, setFVerdict] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [fRange, setFRange] = useState('7d');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    evidenceApi.recent(500)
      .then((r) => { if (alive) { setItems(r.data); if (r.data[0]) selectRow(r.data[0].id); } })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
     
  }, []);

  function selectRow(id: string) {
    setRawOpen(false);
    evidenceApi.get(id)
      .then((r) => setSel(r.data))
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : tr('app.evidenceCouldNotLoaded')));
  }
  function refreshList() {
    evidenceApi.recent(500)
      .then((r) => setItems(r.data))
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : tr('app.listCouldNotRefreshed')));
  }
  function doCustody(action: 'reviewed' | 'verified' | 'flagged') {
    if (!sel) return;
    setActionError('');
    evidenceApi.custody(sel.id, action)
      .then((r) => { setSel(r.data); refreshList(); })
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : tr('evidence.custodyActionFailed', { action })));
  }
  function addNote(note: string) {
    if (!sel || !note.trim()) return;
    setActionError('');
    evidenceApi.custody(sel.id, 'note', note.trim())
      .then((r) => { setSel(r.data); refreshList(); })
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : tr('app.noteCouldNotSaved')));
  }
  function jumpToTicket(ticketId?: string) {
    if (ticketId) navigate(`/tickets/${ticketId}`);
  }
  function onEvidenceCreated(item: EvidenceItem) {
    refreshList();
    selectRow(item.id);
  }
  function exportEvidence() {
    if (!sel?.ticketId) return;
    setActionError('');
    evidenceApi.exportTicket(sel.ticketId)
      .then((r) => {
        const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `evidence-${sel.ticketId}.json`; a.click();
      })
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : tr('common.exportFailed')));
  }

  const rows = useMemo(() => (items || []).map((item) => {
    const p = safeParse(item.rawText);
    return { item, parsed: p, kind: deriveKind(item), verdict: deriveVerdict(p), indicator: deriveIndicator(item, p) };
  }), [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const maxAge = RANGES[fRange] ?? Infinity;
    const now = Date.now();
    return rows.filter((r) => {
      if (fType !== 'all' && r.kind !== fType) return false;
      if (fSource !== 'all' && r.item.source !== fSource) return false;
      if (fVerdict !== 'all' && r.verdict !== fVerdict) return false;
      if (fStatus !== 'all' && (r.item.reviewStatus || 'open') !== fStatus) return false;
      if (maxAge !== Infinity && now - new Date(r.item.createdAt).getTime() > maxAge) return false;
      if (needle && ![r.item.title, r.indicator, r.item.source, r.item.ticketId, r.item.eventId, r.item.sha256].join(' ').toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, fType, fSource, fVerdict, fStatus, fRange, q]);

  const sources = useMemo(() => [...new Set((items || []).map((i) => i.source))].sort(), [items]);
  const kpis = useMemo(() => {
    const list = items || [];
    const dayAgo = Date.now() - 86_400_000;
    return {
      total: list.length,
      sources: new Set(list.map((i) => i.source)).size,
      tickets: new Set(list.map((i) => i.ticketId).filter(Boolean)).size,
      verified: list.filter((i) => i.reviewStatus === 'verified').length,
      last24: list.filter((i) => new Date(i.createdAt).getTime() > dayAgo).length,
    };
  }, [items]);

  const resetFilters = () => { setFType('all'); setFSource('all'); setFVerdict('all'); setFStatus('all'); setFRange('7d'); setQ(''); };

  return (
    <div>
      <SectionHeader title="Evidence Center" help="evidence" subtitle="Central overview of evidence items and chain of custody"
        onBack={() => navigate(-1)}
        actions={<Badge tone={items ? 'success' : 'muted'}>{items ? `${items.length} Items` : tr('app.loading2')}</Badge>} />

      {/* KPIs */}
      <div className="grid grid-kpi" style={{ marginBottom: 16 }}>
        <StatCard label="Evidence Items" value={items ? String(kpis.total) : '—'} tone="accent" icon={<FileText size={18} />} hint="All time" />
        <StatCard label="Sources" value={items ? String(kpis.sources) : '—'} tone="accent" icon={<Database size={18} />} hint="Active data sources" />
        <StatCard label="Linked Tickets" value={items ? String(kpis.tickets) : '—'} tone="accent" icon={<Link2 size={18} />} hint="With evidence" />
        <StatCard label="Verified Items" value={items ? String(kpis.verified) : '—'} tone="success" icon={<ShieldCheck size={18} />} hint={items && kpis.total ? `${Math.round((kpis.verified / kpis.total) * 100)}% of total` : '—'} />
        <StatCard label="Last 24h" value={items ? String(kpis.last24) : '—'} tone="accent" icon={<Clock size={18} />} hint="New evidence" />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {canAct && <Button variant="primary" size="sm" icon={<Upload size={14} />} onClick={() => setShowImport(true)}>Import Evidence</Button>}
        <Button variant="ghost" size="sm" icon={<ExternalLink size={14} />} disabled={!sel?.ticketId} onClick={() => jumpToTicket(sel?.ticketId)}>Link to Ticket</Button>
        {canAct && <Button variant="ghost" size="sm" icon={<ShieldCheck size={14} />} disabled={!sel} onClick={() => doCustody('verified')}>Verify Integrity</Button>}
        {canAct && <Button variant="ghost" size="sm" icon={<Download size={14} />} disabled={!sel?.ticketId} onClick={exportEvidence}>Export Bundle</Button>}
      </div>
      {actionError && (
        <div style={{ marginBottom: 10, padding: '8px 12px', background: 'color-mix(in srgb, var(--danger) 12%, transparent)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>{actionError}</span>
          <button onClick={() => setActionError('')} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 2 }}><X size={14} /></button>
        </div>
      )}

      {showImport && (
        <EvidenceImportModal
          initialTicketId={sel?.ticketId ?? ''}
          onCreated={onEvidenceCreated}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Filter */}
      <Card style={{ marginBottom: 14 }}>
        <CardBody style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', padding: '12px 14px' }}>
          <Select label="Type" value={fType} onChange={setFType} options={[['all', 'All Types'], ...ALL_TYPES.map((t) => [t, t] as [string, string])]} />
          <Select label="Source" value={fSource} onChange={setFSource} options={[['all', 'All Sources'], ...sources.map((s) => [s, s] as [string, string])]} />
          <Select label="Verdict" value={fVerdict} onChange={setFVerdict} options={[['all', 'All Verdicts'], ...ALL_VERDICTS.map((v) => [v, v.charAt(0).toUpperCase() + v.slice(1)] as [string, string])]} />
          <Select label="Status" value={fStatus} onChange={setFStatus} options={[['all', 'All Status'], ...ALL_STATUS.map((s) => [s, statusLabel(s)] as [string, string])]} />
          <Select label="Time Range" value={fRange} onChange={setFRange} options={[['24h', 'Last 24h'], ['7d', 'Last 7 Days'], ['30d', 'Last 30 Days'], ['all', 'All time']]} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={SUBLABEL}>Search</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '0 8px' }}>
              <Search size={14} style={{ color: 'var(--text-dim)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="title, indicator, hash, ticket, IP …"
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12.5, padding: '7px 0', outline: 'none' }} />
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={resetFilters}>Clear</Button>
        </CardBody>
      </Card>

      {error ? (
        <Card><CardBody><EmptyState icon={<Archive size={28} />} title={tr('app.couldNotLoadEvidence')} message={tr('app.pleaseTryAgainLaterCheck')} /></CardBody></Card>
      ) : !items ? (
        <Card><CardBody><Spinner label={tr('app.loadingEvidence')} /></CardBody></Card>
      ) : items.length === 0 ? (
        <Card><CardBody><EmptyState icon={<Archive size={28} />} title={tr('app.noEvidenceYet')} message={tr('label.onceAddEnrichmentEvidenceSave')} /></CardBody></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: sel ? 'minmax(0, 1.7fr) minmax(380px, 1fr)' : '1fr', gap: 16, alignItems: 'start' }}>
          {/* Tabelle */}
          <Card>
            <CardBody style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Type', 'Source', 'Verdict', 'Title', 'Indicator / Entity', 'Ticket', 'Integrity', 'Status'].map((h) => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.item.id} onClick={() => selectRow(r.item.id)} style={{ cursor: 'pointer', background: sel?.id === r.item.id ? 'var(--bg-card-soft)' : 'transparent' }}>
                      <td style={TD}><span style={{ fontWeight: 600 }}>{r.kind}</span></td>
                      <td style={TD}><Badge tone={sourceTone(r.item.source)} dot>{r.item.source}</Badge></td>
                      <td style={TD}><Badge tone={verdictTone(r.verdict)}>{r.verdict}</Badge></td>
                      <td style={{ ...TD, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.item.title || '—'}</td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.indicator}</td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--accent)' }}>{r.item.ticketId ? r.item.ticketId.slice(0, 8) : '—'}</td>
                      <td style={TD}>{r.item.sha256 ? <Badge tone="success" dot>Verified</Badge> : <Badge tone="muted">—</Badge>}</td>
                      <td style={TD}><Badge tone={statusTone(r.item.reviewStatus || 'open')}>{statusLabel(r.item.reviewStatus)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '7px 12px', fontSize: 11, color: 'var(--text-dim)', borderTop: '1px solid var(--border-soft)' }}>{filtered.length} von {items.length} Items</div>
            </CardBody>
          </Card>

          {/* Detail-Panel */}
          {sel && <DetailPanel sel={sel} rows={rows} rawOpen={rawOpen} setRawOpen={setRawOpen} onClose={() => setSel(null)} onCustody={doCustody} onExport={exportEvidence} onNote={addNote} onJumpTicket={jumpToTicket} canAct={canAct} />}
        </div>
      )}
    </div>
  );
}

// ── Detail-Panel ─────────────────────────────────────────────────────────────
function DetailPanel({ sel, rows, rawOpen, setRawOpen, onClose, onCustody, onExport, onNote, onJumpTicket, canAct }: {
  sel: EvidenceDetail; rows: { item: EvidenceItem; parsed: Record<string, unknown> | null; kind: string; verdict: Verdict; indicator: string }[];
  rawOpen: boolean; setRawOpen: (v: boolean) => void; onClose: () => void;
  onCustody: (a: 'reviewed' | 'verified' | 'flagged') => void; onExport: () => void;
  onNote: (note: string) => void; onJumpTicket: (ticketId?: string) => void;
  canAct: boolean;
}) {
  const { t: tr } = useTranslation();
  const [note, setNote] = useState('');
  const notes = sel.custody.filter((c) => c.action === 'note');
  const meta = rows.find((r) => r.item.id === sel.id);
  const p = meta?.parsed ?? safeParse(sel.rawText);
  const verdict = meta?.verdict ?? deriveVerdict(p);
  const indicator = meta?.indicator ?? deriveIndicator(sel, p);
  const tech = techFields(p);
  const custodyAt = (action: string) => { const e = [...sel.custody].reverse().find((c) => c.action === action); return e ? e.createdAt : null; };
  const assessment = asStr(p?.summary) || asStr(asObj(p?.detection).description) || sel.comment || '—';

  return (
    <div style={{ position: 'sticky', top: 12, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 90px)', overflowY: 'auto' }}>
      {/* Header */}
      <Card>
        <CardBody style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 8, background: 'var(--bg-card-soft)', color: 'var(--accent)', flexShrink: 0 }}><FileText size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{sel.title || meta?.kind || 'Evidence'}</span>
                <Badge tone={verdictTone(verdict)}>{verdict}</Badge>
                <Badge tone={statusTone(sel.reviewStatus)} dot>{statusLabel(sel.reviewStatus)}</Badge>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3 }}>{assessment !== '—' ? assessment.slice(0, 120) : `${meta?.kind || sel.type} evidence`}</div>
            </div>
            {sel.ticketId && (
              <Button variant="ghost" size="sm" icon={<ExternalLink size={13} />} onClick={() => onJumpTicket(sel.ticketId)} title={tr('app.openLinkedTicket')}>Ticket</Button>
            )}
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}><X size={16} /></button>
          </div>
        </CardBody>
      </Card>

      {/* Overview */}
      <DCard title="Overview">
        <KvGrid items={[
          ['Title', sel.title], ['Evidence Type', meta?.kind || sel.type], ['Source', sel.source],
          ['Verdict', verdict], ['Confidence', sel.confidence != null ? `${sel.confidence}%` : (p && typeof p.confidence === 'number' ? `${p.confidence}%` : '—')],
          ['Linked Ticket', sel.ticketId], ['Created By', sel.collectedBy], ['Created At', fmt(sel.createdAt)],
        ]} />
      </DCard>

      {/* Technical Fields */}
      <DCard title="Technical Fields">
        <KvGrid items={[
          ['Source IP', tech.sourceIp], ['Rule ID', tech.ruleId],
          ['Source Port', tech.sourcePort], ['Agent', tech.agent],
          ['Destination IP', tech.destIp], ['Process', tech.process],
          ['Destination Port', tech.destPort], ['File Path', tech.filePath],
          ['Protocol', tech.protocol], ['Hash (SHA-256)', tech.hash],
          ['Action', tech.action], ['', ''],
        ]} />
      </DCard>

      {/* Correlation */}
      <DCard title="Correlation">
        <KvGrid items={[
          ['Related Ticket', sel.ticketId], ['Related Host', asStr(asObj(p?.source).host) || asStr(asObj(p?.metadata).agentName)],
          ['Related IoC', indicator], ['Related User', asStr(asObj(p?.source).user)],
          ['Related Rule', tech.ruleId], ['Related FP Exception', 'None'],
        ]} />
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-soft)' }}>
          <div style={SUBLABEL}>Analyst Assessment</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{assessment}</div>
        </div>
      </DCard>

      {/* Chain of Custody */}
      <DCard title="Chain of Custody">
        <Stepper steps={[
          { label: 'Created', at: sel.createdAt }, { label: 'Ingested', at: sel.createdAt },
          { label: 'Linked', at: sel.ticketId ? sel.createdAt : null }, { label: 'Reviewed', at: custodyAt('reviewed') },
          { label: 'Verified', at: custodyAt('verified') }, { label: 'Flagged', at: custodyAt('flagged') }, { label: 'Exported', at: custodyAt('exported') },
        ]} />
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {canAct && <Button variant="ghost" size="sm" disabled={sel.reviewStatus === 'reviewed' || sel.reviewStatus === 'verified'} onClick={() => onCustody('reviewed')}>Reviewed</Button>}
          {canAct && <Button variant="ghost" size="sm" icon={<CheckCircle2 size={13} />} disabled={sel.reviewStatus === 'verified'} onClick={() => onCustody('verified')}>Verify</Button>}
          {canAct && <Button variant="ghost" size="sm" icon={<Flag size={13} />} onClick={() => onCustody('flagged')}>Flag</Button>}
          {canAct && <Button variant="ghost" size="sm" icon={<Download size={13} />} disabled={!sel.ticketId} onClick={onExport}>Export</Button>}
        </div>

        {/* Review-Notiz */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
          <div style={{ ...SUBLABEL, display: 'flex', alignItems: 'center', gap: 5 }}><StickyNote size={11} /> Review-Notizen</div>
          {notes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0 8px' }}>
              {notes.map((n) => (
                <div key={n.id} style={{ fontSize: 11.5, color: 'var(--text-muted)', background: 'var(--bg-card-soft)', borderRadius: 'var(--radius-sm)', padding: '6px 8px' }}>
                  <div>{n.note}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 2 }}>{n.actor || '—'} · {fmt(n.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
          {canAct && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) { onNote(note); setNote(''); } }}
                placeholder={tr('app.addNote')}
                style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12, padding: '6px 8px', outline: 'none' }}
              />
              <Button variant="ghost" size="sm" disabled={!note.trim()} onClick={() => { onNote(note); setNote(''); }}>Notiz</Button>
            </div>
          )}
        </div>
      </DCard>

      {/* Integrity */}
      <DCard title="Integrity">
        <KvGrid items={[
          ['SHA-256', sel.sha256 ? `${sel.sha256.slice(0, 24)}…` : '—'],
          ['Tamper Status', sel.sha256 ? 'Intact' : '—'],
          ['Last Verified', fmt(custodyAt('verified'))],
          ['Original Event ID', asStr(asObj(p?.raw).id) || asStr(p?.id) || sel.id.slice(0, 18)],
        ]} mono />
        {sel.sha256 && <div style={{ marginTop: 6 }}><Badge tone="success" dot>Intact</Badge></div>}
      </DCard>

      {/* Raw Event — collapsed */}
      <Card>
        <CardBody style={{ padding: '8px 12px' }}>
          <button onClick={() => setRawOpen(!rawOpen)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 600, width: '100%', textAlign: 'left' }}>
            {rawOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Raw Event
          </button>
          {rawOpen && <pre style={{ margin: '8px 0 0', background: 'var(--bg-terminal)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: 10, fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{sel.rawText || '—'}</pre>}
        </CardBody>
      </Card>
    </div>
  );
}

// ── kleine Bausteine ─────────────────────────────────────────────────────────
function techFields(p: Record<string, unknown> | null) {
  const dash = { sourceIp: '—', sourcePort: '—', destIp: '—', destPort: '—', protocol: '—', action: '—', ruleId: 'N/A', agent: '—', process: 'N/A', filePath: 'N/A', hash: '—' };
  if (!p) return dash;
  if (typeof p.verdict === 'string' && p.indicatorValue) {
    const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
    return { ...dash, destIp: p.indicatorType === 'ip' ? asStr(p.indicatorValue) : '—', protocol: tags.includes('multicast') ? 'Multicast (IGMP)' : '—', action: 'Informational', agent: 'ThreatIntel Feed' };
  }
  const d = asObj(p.destination), s = asObj(p.source), n = asObj(p.network), pr = asObj(p.process), f = asObj(p.file), det = asObj(p.detection), m = asObj(p.metadata);
  return {
    sourceIp: asStr(s.ip) || '—', sourcePort: asStr(s.port) || '—', destIp: asStr(d.ip) || '—', destPort: asStr(d.port) || '—',
    protocol: asStr(n.protocol) || '—', action: asStr(n.action) || '—', ruleId: asStr(det.ruleId) || 'N/A', agent: asStr(m.agentName) || '—',
    process: asStr(pr.image) || 'N/A', filePath: asStr(f.name) || 'N/A', hash: asStr(pr.hashes) || asStr(f.hashes) || '—',
  };
}

function DCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card><CardBody style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>{title}</div>
      {children}
    </CardBody></Card>
  );
}

function KvGrid({ items, mono }: { items: [string, string | null | undefined][]; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
      {/* Statisches KV-Layout mit Spacern (k===''), feste Reihenfolge → Index ist hier der korrekte Key */}
      {/* eslint-disable react/no-array-index-key */}
      {items.map(([k, v], i) => (k === '' ? <div key={i} /> : (
        <div key={i} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{k}</div>
          <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-all' }}>{v || '—'}</div>
        </div>
      )))}
      {/* eslint-enable react/no-array-index-key */}
    </div>
  );
}

function Stepper({ steps }: { steps: { label: string; at: string | null }[] }) {
  return (
    <div style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 4 }}>
      {steps.map((s, i) => {
        const done = !!s.at;
        return (
          <div key={s.label} style={{ flex: '1 0 auto', minWidth: 64, textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ flex: 1, height: 2, background: i === 0 ? 'transparent' : (done ? 'var(--success)' : 'var(--border-soft)') }} />
              <span style={{ display: 'grid', placeItems: 'center', width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: done ? 'var(--success)' : 'var(--bg-card-soft)', color: done ? '#06210f' : 'var(--text-dim)', border: done ? 'none' : '1px solid var(--border-soft)' }}>
                {done ? <CheckCircle2 size={12} /> : <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-dim)' }} />}
              </span>
              <div style={{ flex: 1, height: 2, background: i === steps.length - 1 ? 'transparent' : (steps[i + 1].at ? 'var(--success)' : 'var(--border-soft)') }} />
            </div>
            <div style={{ fontSize: 9.5, color: done ? 'var(--text-muted)' : 'var(--text-dim)', marginTop: 4, fontWeight: done ? 600 : 400 }}>{s.label}</div>
            <div style={{ fontSize: 8.5, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{s.at ? new Date(s.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
          </div>
        );
      })}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <div style={SUBLABEL}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, padding: '7px 8px', outline: 'none', minWidth: 120 }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

const SUBLABEL: CSSProperties = { fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
const TH: CSSProperties = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-dim)', padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid var(--border-soft)' };
const TD: CSSProperties = { padding: '7px 10px', fontSize: 12.5, color: 'var(--text)', borderBottom: '1px solid var(--border-soft)' };
