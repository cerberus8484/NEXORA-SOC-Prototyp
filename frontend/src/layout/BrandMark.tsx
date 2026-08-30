import { Hexagon, ShieldHalf } from 'lucide-react';

/** NEXORA-SOC-Logo: Hexagon-Outline mit innerem Shield (cyan). */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span style={{ position: 'relative', width: size, height: size, display: 'inline-grid', placeItems: 'center', flexShrink: 0 }}>
      <Hexagon size={size} style={{ color: 'var(--accent)' }} strokeWidth={1.6} />
      <ShieldHalf
        size={size * 0.46}
        style={{ position: 'absolute', color: 'var(--accent)' }}
        strokeWidth={2}
      />
    </span>
  );
}
