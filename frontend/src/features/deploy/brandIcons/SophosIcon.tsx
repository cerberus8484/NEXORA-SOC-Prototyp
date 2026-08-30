// SophosIcon — Marken-Annäherung (KEIN offizielles Logo).
// Blaues „S"-Monogramm; ersetzbar durch offizielles Logo-SVG.
import type { BrandIconProps } from './brandIconTypes';
import { iconOpacity } from './brandIconTypes';

const BRAND = '#0083c1'; // Sophos-Blau (Annäherung)

export function SophosIcon({ size = 40, muted, style }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Sophos"
      style={{ opacity: iconOpacity(muted), ...style }}>
      <rect width="40" height="40" rx="9" fill={BRAND} fillOpacity="0.12" />
      <text x="20" y="27" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif"
        fontSize="19" fontWeight="700" fill={BRAND}>S</text>
    </svg>
  );
}
