// PfsenseIcon — Marken-Annäherung (KEIN offizielles Logo).
// Blaues „pf"-Monogramm; ersetzbar durch offizielles Logo-SVG.
import type { BrandIconProps } from './brandIconTypes';
import { iconOpacity } from './brandIconTypes';

const BRAND = '#2265a1'; // pfSense/Netgate-Blau (Annäherung)

export function PfsenseIcon({ size = 40, muted, style }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="pfSense"
      style={{ opacity: iconOpacity(muted), ...style }}>
      <rect width="40" height="40" rx="9" fill={BRAND} fillOpacity="0.12" />
      <text x="20" y="26.5" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif"
        fontSize="17" fontWeight="700" fill={BRAND}>pf</text>
    </svg>
  );
}
