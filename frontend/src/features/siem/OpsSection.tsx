import type { CSSProperties, ReactNode } from 'react';

// Gemeinsamer Ops-Stil für die SIEM-Panels: Mono-Section-Header ([NN] TITEL ───)
// und Glow-Werte — von TelemetryPanel, NetworkZones und QuickAccess geteilt.

const s: Record<string, CSSProperties> = {
  head: {
    display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px',
    fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700,
    letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-dim)',
  },
  tag: { color: 'var(--accent)' },
  line: { flex: 1, height: 1, background: 'linear-gradient(90deg, var(--border-soft), transparent)' },
};

export function glow(color: string): CSSProperties {
  return { color, textShadow: `0 0 14px ${color}` };
}

interface OpsSectionHeadProps {
  tag: string;
  title: string;
  right?: ReactNode;
}

export function OpsSectionHead({ tag, title, right }: OpsSectionHeadProps) {
  return (
    <div style={s.head}>
      <span style={s.tag}>{tag}</span>
      <span>{title}</span>
      <span style={s.line} />
      {right ? <span style={{ ...s.tag, letterSpacing: '0.08em' }}>{right}</span> : null}
    </div>
  );
}
