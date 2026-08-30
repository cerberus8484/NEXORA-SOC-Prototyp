// OpnsenseIcon — Marken-Annäherung (KEIN offizielles Logo).
// Orange „O"-Ring als Monogramm; ersetzbar durch offizielles Logo-SVG.
import type { BrandIconProps } from './brandIconTypes';
import { iconOpacity } from './brandIconTypes';

const BRAND = '#d94f00'; // OPNsense-Orange (Annäherung)

export function OpnsenseIcon({ size = 40, muted, style }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="OPNsense"
      style={{ opacity: iconOpacity(muted), ...style }}>
      <rect width="40" height="40" rx="9" fill={BRAND} fillOpacity="0.12" />
      <circle cx="20" cy="20" r="9.5" fill="none" stroke={BRAND} strokeWidth="3.4" />
      <circle cx="20" cy="20" r="3" fill={BRAND} />
    </svg>
  );
}
