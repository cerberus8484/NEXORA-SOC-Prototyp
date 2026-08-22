'use strict';

const { HuntService } = require('../../src/threatHunting/services/HuntService');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');

function svc() {
  return new HuntService(new InMemoryHuntRepository());
}

async function createAndRun(huntType, targetHost) {
  const s = svc();
  const session = await s.createSession({ analystId: 'analyst-1', targetHost, huntType });
  await s.startHunt(session.id, 'analyst-1');
  const [logs, findings, reloaded] = await Promise.all([
    s.getLogs(session.id),
    s.getFindings(session.id),
    s.getSession(session.id),
  ]);
  return { service: s, session: reloaded, logs, findings };
}

describe('HuntRunner — Session-Lifecycle', () => {
  it('Session kann mit Hunt-Typ erstellt werden', async () => {
    const s = svc();
    const session = await s.createSession({ analystId: 'a1', targetHost: 'Windows-01', huntType: 'suspicious_powershell_hunt' });
    expect(session.huntType).toBe('suspicious_powershell_hunt');
    expect(session.title).toBe('Suspicious PowerShell Hunt');
    expect(session.status).toBe('planned');
  });

  it('startHunt erzeugt Logs und Findings und schließt ab', async () => {
    const { session, logs, findings } = await createAndRun('suspicious_powershell_hunt', 'Windows-01');
    expect(logs.length).toBeGreaterThan(0);
    expect(findings.length).toBe(1);
    expect(session.status).toBe('completed');
    expect(session.findingsCount).toBe(1);
  });

  it('Logs sind chronologisch (seq aufsteigend)', async () => {
    const { logs } = await createAndRun('suspicious_powershell_hunt', 'Windows-01');
    const seqs = logs.map(l => l.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(logs[0].message).toMatch(/Hunt session created/);
  });
});

describe('HuntRunner — Hunt-Typen', () => {
  it('suspicious_powershell_hunt → High Finding mit Prozess-Kontext', async () => {
    const { findings } = await createAndRun('suspicious_powershell_hunt', 'Windows-01');
    const f = findings[0];
    expect(f.severity).toBe('high');
    expect(f.title).toMatch(/PowerShell/);
    expect(f.context.process).toBe('powershell.exe');
    expect(f.context.mitreTechnique).toBe('T1059.001');
    expect(f.context.confidencePct).toBe(91);
  });

  it('opnsense_multicast_review → Low FP-candidate Finding', async () => {
    const { findings } = await createAndRun('opnsense_multicast_review', 'OPNsense-fw');
    const f = findings[0];
    expect(f.severity).toBe('low');
    expect(f.context.verdict).toBe('benign');
    expect(f.context.destinationIp).toBe('224.0.0.7');
    expect(f.context.destinationPort).toBe(5353);
  });

  it('rdp_exposure_hunt → RDP Finding auf Port 3389', async () => {
    const { findings } = await createAndRun('rdp_exposure_hunt', 'Server-01');
    const f = findings[0];
    expect(f.title).toMatch(/RDP/);
    expect(f.context.destinationPort).toBe(3389);
    expect(f.context.protocol).toBe('TCP');
  });
});

describe('HuntRunner — Sonderfälle', () => {
  it('startHunt ohne Hunt-Typ aktiviert nur (back-kompatibel)', async () => {
    const s = svc();
    const session = await s.createSession({ analystId: 'a1', targetHost: 'Host-X' });
    await s.startHunt(session.id, 'a1');
    const reloaded = await s.getSession(session.id);
    expect(reloaded.status).toBe('active');
    const logs = await s.getLogs(session.id);
    expect(logs).toHaveLength(0);
  });

  it('cancel setzt Status cancelled', async () => {
    const s = svc();
    const session = await s.createSession({ analystId: 'a1', targetHost: 'Host-X' });
    await s.cancelSession(session.id, 'a1');
    const reloaded = await s.getSession(session.id);
    expect(reloaded.status).toBe('cancelled');
  });

  it('async-Modus: Session bleibt zunächst active, läuft dann auf completed', async () => {
    const s = svc();
    const session = await s.createSession({ analystId: 'a1', targetHost: 'Windows-01', huntType: 'suspicious_powershell_hunt' });
    const started = await s.startHunt(session.id, 'a1', { stepDelayMs: 5 });
    expect(started.status).toBe('active');           // sofort active, Run läuft async

    // Auf Abschluss warten (Polling).
    let reloaded;
    for (let i = 0; i < 50; i += 1) {
      reloaded = await s.getSession(session.id);
      if (reloaded.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(reloaded.status).toBe('completed');
    const findings = await s.getFindings(session.id);
    expect(findings.length).toBe(1);
  });

  it('getLogs liefert Logs chronologisch zurück', async () => {
    const { logs } = await createAndRun('rdp_exposure_hunt', 'Server-01');
    expect(logs[0].seq).toBe(0);
    expect(logs[logs.length - 1].message).toMatch(/Total findings/);
  });
});
