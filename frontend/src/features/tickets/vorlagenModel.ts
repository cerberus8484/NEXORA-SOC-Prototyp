/**
 * Mapping zwischen Editor-Formfeldern und Analyse-Vorlagen-Feldern.
 *
 * Die Vorlage speichert sechs Textfelder. Zwei heißen im Editor-Formular anders:
 *   desc → description, rec → recommendation. Der Rest ist namensgleich.
 */

export interface AnalysisTemplate {
  id: string;
  name: string;
  desc: string;
  iocs: string;
  logs: string;
  actions: string;
  rec: string;
  notes: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

/** Die für eine Vorlage relevanten Inhaltsfelder (ohne Metadaten). */
export interface TemplateFields {
  desc: string;
  iocs: string;
  logs: string;
  actions: string;
  rec: string;
  notes: string;
}

/** Vorlagen-Feld → Editor-Formularschlüssel. */
const FIELD_TO_FORM: Record<keyof TemplateFields, string> = {
  desc: 'description',
  iocs: 'iocs',
  logs: 'logs',
  actions: 'actions',
  rec: 'recommendation',
  notes: 'notes',
};

/** Liest die sechs Vorlagen-Felder aus dem aktuellen Formular (zum Speichern). */
export function formToTemplateFields(form: Record<string, string>): TemplateFields {
  return {
    desc: form.description ?? '',
    iocs: form.iocs ?? '',
    logs: form.logs ?? '',
    actions: form.actions ?? '',
    rec: form.recommendation ?? '',
    notes: form.notes ?? '',
  };
}

/**
 * Baut ein Form-Patch aus einer Vorlage (zum Laden ins Formular).
 * Leere Vorlagen-Felder überschreiben nichts — so bleibt vorhandener
 * Ticket-Inhalt erhalten, wenn die Vorlage ein Feld nicht setzt.
 */
export function templateToFormPatch(tpl: AnalysisTemplate): Record<string, string> {
  const patch: Record<string, string> = {};
  (Object.keys(FIELD_TO_FORM) as (keyof TemplateFields)[]).forEach((key) => {
    const value = tpl[key];
    if (value && value.trim().length > 0) patch[FIELD_TO_FORM[key]] = value;
  });
  return patch;
}
