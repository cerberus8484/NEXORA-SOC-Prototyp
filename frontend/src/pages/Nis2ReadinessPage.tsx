import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { ShieldCheck, AlertTriangle, Clock, FileCheck2, Plus, Trash2, Check, RefreshCw, Link2, BarChart3, ListChecks } from 'lucide-react';
import { Badge, Button, Spinner, ErrorCard, HelpTip } from '../components/ui';
import {
  nis2Api, ASSESSMENT_STATUSES, EVIDENCE_TYPES,
  type Nis2ControlRow, type Nis2Summary, type Nis2ControlDetail,
  type AssessmentStatus, type EvidenceType, type UpdateAssessmentBody, type AddEvidenceBody,
  type Nis2ManagementReport,
} from '../features/compliance/nis2Api';
import {
  statusLabel, statusTone, evidenceTypeLabel, controlSignal, isAddressedWithoutEvidence,
  formatDate, coverageTone, NIS2_HEADER_TITLE, NIS2_HEADER_SUBTITLE,
  reportStatusRows, incidentCoverageText, formatGeneratedAt, reportControlTone,
} from '../features/compliance/nis2View';
import { ticketApi } from '../features/tickets/ticketApi';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';

const s: Record<string, CSSProperties> = {
  page:      { padding: '16px 20px' },
  head:      { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' },
  kpis:      { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 },
  kpi:       { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', padding: '14px 16px' },
  kpiLabel:  { fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 },
  kpiValue:  { fontSize: 26, fontWeight: 700, marginTop: 6 },
  layout:    { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 16, alignItems: 'start' },
  panel:     { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)' },
  panelHead: { padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 10 },
  th:        { textAlign: 'left', fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, padding: '8px 12px', borderBottom: '1px solid var(--border-soft)' },
  td:        { fontSize: 12.5, padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'middle' },
  label:     { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4, display: 'block' },
  input:     { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' as const },
  group:     { display: 'flex', flexDirection: 'column' as const, gap: 4, marginBottom: 12 },
  hint:      { fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45 },
  warn:      { background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.30)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12, color: 'var(--warning)', display: 'flex', gap: 8, alignItems: 'flex-start' },
  evItem:    { border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', marginBottom: 8 },
  detailBody:{ padding: '14px 16px' },
};

function KpiCard({ icon, label, value, valueColor }: { icon: React.ReactNode; label: string; value: string | number; valueColor?: string }) {
  return (
    <div style={s.kpi}>
      <div style={s.kpiLabel}>{icon}{label}</div>
      <div style={{ ...s.kpiValue, color: valueColor || 'var(--text)' }}>{value}</div>
    </div>
  );
}

// ── Admin: Assessment-Edit-Formular ─────────────────────────────────────────
function AssessmentForm({ detail, onSave, busy }: { detail: Nis2ControlDetail; onSave: (b: UpdateAssessmentBody) => void; busy: boolean }) {
  const a = detail.assessment;
  const [form, setForm] = useState<UpdateAssessmentBody>({
    status: a?.status ?? 'not_started',
    owner: a?.owner ?? '',
    dueDate: a?.dueDate ? a.dueDate.slice(0, 10) : '',
    notes: a?.notes ?? '',
    lastReviewedAt: a?.lastReviewedAt ? a.lastReviewedAt.slice(0, 10) : '',
  });
  function set<K extends keyof UpdateAssessmentBody>(k: K, v: UpdateAssessmentBody[K]) { setForm((p) => ({ ...p, [k]: v })); }
  return (
    <div>
      <div style={s.group}>
        <label htmlFor="n2-status" style={s.label}>Status</label>
        <select id="n2-status" style={s.input} value={form.status} onChange={(e) => set('status', e.target.value as AssessmentStatus)}>
          {ASSESSMENT_STATUSES.map((st) => <option key={st} value={st}>{statusLabel(st)}</option>)}
        </select>
      </div>
      <div style={s.group}>
        <label htmlFor="n2-owner" style={s.label}>Owner</label>
        <input id="n2-owner" style={s.input} value={form.owner} maxLength={120} onChange={(e) => set('owner', e.target.value)} placeholder="z. B. Security-Team" />
      </div>
      <div style={s.group}>
        <label htmlFor="n2-due" style={s.label}>Fällig bis</label>
        <input id="n2-due" type="date" style={s.input} value={form.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value)} />
      </div>
      <div style={s.group}>
        <label htmlFor="n2-review" style={s.label}>Zuletzt geprüft</label>
        <input id="n2-review" type="date" style={s.input} value={form.lastReviewedAt ?? ''} onChange={(e) => set('lastReviewedAt', e.target.value)} />
      </div>
      <div style={s.group}>
        <label htmlFor="n2-notes" style={s.label}>Notizen {form.status === 'not_applicable' && <span style={{ color: 'var(--warning)' }}>(Begründung erforderlich)</span>}</label>
        <textarea id="n2-notes" style={{ ...s.input, minHeight: 64, resize: 'vertical' }} value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <Button variant="primary" size="sm" icon={busy ? undefined : <Check size={13} />} disabled={busy} onClick={() => onSave(form)}>
        {busy ? 'Speichern …' : 'Assessment speichern'}
      </Button>
    </div>
  );
}

// ── Admin: Evidence-Add-Formular ────────────────────────────────────────────
const EMPTY_EVIDENCE: AddEvidenceBody = { evidenceType: 'document', evidenceRef: '', title: '', description: '' };
function EvidenceForm({ onAdd, busy, error }: { onAdd: (b: AddEvidenceBody) => void; busy: boolean; error: string }) {
  const [form, setForm] = useState<AddEvidenceBody>(EMPTY_EVIDENCE);
  function set<K extends keyof AddEvidenceBody>(k: K, v: AddEvidenceBody[K]) { setForm((p) => ({ ...p, [k]: v })); }
  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
      <div style={{ ...s.label, marginBottom: 8 }}>Evidence hinzufügen</div>
      <div style={s.group}>
        <select style={s.input} value={form.evidenceType} onChange={(e) => set('evidenceType', e.target.value as EvidenceType)}>
          {EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{evidenceTypeLabel(t)}</option>)}
        </select>
      </div>
      <div style={s.group}>
        <input style={s.input} value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} placeholder="Titel *" />
      </div>
      <div style={s.group}>
        <input style={s.input} value={form.evidenceRef} maxLength={1024} onChange={(e) => set('evidenceRef', e.target.value)} placeholder="Referenz/URL * (kein Secret, nur http/https)" />
      </div>
      {error && <div style={{ ...s.warn, marginBottom: 8 }}>{error}</div>}
      <Button variant="ghost" size="sm" icon={<Plus size={13} />} disabled={busy || !form.title.trim() || !form.evidenceRef.trim()} onClick={() => onAdd(form)}>
        {busy ? 'Hinzufügen …' : 'Evidence verlinken'}
      </Button>
    </div>
  );
}

// ── Admin: Incident-Ticket als Evidence verknüpfen ──────────────────────────
interface IncidentOption { id: string; ticketNr: string; title: string }
function IncidentLinkForm({ onLink, busy, error }: { onLink: (ticketId: string) => void; busy: boolean; error: string }) {
  const [tickets, setTickets] = useState<IncidentOption[]>([]);
  const [ticketId, setTicketId] = useState('');
  useEffect(() => {
    // ticketApi.list kennt kein AbortSignal — daher Mounted-Guard gegen setState
    // nach Unmount (kein React-Warning, kein Effekt auf entladener Komponente).
    let active = true;
    ticketApi.list({ limit: 50, sort: 'createdAt', order: 'desc' })
      .then((r) => { if (active) setTickets(r.data.map((t) => ({ id: t.id, ticketNr: t.ticketNr ?? '', title: t.title ?? '' }))); })
      .catch(() => { /* Ticketliste optional — Verknüpfung bleibt ohne Auswahl */ });
    return () => { active = false; };
  }, []);
  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
      <div style={{ ...s.label, marginBottom: 8 }}>Incident-Ticket verknüpfen</div>
      <div style={{ ...s.hint, marginBottom: 8 }}>Hinweis: Der Ticket-Titel wird als Nachweis-Bezeichnung gespeichert — vor dem Verknüpfen auf personenbezogene Daten prüfen.</div>
      <div style={s.group}>
        <select style={s.input} value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
          <option value="">Incident wählen …</option>
          {tickets.map((t) => (
            <option key={t.id} value={t.id}>{t.ticketNr || t.id.slice(0, 8)} — {t.title.slice(0, 60)}</option>
          ))}
        </select>
      </div>
      {error && <div style={{ ...s.warn, marginBottom: 8 }}>{error}</div>}
      <Button variant="ghost" size="sm" icon={<Link2 size={13} />} disabled={busy || !ticketId} onClick={() => onLink(ticketId)}>
        {busy ? 'Verknüpfen …' : 'Incident als Nachweis verknüpfen'}
      </Button>
    </div>
  );
}

// ── Detail-Panel ────────────────────────────────────────────────────────────
function DetailPanel({ controlKey, isAdmin, onChanged }: { controlKey: string; isAdmin: boolean; onChanged: () => void }) {
  const [detail, setDetail] = useState<Nis2ControlDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [evError, setEvError] = useState('');
  const [linkErr, setLinkErr] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setDetail((await nis2Api.getControlDetail(controlKey)).data); }
    catch (e) { setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen'); }
  }, [controlKey]);
  useEffect(() => { setDetail(null); void load();   }, [controlKey, load]);

  async function saveAssessment(body: UpdateAssessmentBody) {
    setBusy(true);
    try { await nis2Api.updateAssessment(controlKey, body); await load(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen'); }
    finally { setBusy(false); }
  }
  async function addEvidence(body: AddEvidenceBody) {
    setBusy(true); setEvError('');
    try { await nis2Api.addEvidence(controlKey, body); await load(); onChanged(); }
    catch (e) { setEvError(e instanceof Error ? e.message : 'Evidence fehlgeschlagen'); }
    finally { setBusy(false); }
  }
  async function removeEvidence(id: string) {
    setBusy(true);
    try { await nis2Api.removeEvidence(id); await load(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Entfernen fehlgeschlagen'); }
    finally { setBusy(false); }
  }
  async function linkIncident(ticketId: string) {
    setBusy(true); setLinkErr('');
    try { await nis2Api.linkIncident(controlKey, ticketId); await load(); onChanged(); }
    catch (e) { setLinkErr(e instanceof Error ? e.message : 'Verknüpfen fehlgeschlagen'); }
    finally { setBusy(false); }
  }

  if (error && !detail) return <div style={s.panel}><div style={s.detailBody}><ErrorCard message={error} /></div></div>;
  if (!detail) return <div style={s.panel}><div style={s.detailBody}><Spinner /></div></div>;

  const a = detail.assessment;
  const addressedNoEvidence = a ? isAddressedWithoutEvidence(a.status, detail.evidenceCount) : false;

  return (
    <div style={s.panel}>
      <div style={s.panelHead}>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{detail.control.title}</span>
        <Badge tone={statusTone(a?.status ?? 'not_started')}>{statusLabel(a?.status ?? 'not_started')}</Badge>
      </div>
      <div style={s.detailBody}>
        <div style={{ fontSize: 12.5, color: 'var(--text)', marginBottom: 8 }}>{detail.control.shortDescription}</div>
        <div style={{ ...s.hint, marginBottom: 12 }}>Quelle (Referenz, kein Rechtszitat): {detail.control.sourceReference}</div>

        {addressedNoEvidence && (
          <div style={{ ...s.warn, marginBottom: 12 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Status „Bearbeitet", aber keine Evidence verlinkt — das ist <strong>kein vollständiger Nachweis</strong>. Bitte Evidence ergänzen oder Status anpassen.</span>
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Evidence ({detail.evidence.length})
        </div>
        {detail.evidence.length === 0 && <div style={{ ...s.hint, marginBottom: 10 }}>Noch keine Evidence verlinkt. Hinweise: {detail.control.evidenceHints.join(', ')}.</div>}
        {detail.evidence.map((ev) => (
          <div key={ev.id} style={s.evItem}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Badge tone="accent">{evidenceTypeLabel(ev.evidenceType)}</Badge>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{ev.title}</span>
              {isAdmin && (
                <button type="button" aria-label="Evidence entfernen" disabled={busy} onClick={() => void removeEvidence(ev.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 2 }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3, wordBreak: 'break-all' }}>{ev.evidenceRef}</div>
          </div>
        ))}

        {a && (
          <div style={{ ...s.hint, marginTop: 10 }}>
            Owner: {a.owner || '—'} · Fällig: {formatDate(a.dueDate)} · Zuletzt geprüft: {formatDate(a.lastReviewedAt)}
            <br />Zuletzt geändert: {formatDate(a.updatedAt)}{a.updatedBy ? ` · ${a.updatedBy}` : ''}
          </div>
        )}
        {a && a.notes && (
          <div style={{ marginTop: 8 }}>
            <div style={s.label}>Notizen</div>
            <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{a.notes}</div>
          </div>
        )}

        {isAdmin ? (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
            <AssessmentForm detail={detail} onSave={saveAssessment} busy={busy} />
            <EvidenceForm onAdd={addEvidence} busy={busy} error={evError} />
            <IncidentLinkForm onLink={linkIncident} busy={busy} error={linkErr} />
          </div>
        ) : (
          <div style={{ ...s.hint, marginTop: 12 }}>Nur-Lese-Ansicht — Änderungen sind Administratoren vorbehalten.</div>
        )}
      </div>
    </div>
  );
}

// ── Management-Readiness-Report (read-only, ehrlich) ────────────────────────
function ReportView() {
  const [report, setReport] = useState<Nis2ManagementReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const ctrl = new AbortController();
    nis2Api.getManagementReport({ signal: ctrl.signal })
      .then((r) => setReport(r.data))
      .catch((e) => { if (e instanceof Error && e.name !== 'AbortError') setError(e.message); });
    return () => ctrl.abort();
  }, []);
  if (error) return <ErrorCard message={error} />;
  if (!report) return <div style={s.panel}><div style={s.detailBody}><Spinner /></div></div>;

  const { meta, summary, controls } = report;
  const statusRows = reportStatusRows(summary);
  return (
    <>
      <div style={s.kpis}>
        <KpiCard icon={<FileCheck2 size={13} />} label="Evidence-Coverage" value={`${summary.evidenceCoveragePct}%`} valueColor={`var(--${coverageTone(summary.evidenceCoveragePct)})`} />
        <KpiCard icon={<Link2 size={13} />} label="Incident-Nachweise" value={summary.incidentEvidenceTotal} />
        <KpiCard icon={<AlertTriangle size={13} />} label="Review nötig" value={summary.needsReview} valueColor={summary.needsReview ? 'var(--warning)' : undefined} />
        <KpiCard icon={<Clock size={13} />} label="Überfällig" value={summary.overdue} valueColor={summary.overdue ? 'var(--danger)' : undefined} />
        <KpiCard icon={<RefreshCw size={13} />} label="Review fällig" value={summary.reviewDue} valueColor={summary.reviewDue ? 'var(--warning)' : undefined} />
      </div>
      <div style={s.panel}>
        <div style={s.panelHead}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Management-Readiness-Report</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>
            Stand: {formatGeneratedAt(meta.generatedAt)} · Katalog v{meta.catalogVersion}
          </span>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ ...s.hint, marginBottom: 12 }}>{meta.disclaimer}</div>

          <div style={{ ...s.label, marginBottom: 6 }}>Status-Verteilung</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {statusRows.map((r) => <Badge key={r.status} tone={statusTone(r.status)}>{r.label}: {r.count}</Badge>)}
          </div>
          <div style={{ ...s.hint, marginBottom: 14 }}>{incidentCoverageText(summary)} · {summary.addressedWithEvidence} bearbeitet mit Evidence</div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Control', 'Status', 'Owner', 'Fällig', 'Evidence', 'Incidents', 'Signal'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {controls.map((c) => {
                  const sigLabel = c.overdue ? 'überfällig' : c.needsReview ? 'review' : c.missingEvidence ? 'keine Evidence' : 'ok';
                  return (
                    <tr key={c.key}>
                      <td style={{ ...s.td, fontWeight: 600, maxWidth: 260 }}>{c.title}</td>
                      <td style={s.td}><Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge></td>
                      <td style={s.td}>{c.owner || '—'}</td>
                      <td style={s.td}>{formatDate(c.dueDate)}</td>
                      <td style={{ ...s.td, fontFamily: 'var(--font-mono)' }}>{c.evidenceCount}</td>
                      <td style={{ ...s.td, fontFamily: 'var(--font-mono)' }}>{c.incidentEvidenceCount}</td>
                      <td style={s.td}><Badge tone={reportControlTone(c)} dot>{sigLabel}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Seite ───────────────────────────────────────────────────────────────────
export function Nis2ReadinessPage() {
  const { user } = useAuth();
  const isAdmin = can.admin(user?.role);
  const [rows, setRows] = useState<Nis2ControlRow[] | null>(null);
  const [summary, setSummary] = useState<Nis2Summary | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState('');
  const [view, setView] = useState<'registry' | 'report'>('registry');

  async function load() {
    try {
      const res = await nis2Api.getControls();
      setRows(res.data); setSummary(res.summary);
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Laden fehlgeschlagen'); }
  }
  useEffect(() => { void load(); }, []);

  if (loadError) return <div style={s.page}><ErrorCard message={loadError} /></div>;
  if (!rows || !summary) return <div style={s.page}><Spinner /></div>;

  return (
    <div style={s.page}>
      <div style={s.head}>
        <ShieldCheck size={26} style={{ color: 'var(--accent)', marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 18, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{NIS2_HEADER_TITLE}<HelpTip topic="nis2" /></div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2, maxWidth: 720 }}>{NIS2_HEADER_SUBTITLE}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant={view === 'registry' ? 'primary' : 'ghost'} size="sm" icon={<ListChecks size={13} />} onClick={() => setView('registry')}>Registry</Button>
          <Button variant={view === 'report' ? 'primary' : 'ghost'} size="sm" icon={<BarChart3 size={13} />} onClick={() => setView('report')}>Management-Report</Button>
          <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()} title="Neu laden">Neu laden</Button>
        </div>
      </div>

      {view === 'report' ? <ReportView /> : (<>
      <div style={s.kpis}>
        <KpiCard icon={<ShieldCheck size={13} />} label="Controls" value={summary.controlsTotal} />
        <KpiCard icon={<FileCheck2 size={13} />} label="Evidence-Coverage" value={`${summary.evidenceCoveragePct}%`} valueColor={`var(--${coverageTone(summary.evidenceCoveragePct)})`} />
        <KpiCard icon={<AlertTriangle size={13} />} label="Review nötig" value={summary.needsReview} valueColor={summary.needsReview ? 'var(--warning)' : undefined} />
        <KpiCard icon={<Clock size={13} />} label="Überfällig" value={summary.overdue} valueColor={summary.overdue ? 'var(--danger)' : undefined} />
        <KpiCard icon={<RefreshCw size={13} />} label="Review fällig" value={summary.reviewDue} valueColor={summary.reviewDue ? 'var(--warning)' : undefined} />
      </div>

      <div style={s.layout}>
        <div style={s.panel}>
          <div style={s.panelHead}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Control-Registry</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>Katalog v{summary.catalogVersion}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Control', 'Status', 'Evidence', 'Owner', 'Fällig', 'Zuletzt geprüft', 'Signal'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const sig = controlSignal(c);
                  return (
                    <tr key={c.key} style={{ cursor: 'pointer', background: selected === c.key ? 'var(--bg-input)' : undefined }} onClick={() => setSelected(c.key)}>
                      <td style={{ ...s.td, fontWeight: 600, maxWidth: 280 }}>{c.title}</td>
                      <td style={s.td}><Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge></td>
                      <td style={{ ...s.td, fontFamily: 'var(--font-mono)' }}>{c.evidenceCount}</td>
                      <td style={s.td}>{c.owner || '—'}</td>
                      <td style={s.td}>{formatDate(c.dueDate)}</td>
                      <td style={s.td}>{formatDate(c.lastReviewedAt)}</td>
                      <td style={s.td}><Badge tone={sig.tone} dot>{sig.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {selected
          ? <DetailPanel controlKey={selected} isAdmin={isAdmin} onChanged={load} />
          : <div style={s.panel}><div style={s.detailBody}><div style={s.hint}>Control aus der Registry wählen, um Details, Evidence und (für Admins) Bearbeitung zu sehen.</div></div></div>}
      </div>
      </>)}
    </div>
  );
}
