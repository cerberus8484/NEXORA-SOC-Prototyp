// Analysis → Timeline — Ermittlungs-Event-Timeline (Mockup-Layout): gruppierte Events
// (Process/Script/File/Detection/Network/DNS) mit aufklappbaren Sub-Events + Quellen-Labels,
// Filter/Source/Type + Expand-all. Quelle: buildTimelineGroups (reale Evidence + Flows).
import { useMemo, useState, type CSSProperties } from 'react';
import { Clock, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, Badge, Spinner, EmptyState, type Tone } from '../../../components/ui';
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, TicketTimeline, NetworkCorrelation } from '../analysisModel';
import { buildTimelineGroups, relativeOffset, timelineSources, CATEGORY_LABEL, type TimelineCategory, type TimelineGroup } from './timelineModel';

const PAGE = 8;
const CAT_TONE: Record<TimelineCategory, Tone> = {
  process: 'accent', script: 'purple', file: 'warning', detection: 'danger', network: 'success', dns: 'accent',
};
const toneVar = (tone: Tone): string => (tone === 'muted' ? 'var(--text-dim)' : `var(--${tone})`);

const fmtTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isNaN(d.getTime())) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return iso; // bereits formatierte Zeit-/Datumsangabe (z. B. aus dem Ticket) unverändert zeigen
};
const inp: CSSProperties = { background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, padding: '7px 10px' };

function matches(g: TimelineGroup, needle: string): boolean {
  if (!needle) return true;
  const hay = [g.title, ...g.meta.map((m) => `${m.label} ${m.value}`), ...g.sub.map((s) => `${s.text} ${s.source}`)].join(' ').toLowerCase();
  return hay.includes(needle);
}
function hasSource(g: TimelineGroup, src: string): boolean {
  return g.sub.some((s) => s.source === src) || g.meta.some((m) => m.label === 'Source' && m.value === src);
}

function GroupRow({ g, base, isLast, open, onToggle }: { g: TimelineGroup; base: string | null; isLast: boolean; open: boolean; onToggle: () => void }) {
  const tone = CAT_TONE[g.category];
  const offset = relativeOffset(base, g.time);
  const canExpand = g.sub.length > 0;
  return (
    <div style={{ display: 'flex', gap: 12, position: 'relative', paddingLeft: 18, paddingBottom: isLast ? 0 : 16 }}>
      <span style={{ position: 'absolute', left: 2, top: 5, width: 10, height: 10, borderRadius: '50%', background: 'var(--bg-card)', border: `2px solid ${toneVar(tone)}`, flexShrink: 0 }} />
      {!isLast && <span style={{ position: 'absolute', left: 6, top: 16, bottom: -2, width: 1, background: 'var(--border-soft)' }} />}

      <div style={{ width: 92, flexShrink: 0, paddingTop: 1 }}>
        <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{fmtTime(g.time)}</div>
        {offset && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{offset}</div>}
      </div>

      <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '9px 12px' }}>
        <button type="button" onClick={onToggle} disabled={!canExpand}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: canExpand ? 'pointer' : 'default', color: 'inherit' }}>
          {canExpand ? (open ? <ChevronDown size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />) : <span style={{ width: 14, flexShrink: 0 }} />}
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{g.title}</span>
          <Badge tone={tone}>{CATEGORY_LABEL[g.category]}</Badge>
          <span style={{ flex: 1 }} />
          {canExpand && <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{g.sub.length} {g.sub.length === 1 ? 'event' : 'events'}</span>}
        </button>

        {g.meta.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 6, paddingLeft: 22, fontSize: 11.5 }}>
            {g.meta.map((m) => (
              <span key={`${m.label}-${m.value}`} style={{ color: 'var(--text-dim)' }}>{m.label} <span className="mono" style={{ color: 'var(--text-muted)' }}>{m.value}</span></span>
            ))}
          </div>
        )}

        {canExpand && open && (
          <div style={{ marginTop: 8, paddingLeft: 22, display: 'flex', flexDirection: 'column' }}>
            {g.sub.map((s) => (
              <div key={`${s.time}-${s.text}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '5px 0', borderTop: '1px solid var(--border-soft)' }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', width: 64, flexShrink: 0, paddingTop: 1 }}>{fmtTime(s.time)}</span>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{s.text}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-dim)', whiteSpace: 'nowrap', flexShrink: 0 }}>{s.source}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TimelineView({ t, ev, tl, network, loading }: {
  t: Ticket; ev: ParsedEvidence; tl: TicketTimeline | null; network?: NetworkCorrelation | null; loading: boolean;
}) {
  const [q, setQ] = useState('');
  const [srcF, setSrcF] = useState('all');
  const [typeF, setTypeF] = useState<'all' | TimelineCategory>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // default: alles offen
  const [limit, setLimit] = useState(PAGE);

  const groups = useMemo(() => buildTimelineGroups(t, ev, tl, network), [t, ev, tl, network]);
  const sources = useMemo(() => timelineSources(groups), [groups]);
  const categories = useMemo(() => [...new Set(groups.map((g) => g.category))], [groups]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups.filter((g) => {
      if (typeF !== 'all' && g.category !== typeF) return false;
      if (srcF !== 'all' && !hasSource(g, srcF)) return false;
      return matches(g, needle);
    });
  }, [groups, q, srcF, typeF]);

  if (loading) return <Card style={{ padding: '14px 16px' }}><Spinner label="Timeline wird geladen …" /></Card>;
  if (groups.length === 0) {
    return <Card style={{ padding: '14px 16px' }}><EmptyState title="Keine Timeline-Events" message="Aus der Evidence dieses Tickets lässt sich keine Event-Abfolge ableiten (Indexer nicht verbunden oder reines Alert-Event ohne Facetten)." /></Card>;
  }

  const shown = filtered.slice(0, limit);
  const base = filtered[0]?.time ?? groups[0]?.time ?? null;
  const allOpen = shown.every((g) => g.sub.length === 0 || !collapsed.has(g.id));
  const toggleAll = () => setCollapsed(allOpen ? new Set(groups.map((g) => g.id)) : new Set());
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
        <Clock size={15} style={{ color: 'var(--accent)' }} /> Event Timeline
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-soft)' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-dim)' }} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Events durchsuchen …" aria-label="Events durchsuchen" style={{ ...inp, width: '100%', boxSizing: 'border-box', paddingLeft: 30 }} />
        </div>
        <select value={srcF} onChange={(e) => { setSrcF(e.target.value); setLimit(PAGE); }} style={inp} aria-label="Quelle">
          <option value="all">Alle Quellen</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={typeF} onChange={(e) => { setTypeF(e.target.value as typeof typeF); setLimit(PAGE); }} style={inp} aria-label="Event-Typ">
          <option value="all">Alle Typen</option>
          {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <button type="button" onClick={toggleAll} style={{ ...inp, cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, background: 'transparent' }}>
          {allOpen ? 'Alle einklappen' : 'Alle ausklappen'}
        </button>
      </div>

      {/* Timeline */}
      <div style={{ padding: '14px 16px' }}>
        {shown.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--text-dim)' }}>Keine Events für diese Filter.</div>
        ) : shown.map((g, i) => (
          <GroupRow key={g.id} g={g} base={base} isLast={i === shown.length - 1} open={g.sub.length > 0 && !collapsed.has(g.id)} onToggle={() => toggle(g.id)} />
        ))}

        {filtered.length > limit && (
          <button type="button" onClick={() => setLimit((l) => l + PAGE)} style={{ marginTop: 14, width: '100%', padding: '9px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            Weitere Events laden ({filtered.length - limit})
          </button>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 12 }}>
          {Math.min(limit, filtered.length)} von {filtered.length} Gruppen{filtered.length !== groups.length ? ` (gefiltert aus ${groups.length})` : ''} · abgeleitet aus realer Evidence + korrelierten Flows. Fehlende Facetten erzeugen keine Events.
        </div>
      </div>
    </Card>
  );
}
