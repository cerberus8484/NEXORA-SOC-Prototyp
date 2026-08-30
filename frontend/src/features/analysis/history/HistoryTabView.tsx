// Analysis → History — Case History / Activity Timeline aus dem echten Audit-Log.
// Quelle: ticketApi.history (append-only Audit-Log). WICHTIG: aus Datenschutzgründen werden NUR
// Feldnamen protokolliert, KEINE Before/After-Werte → „Change Details" zeigt ehrlich nur die
// geänderten Felder ohne Werte. Keine erfundenen Verläufe.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Clock, Search, Database, Bot, CheckCircle2, RefreshCw, FileText, Pencil, ShieldCheck, GitBranch, User,
} from 'lucide-react';
import { Card, Badge, Spinner, EmptyState, type Tone } from '../../../components/ui';
import { ticketApi } from '../../tickets/ticketApi';
import { useTranslation } from 'react-i18next';
import {
  describeAuditEntry, auditCategory, activitySummary, decisionEntries, revisions, changedFieldLabels,
  type AuditEntry, type HistoryTone,
} from '../historyModel';

const PAGE = 8;
const head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' };
const lbl: CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };
const inp: CSSProperties = { background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, padding: '7px 10px' };
const th: CSSProperties = { ...lbl, fontWeight: 600, textAlign: 'left', padding: '0 8px 6px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };
const tdc: CSSProperties = { fontSize: 11.5, color: 'var(--text)', padding: '6px 8px', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'top' };

const fmtDate = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const toneVar = (t: HistoryTone | Tone) => (t === 'muted' ? 'var(--text-dim)' : `var(--${t})`);
const CAT_ICON: Record<string, ReactNode> = {
  system: <Database size={14} />, analysis: <Bot size={14} />, decision: <CheckCircle2 size={14} />,
  status: <RefreshCw size={14} />, note: <FileText size={14} />, update: <Pencil size={14} />,
};

function Section({ title, icon, children, right, style }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode; style?: CSSProperties }) {
  return <Card style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...style }}><div style={head}>{icon}<span style={{ flex: 1 }}>{title}</span>{right}</div><div style={{ padding: '12px 14px', flex: 1, minWidth: 0 }}>{children}</div></Card>;
}
function SummaryRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12.5 }}>{icon}<span style={{ flex: 1, color: 'var(--text-muted)' }}>{label}</span><span style={{ fontWeight: 700, color: 'var(--text)' }}>{value}</span></div>;
}

export function HistoryTabView({ ticketId }: { ticketId: string }) {
  const { t: tr } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [usr, setUsr] = useState('all');
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    setLoading(true); setEntries(null); setLimit(PAGE);
    let alive = true;
    ticketApi.history(ticketId)
      .then((r) => { if (alive) setEntries(r.data); })
      .catch(() => { if (alive) setEntries(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ticketId]);

  const sorted = useMemo(() => [...(entries ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [entries]);
  const categories = useMemo(() => [...new Set(sorted.map((e) => auditCategory(e).key))], [sorted]);
  const users = useMemo(() => [...new Set(sorted.map((e) => e.actorLabel).filter(Boolean))], [sorted]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sorted.filter((e) => {
      if (cat !== 'all' && auditCategory(e).key !== cat) return false;
      if (usr !== 'all' && e.actorLabel !== usr) return false;
      if (!needle) return true;
      const d = describeAuditEntry(e);
      return [d.label, d.detail, e.actorLabel, auditCategory(e).label].join(' ').toLowerCase().includes(needle);
    });
  }, [sorted, q, cat, usr]);

  if (loading) return <Card style={{ padding: '14px 16px' }}><Spinner label={tr('analysis.loadingHistory')} /></Card>;
  if (!entries || entries.length === 0) {
    return <Card style={{ padding: '14px 16px' }}><EmptyState title={tr('text.noHistory')} message={tr('analysis.thereNoAuditEntriesTicket')} /></Card>;
  }

  const summary = activitySummary(entries);
  const latest = sorted[0];
  const decisions = decisionEntries(sorted);
  const revs = revisions(entries);
  const lastChange = sorted.find((e) => changedFieldLabels(e).length > 0);
  const shown = filtered.slice(0, limit);
  const grid3: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, alignItems: 'start' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Top-Strip: Activity Summary · Last Modified · Audit-Integrität */}
      <div style={grid3}>
        <Section title="Activity Summary" icon={<Clock size={15} style={{ color: 'var(--accent)' }} />}>
          <SummaryRow icon={<Clock size={14} style={{ color: 'var(--accent)' }} />} label="Total Events" value={summary.total} />
          <SummaryRow icon={<User size={14} style={{ color: 'var(--purple)' }} />} label="Analyst Actions" value={summary.analyst} />
          <SummaryRow icon={<Database size={14} style={{ color: 'var(--text-dim)' }} />} label="System Actions" value={summary.system} />
          <SummaryRow icon={<Bot size={14} style={{ color: 'var(--warning)' }} />} label="Automations" value={summary.automation} />
        </Section>

        <Section title="Last Modified" icon={<Pencil size={15} style={{ color: 'var(--accent)' }} />}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--accent)' }}>{(latest.actorLabel || '—').slice(0, 2).toUpperCase()}</span>
            <div><div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }}>{fmtDate(latest.createdAt)}</div><div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>von {latest.actorLabel || 'System'}</div></div>
          </div>
        </Section>

        <Section title={tr('analysis.auditIntegrity')} icon={<ShieldCheck size={15} style={{ color: 'var(--success)' }} />}>
          {[['Append-only Audit-Log', 'garantiert'], ['IP gehasht (SHA-256)', 'aktiv'], [tr('analysis.fieldNamesOnlyNoValues'), 'DSGVO']].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
              <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} /><span style={{ flex: 1, color: 'var(--text)' }}>{k}</span><Badge tone="success">{v}</Badge>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 6 }}>{tr('analysis.designPropertiesAuditLogNot')}</div>
        </Section>
      </div>

      {/* Case History / Activity Timeline */}
      <Section title="Case History / Activity Timeline" icon={<Clock size={15} style={{ color: 'var(--accent)' }} />}
        right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{filtered.length} / {entries.length}</span>}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-dim)' }} />
            <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder={tr('analysis.searchHistoryPlaceholder')} aria-label={tr('analysis.searchHistory')} style={{ ...inp, width: '100%', boxSizing: 'border-box', paddingLeft: 30 }} />
          </div>
          <select value={cat} onChange={(e) => { setCat(e.target.value); setLimit(PAGE); }} style={inp} aria-label="Kategorie"><option value="all">{tr('analysis.allCategories')}</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select value={usr} onChange={(e) => { setUsr(e.target.value); setLimit(PAGE); }} style={inp} aria-label={tr('common.users')}><option value="all">{tr('analysis.allUsers')}</option>{users.map((u) => <option key={u} value={u}>{u}</option>)}</select>
        </div>

        {shown.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--text-dim)', padding: '12px 0' }}>{tr('analysis.noEntriesTheseFilters')}</div>
          : shown.map((e, i) => {
            const d = describeAuditEntry(e); const c = auditCategory(e);
            return (
              <div key={e.id} style={{ position: 'relative', paddingLeft: 26, paddingBottom: i === shown.length - 1 ? 0 : 14 }}>
                <span style={{ position: 'absolute', left: 0, top: 1, width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', color: toneVar(c.tone), background: `color-mix(in srgb, ${toneVar(c.tone)} 14%, var(--bg-card))` }}>{CAT_ICON[c.key] ?? <FileText size={14} />}</span>
                {i < shown.length - 1 && <span style={{ position: 'absolute', left: 9.5, top: 22, bottom: 0, width: 1, background: 'var(--border-soft)' }} />}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{d.label}</span>
                  <Badge tone={c.tone}>{c.label}</Badge>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{fmtDate(e.createdAt)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{e.actorLabel || 'System'}{d.detail ? ` · ${tr('analysis.fieldsLabel')}: ${d.detail}` : ''}</div>
              </div>
            );
          })}
        {filtered.length > limit && (
          <button type="button" onClick={() => setLimit((l) => l + PAGE)} style={{ marginTop: 14, width: '100%', padding: '9px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Load More ({filtered.length - limit})</button>
        )}
      </Section>

      {/* Revision History · Decision Timeline · Change Details */}
      <div style={grid3}>
        <Section title="Revision History" icon={<GitBranch size={15} style={{ color: 'var(--accent)' }} />}>
          {revs.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('text.noRevisions')}</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Version</th><th style={th}>{tr('common.date')}</th><th style={th}>{tr('text.from')}</th><th style={th}>{tr('analysis.changes')}</th></tr></thead>
              <tbody>{revs.slice(0, 6).map((r) => (
                <tr key={r.id}><td style={{ ...tdc, fontFamily: 'var(--font-mono)' }}>{r.version}</td><td style={{ ...tdc, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(r.at)}</td><td style={tdc}>{r.by}</td><td style={{ ...tdc, color: 'var(--text-muted)' }}>{r.changes}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Section>

        <Section title="Decision Timeline" icon={<CheckCircle2 size={15} style={{ color: 'var(--success)' }} />}>
          {decisions.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('analysis.noDecisionStatusChanges')}</div>
            : decisions.map((e, i) => {
              const c = auditCategory(e);
              return (
                <div key={e.id} style={{ position: 'relative', paddingLeft: 18, paddingBottom: i === decisions.length - 1 ? 0 : 12 }}>
                  <span style={{ position: 'absolute', left: 0, top: 3, width: 9, height: 9, borderRadius: '50%', background: toneVar(c.tone) }} />
                  {i < decisions.length - 1 && <span style={{ position: 'absolute', left: 4, top: 13, bottom: 0, width: 1, background: 'var(--border-soft)' }} />}
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{describeAuditEntry(e).label}{changedFieldLabels(e).length ? ` (${changedFieldLabels(e).join(', ')})` : ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmtDate(e.createdAt)} · {e.actorLabel || 'System'}</div>
                </div>
              );
            })}
        </Section>

        <Section title="Change Details" icon={<Pencil size={15} style={{ color: 'var(--accent)' }} />}>
          {!lastChange ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('analysis.noFieldChangeLogged')}</div> : (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>Letzte Änderung: {fmtDate(lastChange.createdAt)} · {lastChange.actorLabel || 'System'}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>{tr('common.field')}</th><th style={th}>Before</th><th style={th}>After</th></tr></thead>
                <tbody>{changedFieldLabels(lastChange).map((f) => (
                  <tr key={f}><td style={tdc}>{f}</td><td style={{ ...tdc, color: 'var(--text-dim)' }}>{tr('misc.notLogged')}</td><td style={{ ...tdc, color: 'var(--text-dim)' }}>{tr('misc.notLogged')}</td></tr>
                ))}</tbody>
              </table>
              <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>{tr('analysis.dataProtectionReasonsGdprValues')}</div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
