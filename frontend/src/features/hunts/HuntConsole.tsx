import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Monitor, Play, CheckCircle2, FileDown, TerminalSquare, AlertTriangle, Archive,
  Clock, ExternalLink, Tag, Plus,
} from 'lucide-react';
import type { HuntSession, HuntCommand, HuntArtifact, HuntFinding, HuntTicketLink } from '../../lib/types';
import { Card, CardHeader, CardBody, Button, Badge, EmptyState } from '../../components/ui';
import { badge } from '../../lib/badges';
import { HuntNotesPanel } from './HuntNotesPanel';
import type { HuntNote } from './huntApi';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const SAFE_HINTS = ['whoami', 'hostname', 'tasklist', 'netstat -ano', 'ipconfig /all', 'Get-Process', 'Get-Service'];

interface Props {
  session: HuntSession;
  commands: HuntCommand[];
  artifacts: HuntArtifact[];
  findings: HuntFinding[];
  ticketLinks: HuntTicketLink[];
  notes: HuntNote[];
  canAct: boolean;
  onStart: () => void;
  onComplete: () => void;
  onRunCommand: (command: string) => Promise<void>;
  onAddFinding: (body: { title: string; severity: string; description?: string; mitreAttack?: string }) => Promise<void>;
  onAddArtifact: (body: { type: string; value: string; description?: string }) => Promise<void>;
  onSaveNotes: (content: string) => Promise<void>;
}

export function HuntConsole({ session, commands, artifacts, findings, ticketLinks, notes, canAct, onStart, onComplete, onRunCommand, onAddFinding, onAddArtifact, onSaveNotes }: Props) {
  const navigate = useNavigate();
  const [cmd, setCmd] = useState('');
  const [saving, setSaving] = useState(false);

  // Finding-Form
  const [showFinding, setShowFinding] = useState(false);
  const [fTitle, setFTitle] = useState('');
  const [fSev, setFSev] = useState('medium');
  const [fDesc, setFDesc] = useState('');
  const [fMitre, setFMitre] = useState('');
  const [savingFinding, setSavingFinding] = useState(false);

  // Artifact-Form
  const [showArtifact, setShowArtifact] = useState(false);
  const [aType, setAType] = useState('file');
  const [aValue, setAValue] = useState('');
  const [aDesc, setADesc] = useState('');
  const [savingArtifact, setSavingArtifact] = useState(false);

  // Notizen: append-only Liste im HuntNotesPanel (P_TRUST_1 A3).

  const sb = badge.sessionStatus(session.status);
  const sevCount = (sev: string) => findings.filter((f) => f.severity === sev).length;
  const mitreTags = [...new Set(findings.map((f) => f.mitreAttack).filter(Boolean))];

  async function runCmd() {
    if (!cmd.trim()) return;
    setSaving(true);
    try { await onRunCommand(cmd.trim()); setCmd(''); }
    finally { setSaving(false); }
  }

  async function submitFinding() {
    if (!fTitle.trim()) return;
    setSavingFinding(true);
    try {
      await onAddFinding({ title: fTitle.trim(), severity: fSev, description: fDesc || undefined, mitreAttack: fMitre || undefined });
      setFTitle(''); setFDesc(''); setFMitre(''); setFSev('medium'); setShowFinding(false);
    } finally { setSavingFinding(false); }
  }

  async function submitArtifact() {
    if (!aValue.trim()) return;
    setSavingArtifact(true);
    try {
      await onAddArtifact({ type: aType, value: aValue.trim(), description: aDesc || undefined });
      setAValue(''); setADesc(''); setAType('file'); setShowArtifact(false);
    } finally { setSavingArtifact(false); }
  }


  async function exportFindings() {
    const lines = findings.map((f) =>
      `[${f.severity.toUpperCase()}] ${f.title}${f.mitreAttack ? ` (${f.mitreAttack})` : ''}\n${f.description || ''}`
    ).join('\n\n');
    const blob = new Blob([`Hunt: ${session.targetHost}\n\n${lines}`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `hunt-findings-${session.id.slice(0, 8)}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  const inlineInput: React.CSSProperties = { flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '6px 10px', fontSize: 12.5 };
  const inlineSelect: React.CSSProperties = { ...inlineInput, flex: 'none', width: 120 };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
      {/* ── Hauptbereich ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Summary */}
        <Card>
          <CardHeader
            title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Monitor size={16} /> Zielsystem</span>}
            actions={<Badge tone={sb.tone} dot>{sb.label}</Badge>}
          />
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
              <Meta label="Target Host" value={<span className="mono">{session.targetHost}</span>} />
              <Meta label="Analyst" value={<span className="mono">{session.analystId.slice(0, 12)}</span>} />
              <Meta label="Scope" value={session.scope || '—'} />
              <Meta
                label="Linked Ticket"
                value={
                  session.ticketId
                    ? <span className="mono" style={{ color: 'var(--accent)' }}>{session.ticketId.slice(0, 8)}</span>
                    : ticketLinks[0]?.ticketId
                      ? <span className="mono" style={{ color: 'var(--accent)' }}>{ticketLinks[0].ticketId.slice(0, 8)}</span>
                      : <span style={{ color: 'var(--text-dim)' }}>—</span>
                }
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="primary" icon={<Play size={15} />} disabled={!canAct || session.status !== 'planned'} onClick={onStart}>Session starten</Button>
              <Button variant="ghost" icon={<CheckCircle2 size={15} />} disabled={!canAct || session.status !== 'active'} onClick={onComplete}>Abschließen</Button>
              <Button variant="ghost" icon={<FileDown size={15} />} disabled={findings.length === 0} onClick={exportFindings}>Findings exportieren</Button>
            </div>
          </CardBody>
        </Card>

        {/* Safe Command Console */}
        <Card>
          <CardHeader
            title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><TerminalSquare size={16} /> Safe Command Console</span>}
            actions={<Badge tone="accent">read-only · mock</Badge>}
          />
          {/* Allowlist-Chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 14px', borderBottom: '1px solid var(--border-soft)' }}>
            {SAFE_HINTS.map((hint) => (
              <button key={hint} disabled={!canAct}
                onClick={() => { setCmd(hint); }}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, padding: '3px 9px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)', background: cmd === hint ? 'var(--accent)' : 'var(--bg-card-soft)', color: cmd === hint ? '#000' : 'var(--text-muted)', cursor: canAct ? 'pointer' : 'default', transition: 'background .15s, color .15s' }}>
                {hint}
              </button>
            ))}
          </div>
          {/* Terminal-Output */}
          <div style={{ background: 'var(--bg-terminal)', padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12.5, minHeight: 180, maxHeight: 300, overflow: 'auto' }}>
            {commands.length === 0
              ? <div style={{ color: 'var(--text-dim)' }}>// Befehl aus der Allowlist wählen oder eingeben und Ausführen drücken.</div>
              : commands.map((c) => (
                <div key={c.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--success)' }}>analyst@{session.targetHost || 'host'} $</span>
                    <span style={{ color: 'var(--text)' }}>{c.command}</span>
                  </div>
                  {c.stdout
                    ? <pre style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', paddingLeft: 16 }}>{c.stdout}</pre>
                    : <span style={{ color: 'var(--text-dim)', paddingLeft: 16, fontSize: 11 }}>[{badge.commandStatus(c.status).label}]</span>}
                </div>
              ))}
          </div>
          {/* Input-Zeile */}
          <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border-soft)', alignItems: 'center' }}>
            <span style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)', fontSize: 13, whiteSpace: 'nowrap' }}>$</span>
            <input className="input input-mono" value={cmd} onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runCmd(); }}
              placeholder="Befehl eingeben …" disabled={!canAct} style={{ flex: 1 }} />
            <Button variant="primary" onClick={() => void runCmd()} disabled={!canAct || saving}>{saving ? '…' : 'Ausführen'}</Button>
          </div>
        </Card>

        {/* Findings hinzufügen */}
        <Card>
          <CardHeader
            title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={16} /> Findings</span>}
            actions={canAct && <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setShowFinding((v) => !v)}>Finding hinzufügen</Button>}
          />
          <CardBody>
            {showFinding && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, padding: 12, background: 'var(--bg-card-soft)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input style={inlineInput} placeholder="Titel *" value={fTitle} onChange={(e) => setFTitle(e.target.value)} />
                  <select style={inlineSelect} value={fSev} onChange={(e) => setFSev(e.target.value)}>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <input style={inlineInput} placeholder="MITRE ATT&CK (z. B. T1059)" value={fMitre} onChange={(e) => setFMitre(e.target.value)} />
                <textarea style={{ ...inlineInput, minHeight: 60, resize: 'vertical' }} placeholder="Beschreibung (optional)" value={fDesc} onChange={(e) => setFDesc(e.target.value)} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button size="sm" variant="primary" onClick={() => void submitFinding()} disabled={!fTitle.trim() || savingFinding}>{savingFinding ? '…' : 'Speichern'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowFinding(false)}>Abbrechen</Button>
                </div>
              </div>
            )}
            {findings.length === 0
              ? <EmptyState title="Keine Findings" />
              : findings.map((f) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.title}</span>
                  {f.mitreAttack && <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{f.mitreAttack}</span>}
                  <Badge tone={badge.severity(f.severity).tone}>{badge.severity(f.severity).label}</Badge>
                </div>
              ))}
          </CardBody>
        </Card>

        {/* Artefakte */}
        <Card>
          <CardHeader
            title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Archive size={16} /> Artefakte</span>}
            actions={canAct && <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setShowArtifact((v) => !v)}>Artefakt hinzufügen</Button>}
          />
          <CardBody>
            {showArtifact && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, padding: 12, background: 'var(--bg-card-soft)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select style={inlineSelect} value={aType} onChange={(e) => setAType(e.target.value)}>
                    {['file', 'process', 'network', 'registry', 'hash', 'other'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input style={inlineInput} placeholder="Wert * (Pfad, Hash, IP …)" value={aValue} onChange={(e) => setAValue(e.target.value)} />
                </div>
                <input style={inlineInput} placeholder="Beschreibung (optional)" value={aDesc} onChange={(e) => setADesc(e.target.value)} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button size="sm" variant="primary" onClick={() => void submitArtifact()} disabled={!aValue.trim() || savingArtifact}>{savingArtifact ? '…' : 'Speichern'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowArtifact(false)}>Abbrechen</Button>
                </div>
              </div>
            )}
            {artifacts.length === 0
              ? <EmptyState title="Keine Artefakte" />
              : artifacts.map((a) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <Badge tone="muted">{a.type}</Badge>
                  <span style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.value}</span>
                </div>
              ))}
          </CardBody>
        </Card>

        {/* Notizen — append-only Liste + „Notiz hinzufügen" (P_TRUST_1 A3) */}
        <HuntNotesPanel notes={notes} canAct={canAct} onAdd={onSaveNotes} />

        {/* Timeline */}
        <Card className="card-pad">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ color: 'var(--accent)', display: 'inline-flex' }}><Clock size={15} /></span>
            <span className="card-title">Timeline</span>
            <span style={{ marginLeft: 'auto' }}><Badge tone="muted">{commands.length + artifacts.length + findings.length}</Badge></span>
          </div>
          {commands.length + artifacts.length + findings.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Noch keine Ereignisse</div>
            : [...commands].slice(0, 8).map((c) => (
              <div key={c.id} className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '3px 0' }}>
                {new Date(c.createdAt).toLocaleTimeString('de-DE')} — {c.command}
              </div>
            ))}
        </Card>
      </div>

      {/* ── Rechts: Findings-Summary + Tags ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
          <CardHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={16} /> Findings Summary</span>} />
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <CountBox label="Kritisch" value={sevCount('critical')} tone="danger" />
              <CountBox label="Hoch" value={sevCount('high')} tone="danger" />
              <CountBox label="Mittel" value={sevCount('medium')} tone="warning" />
              <CountBox label="Niedrig" value={sevCount('low')} tone="accent" />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Tag size={15} /> Tags &amp; TTPs</span>} />
          <CardBody>
            {mitreTags.length === 0
              ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Noch keine MITRE-Tags aus Findings.</div>
              : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {mitreTags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
                </div>}
            <button
              onClick={() => navigate('/mitre')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 12, background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>
              <ExternalLink size={13} /> MITRE Coverage Matrix
            </button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Befehlsverlauf" />
          <CardBody>
            {commands.length === 0
              ? <EmptyState title="Keine Befehle" />
              : commands.slice(0, 6).map((c) => (
                <div key={c.id} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', padding: '3px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.command}
                </div>
              ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--text-dim)' }}>{label}</div>
      <div style={{ fontSize: 13.5, marginTop: 3, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function CountBox({ label, value, tone }: { label: string; value: number; tone: 'danger' | 'warning' | 'accent' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--accent)';
  return (
    <div style={{ background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{label}</div>
    </div>
  );
}
