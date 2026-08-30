import { describe, it, expect } from 'vitest';
import { deriveParamFields, initialParamValues, validateParamValues, CONNECTOR_DERIVED } from './paramFormModel';

// ─────────────────────────────────────────────────────────────────────────
// Schema-getriebenes agent-install-Formular.
//
// Das Formular war fest auf die Wazuh-Module verdrahtet (wazuhManager/agentName/os).
// Jedes neue Modul haette Handarbeit in der UI gebraucht — der Firewall-Collector
// war deploybar, seine Felder aber nicht eingebbar. Hier werden die Felder aus dem
// paramSchema des Backends abgeleitet: EINE Quelle der Wahrheit, neue Module
// funktionieren ohne UI-Aenderung.
// ─────────────────────────────────────────────────────────────────────────

const wazuhSchema = {
  targetHost: { type: 'string', required: true, pattern: '^[a-zA-Z0-9.-]{1,253}$' },
  sshUser: { type: 'string', required: false, default: 'root' },
  sshPort: { type: 'integer', required: false, default: 22 },
  wazuhManager: { type: 'string', required: true, pattern: '^[a-zA-Z0-9.-]{1,253}$' },
  agentName: { type: 'string', required: false },
  os: { type: 'enum', required: false, default: 'debian', values: ['debian', 'rhel'] },
};

const collectorSchema = {
  targetHost: { type: 'string', required: true },
  sshUser: { type: 'string', required: false, default: 'root' },
  sshPort: { type: 'integer', required: false, default: 22 },
  collectorVersion: { type: 'string', required: true, pattern: '^v?[0-9]+(\\.[0-9]+){0,3}$' },
  checksumSha256: { type: 'string', required: true, pattern: '^[a-fA-F0-9]{64}$' },
  intakeUrl: { type: 'string', required: true, pattern: '^https?://.{1,500}$' },
  artifactBaseUrl: { type: 'string', required: false, pattern: '^https?://.{1,500}$' },
};

describe('deriveParamFields', () => {
  it('laesst Connector-Felder weg (Host/User/Port kommen aus dem SSH-Connector)', () => {
    const names = deriveParamFields(wazuhSchema).map((f) => f.name);
    for (const skipped of CONNECTOR_DERIVED) expect(names).not.toContain(skipped);
  });

  it('leitet die Wazuh-Felder ab — wie bisher, nur nicht mehr hartkodiert', () => {
    const names = deriveParamFields(wazuhSchema).map((f) => f.name);
    expect(names).toEqual(['wazuhManager', 'agentName', 'os']);
  });

  it('leitet die Collector-Felder ab, OHNE dass die UI davon wissen muss', () => {
    const names = deriveParamFields(collectorSchema).map((f) => f.name);
    expect(names).toEqual(['collectorVersion', 'checksumSha256', 'intakeUrl', 'artifactBaseUrl']);
  });

  it('uebernimmt required/default/pattern und den Feldtyp', () => {
    const f = deriveParamFields(collectorSchema);
    const sha = f.find((x) => x.name === 'checksumSha256')!;
    expect(sha.required).toBe(true);
    expect(sha.pattern).toBe('^[a-fA-F0-9]{64}$');

    const port = deriveParamFields({ p: { type: 'integer', required: false, default: 7 } })[0];
    expect(port.kind).toBe('number');
    expect(port.defaultValue).toBe('7');
  });

  it('enum wird zur Auswahl mit Werten', () => {
    const os = deriveParamFields(wazuhSchema).find((x) => x.name === 'os')!;
    expect(os.kind).toBe('select');
    expect(os.options).toEqual(['debian', 'rhel']);
  });

  it('Pflichtfelder stehen vor optionalen (Formular liest sich sinnvoll)', () => {
    const f = deriveParamFields(collectorSchema);
    const firstOptional = f.findIndex((x) => !x.required);
    const lastRequired = f.map((x) => x.required).lastIndexOf(true);
    expect(lastRequired).toBeLessThan(firstOptional);
  });

  it('leeres/fehlendes Schema ergibt keine Felder (kein Absturz)', () => {
    expect(deriveParamFields({})).toEqual([]);
    expect(deriveParamFields(undefined)).toEqual([]);
  });
});

describe('initialParamValues', () => {
  it('setzt Defaults, sonst leer', () => {
    const v = initialParamValues(deriveParamFields(wazuhSchema));
    expect(v.os).toBe('debian');
    expect(v.wazuhManager).toBe('');
  });
});

describe('validateParamValues', () => {
  const fields = deriveParamFields(collectorSchema);

  it('meldet fehlende Pflichtfelder', () => {
    const errs = validateParamValues(fields, { collectorVersion: '', checksumSha256: '', intakeUrl: '' });
    expect(errs.collectorVersion).toBeTruthy();
    expect(errs.checksumSha256).toBeTruthy();
  });

  it('prueft das Pattern des Backends (gleiche Regel, frueheres Feedback)', () => {
    const errs = validateParamValues(fields, {
      collectorVersion: 'v1.2.0', checksumSha256: 'zzz', intakeUrl: 'https://x/y',
    });
    expect(errs.checksumSha256).toBeTruthy();
    expect(errs.collectorVersion).toBeUndefined();
  });

  it('gueltige Eingaben ergeben keine Fehler', () => {
    const errs = validateParamValues(fields, {
      collectorVersion: 'v1.2.0', checksumSha256: 'a'.repeat(64), intakeUrl: 'https://10.0.10.75/x',
    });
    expect(Object.keys(errs)).toHaveLength(0);
  });

  it('leere OPTIONALE Felder sind in Ordnung', () => {
    const errs = validateParamValues(fields, {
      collectorVersion: 'v1.2.0', checksumSha256: 'a'.repeat(64), intakeUrl: 'https://x/y', artifactBaseUrl: '',
    });
    expect(errs.artifactBaseUrl).toBeUndefined();
  });
});
