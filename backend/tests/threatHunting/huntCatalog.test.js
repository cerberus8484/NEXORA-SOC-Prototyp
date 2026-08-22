'use strict';

const { getCatalog, getHuntType, HUNT_TYPE_KEYS } = require('../../src/threatHunting/domain/HuntType');
const { HuntService } = require('../../src/threatHunting/services/HuntService');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');

describe('Hunt-Katalog (vorgefertigte Hunts)', () => {
  it('enthält mindestens 6 vorgefertigte Hunts mit Metadaten', () => {
    const cat = getCatalog();
    expect(cat.length).toBeGreaterThanOrEqual(6);
    for (const item of cat) {
      expect(item.key).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(['low', 'medium', 'high', 'critical']).toContain(item.riskLevel);
    }
  });

  it('Katalog enthält keine build-Funktion (nur Metadaten)', () => {
    expect(getCatalog().every((i) => typeof i.build === 'undefined')).toBe(true);
  });

  it('neue Hunt-Typen sind registriert', () => {
    for (const k of ['persistence_hunt', 'failed_logon_hunt', 'dns_tunneling_hunt']) {
      expect(HUNT_TYPE_KEYS).toContain(k);
      expect(getHuntType(k)).toBeTruthy();
    }
  });

  it('Erweiterungs-Hunts (LSASS/PsExec/BITS/WMI) sind registriert mit korrekter MITRE-Technik', () => {
    const expected = {
      lsass_access_hunt:     'T1003.001',
      lateral_movement_hunt: 'T1021.002',
      bits_jobs_hunt:        'T1197',
      wmi_persistence_hunt:  'T1546.003',
    };
    for (const [key, mitre] of Object.entries(expected)) {
      expect(HUNT_TYPE_KEYS).toContain(key);
      expect(getHuntType(key).mitre).toBe(mitre);
    }
  });

  it('Welle-2-Hunts (Token/AS-REP/Shadow Copy) sind registriert mit korrekter MITRE-Technik', () => {
    const expected = {
      token_theft_hunt:          'T1134.001',
      asrep_roasting_hunt:       'T1558.004',
      shadow_copy_deletion_hunt: 'T1490',
    };
    for (const [key, mitre] of Object.entries(expected)) {
      expect(HUNT_TYPE_KEYS).toContain(key);
      expect(getHuntType(key).mitre).toBe(mitre);
    }
  });
});

describe('Neue Hunts erzeugen Logs + Findings', () => {
  async function run(huntType, host) {
    const s = new HuntService(new InMemoryHuntRepository());
    const session = await s.createSession({ analystId: 'a1', targetHost: host, huntType });
    await s.startHunt(session.id, 'a1'); // sync
    return { logs: await s.getLogs(session.id), findings: await s.getFindings(session.id) };
  }

  it('persistence_hunt → Finding mit Persistence-Kontext', async () => {
    const { logs, findings } = await run('persistence_hunt', 'Windows-01');
    expect(logs.length).toBeGreaterThan(0);
    expect(findings).toHaveLength(1);
    expect(findings[0].context.mitreTactic).toBe('Persistence');
  });

  it('failed_logon_hunt → Finding mit Quell-IP', async () => {
    const { findings } = await run('failed_logon_hunt', 'Linux-01');
    expect(findings[0].context.sourceIp).toBeTruthy();
    expect(findings[0].title).toMatch(/failed logon/i);
  });

  it('dns_tunneling_hunt → C2-Finding', async () => {
    const { findings } = await run('dns_tunneling_hunt', 'DNS-01');
    expect(findings[0].context.mitreTactic).toMatch(/Command and Control/i);
  });

  it('lsass_access_hunt → kritisches Credential-Access-Finding', async () => {
    const { findings } = await run('lsass_access_hunt', 'Windows-01');
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].context.mitreTactic).toBe('Credential Access');
    expect(findings[0].title).toMatch(/lsass/i);
  });

  it('lateral_movement_hunt → Finding mit Quell-IP (Brückenkopf)', async () => {
    const { findings } = await run('lateral_movement_hunt', 'Windows-02');
    expect(findings[0].context.sourceIp).toBeTruthy();
    expect(findings[0].context.mitreTactic).toBe('Lateral Movement');
  });

  it('bits_jobs_hunt → Defense-Evasion-Finding (T1197)', async () => {
    const { findings } = await run('bits_jobs_hunt', 'Windows-01');
    expect(findings[0].mitreAttack).toBe('T1197');
    expect(findings[0].context.mitreTactic).toBe('Defense Evasion');
  });

  it('wmi_persistence_hunt → Persistence-Finding (T1546.003)', async () => {
    const { findings } = await run('wmi_persistence_hunt', 'Windows-01');
    expect(findings[0].context.mitreTactic).toBe('Persistence');
    expect(findings[0].mitreAttack).toBe('T1546.003');
  });

  it('token_theft_hunt → Privilege-Escalation-Finding (T1134.001)', async () => {
    const { findings } = await run('token_theft_hunt', 'Windows-01');
    expect(findings[0].context.mitreTactic).toBe('Privilege Escalation');
    expect(findings[0].mitreAttack).toBe('T1134.001');
    expect(findings[0].title).toMatch(/token/i);
  });

  it('asrep_roasting_hunt → Credential-Access-Finding mit Quell-IP', async () => {
    const { findings } = await run('asrep_roasting_hunt', 'DC01');
    expect(findings[0].context.mitreTactic).toBe('Credential Access');
    expect(findings[0].context.sourceIp).toBeTruthy();
    expect(findings[0].title).toMatch(/AS-REP/i);
  });

  it('shadow_copy_deletion_hunt → kritisches Impact-Finding (T1490)', async () => {
    const { findings } = await run('shadow_copy_deletion_hunt', 'Windows-01');
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].context.mitreTactic).toBe('Impact');
    expect(findings[0].mitreAttack).toBe('T1490');
  });

  it('JEDER Katalog-Hunt erzeugt Logs + genau 1 Finding', async () => {
    for (const item of getCatalog()) {
      const { logs, findings } = await run(item.key, item.defaultTarget || 'Host-X');
      expect(logs.length).toBeGreaterThan(0);
      expect(findings).toHaveLength(1);
      expect(findings[0].title).toBeTruthy();
    }
  });
});
