// brandIcons — Registry der Marken-Annäherungs-Icons für den Deploy-Katalog.
//
// Alle Icons sind eigenständig gezeichnete ANNÄHERUNGEN (Herstellerfarbe +
// erkennbares Zeichen), KEINE offiziellen Logos. Um später ein echtes Logo
// einzusetzen: das jeweilige *Icon.tsx durch das offizielle SVG ersetzen —
// die Registry unten und die Aufrufstelle bleiben unverändert.

import type { ComponentType } from 'react';
import { Shield } from 'lucide-react';
import type { BrandIconProps } from './brandIconTypes';
import { OpnsenseIcon } from './OpnsenseIcon';
import { PfsenseIcon } from './PfsenseIcon';
import { SophosIcon } from './SophosIcon';
import { FortinetIcon } from './FortinetIcon';
import { IpfireIcon } from './IpfireIcon';

export type { BrandIconProps } from './brandIconTypes';

const REGISTRY: Record<string, ComponentType<BrandIconProps>> = {
  opnsense: OpnsenseIcon,
  pfsense: PfsenseIcon,
  sophos: SophosIcon,
  fortinet: FortinetIcon,
  ipfire: IpfireIcon,
};

/** Generisches Fallback-Icon für Produkt-Schlüssel ohne dediziertes Marken-Icon. */
export function FallbackBrandIcon({ size = 40, muted, style }: BrandIconProps) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: 9,
        background: 'var(--accent-soft)', color: 'var(--accent)',
        opacity: muted ? 0.4 : 1, ...style,
      }}
    >
      <Shield size={Math.round(size * 0.5)} />
    </span>
  );
}

/** Liefert die Icon-Komponente für einen Produkt-Schlüssel (oder das Fallback). */
export function brandIconFor(productKey: string): ComponentType<BrandIconProps> {
  return REGISTRY[productKey] ?? FallbackBrandIcon;
}
