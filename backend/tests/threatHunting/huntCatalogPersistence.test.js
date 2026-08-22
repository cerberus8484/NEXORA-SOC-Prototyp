'use strict';

const { getCatalog, getHuntType, HUNT_TYPE_KEYS } = require('../../src/threatHunting/domain/HuntType');
const { HuntService } = require('../../src/threatHunting/services/HuntService');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');

const NEW_KEYS = ['scheduled_tasks_hunt', 'services_hunt', 'autoruns_hunt', 'remote_access_tools_hunt'];

async function run(huntType, host) {
  const s = new HuntService(new InMemoryHuntRepository());
  const session = await s.createSession({ analystId: 'a1', targetHost: host, huntType });
  await s.startHunt(session.id, 'a1');
  return { logs: await s.getLogs(session.id), findings: await s.getFindings(session.id) };
}

describe('Hunt-Katalog — Persistenz-/RMM-Hunts (scheduled_tasks, services, autoruns, remote_access_tools)', () => {
  it('alle 4 Hunts sind registriert und im Katalog mit Metadaten enthalten', () => {
    const cat = getCatalog();
    for (const key of NEW_KEYS) {
      expect(HUNT_TYPE_KEYS).toContain(key);
      expect(getHuntType(key)).toBeTruthy();
      const item = cat.find((c) => c.key === key);
      expect(item).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item.dataSources.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high', 'critical']).toContain(item.riskLevel);
    }
  });

  it('scheduled_tasks_hunt → T1053.005, erkennt Task außerhalb Standard-Pfad mit encoded PowerShell', async () => {
    const { logs, findings } = await run('scheduled_tasks_hunt', 'Windows-01');
    expect(logs.length).toBeGreaterThan(0);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.mitreAttack).toBe('T1053.005');
    expect(f.context.mitreTactic).toBe('Persistence');
    expect(f.context.commandLine).toMatch(/-enc/i);
    const logText = logs.map((l) => l.message).join('\n');
    expect(logText).toMatch(/schtasks/i);
    expect(logText).toMatch(/encoded|non-standard|Standard-Pfad/i);
  });

  it('services_hunt → T1543.003, erkennt unquoted service path + Binärpfad im User-Verzeichnis', async () => {
    const { logs, findings } = await run('services_hunt', 'Windows-01');
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.mitreAttack).toBe('T1543.003');
    expect(f.context.mitreTactic).toBe('Persistence');
    const logText = logs.map((l) => l.message).join('\n');
    expect(logText).toMatch(/unquoted/i);
    expect(logText).toMatch(/Users|AppData|ProgramData/i);
  });

  it('autoruns_hunt → T1547.001, prüft Run/RunOnce-Keys und Startup-Ordner', async () => {
    const { logs, findings } = await run('autoruns_hunt', 'Windows-01');
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.mitreAttack).toBe('T1547.001');
    expect(f.context.mitreTechnique).toBe('T1547.001');
    expect(f.context.mitreTactic).toBe('Persistence');
    const logText = logs.map((l) => l.message).join('\n');
    expect(logText).toMatch(/RunOnce/i);
    expect(logText).toMatch(/Startup/i);
  });

  it('remote_access_tools_hunt → T1219, matcht bekannte RMM-Tools-Signaturen', async () => {
    const { logs, findings } = await run('remote_access_tools_hunt', 'Windows-01');
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.mitreAttack).toBe('T1219');
    expect(f.context.mitreTactic).toBe('Command and Control');
    expect(f.context.process).toBeTruthy();
    const logText = logs.map((l) => l.message).join('\n');
    for (const tool of ['AnyDesk', 'TeamViewer', 'ScreenConnect', 'Atera', 'NinjaRMM']) {
      expect(logText).toContain(tool);
    }
  });

  it('jeder der 4 Hunts erzeugt Logs + genau 1 Finding mit gültiger Severity/Confidence', async () => {
    for (const key of NEW_KEYS) {
      const { logs, findings } = await run(key, 'Windows-01');
      expect(logs.length).toBeGreaterThan(0);
      expect(findings).toHaveLength(1);
      expect(['low', 'medium', 'high', 'critical']).toContain(findings[0].severity);
      expect(['low', 'medium', 'high']).toContain(findings[0].confidence);
      expect(findings[0].recommendation).toBeTruthy();
    }
  });
});
