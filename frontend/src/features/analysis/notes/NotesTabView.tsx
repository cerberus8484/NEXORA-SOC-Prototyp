// Analysis → Notes — Notiz-Timeline + Editor im Mockup-Layout. Es gibt KEIN strukturiertes
// Notes-Backend: jede Notiz wird als lesbarer, parsbarer Block ins ticket.notes-Feld geschrieben
// (notesModel). Autor = aktueller Analyst, Typ/Tags/Zeit real. Speicherfehler werden sichtbar
// gemacht (role=alert) — kein stiller catch (P_TRUST_1).
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FileText, ListChecks, Check, Bold, Italic, List, Code, Link2, Loader2, Plus, X } from 'lucide-react';
import { Card, Badge, Button, type Tone } from '../../../components/ui';
import type { AnalystState, ChecklistItem } from '../../../lib/types';
import { INVESTIGATION_CHECKLIST } from '../analysisModel';
import { appendNote, parseNotes, notePreview, type NoteType } from './notesModel';
import { useTranslation } from 'react-i18next';

const head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' };
const lbl: CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };
const th: CSSProperties = { ...lbl, fontWeight: 600, textAlign: 'left', padding: '0 8px 6px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };
const tdc: CSSProperties = { fontSize: 11.5, color: 'var(--text)', padding: '7px 8px', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'top' };

const NOTE_TYPE_META: Record<NoteType, { label: string; tone: Tone }> = {
  triage: { label: 'Triage', tone: 'success' },
  investigation: { label: 'Investigation', tone: 'accent' },
  internal: { label: 'Internal', tone: 'muted' },
  customer: { label: 'Customer', tone: 'purple' },
  note: { label: 'Note', tone: 'muted' },
};
const EDITOR_TYPES: NoteType[] = ['triage', 'investigation', 'internal', 'customer'];

const fmtAt = (at?: string): string => {
  if (!at) return '—';
  const d = new Date(at);
  return isNaN(d.getTime()) ? at : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const initials = (name?: string): string => {
  const n = (name || '').trim();
  if (!n) return '—';
  const parts = n.split(/[\s.@]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || n.slice(0, 2).toUpperCase();
};

function Section({ title, icon, children, right, style }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode; style?: CSSProperties }) {
  return <Card style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...style }}><div style={head}>{icon}<span style={{ flex: 1 }}>{title}</span>{right}</div><div style={{ padding: '12px 14px', flex: 1, minWidth: 0 }}>{children}</div></Card>;
}
function Avatar({ name, tone }: { name?: string; tone: string }) {
  return <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: 700, color: '#fff', background: tone }}>{initials(name)}</span>;
}

type NotesTabProps = {
  notes: string;
  currentUser?: string;
  onAddNote: (mergedNotes: string) => Promise<void> | void;
  analystState: AnalystState;
  onSaveAnalystState: (s: AnalystState) => void;
  saveError?: string;
};

export function NotesTabView({ notes, currentUser, onAddNote, analystState, onSaveAnalystState, saveError }: NotesTabProps) {
  const { t: tr } = useTranslation();
  const [type, setType] = useState<NoteType>('investigation');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const entries = parseNotes(notes);
  const newest = [...entries].reverse();

  function wrap(before: string, after = before) {
    const ta = taRef.current;
    if (!ta) { setBody((b) => b + before + after); return; }
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const next = value.slice(0, s) + before + value.slice(s, e) + after + value.slice(e);
    setBody(next);
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = s + before.length; ta.selectionEnd = e + before.length; });
  }
  function addTag() {
    const t = tagInput.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput('');
  }
  async function save() {
    if (!body.trim() || busy) return;
    setBusy(true); setLocalErr('');
    try {
      const merged = appendNote(notes, { type, author: currentUser, at: new Date().toISOString(), tags, body });
      await onAddNote(merged);
      setBody(''); setTags([]);
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : tr('analysis.noteCouldNotSaved'));
    } finally { setBusy(false); }
  }

  // Checkliste (analystState) — bleibt erhalten (echte, persistierte Funktion).
  const checklistItems: ChecklistItem[] = analystState.checklist.length > 0
    ? analystState.checklist
    : INVESTIGATION_CHECKLIST.map((label, i) => ({ id: `default-${i}`, label, done: false }));
  const doneCount = checklistItems.filter((i) => i.done).length;
  const toggleCheck = (id: string) => onSaveAnalystState({ ...analystState, checklist: checklistItems.map((it) => it.id === id ? { ...it, done: !it.done } : it) });

  const toneVar = (t: Tone) => (t === 'muted' ? 'var(--text-dim)' : `var(--${t})`);
  const tbtn: CSSProperties = { background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, borderRadius: 'var(--radius-sm)', display: 'inline-flex' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {(saveError || localErr) && (
        <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
          Nicht gespeichert: {saveError || localErr}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        {/* Notes Timeline */}
        <Section title="Notes Timeline" icon={<FileText size={15} style={{ color: 'var(--accent)' }} />}>
          {newest.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('analysis.noNotesYetCreateFirst')}</div>
            : newest.map((n, i) => {
              const meta = NOTE_TYPE_META[n.type];
              return (
                <div key={n.id} style={{ position: 'relative', paddingLeft: 18, paddingBottom: i === newest.length - 1 ? 0 : 14 }}>
                  <span style={{ position: 'absolute', left: 0, top: 4, width: 9, height: 9, borderRadius: '50%', background: 'var(--bg-card)', border: `2px solid ${toneVar(meta.tone)}` }} />
                  {i < newest.length - 1 && <span style={{ position: 'absolute', left: 4, top: 15, bottom: 0, width: 1, background: 'var(--border-soft)' }} />}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtAt(n.at)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{n.author || '—'}</span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.body}</div>
                  {n.tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>{n.tags.map((t) => <Badge key={t} tone="muted">{t}</Badge>)}</div>}
                </div>
              );
            })}
        </Section>

        {/* Editor */}
        <Section title={tr('label.newNote2')} icon={<FileText size={15} style={{ color: 'var(--accent)' }} />}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {EDITOR_TYPES.map((t) => {
              const meta = NOTE_TYPE_META[t]; const on = type === t;
              return <button key={t} type="button" onClick={() => setType(t)} style={{ background: on ? `color-mix(in srgb, ${toneVar(meta.tone)} 14%, var(--bg-card))` : 'transparent', border: `1px solid ${on ? toneVar(meta.tone) : 'var(--border-soft)'}`, color: on ? toneVar(meta.tone) : 'var(--text-muted)', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '5px 12px' }}>{meta.label}</button>;
            })}
          </div>

          <div style={{ display: 'flex', gap: 2, padding: '4px 6px', border: '1px solid var(--border-soft)', borderBottom: 'none', borderTopLeftRadius: 'var(--radius-sm)', borderTopRightRadius: 'var(--radius-sm)', background: 'var(--bg-card-soft)' }}>
            <button type="button" title="Fett" style={tbtn} onClick={() => wrap('**')}><Bold size={14} /></button>
            <button type="button" title="Kursiv" style={tbtn} onClick={() => wrap('*')}><Italic size={14} /></button>
            <button type="button" title="Liste" style={tbtn} onClick={() => wrap('\n- ', '')}><List size={14} /></button>
            <button type="button" title="Code" style={tbtn} onClick={() => wrap('`')}><Code size={14} /></button>
            <button type="button" title="Link" style={tbtn} onClick={() => wrap('[', '](https://)')}><Link2 size={14} /></button>
          </div>
          <textarea ref={taRef} value={body} onChange={(e) => setBody(e.target.value)} rows={6}
            placeholder={tr('text.enterNoteHereMarkdown')}
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderTopLeftRadius: 0, borderTopRightRadius: 0, borderBottomLeftRadius: 'var(--radius-sm)', borderBottomRightRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '10px 12px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />

          <div style={{ marginTop: 10 }}>
            <div style={lbl}>Tags</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5, alignItems: 'center' }}>
              {tags.map((t) => (
                <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-pill)', fontSize: 11, color: 'var(--text)', padding: '2px 8px' }}>
                  {t}<button type="button" aria-label={tr('analysis.removeTag', { tag: t })} onClick={() => setTags((prev) => prev.filter((x) => x !== t))} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'inline-flex', padding: 0 }}><X size={11} /></button>
                </span>
              ))}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} placeholder="+ Tag" aria-label={tr('analysis.addTag')}
                  style={{ width: 90, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-pill)', color: 'var(--text)', fontSize: 11, padding: '3px 9px' }} />
                <button type="button" aria-label={tr('analysis.applyTag')} onClick={addTag} style={{ ...tbtn, color: 'var(--accent)' }}><Plus size={13} /></button>
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Button variant="primary" size="sm" disabled={!body.trim() || busy} icon={busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />} onClick={() => void save()}>{busy ? 'Speichert …' : 'Save Note'}</Button>
          </div>
        </Section>
      </div>

      {/* Recent Notes */}
      <Section title="Recent Notes" icon={<FileText size={15} style={{ color: 'var(--accent)' }} />} right={<Badge tone="accent">{entries.length}</Badge>}>
        {newest.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('analysis.noNotesYet')}</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead><tr><th style={th}>Time</th><th style={th}>Author</th><th style={th}>Type</th><th style={th}>Preview</th><th style={th}>Tags</th></tr></thead>
              <tbody>
                {newest.slice(0, 6).map((n) => {
                  const meta = NOTE_TYPE_META[n.type];
                  return (
                    <tr key={n.id}>
                      <td style={{ ...tdc, whiteSpace: 'nowrap', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtAt(n.at)}</td>
                      <td style={tdc}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Avatar name={n.author} tone={toneVar(meta.tone)} />{n.author || '—'}</span></td>
                      <td style={tdc}><Badge tone={meta.tone}>{meta.label}</Badge></td>
                      <td style={{ ...tdc, color: 'var(--text-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.body}>{notePreview(n.body)}</td>
                      <td style={tdc}>{n.tags.length ? <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{n.tags.slice(0, 3).map((t) => <Badge key={t} tone="muted">{t}</Badge>)}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 10 }}>{tr('analysis.notesStoredReadableBlocksTicket')}</div>
      </Section>

      {/* Investigation Checklist — echte, persistierte Funktion (bleibt erhalten) */}
      <Section title={`Investigation Checklist (${doneCount}/${checklistItems.length})`} icon={<ListChecks size={15} style={{ color: 'var(--success)' }} />}>
        {checklistItems.map((item) => (
          <label key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '4px 0', cursor: 'pointer', color: item.done ? 'var(--text-dim)' : 'var(--text)' }}>
            <input type="checkbox" checked={item.done} onChange={() => toggleCheck(item.id)} />
            <span style={{ textDecoration: item.done ? 'line-through' : 'none' }}>{item.label}</span>
          </label>
        ))}
        <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 8 }}>
          <Check size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{tr('analysis.checklistSaves')}</div>
      </Section>
    </div>
  );
}
