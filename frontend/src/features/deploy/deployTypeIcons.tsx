// Produkt-/Marken-Icons für die „Was bereitstellen?"-Kacheln des Deployment Centers.
// Bewusst als schlanke Inline-SVGs (keine zusätzliche Abhängigkeit, CSP-sicher). Es sind
// eigene, einfache Wiedererkennungs-Marken für die jeweilige Produkt-Kategorie — keine
// Kopie einer Logo-Datei. Marken-typische Farben, damit die Kacheln „echt" wirken statt
// generischer Linien-Icons. Signatur kompatibel zu lucide (size + optional strokeWidth).

export interface DeployTypeIconProps {
  // number | string, damit die Signatur zu lucide-Icons kompatibel bleibt (gemeinsamer
  // Komponententyp in der Kachel-Liste). strokeWidth wird durchgereicht, hier ungenutzt.
  size?: number | string;
  strokeWidth?: number | string;
}

/** Linux / Container — Pinguin (Tux-Anmutung). */
export function LinuxTypeIcon({ size = 24 }: DeployTypeIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Linux" fill="none">
      <path d="M24 3c-6.2 0-9 5.6-9 12.4 0 4.2-1.2 6.1-3.4 9.2-1.6 2.2-3.6 4.3-3.6 7.4 0 4.6 6.7 8 16 8s16-3.4 16-8c0-3.1-2-5.2-3.6-7.4-2.2-3.1-3.4-5-3.4-9.2C33 8.6 30.2 3 24 3Z" fill="#111214" />
      <ellipse cx="24" cy="31" rx="8.5" ry="11" fill="#fff" />
      <circle cx="20.6" cy="16.5" r="3.2" fill="#fff" />
      <circle cx="27.4" cy="16.5" r="3.2" fill="#fff" />
      <circle cx="21.4" cy="17.4" r="1.5" fill="#111214" />
      <circle cx="26.6" cy="17.4" r="1.5" fill="#111214" />
      <path d="M21 19.6h6l-3 4.2z" fill="#F7A80D" />
      <path d="M17 41l-2.6 4.4 8-1.2z" fill="#F7A80D" />
      <path d="M31 41l2.6 4.4-8-1.2z" fill="#F7A80D" />
    </svg>
  );
}

/** Docker / Portainer — Container-Stapel auf dem Wal. */
export function DockerTypeIcon({ size = 24 }: DeployTypeIconProps) {
  const box = { width: 6.4, height: 5.4, rx: 0.7, fill: '#2496ED' };
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Docker" fill="none">
      {/* Container-Boxen: untere Reihe (4) + obere Reihe (2) */}
      <rect x="7" y="20" {...box} />
      <rect x="14.4" y="20" {...box} />
      <rect x="21.8" y="20" {...box} />
      <rect x="29.2" y="20" {...box} />
      <rect x="14.4" y="13.8" {...box} />
      <rect x="21.8" y="13.8" {...box} />
      {/* Wal-Körper + Schwanz + Spout */}
      <path d="M4 27h33.5c0 0 .3 4.2-3.4 6.6C30.8 36 26 37 20.5 37 11 37 6 33 4.6 30.2 3.8 28.6 4 27 4 27Z" fill="#2496ED" />
      <path d="M38 24c1.6-1.4 3.4-1.3 4.8-.4-.5 1.2-1.9 1.9-3.4 1.7 1 .9 2.6.9 3.8.2-.6 1.7-2.6 2.6-4.4 1.9" fill="#2496ED" />
    </svg>
  );
}

/** Windows Server — Vier-Felder-Logo. */
export function WindowsTypeIcon({ size = 24 }: DeployTypeIconProps) {
  const c = '#00A4EF';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Windows" fill="none">
      <path d="M6 9.6l16-2.2v15.1H6z" fill={c} />
      <path d="M25 7l17-2.4v17.9H25z" fill={c} />
      <path d="M6 25.5h16v15.1L6 38.4z" fill={c} />
      <path d="M25 25.5h17v17.9L25 41z" fill={c} />
    </svg>
  );
}

/** SIEM / Wazuh — W-Lettermark im Marken-Blau. */
export function WazuhTypeIcon({ size = 24 }: DeployTypeIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Wazuh" fill="none">
      <path d="M6 10l6.5 28L24 19l11.5 19L42 10" stroke="#0578C0" strokeWidth="5.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
