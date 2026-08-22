// Rechte Spalte: Analyst Summary (abgeleitete Bullets) + Risk & Impact.
// Alles deterministisch aus echten Daten — fehlende Werte bleiben „—".
import type { ReactNode } from 'react';
import { Terminal, FileCode, Globe, Database, ShieldAlert, ListChecks, Info } from 'lucide-react';
import { Badge, Card } from '../../../components/ui';
import type { SummaryBullet, RiskModel, BulletKind } from '../deckModel';
import { LABEL } from './deckUi';

const BULLET_ICON: Record<BulletKind, ReactNode> = {
  process: <Terminal size={14} style={{ color: 'var(--accent)' }} />,
  decoded: <FileCode size={14} style={{ color: 'var(--warning)' }} />,
  network: <Globe size={14} style={{ color: 'var(--accent)' }} />,
  data: <Database size={14} style={{ color: 'var(--purple)' }} />,
  c2: <ShieldAlert size={14} style={{ color: 'var(--danger)' }} />,
  recommend: <ListChecks size={14} style={{ color: 'var(--success)' }} />,
  info: <Info size={14} style={{ color: 'var(--text-dim)' }} />,
};

/** 10-Segment-Meter — null = nicht bewertet (gestrichelt leer). */
function Meter({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <span style={{ ...LABEL, width: 76, flexShrink: 0 }}>{label}</span>
      <span style={{ display: 'flex', gap: 2, flex: 1 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} style={{
            flex: 1, height: 8, borderRadius: 2,
            background: value != null && i < value ? color : 'var(--bg-input)',
            border: value == null ? '1px dashed var(--border-soft)' : 'none',
          }} />
        ))}
      </span>
      <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', width: 24, textAlign: 'right' }}>
        {value != null ? value : '—'}
      </span>
    </div>
  );
}

const IMPACT_TONE = { High: 'danger', Medium: 'warning', Low: 'success' } as const;

export function AnalystSummaryPanel({ bullets, risk }: { bullets: SummaryBullet[]; risk: RiskModel }) {
  const scoreColor = (risk.score ?? 0) >= 80 ? 'var(--danger)' : (risk.score ?? 0) >= 50 ? 'var(--warning)' : 'var(--success)';
  return (
    <>
      <Card style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
          <ShieldAlert size={14} style={{ color: 'var(--accent)' }} /> Analyst Summary
        </div>
        {bullets.map((b, i) => (
          <div key={b.text} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '6px 0', borderBottom: i < bullets.length - 1 ? '1px solid var(--border-soft)' : 'none' }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>{BULLET_ICON[b.kind]}</span>
            <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{b.text}</span>
          </div>
        ))}
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>
          Automatisch aus Evidence/Timeline abgeleitet — ersetzt keine Analysten-Entscheidung.
        </div>
      </Card>

      <Card style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Risk &amp; Impact</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 8 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
            border: `3px solid ${scoreColor}`, background: `color-mix(in srgb, ${scoreColor} 10%, transparent)`,
          }}>
            <div style={{ textAlign: 'center', lineHeight: 1.1 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: scoreColor }}>{risk.score ?? '—'}</div>
              <div style={{ fontSize: 8.5, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Risk</div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={LABEL}>Business Impact</div>
            <div style={{ marginTop: 4 }}><Badge tone={IMPACT_TONE[risk.businessImpact]}>{risk.businessImpact}</Badge></div>
          </div>
        </div>
        <Meter label="Magnitude" value={risk.magnitude} color="var(--danger)" />
        <Meter label="Severity" value={risk.severity} color="var(--danger)" />
        <Meter label="Credibility" value={risk.credibility} color="var(--warning)" />
        <Meter label="Relevance" value={risk.relevance} color="var(--accent)" />
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>
          Severity aus Priorität · Credibility aus Analyst-Confidence · Relevance aus Evidence-Tiefe.
        </div>
      </Card>
    </>
  );
}
