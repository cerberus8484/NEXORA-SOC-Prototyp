'use strict';

const {
  UseCaseDraft,
  UCD_STATUSES,
  UCD_SOURCE_TYPES,
  UCD_SEVERITIES,
  UCD_LANGUAGES,
} = require('../../src/domain/UseCaseDraft');

// ─── Hilfsfunktion ────────────────────────────────────────────────────────────

function make(overrides = {}) {
  return UseCaseDraft.create({
    title:         'Lateral Movement via WMI',
    sourceType:    'ticket',
    sourceId:      'ticket-abc-123',
    description:   'Erkennt WMI-basierte Lateral-Movement-Techniken.',
    detectionGoal: 'T1047 Erkennung via WMI-Prozess-Spawning',
    dataSources:   ['wazuh', 'sysmon'],
    detectionLogic: {
      language:    'wazuh',
      queryOrRule: 'rule.groups: wmi AND process.name: wmiprvse.exe',
      explanation: 'WMI-Provider-Host spawnt ungewöhnliche Kindprozesse',
    },
    mitre:    [{ tactic: 'lateral_movement', technique: 'T1047' }],
    severity: 'high',
    confidence: 75,
    testCases: [
      { name: 'WMI-Spawn', type: 'true_positive',  event: { process: 'wmiprvse.exe', child: 'cmd.exe' }, expectedResult: 'alert' },
      { name: 'Normal',    type: 'false_positive',  event: { process: 'wmiprvse.exe', child: 'svchost.exe' }, expectedResult: 'no_alert' },
    ],
    ...overrides,
  });
}

// ─── Konstruktion & Defaults ──────────────────────────────────────────────────

describe('UseCaseDraft — Konstruktion', () => {
  it('vergibt eine UUID', () => {
    const d = make();
    expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('startet im Status draft', () => {
    const d = make();
    expect(d.status).toBe('draft');
  });

  it('setzt Timestamps createdAt und updatedAt', () => {
    const d = make();
    expect(d.createdAt).toBeTruthy();
    expect(d.updatedAt).toBeTruthy();
  });

  it('klemmt confidence auf [0, 100]', () => {
    expect(make({ confidence: 150 }).confidence).toBe(100);
    expect(make({ confidence: -5  }).confidence).toBe(0);
    expect(make({ confidence: 42  }).confidence).toBe(42);
  });

  it('fällt bei unbekanntem sourceType auf "manual" zurück', () => {
    expect(make({ sourceType: 'unknown_source' }).sourceType).toBe('manual');
  });

  it('fällt bei unbekanntem status auf "draft" zurück', () => {
    const d = new UseCaseDraft({ title: 'T', status: 'bogus_status' });
    expect(d.status).toBe('draft');
  });

  it('fällt bei unbekannter severity auf "medium" zurück', () => {
    expect(make({ severity: 'extreme' }).severity).toBe('medium');
  });

  it('normalisiert detectionLogic.language auf "generic" wenn unbekannt', () => {
    const d = make({ detectionLogic: { language: 'unknown_lang', queryOrRule: 'x', explanation: '' } });
    expect(d.detectionLogic.language).toBe('generic');
  });

  it('setzt Arrays auf [] wenn kein Array übergeben', () => {
    const d = new UseCaseDraft({ title: 'T', dataSources: 'falsch' });
    expect(Array.isArray(d.dataSources)).toBe(true);
    expect(d.dataSources).toHaveLength(0);
  });

  it('isValid() false ohne title', () => {
    expect(new UseCaseDraft({}).isValid()).toBe(false);
  });

  it('isValid() true mit Minimalfeldern', () => {
    expect(make().isValid()).toBe(true);
  });
});

// ─── toJSON ──────────────────────────────────────────────────────────────────

describe('UseCaseDraft — toJSON()', () => {
  it('gibt eine flache Kopie aller Felder zurück', () => {
    const d = make();
    const j = d.toJSON();
    expect(j.id).toBe(d.id);
    expect(j.title).toBe('Lateral Movement via WMI');
    expect(j.detectionLogic.language).toBe('wazuh');
    expect(j.mitre).toHaveLength(1);
  });

  it('Mutation des toJSON()-Ergebnisses ändert Instanz nicht', () => {
    const d = make();
    const j = d.toJSON();
    j.title = 'Mutiert';
    expect(d.title).toBe('Lateral Movement via WMI');
  });
});

// ─── Status-Statemaschine — gültige Übergänge ─────────────────────────────────

describe('UseCaseDraft — Statemaschine: gültige Übergänge', () => {
  it('draft → in_review via sendToReview()', () => {
    const d = make();
    d.sendToReview();
    expect(d.status).toBe('in_review');
  });

  it('in_review → approved via approve()', () => {
    const d = make();
    d.sendToReview();
    d.approve('reviewer-1');
    expect(d.status).toBe('approved');
    expect(d.reviewedBy).toBe('reviewer-1');
  });

  it('in_review → rejected via reject()', () => {
    const d = make();
    d.sendToReview();
    d.reject('reviewer-1');
    expect(d.status).toBe('rejected');
    expect(d.reviewedBy).toBe('reviewer-1');
  });

  it('approved → published via publish()', () => {
    const d = make();
    d.sendToReview();
    d.approve('reviewer-1');
    d.publish();
    expect(d.status).toBe('published');
  });

  it('updatedAt ist nach dem Übergang ein gültiges ISO-Datum', () => {
    const d = make();
    d.sendToReview();
    expect(d.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── Status-Statemaschine — ungültige Übergänge ───────────────────────────────

describe('UseCaseDraft — Statemaschine: ungültige Übergänge', () => {
  it('draft → approved wirft (Übersprung)', () => {
    const d = make();
    expect(() => d.approve('u')).toThrow(/ungültig.*draft.*approved/i);
  });

  it('draft → published wirft', () => {
    const d = make();
    expect(() => d.publish()).toThrow(/ungültig/i);
  });

  it('draft → rejected wirft (Übersprung)', () => {
    const d = make();
    expect(() => d.reject('u')).toThrow(/ungültig/i);
  });

  it('rejected → approved wirft (Terminal-Status)', () => {
    const d = make();
    d.sendToReview();
    d.reject('u');
    expect(() => d.approve('u')).toThrow(/ungültig/i);
  });

  it('published → approved wirft (Terminal-Status)', () => {
    const d = make();
    d.sendToReview();
    d.approve('u');
    d.publish();
    expect(() => d.approve('u')).toThrow(/ungültig/i);
  });

  it('approved → in_review wirft (Rückwärts nicht erlaubt)', () => {
    const d = make();
    d.sendToReview();
    d.approve('u');
    expect(() => d.sendToReview()).toThrow(/ungültig/i);
  });

  it('Fehler hat HTTP-Statuscode 409', () => {
    const d = make();
    let err;
    try { d.publish(); } catch (e) { err = e; }
    expect(err.status).toBe(409);
  });
});

// ─── Update ───────────────────────────────────────────────────────────────────

describe('UseCaseDraft — update()', () => {
  it('aktualisiert erlaubte Felder', () => {
    const d = make();
    d.update({ title: 'Neuer Titel', severity: 'critical' });
    expect(d.title).toBe('Neuer Titel');
    expect(d.severity).toBe('critical');
  });

  it('klemmt confidence beim Update', () => {
    const d = make();
    d.update({ confidence: 999 });
    expect(d.confidence).toBe(100);
  });

  it('normalisiert detectionLogic beim Update', () => {
    const d = make();
    d.update({ detectionLogic: { language: 'sigma', queryOrRule: 'new', explanation: 'ok' } });
    expect(d.detectionLogic.language).toBe('sigma');
  });

  it('updatedAt ist nach dem Update ein gültiges ISO-Datum', () => {
    const d = make();
    d.update({ title: 'X' });
    expect(d.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('ignoriert unbekannte Felder (Whitelist)', () => {
    const d = make();
    d.update({ id: 'overwrite-attempt', status: 'published' });
    // id und status sind nicht in der Whitelist
    expect(d.id).not.toBe('overwrite-attempt');
    expect(d.status).toBe('draft');
  });
});

// ─── Enum-Exporte ─────────────────────────────────────────────────────────────

describe('UseCaseDraft — exportierte Enums', () => {
  it('UCD_STATUSES enthält alle 5 Status', () => {
    expect(UCD_STATUSES).toEqual(expect.arrayContaining(['draft','in_review','approved','rejected','published']));
    expect(UCD_STATUSES).toHaveLength(5);
  });

  it('UCD_SOURCE_TYPES enthält alle 5 Typen', () => {
    expect(UCD_SOURCE_TYPES).toHaveLength(5);
  });

  it('UCD_SEVERITIES enthält alle 4 Stufen', () => {
    expect(UCD_SEVERITIES).toEqual(expect.arrayContaining(['low','medium','high','critical']));
  });

  it('UCD_LANGUAGES enthält alle 5 Sprachen', () => {
    expect(UCD_LANGUAGES).toEqual(expect.arrayContaining(['wazuh','sigma','splunk','qradar','generic']));
  });
});
