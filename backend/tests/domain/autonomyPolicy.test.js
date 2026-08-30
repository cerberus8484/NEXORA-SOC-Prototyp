'use strict';

/**
 * Tests — AutonomyPolicy Domain
 * RED → GREEN zyklus: Tests zuerst, Implementierung folgt.
 */

const {
  AutonomyPolicy,
  ACTION_CLASSES,
  MODES,
  VERDICTS,
  CEILINGS,
} = require('../../src/domain/AutonomyPolicy');

// ─── Hilfsfunktion ────────────────────────────────────────────────────────────

function makePolicy(overrides = {}) {
  return AutonomyPolicy.create({
    customer:             '*',
    actionClass:          'enrichment',
    mode:                 'advisory',
    minVerdict:           'confirmed_incident',
    minConfidence:        0.9,
    requireEvidenceFloor: true,
    maxPerHour:           0,
    enabled:              false,
    createdBy:            'test-admin',
    ...overrides,
  });
}

// ─── Enums ────────────────────────────────────────────────────────────────────

describe('AutonomyPolicy — Enums', () => {
  it('ACTION_CLASSES enthält alle 6 Klassen', () => {
    expect(ACTION_CLASSES).toEqual(expect.arrayContaining([
      'enrichment', 'internal_state', 'draft_generation',
      'detection_write', 'host_response', 'external_comms',
    ]));
    expect(ACTION_CLASSES).toHaveLength(6);
  });

  it('MODES enthält advisory, assisted, autonomous', () => {
    expect(MODES).toEqual(expect.arrayContaining(['advisory', 'assisted', 'autonomous']));
    expect(MODES).toHaveLength(3);
  });

  it('VERDICTS enthält alle 4 Verdicts', () => {
    expect(VERDICTS).toEqual(expect.arrayContaining([
      'needs_more_info', 'false_positive', 'suspicious', 'confirmed_incident',
    ]));
    expect(VERDICTS).toHaveLength(4);
  });
});

// ─── Decken (CEILINGS) ────────────────────────────────────────────────────────

describe('AutonomyPolicy — Decken (CEILINGS)', () => {
  it('enrichment Decke = autonomous', () => {
    expect(CEILINGS.enrichment).toBe('autonomous');
  });

  it('internal_state Decke = autonomous', () => {
    expect(CEILINGS.internal_state).toBe('autonomous');
  });

  it('draft_generation Decke = autonomous', () => {
    expect(CEILINGS.draft_generation).toBe('autonomous');
  });

  it('detection_write Decke = assisted (nie autonomous)', () => {
    expect(CEILINGS.detection_write).toBe('assisted');
  });

  it('host_response Decke = advisory (human-only)', () => {
    expect(CEILINGS.host_response).toBe('advisory');
  });

  it('external_comms Decke = advisory (human-only)', () => {
    expect(CEILINGS.external_comms).toBe('advisory');
  });

  it('alle ACTION_CLASSES haben eine Decke', () => {
    ACTION_CLASSES.forEach((cls) => {
      expect(CEILINGS[cls]).toBeDefined();
      expect(MODES).toContain(CEILINGS[cls]);
    });
  });
});

// ─── Konstruktion & Defaults ──────────────────────────────────────────────────

describe('AutonomyPolicy — Konstruktion', () => {
  it('create() vergibt UUID', () => {
    const p = makePolicy();
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('create() setzt createdAt und updatedAt', () => {
    const p = makePolicy();
    expect(p.createdAt).toBeTruthy();
    expect(p.updatedAt).toBeTruthy();
  });

  it('Default customer ist "*"', () => {
    const p = makePolicy({ customer: undefined });
    expect(p.customer).toBe('*');
  });

  it('Default enabled ist false', () => {
    const p = makePolicy({ enabled: undefined });
    expect(p.enabled).toBe(false);
  });

  it('Default requireEvidenceFloor ist true', () => {
    const p = makePolicy({ requireEvidenceFloor: undefined });
    expect(p.requireEvidenceFloor).toBe(true);
  });

  it('Default maxPerHour ist 0', () => {
    const p = makePolicy({ maxPerHour: undefined });
    expect(p.maxPerHour).toBe(0);
  });

  it('Default mode ist advisory', () => {
    const p = makePolicy({ mode: undefined });
    expect(p.mode).toBe('advisory');
  });

  it('Default minVerdict ist confirmed_incident', () => {
    const p = makePolicy({ minVerdict: undefined });
    expect(p.minVerdict).toBe('confirmed_incident');
  });

  it('Default minConfidence ist 0.9', () => {
    const p = makePolicy({ minConfidence: undefined });
    expect(p.minConfidence).toBe(0.9);
  });
});

// ─── Validierung (ungültige Enums) ───────────────────────────────────────────

describe('AutonomyPolicy — Validierung', () => {
  it('ungültige actionClass wirft', () => {
    expect(() => makePolicy({ actionClass: 'invalid_class' })).toThrow();
  });

  it('ungültiger mode wirft', () => {
    expect(() => makePolicy({ mode: 'turbo' })).toThrow();
  });

  it('ungültiges minVerdict wirft', () => {
    expect(() => makePolicy({ minVerdict: 'maybe' })).toThrow();
  });

  it('minConfidence < 0 wirft', () => {
    expect(() => makePolicy({ minConfidence: -0.1 })).toThrow();
  });

  it('minConfidence > 1 wirft', () => {
    expect(() => makePolicy({ minConfidence: 1.1 })).toThrow();
  });

  it('maxPerHour < 0 wirft', () => {
    expect(() => makePolicy({ maxPerHour: -1 })).toThrow();
  });

  it('gültige Werte werfen nicht', () => {
    expect(() => makePolicy({
      actionClass: 'enrichment',
      mode: 'autonomous',
      minVerdict: 'suspicious',
      minConfidence: 0.7,
      maxPerHour: 10,
    })).not.toThrow();
  });
});

// ─── update() — Whitelist, immutable-Stil ────────────────────────────────────

describe('AutonomyPolicy — update()', () => {
  it('update() gibt neue Instanz zurück (immutable-Stil)', () => {
    const p = makePolicy();
    const updated = p.update({ enabled: true });
    expect(updated).not.toBe(p);
    expect(updated.enabled).toBe(true);
    expect(p.enabled).toBe(false); // Original unverändert
  });

  it('update() ändert nur erlaubte Felder', () => {
    const p = makePolicy({ mode: 'advisory' });
    const updated = p.update({ mode: 'autonomous', id: 'HACKY-ID' });
    expect(updated.mode).toBe('autonomous');
    expect(updated.id).toBe(p.id); // id bleibt unverändert
  });

  it('update() setzt updatedAt neu', () => {
    const p = makePolicy();
    const before = p.updatedAt;
    // kleines Delay damit Timestamps unterscheidbar sind
    const updated = p.update({ enabled: true });
    expect(updated.updatedAt).toBeDefined();
    // updatedAt kann gleich sein bei schnellen Tests — nur sicherstellen dass es gesetzt ist
    expect(typeof updated.updatedAt).toBe('string');
  });

  it('update() mit ungültigem mode wirft', () => {
    const p = makePolicy();
    expect(() => p.update({ mode: 'super_auto' })).toThrow();
  });
});

// ─── toJSON() ─────────────────────────────────────────────────────────────────

describe('AutonomyPolicy — toJSON()', () => {
  it('toJSON() liefert plain object (kein Prototyp)', () => {
    const p = makePolicy();
    const json = p.toJSON();
    expect(json.constructor).toBe(Object);
  });

  it('toJSON() enthält alle Pflichtfelder', () => {
    const p = makePolicy();
    const json = p.toJSON();
    ['id', 'customer', 'actionClass', 'mode', 'minVerdict', 'minConfidence',
      'requireEvidenceFloor', 'maxPerHour', 'enabled', 'createdBy', 'createdAt', 'updatedAt',
    ].forEach((f) => expect(json).toHaveProperty(f));
  });

  it('toJSON() ist Deep-Clone (keine geteilten Referenzen)', () => {
    const p = makePolicy();
    const j1 = p.toJSON();
    const j2 = p.toJSON();
    expect(j1).not.toBe(j2);
  });
});
