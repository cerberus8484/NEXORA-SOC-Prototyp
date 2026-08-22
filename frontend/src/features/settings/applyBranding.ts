import { isValidHexColor } from './brandingHelpers';

// Branding-Applier: mappt die Plattform-Branding-Einstellungen auf CSS-Variablen und
// setzt sie app-weit (auf :root). Kuratierte, system-sichere Font-Stacks — es wird
// NICHTS Externes geladen (CSP bleibt sauber; kein Google-Fonts, kein @font-face nötig).

export type FontFamilyKey = 'default' | 'system' | 'serif' | 'mono';

/** System-sichere Schrift-Stacks (kein Webfont-Laden). */
export const FONT_STACKS: Record<FontFamilyKey, string> = {
  default: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  system:  "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  serif:   "Georgia, Cambria, 'Times New Roman', Times, serif",
  mono:    "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
};

/** Auswahl für die BrandingPanel-Dropdown. */
export const FONT_FAMILY_OPTIONS: { value: FontFamilyKey; label: string }[] = [
  { value: 'default', label: 'Standard (Inter / System-Sans)' },
  { value: 'system',  label: 'System-UI' },
  { value: 'serif',   label: 'Serif' },
  { value: 'mono',    label: 'Monospace' },
];

export interface BrandingInput {
  accentColor?: string | null;
  backgroundColor?: string | null;
  sidebarColor?: string | null;
  fontFamily?: string | null;
}

function isFontKey(v: string | null | undefined): v is FontFamilyKey {
  return v === 'default' || v === 'system' || v === 'serif' || v === 'mono';
}

/**
 * Pure: leitet aus den Branding-Einstellungen die zu setzenden CSS-Variablen ab.
 * NUR gültige Werte kommen durch (ungültige Hex-Werte / unbekannte Font-Keys werden
 * ausgelassen → nie eine kaputte Variable setzen).
 */
export function brandingCssVars(b: BrandingInput): Record<string, string> {
  const vars: Record<string, string> = {};
  if (b.accentColor && isValidHexColor(b.accentColor))         vars['--accent'] = b.accentColor;
  if (b.backgroundColor && isValidHexColor(b.backgroundColor)) vars['--bg'] = b.backgroundColor;
  if (b.sidebarColor && isValidHexColor(b.sidebarColor))       vars['--sidebar-bg'] = b.sidebarColor;
  if (isFontKey(b.fontFamily))                                 vars['--font-sans'] = FONT_STACKS[b.fontFamily];
  return vars;
}

/** Wendet die abgeleiteten Variablen auf ein Ziel-Element an (Default: Dokument-Root). */
export function applyBranding(
  b: BrandingInput,
  target: HTMLElement = document.documentElement,
): void {
  const vars = brandingCssVars(b);
  for (const [key, value] of Object.entries(vars)) target.style.setProperty(key, value);
}
