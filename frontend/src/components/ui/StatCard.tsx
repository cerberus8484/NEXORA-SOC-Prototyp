import type { ReactNode } from 'react';
import { TrendingUp } from 'lucide-react';
import { Card } from './Card';
import type { Tone } from './Badge';

const TONE_COLOR: Record<Tone, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  purple: 'var(--purple)',
  muted: 'var(--text-muted)',
};
const TONE_SOFT: Record<Tone, string> = {
  accent: 'var(--accent-soft)',
  success: 'var(--success-soft)',
  warning: 'var(--warning-soft)',
  danger: 'var(--danger-soft)',
  purple: 'var(--purple-soft)',
  muted: 'var(--bg-card-soft)',
};

interface StatCardProps {
  label: string;
  value: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  /** Delta-Zeile mit Trend-Pfeil, z. B. "8 seit gestern" (Increment B liefert echte Werte). */
  delta?: string;
  /** Status-Hinweis statt Delta, z. B. "Alle Systeme normal". */
  hint?: string;
  /** Punkt vor dem Hint (für Status). */
  hintDot?: boolean;
}

export function StatCard({ label, value, tone = 'accent', icon, delta, hint, hintDot }: StatCardProps) {
  const color = TONE_COLOR[tone];
  return (
    <Card className="stat-card">
      {icon && (
        <span className="stat-icon" style={{ color, borderColor: color, background: TONE_SOFT[tone] }}>
          {icon}
        </span>
      )}
      <div className="stat-main">
        <span className="stat-label">{label}</span>
        <span className="stat-value" style={{ color: tone === 'muted' ? 'var(--text)' : color }}>{value}</span>
        {delta && (
          <span className="stat-delta" style={{ color }}>
            <TrendingUp size={13} /> {delta}
          </span>
        )}
        {!delta && hint && (
          <span className="stat-hint">
            {hintDot && <span className="stat-hint-dot" style={{ background: color }} />}
            {hint}
          </span>
        )}
      </div>
    </Card>
  );
}
