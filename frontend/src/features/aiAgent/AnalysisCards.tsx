import type { CSSProperties } from 'react';
import {
  Monitor, User, Cpu, FileText, KeyRound, Network, Crosshair, Globe,
  CheckCircle2, AlertTriangle, HelpCircle, ListChecks, Target,
} from 'lucide-react';
import { Badge, type Tone } from '../../components/ui';
import type { AgentAnalysis } from './agentApi';

/**
 * AnalysisCards — rendert das strukturierte KI-Analyse-Objekt als native SOC-Karten
 * (Host · User · Process · File · Registry · Network · IOCs · Facts · Indicators ·
 * Missing · Actions · MITRE) statt als pre-wrap-Text. Vertrag: camelCase aus
 * OllamaLlmProvider._buildAnalysis / agentApi.AgentAnalysis.
 */

const s: Record<string, CSSProperties> = {
  wrap:    { display: 'flex', flexDirection: 'column', gap: 12 },
  grid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 },
  card:    { background: 'linear-gradient(160deg, var(--bg-elevated, #1a2233), var(--bg-card))', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' },
  cardHead:{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 },
  cardTitle:{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  row:     { display: 'grid', gridTemplateColumns: '92px 1fr', gap: 8, fontSize: 12, padding: '2px 0', alignItems: 'baseline' },
  key:     { color: 'var(--text-dim)' },
  val:     { color: 'var(--text)', wordBreak: 'break-word' as const, fontFamily: 'var(--font-mono)', fontSize: 11.5 },
  section: { marginTop: 4 },
  secLabel:{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  listItem:{ display: 'flex', gap: 7, fontSize: 12.5, color: 'var(--text)', padding: '3px 0', lineHeight: 1.5, alignItems: 'flex-start' },
  iocRow:  { display: 'flex', gap: 7, fontSize: 12.5, padding: '4px 0', alignItems: 'flex-start', borderBottom: '1px solid var(--border-soft)' },
  mono:    { fontFamily: 'var(--font-mono)', fontSize: 11.5 },
};

const RISK_TONE: Record<string, Tone> = {
  critical: 'danger', high: 'danger', medium: 'warning', low: 'success', informational: 'muted',
};

type FieldRow = [label: string, value: string | boolean | undefined];

function signedLabel(v: string | boolean | undefined): string | undefined {
  if (v === true) return 'ja';
  if (v === false) return 'nein';
  const str = String(v ?? '').trim();
  return str || undefined;
}

function EntityCard({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: FieldRow[] }) {
  const filled = rows.filter(([, v]) => v !== undefined && String(v).trim() !== '');
  if (!filled.length) return null;
  return (
    <div style={s.card}>
      <div style={s.cardHead}>{icon}<span style={s.cardTitle}>{title}</span></div>
      {filled.map(([k, v]) => (
        <div key={k} style={s.row}>
          <span style={s.key}>{k}</span>
          <span style={s.val}>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function BulletList({ label, icon, items, color }: { label: string; icon: React.ReactNode; items: string[]; color?: string }) {
  if (!items.length) return null;
  return (
    <div style={s.section}>
      <div style={s.secLabel}>{label}</div>
      {items.map((it) => (
        <div key={it} style={s.listItem}>
          <span style={{ color: color || 'var(--accent)', flexShrink: 0, marginTop: 1 }}>{icon}</span>
          <span>{it}</span>
        </div>
      ))}
    </div>
  );
}

export function AnalysisCards({ analysis }: { analysis: AgentAnalysis }) {
  const e = analysis.entities || {};
  const ac = 'var(--accent)';

  const sevLine = [
    analysis.riskLevel && `Risk: ${analysis.riskLevel}`,
    analysis.siemSeverity && `SIEM: ${analysis.siemSeverity}`,
    analysis.businessSeverity && `Business: ${analysis.businessSeverity}`,
  ].filter(Boolean).join(' · ');

  const fp = analysis.falsePositivePossibility;
  const mitre = (analysis.mitreAttack || [])
    .map((m) => [m.techniqueId, m.technique, m.tactic && `(${m.tactic})`].filter(Boolean).join(' '))
    .filter(Boolean);

  return (
    <div style={s.wrap}>
      {(analysis.riskLevel || sevLine) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {analysis.riskLevel && <Badge tone={RISK_TONE[analysis.riskLevel.toLowerCase()] || 'muted'} dot>{analysis.riskLevel}</Badge>}
          {sevLine && <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{sevLine}</span>}
        </div>
      )}

      {analysis.whyItMatters && (
        <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55, background: 'var(--accent-soft, rgba(0,150,255,0.06))', borderLeft: '3px solid var(--accent)', borderRadius: 4, padding: '8px 10px' }}>
          {analysis.whyItMatters}
        </div>
      )}

      {/* ── Entity-Karten ── */}
      <div style={s.grid}>
        <EntityCard title="Host" icon={<Monitor size={14} style={{ color: ac }} />} rows={[
          ['Hostname', e.host?.hostname], ['FQDN', e.host?.fqdn], ['Agent-ID', e.host?.agentId], ['Host-IP', e.host?.agentIp],
          ['MAC', e.host?.mac], ['OS', e.host?.os], ['OS-Version', e.host?.osVersion],
        ]} />
        <EntityCard title="User" icon={<User size={14} style={{ color: ac }} />} rows={[
          ['Benutzer', e.user?.username], ['Domäne', e.user?.domain], ['SID', e.user?.sid], ['Privileg', e.user?.privilege],
        ]} />
        <EntityCard title="Process" icon={<Cpu size={14} style={{ color: ac }} />} rows={[
          ['Name', e.process?.name], ['Pfad', e.process?.path], ['PID', e.process?.pid],
          ['Parent', e.process?.parentName], ['CommandLine', e.process?.commandLine],
          ['SHA256', e.process?.hashSha256], ['Signiert', signedLabel(e.process?.signed)],
          ['Publisher', e.process?.publisher], ['OrigName', e.process?.originalFileName],
        ]} />
        <EntityCard title="File" icon={<FileText size={14} style={{ color: ac }} />} rows={[
          ['Name', e.file?.name], ['Pfad', e.file?.path], ['Verzeichnis', e.file?.directory],
          ['SHA256', e.file?.hashSha256], ['Signiert', signedLabel(e.file?.signed)], ['Erstellt', e.file?.createdAt],
        ]} />
        <EntityCard title="Registry" icon={<KeyRound size={14} style={{ color: ac }} />} rows={[
          ['Key', e.registry?.key], ['Value-Name', e.registry?.valueName],
          ['Old-Value', e.registry?.oldValue], ['New-Value', e.registry?.newValue], ['Operation', e.registry?.operation],
        ]} />
        <EntityCard title="Network" icon={<Network size={14} style={{ color: ac }} />} rows={[
          ['Source-IP', e.network?.sourceIp], ['Source-Port', e.network?.sourcePort], ['Source-MAC', e.network?.sourceMac], ['Source-Host', e.network?.sourceHostname],
          ['Dest-IP', e.network?.destinationIp], ['Dest-Port', e.network?.destinationPort], ['Dest-MAC', e.network?.destinationMac], ['Dest-Host', e.network?.destinationHostname],
          ['Protokoll', e.network?.protocol], ['Richtung', e.network?.direction], ['Prozess', e.network?.image],
        ]} />
        <EntityCard title="DNS" icon={<Globe size={14} style={{ color: ac }} />} rows={[
          ['Query', e.dns?.query], ['Antworten', e.dns?.answers], ['Status', e.dns?.status], ['Prozess', e.dns?.image],
        ]} />
      </div>

      {/* ── IOCs ── */}
      {analysis.iocs?.length > 0 && (
        <div style={s.card}>
          <div style={s.cardHead}><Crosshair size={14} style={{ color: ac }} /><span style={s.cardTitle}>IOCs ({analysis.iocs.length})</span></div>
          {analysis.iocs.map((i) => (
            <div key={`${i.type}:${i.value}`} style={s.iocRow}>
              <span style={{ color: i.verdict === 'benign' ? 'var(--text-dim)' : 'var(--warning)', flexShrink: 0 }}>
                {i.verdict === 'benign' ? '○' : '⚠'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div><span style={{ color: 'var(--text-dim)' }}>{i.type}:</span> <span style={s.mono}>{i.value}</span> {i.role && <Badge tone="muted">{i.role}</Badge>}</div>
                {i.reason && <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.4 }}>{i.reason}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Fakten / Indikatoren / Missing ── */}
      <BulletList label="Bestätigte Fakten" icon={<CheckCircle2 size={13} />} items={analysis.confirmedFacts || []} color="var(--success)" />
      <BulletList label="Verdächtige Indikatoren"
        icon={<AlertTriangle size={13} />}
        items={(analysis.suspiciousIndicators || []).map((x) => [x.type && `[${x.type}]`, x.value, x.reason && `— ${x.reason}`].filter(Boolean).join(' '))}
        color="var(--warning)" />

      {fp && (
        <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
          <span style={s.secLabel as CSSProperties}>False-Positive-Möglichkeit: </span>
          <Badge tone={fp.possible ? 'warning' : 'success'}>{fp.possible ? 'ja' : 'nein'}{fp.likelihood ? ` (${fp.likelihood})` : ''}</Badge>
          {fp.reason && <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>{fp.reason}</span>}
        </div>
      )}

      <BulletList label="Fehlende Evidence" icon={<HelpCircle size={13} />} items={analysis.missingEvidence || []} color="var(--text-dim)" />

      {/* ── Empfohlene Aktionen ── */}
      {analysis.recommendedActions?.length > 0 && (
        <div style={s.section}>
          <div style={s.secLabel}>Empfohlene Aktionen</div>
          {[...analysis.recommendedActions].sort((a, b) => a.priority - b.priority).map((a) => (
            <div key={a.action} style={s.listItem}>
              <span style={{ color: ac, flexShrink: 0, fontWeight: 700 }}><ListChecks size={13} /></span>
              <span><b>{a.priority}.</b> {a.action}{a.details ? <span style={{ color: 'var(--text-dim)' }}> — {a.details}</span> : null}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── MITRE ── */}
      {mitre.length > 0 && (
        <div style={s.section}>
          <div style={s.secLabel}>MITRE ATT&CK</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {mitre.map((m) => (
              <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 4, padding: '3px 8px' }}>
                <Target size={11} style={{ color: ac }} />{m}
              </span>
            ))}
          </div>
        </div>
      )}

      {analysis.analystNote && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic', lineHeight: 1.5, borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
          Analyst-Notiz: {analysis.analystNote}
        </div>
      )}
    </div>
  );
}
