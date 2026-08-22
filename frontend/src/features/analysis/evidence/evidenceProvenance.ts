// Reine, testbare Aufbereitung der gesicherten Evidence-Records (EvidenceItem) für die Lese-/Prüf-Ansicht.
// KEINE neue Logik — nur Herkunfts-Label, Roh-Aufbereitung und Kennzahlen aus echten Feldern.
import type { EvidenceItem } from '../../evidence/evidenceApi';
import type { Tone } from '../../../components/ui';

/** Klares Herkunfts-Label aus dem source-Feld (Wazuh / OPNsense / manuell importiert …). */
export function provenanceLabel(source?: string): string {
  const s = (source || '').toLowerCase().trim();
  if (!s) return 'Unbekannte Quelle';
  if (s.includes('wazuh')) return 'Wazuh';
  if (s.includes('opnsense') || s.includes('firewall')) return 'OPNsense';
  if (s.includes('qradar')) return 'QRadar';
  if (s.includes('splunk')) return 'Splunk';
  if (s.includes('virustotal')) return 'VirusTotal';
  if (s.includes('abuseipdb')) return 'AbuseIPDB';
  if (s.includes('snapshot') || s.includes('analysis')) return 'Analyse-Snapshot';
  if (s.includes('manual') || s.includes('import') || s.includes('upload')) return 'manuell importiert';
  return source!.charAt(0).toUpperCase() + source!.slice(1);
}

export function provenanceTone(source?: string): Tone {
  const s = (source || '').toLowerCase();
  if (s.includes('wazuh') || s.includes('qradar') || s.includes('splunk') || s.includes('opnsense') || s.includes('firewall')) return 'accent';
  if (s.includes('virustotal') || s.includes('abuseipdb')) return 'warning';
  if (s.includes('manual') || s.includes('import') || s.includes('upload')) return 'muted';
  return 'muted';
}

export const REVIEW_TONE: Record<string, Tone> = { open: 'muted', reviewed: 'accent', verified: 'success', flagged: 'danger' };

export interface EvidenceSummary {
  total: number;
  sources: { label: string; count: number }[];
  review: Record<string, number>;
  verified: number;
}

export function summarizeEvidence(items: EvidenceItem[]): EvidenceSummary {
  const sourceMap = new Map<string, number>();
  const review: Record<string, number> = { open: 0, reviewed: 0, verified: 0, flagged: 0 };
  for (const it of items) {
    const label = provenanceLabel(it.source);
    sourceMap.set(label, (sourceMap.get(label) ?? 0) + 1);
    const r = it.reviewStatus || 'open';
    review[r] = (review[r] ?? 0) + 1;
  }
  const sources = [...sourceMap.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  return { total: items.length, sources, review, verified: review.verified ?? 0 };
}

/** Roh-Inhalt für die aufklappbare Anzeige aufbereiten: JSON hübsch, sonst Klartext. */
export function prettyRaw(rawText?: string): { text: string; isJson: boolean } {
  const t = (rawText || '').trim();
  if (!t) return { text: '', isJson: false };
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === 'object') return { text: JSON.stringify(parsed, null, 2), isJson: true };
  } catch { /* kein JSON — Klartext */ }
  return { text: t, isJson: false };
}
