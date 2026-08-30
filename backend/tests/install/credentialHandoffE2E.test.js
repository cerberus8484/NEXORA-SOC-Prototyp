'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_INSTALL_1 Slice 2 — Lokaler E2E des Credential-Handoffs.
//
// Beweist den vollen Bootstrap-Sicherheitsfluss gegen das ECHTE Backend
// (InMemory, in-process via supertest) — ohne echten Host, Lab, systemd oder
// Netzwerk-Konfiguration. Simuliert exakt, was bootstrap.sh persistiert
// (agent.env) und prüft, dass der Enrollment-Token NIE auf Platte landet und
// Heartbeats ausschließlich mit dem Node-Credential funktionieren. Alle
// temporären Dateien werden wieder entfernt.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

const BASE = '/api/v1/provisioning';
let adminToken;
let tmpDir;

beforeAll(async () => {
  const email = `e2e-admin-${Date.now()}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: 'e2e', role: 'admin' });
  adminToken = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-e2e-'));
});

afterAll(() => {
  // Aufräumen — keine Datei/kein Prozess bleibt zurück.
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const admin = (m, u, b) => request(app)[m](u).set('Authorization', `Bearer ${adminToken}`).send(b || {});

// Schreibt agent.env exakt wie bootstrap.sh — NUR Server/NodeId/Node-Credential.
function writeAgentEnv(dir, { server, nodeId, nodeCredential }) {
  const file = path.join(dir, 'agent.env');
  fs.writeFileSync(file, `NEXORA_SERVER=${server}\nNEXORA_NODE_ID=${nodeId}\nNEXORA_NODE_CREDENTIAL=${nodeCredential}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* NTFS reflektiert POSIX-Mode evtl. nicht — Inhalt ist maßgeblich */ }
  return file;
}

describe('P_INSTALL_1 Slice 2 — E2E Credential-Handoff', () => {
  test('Admin → Token → Enroll → agent.env (nur Credential) → Heartbeat → Token abgelehnt', async () => {
    // 1) Admin legt Enrollment-Profil an und mintet ein Token (einmalig).
    const profileId = (await admin('post', `${BASE}/enrollment-profiles`, { name: 'e2e', role: 'normal_agent', capabilities: ['inventory', 'heartbeat'] })).body.data.id;
    const enrollToken = (await admin('post', `${BASE}/enrollment-profiles/${profileId}/token`, {})).body.data.token;
    expect(enrollToken.startsWith('enr_')).toBe(true);

    // 2) Bootstrap: einmaliger Enroll mit Token im Body → nodeId + nodeCredential.
    const enr = await request(app).post(`${BASE}/enroll`).send({ token: enrollToken, hostname: 'e2e-host', platform: 'Linux', version: '6.1.0', ips: ['127.0.0.1'] });
    expect(enr.status).toBe(201);
    const { nodeId, nodeCredential } = enr.body.data;
    expect(nodeCredential.startsWith('ncr_')).toBe(true);

    // 3) Bootstrap persistiert agent.env — NUR Credential, NIE der Enrollment-Token.
    const envFile = writeAgentEnv(tmpDir, { server: 'http://127.0.0.1', nodeId, nodeCredential });
    const envContent = fs.readFileSync(envFile, 'utf8');
    expect(envContent).toMatch(/NEXORA_NODE_CREDENTIAL=ncr_/);
    expect(envContent).not.toContain(enrollToken);      // Enrollment-Token nicht auf Platte
    expect(envContent).not.toMatch(/enr_/);              // generell kein enr_-Material
    expect(envContent).not.toMatch(/NEXORA_TOKEN/);

    // 4) Agent: Heartbeat ausschließlich mit dem Node-Credential aus agent.env.
    const cred = envContent.match(/NEXORA_NODE_CREDENTIAL=(\S+)/)[1];
    const hb = await request(app).post(`${BASE}/nodes/${nodeId}/heartbeat`)
      .set('Authorization', `Bearer ${cred}`).send({ status: 'healthy', version: '6.1.0', ips: ['127.0.0.1'] });
    expect(hb.status).toBe(200);
    expect(hb.body.data.accepted).toBe(true);
    // Antwort enthält keinen Command-/Apply-Kanal.
    expect(JSON.stringify(hb.body.data)).not.toMatch(/(command|apply|exec|ssh|firewall|nat|route|dhcp|sniff)/i);

    // 5) Der Enrollment-Token funktioniert NICHT als Heartbeat-Credential.
    const hbToken = await request(app).post(`${BASE}/nodes/${nodeId}/heartbeat`)
      .set('Authorization', `Bearer ${enrollToken}`).send({ status: 'healthy' });
    expect(hbToken.status).toBe(401);

    // 6) Der Enrollment-Token ist verbraucht — kein zweites Enroll/Credential.
    const enr2 = await request(app).post(`${BASE}/enroll`).send({ token: enrollToken, hostname: 'e2e-host' });
    expect(enr2.status).toBe(401);

    // 7) Registry sieht die Node aktiv mit Heartbeat (Admin-Read-API), kein Credential im Detail.
    const detail = await admin('get', `${BASE}/nodes/${nodeId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.node.id).toBe(nodeId);
    expect(detail.body.data.latestHeartbeat.status).toBe('healthy');
    expect(JSON.stringify(detail.body.data)).not.toContain(nodeCredential); // kein Klartext im Detail
  });
});
