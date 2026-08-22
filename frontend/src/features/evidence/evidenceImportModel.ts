// Reine Validierung + Optionen für den „Import Evidence"-Dialog.
// DOM-/API-frei → testbar. Spiegelt die Backend-Whitelist (createEvidenceSchema).

export interface EvidenceDraft {
  ticketId: string;
  title: string;
  type: string;
  source: string;
  comment: string;
  rawText: string;
}

export const EVIDENCE_TYPE_OPTIONS: [string, string][] = [
  ['log_entry', 'Log Entry'], ['network', 'Network'], ['process', 'Process'],
  ['file', 'File'], ['registry', 'Registry'], ['memory', 'Memory'],
  ['dns', 'DNS'], ['email', 'Email'], ['screenshot', 'Screenshot'],
  ['ai_output', 'KI-Output'], ['hunt_finding', 'Hunt-Finding'],
  ['threat_intel', 'Threat Intel'], ['file_upload', 'Datei-Import'], ['other', 'Other'],
];

export const EVIDENCE_SOURCE_OPTIONS: [string, string][] = [
  ['manual', 'Manual'], ['qradar', 'QRadar'], ['splunk', 'Splunk'], ['sysmon', 'Sysmon'],
  ['edr', 'EDR'], ['firewall', 'Firewall'], ['threatHunting', 'Threat Hunting'],
  ['evidenceCollector', 'Evidence Collector'], ['agent', 'KI Agent'], ['threatIntel', 'Threat Intel'],
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyEvidenceDraft(ticketId = ''): EvidenceDraft {
  return { ticketId, title: '', type: 'log_entry', source: 'manual', comment: '', rawText: '' };
}

/** Gibt eine Fehlermeldung zurück oder null, wenn der Draft gültig ist. */
export function validateEvidenceDraft(d: EvidenceDraft): string | null {
  if (!d.ticketId.trim()) return 'Ticket-ID ist Pflicht';
  if (!UUID_RE.test(d.ticketId.trim())) return 'Ticket-ID muss eine gültige UUID sein';
  if (!d.title.trim()) return 'Titel ist Pflicht';
  return null;
}

// ── Datei-Import ────────────────────────────────────────────────────────────
// Spiegelt die Backend-Whitelist (Evidence.validateFileUpload): Endung + 5-MB-Limit.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_UPLOAD_EXTENSIONS = ['.txt', '.log', '.json', '.csv', '.pdf'] as const;

/** Validiert eine Datei vor dem Upload. Gibt Fehlermeldung oder null zurück. */
export function validateUploadFile(file: { name: string; size: number }): string | null {
  const name = (file.name || '').trim();
  if (!name) return 'Dateiname fehlt';
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Dateityp nicht erlaubt (${ALLOWED_UPLOAD_EXTENSIONS.join(', ')})`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Datei zu groß (max. ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB)`;
  }
  return null;
}
