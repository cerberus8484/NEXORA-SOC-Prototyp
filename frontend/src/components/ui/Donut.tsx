import { donutArcs, percent } from '../../lib/donut';

export interface DonutSegment { label: string; value: number; color: string; }

interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerTop: string | number;
  centerBottom?: string;
}

/** Leichtes SVG-Donut — kein Chart-Framework. */
export function Donut({ segments, size = 150, thickness = 18, centerTop, centerBottom }: DonutProps) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const arcs = donutArcs(segments.map((s) => s.value), c);

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-soft)" strokeWidth={thickness} />
        {total > 0 && segments.map((seg, i) => (
          <circle
            key={seg.label}
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={seg.color} strokeWidth={thickness}
            strokeDasharray={`${arcs[i].dash} ${arcs[i].gap}`}
            strokeDashoffset={arcs[i].offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{centerTop}</span>
        {centerBottom && <span style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{centerBottom}</span>}
      </div>
    </div>
  );
}

interface DonutLegendProps { segments: DonutSegment[]; total: number; }

export function DonutLegend({ segments, total }: DonutLegendProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1, minWidth: 0 }}>
      {segments.map((s) => {
        const pct = percent(s.value, total);
        return (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: 'var(--text-muted)' }}>{s.label}</span>
            <span className="mono" style={{ color: 'var(--text)' }}>{s.value}</span>
            <span className="mono" style={{ color: 'var(--text-dim)', width: 42, textAlign: 'right' }}>({pct}%)</span>
          </div>
        );
      })}
    </div>
  );
}
