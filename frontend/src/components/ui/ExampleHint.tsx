import type { CSSProperties } from 'react';
import { Lightbulb } from 'lucide-react';

const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 8 },
  title: { fontSize: 12.5, fontWeight: 700, color: 'var(--text)' },
  text: { fontSize: 12, lineHeight: 1.55, color: 'var(--text-dim)' },
  card: {
    border: '1px solid color-mix(in srgb, var(--accent) 14%, var(--border-soft))',
    background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 6%, var(--bg-card-soft)), var(--bg-card-soft))',
    borderRadius: 'var(--radius-sm)',
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: {
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: 'var(--accent)',
    fontWeight: 700,
  },
  bulb: { display: 'inline-flex', alignItems: 'center', color: 'var(--warning)' },
  preview: {
    border: '1px solid var(--border-soft)',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  previewRow: { display: 'grid', gridTemplateColumns: '92px 1fr', gap: 8, alignItems: 'center' },
  previewLabel: { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 },
  previewValue: {
    fontSize: 11.5,
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--border-soft)',
    borderRadius: 8,
    padding: '5px 7px',
  },
  footer: { fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45 },
};

export interface ExampleHintProps {
  title: string;
  text: string;
  exampleLabel: string;
  rows: Array<{ label: string; value: string }>;
  footer?: string;
}

export function ExampleHint({ title, text, exampleLabel, rows, footer }: ExampleHintProps) {
  return (
    <span style={s.wrap}>
      <span style={s.title}>{title}</span>
      <span style={s.text}>{text}</span>
      <span style={s.card}>
        <span style={s.head}>
          <span style={s.badge}>{exampleLabel}</span>
          <span style={s.bulb}>
            <Lightbulb size={14} aria-hidden />
          </span>
        </span>
        <span style={s.preview}>
          {rows.map((row) => (
            <span key={`${title}-${row.label}`} style={s.previewRow}>
              <span style={s.previewLabel}>{row.label}</span>
              <span style={s.previewValue}>{row.value}</span>
            </span>
          ))}
        </span>
        {footer ? <span style={s.footer}>{footer}</span> : null}
      </span>
    </span>
  );
}
