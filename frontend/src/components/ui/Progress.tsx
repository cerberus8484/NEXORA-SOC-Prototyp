import type { Tone } from './Badge';

const TONE_COLOR: Record<Tone, string> = {
  accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)',
  danger: 'var(--danger)', purple: 'var(--purple)', muted: 'var(--text-muted)',
};

interface ProgressProps { value: number; max?: number; tone?: Tone; }

export function Progress({ value, max = 100, tone = 'accent' }: ProgressProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-input)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: TONE_COLOR[tone] }} />
    </div>
  );
}
