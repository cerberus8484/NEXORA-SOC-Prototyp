// Analysis → Payloads — Artefakt-/Payload-Untersuchung im Mockup-Layout: Normalized Payload,
// Parsed Payload Fields, Indicators Found, Raw Event Snippet, Decoded Script/Extracted Content,
// Payload Relationships. Quelle: payloadsModel (Extraktion aus realem Command/Decoded/Payload).
// Keine erfundenen Dateien/Hashes/URLs — fehlende Werte ehrlich „—".
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  FileCode, FileText, ListChecks, Code2, Boxes, Copy, Terminal, Globe, FileWarning, ArrowRight, ShieldAlert,
  Activity, LogIn, Download, Network,
} from 'lucide-react';
import { Card, Badge, type Tone } from '../../../components/ui';
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence } from '../analysisModel';
import {
  decodePowerShell, normalizedPayload, parsePayloadFields, extractStrings, payloadIndicators,
  rawSnippet, buildPayloadChain, type IndicatorSeverity, type PayloadChainNode, type PayloadNodeKind,
} from './payloadsModel';
import { deriveSessionActivity, type SessionActivityKind, type SessionActivityRow } from './sessionActivityModel';
import { useTranslation } from 'react-i18next';

const head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' };
const SEV_TONE: Record<IndicatorSeverity, Tone> = { high: 'danger', medium: 'warning', low: 'muted' };
const SEV_LABEL: Record<IndicatorSeverity, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const fmtTs = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function Section({ title, icon, children, right }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return <Card style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}><div style={head}>{icon}<span style={{ flex: 1 }}>{title}</span>{right}</div><div style={{ padding: '12px 14px', flex: 1, minWidth: 0 }}>{children}</div></Card>;
}
function CopyIcon({ value }: { value: string }) {
  const { t: tr } = useTranslation();
  const [done, setDone] = useState(false);
  return <button type="button" aria-label={tr('common.copy')} title={done ? tr('common.copied') : tr('common.copy')} onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }} style={{ background: 'transparent', border: 'none', color: done ? 'var(--success)' : 'var(--text-dim)', cursor: 'pointer', flexShrink: 0, padding: 2 }}><Copy size={13} /></button>;
}
function KV({ label, value, mono, copy }: { label: string; value?: string; mono?: boolean; copy?: boolean }) {
  const empty = value === undefined || value === null || value === '';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 12, borderBottom: '1px solid var(--border-soft)' }}>
      <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: empty ? 'var(--text-dim)' : 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, textAlign: 'right', overflow: 'hidden', minWidth: 0, maxWidth: '70%' }}>
        <span title={empty ? undefined : value} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{empty ? '—' : value}</span>
        {!empty && copy && <CopyIcon value={value!} />}
      </span>
    </div>
  );
}
function CodeBlock({ code }: { code: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{ margin: 0, background: 'var(--bg-card-soft)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 34px 10px 12px', fontSize: 11.5, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)', lineHeight: 1.5, maxHeight: 230, overflow: 'auto' }}>{code}</pre>
      <span style={{ position: 'absolute', top: 7, right: 7 }}><CopyIcon value={code} /></span>
    </div>
  );
}

// ── Payload Relationships ──────────────────────────────────────────────────────
const NODE_ICON: Record<PayloadNodeKind, ReactNode> = {
  process: <Terminal size={16} style={{ color: 'var(--warning)' }} />,
  file: <FileCode size={16} style={{ color: 'var(--accent)' }} />,
  url: <Globe size={16} style={{ color: 'var(--danger)' }} />,
  dropped: <FileWarning size={16} style={{ color: 'var(--danger)' }} />,
};
function ChainNodeBox({ node }: { node: PayloadChainNode }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 140, maxWidth: 220, background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{NODE_ICON[node.kind]}<span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span></div>
      {node.sub && <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.sub}</div>}
    </div>
  );
}

// ── Session-Aktivität / Honeypot-Befehle ───────────────────────────────────────
// Angreifer-Session aus ticket.payloads (Cowrie). raw/user sind UNTRUSTED → strikt als
// Text ({value} in JSX wird von React escaped), keine href-Verlinkung auf rohe URLs.
const ACTIVITY_ICON: Record<SessionActivityKind, ReactNode> = {
  command: <Terminal size={13} style={{ color: 'var(--warning)' }} />,
  login: <LogIn size={13} style={{ color: 'var(--danger)' }} />,
  download: <Download size={13} style={{ color: 'var(--danger)' }} />,
  tunnel: <Network size={13} style={{ color: 'var(--accent)' }} />,
};
const ACTIVITY_TONE: Record<SessionActivityKind, Tone> = { command: 'warning', login: 'danger', download: 'danger', tunnel: 'accent' };

function SessionActivitySection({ rows }: { rows: SessionActivityRow[] }) {
  const { t: tr } = useTranslation();
  return (
    <Section
      title={tr('analysis.sessionActivityHoneypotCommands')}
      icon={<Activity size={15} style={{ color: 'var(--accent)' }} />}
      right={<Badge tone="accent">{rows.length}</Badge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r) => (
          <div key={`${r.at ?? ''}-${r.kind}-${r.value}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border-soft)' }}>
            <span style={{ flexShrink: 0, color: 'var(--text-dim)', fontSize: 11, fontFamily: 'var(--font-mono)', width: 96, whiteSpace: 'nowrap' }}>{fmtTs(r.at)}</span>
            <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {ACTIVITY_ICON[r.kind]}
              <Badge tone={ACTIVITY_TONE[r.kind]}>{r.label}</Badge>
            </span>
            <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--text)', overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)' }}>{r.value}</span>
            <CopyIcon value={r.value} />
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>{tr('analysis.observedAttackerInputFromHoneypot')}</div>
    </Section>
  );
}

export function PayloadsView({ t, ev }: { t: Ticket; ev: ParsedEvidence }) {
  const { t: tr } = useTranslation();
  const [tab, setTab] = useState<'decoded' | 'strings'>('decoded');
  const decoded = decodePowerShell(ev);
  const norm = normalizedPayload(ev);
  const parsed = parsePayloadFields(ev, decoded);
  const indicators = payloadIndicators(ev, parsed, decoded);
  const strings = extractStrings(ev, decoded);
  const raw = rawSnippet(ev);
  const chain = buildPayloadChain(ev, parsed);
  const sessionActivity = deriveSessionActivity(t);

  const hasWinContent = Boolean(norm.fileName || parsed.invocation || decoded || ev.process?.image || strings.length);
  const hasContent = hasWinContent || sessionActivity.length > 0;
  if (!hasContent) {
    return (
      <Card style={{ padding: '40px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
          <Boxes size={32} style={{ color: 'var(--text-dim)' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{tr('analysis.noPayloadEvidenceYet')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{tr('analysis.noPayloadArtefacts')}</div>
        </div>
      </Card>
    );
  }

  const grid3: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14, alignItems: 'start' };
  const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, alignItems: 'start' };
  const tabBtn = (key: 'decoded' | 'strings'): CSSProperties => ({
    background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`,
    color: tab === key ? 'var(--accent)' : 'var(--text-dim)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 10px',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {sessionActivity.length > 0 && <SessionActivitySection rows={sessionActivity} />}

      {hasWinContent && (
      <>
      <div style={grid3}>
        <Section title="Normalized Payload" icon={<FileText size={15} style={{ color: 'var(--accent)' }} />}>
          <KV label="File Name" value={norm.fileName} mono />
          <KV label="File Path" value={norm.filePath} mono />
          <KV label="File Type" value={norm.fileType} />
          <KV label="File Size" value={undefined} />
          <KV label="SHA256" value={norm.sha256} mono copy />
          <KV label="MD5" value={norm.md5} mono copy />
          <KV label="Created" value={fmtTs(norm.created)} />
          <KV label="Modified" value={norm.modified} />
          <KV label="User" value={norm.user} />
        </Section>

        <Section title="Parsed Payload Fields" icon={<Code2 size={15} style={{ color: 'var(--accent)' }} />}>
          <KV label="Script Engine" value={parsed.scriptEngine} />
          <KV label="Invocation" value={parsed.invocation} mono />
          <KV label="Execution Policy" value={parsed.executionPolicy} />
          <KV label="Downloaded From" value={parsed.downloadedFrom} mono />
          <KV label="Dropped File" value={parsed.droppedFile} mono />
          <KV label="Drops To" value={parsed.dropsTo} mono />
          <KV label="Persistence" value={parsed.persistence} mono />
          <KV label="LOLBIN / Tool" value={parsed.lolbin} mono />
          <KV label="Command Type" value={parsed.commandType} />
        </Section>

        <Section title="Indicators Found" icon={<ListChecks size={15} style={{ color: 'var(--accent)' }} />} right={<Badge tone="accent">{indicators.length}</Badge>}>
          {indicators.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('analysis.noNotableIndicatorsDerived')}</div>
            : indicators.map((i) => (
              <div key={i.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 12 }}>
                <ShieldAlert size={13} style={{ color: `var(--${SEV_TONE[i.severity] === 'muted' ? 'text-dim' : SEV_TONE[i.severity]})`, flexShrink: 0 }} />
                <span style={{ flex: 1, color: 'var(--text)' }}>{i.label}</span>
                <Badge tone={SEV_TONE[i.severity]}>{SEV_LABEL[i.severity]}</Badge>
              </div>
            ))}
        </Section>
      </div>

      <div style={grid2}>
        <Section title="Raw Event Snippet" icon={<FileText size={15} style={{ color: 'var(--accent)' }} />}>
          <CodeBlock code={raw} />
        </Section>

        <Section title="Decoded Script / Extracted Content" icon={<Code2 size={15} style={{ color: 'var(--accent)' }} />}>
          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-soft)', marginBottom: 10 }}>
            <button type="button" style={tabBtn('decoded')} onClick={() => setTab('decoded')}>Decoded PowerShell</button>
            <button type="button" style={tabBtn('strings')} onClick={() => setTab('strings')}>Extracted Strings ({strings.length})</button>
          </div>
          {tab === 'decoded' ? (
            decoded ? <CodeBlock code={decoded} /> : <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('analysis.noEncodedCommandAvailableDecode')}</div>
          ) : (
            strings.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('text.noExtractableStringsUrlsIps')}</div>
              : <div style={{ display: 'flex', flexDirection: 'column' }}>
                {strings.map((s) => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}>
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, overflowWrap: 'anywhere' }}>{s}</span>
                    <CopyIcon value={s} />
                  </div>
                ))}
              </div>
          )}
        </Section>
      </div>

      <Section title="Payload Relationships" icon={<Boxes size={15} style={{ color: 'var(--accent)' }} />}>
        {chain.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('analysis.noChainCanDerivedFrom')}</div>
          : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {chain.map((n, i) => (
                <span key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && (
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-dim)', flexShrink: 0, minWidth: 64 }}>
                      <span style={{ fontSize: 9.5 }}>{n.edge}</span>
                      <ArrowRight size={15} />
                    </span>
                  )}
                  <ChainNodeBox node={n} />
                </span>
              ))}
            </div>
          )}
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 10 }}>{tr('text.derivedFromProcessFileEvidence')}</div>
      </Section>
      </>
      )}
    </div>
  );
}
