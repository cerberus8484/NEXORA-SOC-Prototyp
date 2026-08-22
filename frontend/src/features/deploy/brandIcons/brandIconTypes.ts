// brandIconTypes — gemeinsame Props für die Marken-Icons des Deploy-Katalogs.
//
// WICHTIG: Diese Icons sind eigenständig gezeichnete Marken-ANNÄHERUNGEN
// (Herstellerfarbe + erkennbares Monogramm/Zeichen). Es sind bewusst KEINE
// offiziellen Hersteller-Logos — solche Assets liegen nicht vor und werden
// hier nicht ausgeliefert. Sobald ein offizielles Logo-SVG vorliegt, kann es
// das jeweilige Icon 1:1 ersetzen (gleiche Props, gleicher Aufruf).

import type { CSSProperties } from 'react';

export interface BrandIconProps {
  /** Kantenlänge des quadratischen Icons in Pixeln. */
  size?: number;
  /** true ⇢ visuell gedämpft (für „Geplant"/disabled-Kacheln). */
  muted?: boolean;
  style?: CSSProperties;
}

/** Deckkraft-Helfer: gedämpfte Kacheln zeigen ein blasseres Icon. */
export function iconOpacity(muted: boolean | undefined): number {
  return muted ? 0.4 : 1;
}
