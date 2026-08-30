// Analysis → Commands — Ermittlungsansicht im Mockup-Layout: Commands-Tabelle + Execution Chain
// (Process Tree) + Extracted Interpreters + LOLBins Detected + PowerShell Insights + Command
// Highlights. Quelle: deriveCommands (ev.process + Flow-Prozesse) + reine Ableitungen. Keine
// erfundenen Prozesse/Hashes/Confidence — fehlende Felder ehrlich als „—".
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  Terminal, GitBranch, Cpu, Code2, ShieldAlert, AlertTriangle, Sparkles, Copy,
} from 'lucide-react';
import { Card, Badge, type Tone } from '../../../components/ui';
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, NetworkCorrelation } from '../analysisModel';
import { useTranslation } from 'react-i18next';
import {
  deriveCommands, detectLolbins, extractInterpreters, commandSeverity, commandConfidence,
  powershellInsights, commandHighlights, buildProcessTree,
  type CommandRow, type CmdLevel, type ProcessNode,
} from './commandsModel';

const PAGE = 5;
const head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' };
const th: CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, textAlign: 'left', padding: '0 8px 6px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };
const td: CSSProperties = { fontSize: 11.5, color: 'var(--text)', padding: '7px 8px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap', verticalAlign: 'middle' };
const lbl: CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };

const SEV_TONE: Record<CmdLevel, Tone> = { high: 'danger', medium: 'warning', low: 'muted' };
const SEV_LABEL: Record<CmdLevel, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const CONF_COLOR: Record<CmdLevel, string> = { high: 'var(--accent)', medium: 'var(--warning)', low: 'var(--text-dim)' };
const baseName = (img?: string) => (img ? (img.split(/[\\/]/).pop() || img) : '—');
const fmtTs = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function Section({ title, icon, children, right }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return <Card style={{ padding: 0, overflow: 'hidden' }}><div style={head}>{icon}<span style={{ flex: 1 }}>{title}</span>{right}</div><div style={{ padding: '12px 14px' }}>{children}</div></Card>;
}
function CopyBtn({ value }: { value: string }) {
  const { t: tr } = useTranslation();
  const [done, setDone] = useState(false);
  return <button type="button" aria-label={tr('common.copy')} title={done ? tr('common.copied') : tr('common.copy')} onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }} style={{ background: 'transparent', border: 'none', color: done ? 'var(--success)' : 'var(--text-dim)', cursor: 'pointer', flexShrink: 0, padding: 2 }}><Copy size={12} /></button>;
}

// ── Commands-Tabelle ───────────────────────────────────────────────────────────
function CommandsTable({ rows }: { rows: CommandRow[] }) {
  const { t: tr } = useTranslation();
  const [limit, setLimit] = useState(PAGE);
  const shown = rows.slice(0, limit);
  return (
    <Section title="Commands" icon={<Terminal size={15} style={{ color: 'var(--accent)' }} />} right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{rows.length}</span>}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr>
            <th style={th}>Command Line</th><th style={th}>Tree</th><th style={th}>User</th><th style={th}>Parent Process</th>
            <th style={th}>Integrity</th><th style={th}>First Seen</th><th style={th}>Last Seen</th><th style={th}>Severity</th><th style={{ ...th, textAlign: 'right' }}>Confidence</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => {
              const sev = commandSeverity(r); const conf = commandConfidence(r);
              const cmd = r.commandLine || r.image || '—';
              return (
                <tr key={r.id}>
                  <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: `var(--${SEV_TONE[sev] === 'muted' ? 'text-dim' : SEV_TONE[sev]})`, flexShrink: 0 }} />
                      <span className="mono" title={cmd} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{cmd}</span>
                    </span>
                  </td>
                  <td style={td}>{r.parentImage || r.pid ? <GitBranch size={13} style={{ color: 'var(--text-dim)' }} /> : '—'}</td>
                  <td style={td}>{r.user || '—'}</td>
                  <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{r.parentImage ? `${baseName(r.parentImage)}${r.parentPid ? ` (${r.parentPid})` : ''}` : '—'}</td>
                  <td style={td}>{r.integrityLevel || '—'}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{fmtTs(r.time)}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{fmtTs(r.time)}</td>
                  <td style={td}><Badge tone={SEV_TONE[sev]}>{SEV_LABEL[sev]}</Badge></td>
                  <td style={{ ...td, textAlign: 'right', color: CONF_COLOR[conf], fontWeight: 700 }}>{SEV_LABEL[conf]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Math.min(limit, rows.length)} von {rows.length} Commands</span>
        {rows.length > limit && <button type="button" onClick={() => setLimit((l) => l + PAGE)} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '5px 12px' }}>{tr('text.loadMore')}</button>}
      </div>
    </Section>
  );
}

// ── Execution Chain (Process Tree) ─────────────────────────────────────────────
function TreeNodeRow({ node, depth }: { node: ProcessNode; depth: number }) {
  const accent = node.suspicious ? 'var(--danger)' : 'var(--accent)';
  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 18, borderLeft: depth === 0 ? 'none' : '1px solid var(--border-soft)', paddingLeft: depth === 0 ? 0 : 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', margin: '4px 0', background: 'var(--bg-card-soft)', border: `1px solid var(--border-soft)`, borderLeft: `2px solid ${accent}`, borderRadius: 'var(--radius-sm)' }}>
        <Cpu size={14} style={{ color: accent, flexShrink: 0 }} />
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{node.name}</span>
        {node.pid && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>({node.pid})</span>}
        {node.suspicious && <AlertTriangle size={13} style={{ color: 'var(--danger)' }} />}
        {node.path && <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 'auto', maxWidth: '50%' }}>{node.path}</span>}
      </div>
      {node.children.map((c) => <TreeNodeRow key={c.id} node={c} depth={depth + 1} />)}
    </div>
  );
}
function ExecutionChain({ rows }: { rows: CommandRow[] }) {
  const { t: tr } = useTranslation();
  const tree = buildProcessTree(rows);
  return (
    <Section title="Execution Chain (Process Tree)" icon={<GitBranch size={15} style={{ color: 'var(--accent)' }} />}>
      {tree.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('analysis.noParentChildProcessRelationship')}</div>
      ) : tree.map((n) => <TreeNodeRow key={n.id} node={n} depth={0} />)}
    </Section>
  );
}

// ── Kleine Listen-Cards ────────────────────────────────────────────────────────
function ListCard({ title, icon, empty, children }: { title: string; icon: ReactNode; empty: boolean; children: ReactNode }) {
  const { t: tr } = useTranslation();
  return <Section title={title} icon={icon}>{empty ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('text.notDetected')}</div> : children}</Section>;
}
function RowLine({ left, right }: { left: ReactNode; right: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 12 }}>{left}{right}</div>;
}

export function CommandsView({ t, ev, network }: { t: Ticket; ev: ParsedEvidence; network?: NetworkCorrelation | null }) {
  const { t: tr } = useTranslation();
  const rows = deriveCommands(t, ev, network);

  if (rows.length === 0) {
    return (
      <Card style={{ padding: '40px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', maxWidth: 460, margin: '0 auto' }}>
          <Terminal size={32} style={{ color: 'var(--text-dim)' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{tr('analysis.noCommandEvidenceYet')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{tr('analysis.noProcessData')}</div>
        </div>
      </Card>
    );
  }

  const lolbins = detectLolbins(rows);
  const interpreters = extractInterpreters(rows);
  const ps = powershellInsights(rows);
  const highlights = commandHighlights(rows);
  const twoCol: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, alignItems: 'start' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <CommandsTable rows={rows} />
      <ExecutionChain rows={rows} />

      <div style={twoCol}>
        <ListCard title="Extracted Interpreters" icon={<Code2 size={15} style={{ color: 'var(--accent)' }} />} empty={interpreters.length === 0}>
          {interpreters.map((i) => (
            <RowLine key={i.name}
              left={<span className="mono" style={{ color: 'var(--text)' }}>{i.name}</span>}
              right={<span className="mono" style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{i.arg || '—'}</span>} />
          ))}
        </ListCard>

        <ListCard title="LOLBins Detected" icon={<ShieldAlert size={15} style={{ color: 'var(--danger)' }} />} empty={lolbins.length === 0}>
          {lolbins.map((l) => (
            <RowLine key={l.name}
              left={<span className="mono" style={{ color: 'var(--text)' }}>{l.name}</span>}
              right={<Badge tone="warning">{l.technique}</Badge>} />
          ))}
        </ListCard>

        <ListCard title="PowerShell Insights" icon={<Terminal size={15} style={{ color: 'var(--accent)' }} />} empty={!ps.present}>
          <RowLine left={<span style={{ color: 'var(--text-dim)' }}>Execution Policy</span>} right={<span style={{ color: ps.executionPolicy ? 'var(--warning)' : 'var(--text-dim)', fontWeight: 600 }}>{ps.executionPolicy ?? '—'}</span>} />
          <RowLine left={<span style={{ color: 'var(--text-dim)' }}>Encoded Command</span>} right={<span style={{ color: ps.encodedCommand ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>{ps.encodedCommand ? 'Yes' : 'No'}</span>} />
          <div style={{ padding: '6px 0' }}>
            <div style={lbl}>Suspicious Flags</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
              {ps.suspiciousFlags.length ? ps.suspiciousFlags.map((f) => <Badge key={f} tone="warning">{f}</Badge>) : <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>keine</span>}
            </div>
          </div>
          {ps.decoded && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ ...lbl, color: 'var(--danger)' }}>Decoded</span><CopyBtn value={ps.decoded} /></div>
              <pre style={{ margin: '4px 0 0', background: 'var(--bg-card-soft)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 11, color: 'var(--danger)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)' }}>{ps.decoded}</pre>
            </div>
          )}
        </ListCard>

        <ListCard title="Command Highlights" icon={<AlertTriangle size={15} style={{ color: 'var(--warning)' }} />} empty={highlights.length === 0}>
          {highlights.map((h) => (
            <RowLine key={h.text}
              left={<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}><Sparkles size={12} style={{ color: `var(--${SEV_TONE[h.severity] === 'muted' ? 'text-dim' : SEV_TONE[h.severity]})` }} />{h.text}</span>}
              right={<Badge tone={SEV_TONE[h.severity]}>{SEV_LABEL[h.severity]}</Badge>} />
          ))}
        </ListCard>
      </div>

      <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{tr('analysis.processSourceNote')}</div>
    </div>
  );
}
