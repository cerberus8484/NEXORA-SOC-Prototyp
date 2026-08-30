import type { ReactNode } from 'react';

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'purple' | 'muted';

const TONE_COLOR: Record<Tone, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  purple: 'var(--purple)',
  muted: 'var(--text-muted)',
};
const TONE_BG: Record<Tone, string> = {
  accent: 'var(--accent-soft)',
  success: 'var(--success-soft)',
  warning: 'var(--warning-soft)',
  danger: 'var(--danger-soft)',
  purple: 'var(--purple-soft)',
  muted: 'transparent',
};

interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}

export function Badge({ children, tone = 'muted', dot = false }: BadgeProps) {
  return (
    <span className="badge" style={{ color: TONE_COLOR[tone], background: TONE_BG[tone] }}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}
