'use strict';

// Deployment Center — Config-Media-Verpackung (First-Boot-Drive).
// Reine Funktion: verpackt die gerenderte config.xml deterministisch in ein
// Media-Artefakt, das OPNsense beim ersten Boot von /conf/config.xml importiert.

const { buildOpnsenseConfigMedia } = require('../../src/deploy/appliers/opnsenseConfigMedia');

const XML = '<?xml version="1.0"?><opnsense><system><hostname>fw-lab</hostname></system></opnsense>';
const HASH = 'a'.repeat(64);

describe('buildOpnsenseConfigMedia — Verpackung', () => {
  test('legt die config.xml unter dem OPNsense-Import-Pfad ab', () => {
    const media = buildOpnsenseConfigMedia({ xml: XML, configHash: HASH });
    expect(media.content).toBe(XML);
    expect(media.guestPath).toBe('/conf/config.xml');
  });

  test('Dateiname ist deterministisch aus dem configHash abgeleitet', () => {
    const a = buildOpnsenseConfigMedia({ xml: XML, configHash: HASH });
    const b = buildOpnsenseConfigMedia({ xml: XML, configHash: HASH });
    expect(a.filename).toBe(b.filename);
    expect(a.filename).toMatch(/^opnsense-config-a{12}\.xml$/);
  });

  test('trägt configHash + Default-Label', () => {
    const media = buildOpnsenseConfigMedia({ xml: XML, configHash: HASH });
    expect(media.configHash).toBe(HASH);
    expect(media.label).toBeTruthy();
  });

  test('eigenes Label wird übernommen', () => {
    const media = buildOpnsenseConfigMedia({ xml: XML, configHash: HASH, label: 'FW_EDGE' });
    expect(media.label).toBe('FW_EDGE');
  });

  test('fail-fast: leeres xml wirft (kein leeres Media-Artefakt)', () => {
    expect(() => buildOpnsenseConfigMedia({ xml: '', configHash: HASH })).toThrow();
  });

  test('fail-fast: fehlender configHash wirft', () => {
    expect(() => buildOpnsenseConfigMedia({ xml: XML })).toThrow();
  });
});
