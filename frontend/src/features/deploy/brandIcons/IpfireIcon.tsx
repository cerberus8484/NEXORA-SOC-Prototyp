// IpfireIcon — Marken-Annäherung (KEIN offizielles Logo).
// Rot-orange Flammen-Andeutung als Zeichen; ersetzbar durch offizielles Logo-SVG.
import type { BrandIconProps } from './brandIconTypes';
import { iconOpacity } from './brandIconTypes';

const BRAND = '#e2231a'; // IPFire-Rot (Annäherung)

export function IpfireIcon({ size = 40, muted, style }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="IPFire"
      style={{ opacity: iconOpacity(muted), ...style }}>
      <rect width="40" height="40" rx="9" fill={BRAND} fillOpacity="0.12" />
      <path d="M20 9c3.2 3.2 3.4 6 1.6 8.4 1.9-.4 3.2-1.7 3.9-3.6 2 2.6 2.9 5.4 2.9 8.1a8.4 8.4 0 1 1-16.8 0c0-2.1.8-4.2 2.3-6 .3 1.7 1.2 2.8 2.6 3.3-1.5-3.6-.6-7.1 1.5-10.2Z"
        fill={BRAND} />
    </svg>
  );
}
