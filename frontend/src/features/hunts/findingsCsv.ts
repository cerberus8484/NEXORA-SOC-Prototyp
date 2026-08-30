import type { HuntFinding } from '../../lib/types';

// CSV-Erzeugung für Hunt-Findings. DOM-/API-frei → testbar.
// Felder: id, severity, title, description, createdAt.

const CSV_HEADER = ['id', 'severity', 'title', 'description', 'createdAt'] as const;

// Escaped ein einzelnes CSV-Feld nach RFC 4180:
// Felder mit Komma, Anführungszeichen oder Zeilenumbruch werden gequotet,
// innere Anführungszeichen verdoppelt.
export function escapeCsvField(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Baut die komplette CSV-Datei (Header + eine Zeile je Finding).
export function findingsToCsv(findings: ReadonlyArray<HuntFinding>): string {
  const lines = [CSV_HEADER.join(',')];
  for (const f of findings) {
    lines.push([
      escapeCsvField(f.id),
      escapeCsvField(f.severity),
      escapeCsvField(f.title),
      escapeCsvField(f.description),
      escapeCsvField(f.createdAt),
    ].join(','));
  }
  return lines.join('\r\n');
}
