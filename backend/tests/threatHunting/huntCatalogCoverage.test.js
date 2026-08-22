'use strict';

/**
 * Deckt die MITRE-ATT&CK-Breitenabdeckung des Hunt-Katalogs ab.
 *
 * Verifiziert:
 *  - der zusammengeführte Katalog (HuntType.js + huntTypeExtended.js) ist gewachsen
 *  - alle MITRE-IDs sind wohlgeformt (Txxxx / Txxxx.xxx)
 *  - alle Kategorien sind gültige ATT&CK-Taktiken und stimmen mit finding.mitreTactic überein
 *  - jeder Hunt erzeugt Logs + genau 1 wohlgeformtes Finding
 *  - die Parent-Technik-Abdeckung liegt bei ≥ 50 % der ~203 Enterprise-Basistechniken
 */

const { getCatalog, getHuntType, HUNT_TYPE_KEYS } = require('../../src/threatHunting/domain/HuntType');
const { EXTENDED_HUNT_TYPES } = require('../../src/threatHunting/domain/huntTypeExtended');
const { HuntService } = require('../../src/threatHunting/services/HuntService');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');

// MITRE ATT&CK Enterprise Basistechniken (Parent-Techniken, ohne Sub) — Denominator.
// Bewusst konservativ auf 203 gesetzt (Enterprise v15/16 ~203 base techniques).
const MITRE_ENTERPRISE_BASE_TECHNIQUES = 203;

const MITRE_ID_RE = /^T\d{4}(\.\d{3})?$/;

const VALID_TACTICS = new Set([
  'Reconnaissance', 'Resource Development', 'Initial Access', 'Execution',
  'Persistence', 'Privilege Escalation', 'Defense Evasion', 'Credential Access',
  'Discovery', 'Lateral Movement', 'Collection', 'Command and Control',
  'Exfiltration', 'Impact',
]);

const parentOf = (id) => id.split('.')[0];

describe('Hunt-Katalog — MITRE-ATT&CK-Breitenabdeckung', () => {
  it('der Katalog ist durch den erweiterten Block deutlich gewachsen (> 100 Hunt-Typen)', () => {
    expect(getCatalog().length).toBeGreaterThan(100);
    // Der erweiterte Block trägt den Löwenanteil bei.
    expect(Object.keys(EXTENDED_HUNT_TYPES).length).toBeGreaterThanOrEqual(80);
  });

  it('alle MITRE-IDs im Katalog sind wohlgeformt (Txxxx oder Txxxx.xxx)', () => {
    for (const item of getCatalog()) {
      if (!item.mitre) continue; // FP-/Exposure-Hunts dürfen leer sein
      expect(item.mitre).toMatch(MITRE_ID_RE);
    }
  });

  it('alle erweiterten Hunts haben eine gültige ATT&CK-Taktik als Kategorie', () => {
    for (const key of Object.keys(EXTENDED_HUNT_TYPES)) {
      const def = getHuntType(key);
      expect(VALID_TACTICS.has(def.category)).toBe(true);
    }
  });

  it('für jeden erweiterten Hunt stimmt finding.mitreTactic mit der Kategorie überein', () => {
    for (const key of Object.keys(EXTENDED_HUNT_TYPES)) {
      const def = getHuntType(key);
      const { findings } = def.build({ targetHost: 'Host-X', context: {} });
      expect(findings).toHaveLength(1);
      expect(findings[0].context.mitreTactic).toBe(def.category);
      expect(findings[0].mitreAttack).toBe(def.mitre);
    }
  });

  it('erreicht ≥ 50 % Parent-Technik-Abdeckung der MITRE-Enterprise-Basistechniken', () => {
    const parents = new Set();
    for (const item of getCatalog()) {
      if (!item.mitre) continue;
      parents.add(parentOf(item.mitre));
    }
    const coverage = parents.size / MITRE_ENTERPRISE_BASE_TECHNIQUES;
    // Dokumentiert die tatsächliche Zahl im Fehlerfall.
    expect(parents.size).toBeGreaterThanOrEqual(Math.ceil(MITRE_ENTERPRISE_BASE_TECHNIQUES * 0.5));
    expect(coverage).toBeGreaterThanOrEqual(0.5);
  });

  it('deckt alle 14 ATT&CK-Taktiken mit mindestens einem Hunt ab', () => {
    const tactics = new Set();
    for (const key of Object.keys(EXTENDED_HUNT_TYPES)) {
      tactics.add(getHuntType(key).category);
    }
    for (const t of VALID_TACTICS) {
      expect(tactics.has(t)).toBe(true);
    }
  });

  it('einige repräsentative neue Techniken sind registriert (Reuse aus QRadar-Szenarien)', () => {
    const expected = {
      kerberoasting_hunt:      'T1558.003', // UC-CRED-002
      dcsync_hunt:             'T1003.006', // MITRE-Map-Roadmap
      winrm_lateral_hunt:      'T1021.006', // MITRE-Map-Roadmap
      lolbin_proxy_exec_hunt:  'T1218',     // MITRE-Map-Roadmap
      data_encrypted_hunt:     'T1486',     // UC-IMP-002
      indicator_removal_hunt:  'T1070',     // UC-IMP-001 C Synergie
      exploit_public_facing_hunt: 'T1190',
    };
    for (const [key, mitre] of Object.entries(expected)) {
      expect(HUNT_TYPE_KEYS).toContain(key);
      expect(getHuntType(key).mitre).toBe(mitre);
    }
  });
});

describe('Hunt-Katalog — jeder erweiterte Hunt ist ausführbar und wohlgeformt', () => {
  async function run(huntType, host) {
    const s = new HuntService(new InMemoryHuntRepository());
    const session = await s.createSession({ analystId: 'a1', targetHost: host, huntType });
    await s.startHunt(session.id, 'a1');
    return { logs: await s.getLogs(session.id), findings: await s.getFindings(session.id) };
  }

  it('jeder erweiterte Hunt erzeugt Logs + genau 1 Finding mit gültiger Severity/Confidence', async () => {
    for (const key of Object.keys(EXTENDED_HUNT_TYPES)) {
      const def = getHuntType(key);
      const { logs, findings } = await run(key, def.defaultTarget || 'Host-X');
      expect(logs.length).toBeGreaterThan(0);
      expect(findings).toHaveLength(1);
      const f = findings[0];
      expect(f.title).toBeTruthy();
      expect(f.description).toBeTruthy();
      expect(f.recommendation).toBeTruthy();
      expect(['low', 'medium', 'high', 'critical', 'info']).toContain(f.severity);
      expect(['low', 'medium', 'high']).toContain(f.confidence);
      expect(f.mitreAttack).toMatch(MITRE_ID_RE);
      expect(f.context.confidencePct).toBeGreaterThan(0);
    }
  });

  it('kritische Impact-/Cred-Hunts sind korrekt eingestuft', async () => {
    const ransomware = await run('data_encrypted_hunt', 'fileserver');
    expect(ransomware.findings[0].severity).toBe('critical');
    expect(ransomware.findings[0].context.mitreTactic).toBe('Impact');

    const dcsync = await run('dcsync_hunt', 'DC01');
    expect(dcsync.findings[0].severity).toBe('critical');
    expect(dcsync.findings[0].context.mitreTactic).toBe('Credential Access');
  });
});
