// Schema-getriebenes agent-install-Formular.
//
// Das Formular war fest auf die Wazuh-Module verdrahtet (wazuhManager/agentName/os).
// Folge: jedes neue Modul brauchte Handarbeit in der UI — der Firewall-Collector war
// bereits deploybar, seine Felder aber nicht eingebbar. Hier werden die Felder aus
// dem `paramSchema` des Backends abgeleitet: EINE Quelle der Wahrheit für Feldnamen,
// Pflicht, Default und Muster. Neue Module (ids-sensor, siem-collector …) erscheinen
// damit ohne UI-Änderung.
//
// Reine Logik, kein React — testbar ohne DOM.

/** Feld-Definition, wie sie das Backend im paramSchema liefert. */
import i18n from '../../i18n';

export interface ParamSchemaField {
  type?: string;
  required?: boolean;
  default?: unknown;
  pattern?: string;
  values?: readonly string[];
  min?: number;
  max?: number;
}
export type ParamSchema = Record<string, ParamSchemaField>;

/** Was das Formular rendern soll. */
export interface ParamField {
  name: string;
  label: string;
  kind: 'text' | 'number' | 'select';
  required: boolean;
  defaultValue: string;
  pattern?: string;
  options?: readonly string[];
}

/**
 * Felder, die das Formular NICHT abfragt: Ziel-Host, SSH-Benutzer und -Port kommen
 * aus dem gewählten SSH-Connector. Sie doppelt abzufragen wäre fehleranfällig und
 * würde erlauben, Connector und Ziel auseinanderlaufen zu lassen.
 */
export const CONNECTOR_DERIVED = ['targetHost', 'sshUser', 'sshPort'] as const;

// Sprechende Beschriftungen für bekannte Felder; unbekannte werden aus dem
// camelCase-Namen erzeugt, damit ein neues Modul nie „nackt" aussieht.
const LABELS: Record<string, string> = {
  wazuhManager:     'Wazuh-Manager',
  agentName:        'Agent-Name',
  os:               'Betriebssystem (Distribution)',
  collectorVersion: 'Collector-Version',
  checksumSha256:   i18n.t('deploy.sha256ChecksumArtefact'),
  intakeUrl:        'Nexora-Intake-URL',
  artifactBaseUrl:  i18n.t('text.sourceArtefact'),
};

function humanize(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function kindOf(def: ParamSchemaField): ParamField['kind'] {
  if (def.type === 'enum' && Array.isArray(def.values) && def.values.length > 0) return 'select';
  if (def.type === 'integer' || def.type === 'number') return 'number';
  return 'text';
}

/**
 * Leitet die Formularfelder aus dem paramSchema ab.
 * Pflichtfelder zuerst — das Formular liest sich dann von oben nach unten sinnvoll.
 */
export function deriveParamFields(schema?: Record<string, unknown>): ParamField[] {
  if (!schema || typeof schema !== 'object') return [];
  const skip = new Set<string>(CONNECTOR_DERIVED);

  const fields = Object.entries(schema)
    .filter(([name]) => !skip.has(name))
    .map(([name, def]): ParamField => {
      const d = (def || {}) as ParamSchemaField;
      const required = d.required === true;
      return {
        name,
        label: LABELS[name] ?? humanize(name),
        kind: kindOf(d),
        required,
        defaultValue: d.default !== undefined && d.default !== null ? String(d.default) : '',
        pattern: d.pattern,
        options: Array.isArray(d.values) ? d.values : undefined,
      };
    });

  // Stabil sortieren: Pflicht vor optional, sonst Schema-Reihenfolge beibehalten.
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (Number(b.f.required) - Number(a.f.required)) || (a.i - b.i))
    .map(({ f }) => f);
}

/** Startwerte: Default aus dem Schema, sonst leer. */
export function initialParamValues(fields: readonly ParamField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.name] = f.defaultValue;
  return out;
}

/**
 * Prüft gegen dieselben Regeln wie das Backend (Pflicht + Muster) — der Analyst
 * bekommt das Feedback am Feld, statt erst als 400 nach dem Absenden.
 * Das Backend validiert unabhängig weiter; dies ist KEINE Sicherheitsgrenze.
 */
export function validateParamValues(
  fields: readonly ParamField[],
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = values[f.name];
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v === '') {
      if (f.required) errors[f.name] = 'Pflichtfeld';
      continue;                                   // leere optionale Felder sind in Ordnung
    }
    if (f.pattern) {
      let re: RegExp | null = null;
      try { re = new RegExp(f.pattern); } catch { re = null; }   // kaputtes Muster nie als Fehler am Nutzer auslassen
      if (re && !re.test(v)) errors[f.name] = i18n.t('deploy.invalidFormat');
    }
    if (f.kind === 'number' && !/^-?\d+$/.test(v)) errors[f.name] = 'Zahl erwartet';
  }
  return errors;
}
