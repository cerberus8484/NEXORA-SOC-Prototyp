// Threat-Intel-Eintrag — mehrere pro Ticket (Editor-Parität zum Ursprungs-Tool).
// Eingebettet am Ticket als `tiEntries`-Array (analog zu `payloads`).

export interface TiEntry {
  id: string;
  category: string;
  actor: string;
  malware: string;
  confidence: string;
}

/** Leerer Eintrag mit frischer ID — für „TI Eintrag hinzufügen". */
export function emptyTiEntry(): TiEntry {
  return { id: crypto.randomUUID(), category: '', actor: '', malware: '', confidence: '' };
}

/** Hat der Eintrag irgendeinen Inhalt? (leere Einträge nicht ins Template/Save). */
export function isTiEntryFilled(e: TiEntry): boolean {
  return Boolean(e.category || e.actor || e.malware || e.confidence);
}

const withPlaceholder = (...vals: string[]) =>
  [{ value: '', label: '— wählen —' }, ...vals.map((v) => ({ value: v, label: v }))];

export const TI_CATEGORY_OPTS = withPlaceholder(
  'Initial Access', 'Execution', 'Persistence', 'Privilege Escalation', 'Defense Evasion',
  'Credential Access', 'Lateral Movement', 'Exfiltration', 'Command & Control', 'Impact',
);
export const TI_CONFIDENCE_OPTS = withPlaceholder('Low', 'Medium', 'High');
