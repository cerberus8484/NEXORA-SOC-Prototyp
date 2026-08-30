// Analysis → Playbooks — Katalog + Fortschritt im Mockup-Layout. Quelle: PLAYBOOKS-Katalog +
// analystState.playbook (persistierter Step/Status). KEINE erfundenen Match-Scores/Owner/Approvals/
// Effort — solche Felder zeigt das Mockup, das Datenmodell hat sie nicht → weggelassen bzw. „—".
import { type CSSProperties, type ReactNode } from 'react';
import { BookOpen, ChevronRight, Check, CheckCircle2, Download, Printer, UserPlus, ListChecks, Layers } from 'lucide-react';
import { Card, Badge, Button, type Tone } from '../../../components/ui';
import type { AnalystState } from '../../../lib/types';
import { PLAYBOOKS } from '../analysisModel';
import type { EntityItem } from '../deckModel';
import { playbookProgress, stepStatus, type PlaybookStepState } from './playbooksModel';
import { useTranslation } from 'react-i18next';

const PLAYBOOK_STATUSES = ['in_progress', 'done', 'skipped'] as const;
type PlaybookStatus = '' | (typeof PLAYBOOK_STATUSES)[number];
const STEP_TONE: Record<string, Tone> = { pending: 'muted', in_progress: 'accent', done: 'success', skipped: 'muted', needs_review: 'warning', current: 'accent' };

const head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' };
const lbl: CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };
const th: CSSProperties = { ...lbl, fontWeight: 600, textAlign: 'left', padding: '0 8px 6px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };
const tdc: CSSProperties = { fontSize: 12, color: 'var(--text)', padding: '7px 8px', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'middle' };

function Section({ title, icon, children, right, style }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode; style?: CSSProperties }) {
  return <Card style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...style }}><div style={head}>{icon}<span style={{ flex: 1 }}>{title}</span>{right}</div><div style={{ padding: '12px 14px', flex: 1, minWidth: 0 }}>{children}</div></Card>;
}
function Tile({ label, value, icon }: { label: string; value: ReactNode; icon: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>{icon}<div style={{ minWidth: 0 }}><div style={lbl}>{label}</div><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 1 }}>{value}</div></div></div>;
}

export function PlaybooksTabView({ analystState, onSaveAnalystState, saveError, entities }: {
  analystState: AnalystState; onSaveAnalystState: (s: AnalystState) => void; saveError?: string; entities: EntityItem[];
}) {
  const { t: tr } = useTranslation();
  const pb = analystState.playbook as { id?: string; step?: number; status?: PlaybookStatus };
  const activeId = pb.id || PLAYBOOKS[0].id;
  const activePb = PLAYBOOKS.find((p) => p.id === activeId) ?? PLAYBOOKS[0];
  const currentStep = pb.step ?? 0;
  const currentStatus: PlaybookStatus = (pb.status as PlaybookStatus) || '';
  const progress = playbookProgress(activePb.steps.length, currentStep, currentStatus);

  const hosts = entities.filter((e) => e.kind === 'host').length;
  const users = entities.filter((e) => e.kind === 'user').length;

  const selectPlaybook = (id: string) => onSaveAnalystState({ ...analystState, playbook: { id, step: 0, status: '' } });
  const setStatus = (status: PlaybookStatus) => onSaveAnalystState({ ...analystState, playbook: { ...pb, id: activeId, status } });
  const advance = () => onSaveAnalystState({ ...analystState, playbook: { id: activeId, step: Math.min(currentStep + 1, activePb.steps.length - 1), status: 'in_progress' } });

  function exportPlan() {
    const lines = [`Playbook: ${activePb.name}`, `Fortschritt: ${progress.done}/${progress.total} (${progress.pct}%)`, '', tr('common.stepsColon'),
      ...activePb.steps.map((s, i) => `${i + 1}. [${stepStatus(i, currentStep, currentStatus)}] ${s.label}`)];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `playbook-${activePb.id}.txt`; a.click(); URL.revokeObjectURL(a.href);
  }

  const stateTone = (s: PlaybookStepState) => STEP_TONE[s] ?? 'muted';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {saveError && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>Nicht gespeichert: {saveError}</div>}

      {/* Recommended Playbooks (Katalog) */}
      <Section title="Recommended Playbooks" icon={<BookOpen size={15} style={{ color: 'var(--accent)' }} />}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {PLAYBOOKS.map((p) => {
            const active = p.id === activeId;
            return (
              <div key={p.id} style={{ padding: '12px', borderRadius: 'var(--radius-sm)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border-soft)'}`, background: active ? 'var(--accent-soft)' : 'var(--bg-card-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><BookOpen size={15} style={{ color: 'var(--accent)' }} /><span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{p.name}</span></div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 10px' }}>{p.steps.length} Schritte</div>
                {active ? <Badge tone="accent">{tr('analysis.selected')}</Badge> : <Button variant="ghost" size="sm" onClick={() => selectPlaybook(p.id)}>{tr('analysis.select')}</Button>}
              </div>
            );
          })}
        </div>
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {/* Selected Playbook */}
          <Section title={`Selected Playbook: ${activePb.name}`} icon={<BookOpen size={15} style={{ color: 'var(--accent)' }} />}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 12 }}>
              <Tile label="Total Steps" value={activePb.steps.length} icon={<ListChecks size={16} style={{ color: 'var(--accent)' }} />} />
              <Tile label="Completed" value={`${progress.done}/${progress.total}`} icon={<CheckCircle2 size={16} style={{ color: 'var(--success)' }} />} />
              <Tile label="Affected Systems" value={`${hosts} Hosts · ${users} User`} icon={<Layers size={16} style={{ color: 'var(--accent)' }} />} />
              <Tile label="Status" value={currentStatus ? currentStatus.replace('_', ' ') : 'offen'} icon={<BookOpen size={16} style={{ color: 'var(--warning)' }} />} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
              <span style={lbl}>{tr('hunts.currentStep')}</span>
              {PLAYBOOK_STATUSES.map((s) => <Button key={s} variant={currentStatus === s ? 'primary' : 'ghost'} size="sm" onClick={() => setStatus(s)}>{s.replace('_', ' ')}</Button>)}
              <Button variant="ghost" size="sm" icon={<ChevronRight size={13} />} disabled={currentStep >= activePb.steps.length - 1} onClick={advance}>{tr('analysis.nextStep')}</Button>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--success)', marginTop: 8 }}><Check size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{tr('analysis.progressSavedTicket')}</div>
          </Section>

          {/* Playbook Steps */}
          <Section title="Playbook Steps" icon={<ListChecks size={15} style={{ color: 'var(--accent)' }} />} right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{activePb.steps.length}</span>}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                <thead><tr><th style={{ ...th, width: 28 }}>#</th><th style={th}>Step</th><th style={th}>Status</th><th style={th}>Owner</th><th style={th}>Updated</th></tr></thead>
                <tbody>
                  {activePb.steps.map((s, i) => {
                    const st = stepStatus(i, currentStep, currentStatus);
                    return (
                      <tr key={s.label} style={{ background: i === currentStep ? 'var(--accent-soft)' : undefined }}>
                        <td style={{ ...tdc, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{i + 1}</td>
                        <td style={{ ...tdc, fontWeight: i === currentStep ? 700 : 400 }}>{s.label}</td>
                        <td style={tdc}><Badge tone={stateTone(st)}>{st === 'current' ? 'aktuell' : st.replace('_', ' ')}</Badge></td>
                        <td style={{ ...tdc, color: 'var(--text-dim)' }}>—</td>
                        <td style={{ ...tdc, color: 'var(--text-dim)' }}>—</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>{tr('analysis.ownerUpdatedTimestampsPerStep')}</div>
          </Section>
        </div>

        {/* Rechte Spalte: Progress + Quick Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Section title="Playbook Progress" icon={<CheckCircle2 size={15} style={{ color: 'var(--accent)' }} />}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>{progress.done}</span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>/ {progress.total} Schritte ({progress.pct}%)</span>
            </div>
            <span style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', margin: '10px 0', background: 'var(--bg-input)' }}>
              {progress.done > 0 && <span style={{ width: `${(progress.done / progress.total) * 100}%`, background: 'var(--success)' }} />}
              {progress.current > 0 && <span style={{ width: `${(progress.current / progress.total) * 100}%`, background: 'var(--accent)' }} />}
            </span>
            {[['Completed', progress.done, 'var(--success)'], ['In Progress', progress.current, 'var(--accent)'], ['Pending', progress.pending, 'var(--text-dim)']].map(([k, v, c]) => (
              <div key={k as string} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: c as string }} /><span style={{ flex: 1, color: 'var(--text-muted)' }}>{k}</span><span style={{ fontWeight: 700, color: 'var(--text)' }}>{v}</span>
              </div>
            ))}
          </Section>

          <Section title="Quick Actions" icon={<Layers size={15} style={{ color: 'var(--accent)' }} />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={exportPlan}>Export Plan (.txt)</Button>
              <Button variant="ghost" size="sm" icon={<Printer size={13} />} onClick={() => window.print()}>Print Plan</Button>
              <Button variant="ghost" size="sm" icon={<UserPlus size={13} />} disabled title={tr('analysis.assignmentNotBackendYet')}>Assign Playbook</Button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
