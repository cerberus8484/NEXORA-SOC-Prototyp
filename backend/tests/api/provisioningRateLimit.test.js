'use strict';

jest.setTimeout(30000);

/**
 * P_PROVISION_SECURITY_1 — Rate-Limit RED-Tests für Provisioning-Endpunkte
 *
 * Diese Tests testen das VERHALTEN der echten app.js (via supertest).
 * Sie sind RED, weil die Provisioning-spezifischen Rate-Limit-Middlewares
 * noch NICHT in app.js eingebaut sind. Nach der Implementierung müssen alle
 * Tests grün werden.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MISSBRAUCHSSCHUTZ-PLAN (für den Lead — Zusammenfassung)
 *
 * 1. Enroll-Limiter (POST /api/v1/provisioning/enroll)
 *    - Schutz: Token-Erschöpfung und Enrollment-Brute-Force
 *    - Strategie: skipSuccessfulRequests=true → nur fehlgeschlagene Enrolls
 *      zählen zum Limit. Legitime Nodes (richtiger Token, einmalig) werden
 *      niemals blockiert, egal wie viele Fehlversuche vorher kamen.
 *    - keyGenerator: IP (X-Forwarded-For via trust proxy 1)
 *    - Prod-Default: 5 Fehlversuche in 15 Minuten pro IP
 *    - Warum IP: Enrollment ist eine administrative Aktion; Enrollment-Tokens
 *      werden von einem Admin ausgegeben, ein einzelner Angreifer hat keine
 *      legitime Basis für viele Versuche.
 *
 * 2. Heartbeat-Auth-Fehler-Limiter (POST /api/v1/provisioning/nodes/:id/heartbeat)
 *    - Schutz: Brute-Force auf Node-Credentials
 *    - Strategie: separater Limiter auf Auth-Fehler pro IP,
 *      skipSuccessfulRequests=true → authentifizierte Heartbeats zählen nicht
 *    - keyGenerator: IP (X-Forwarded-For)
 *    - Prod-Default: 20 fehlgeschlagene Auth-Versuche in 15 Minuten pro IP
 *
 * 3. Heartbeat-Flood-Limiter (POST /api/v1/provisioning/nodes/:id/heartbeat)
 *    - Schutz: DoS durch Heartbeat-Flooding einer einzelnen Node
 *    - Strategie: pro nodeId (req.params.id) — NICHT pro IP
 *    - NAT-Begründung: In einem Lab können N Nodes hinter einer einzigen
 *      NAT-IP sitzen (OPNsense, WLAN-Router, LXC-NAT). Würde der Heartbeat-
 *      Limiter per IP zählen, würde eine einzelne übermäßige Node alle anderen
 *      Nodes hinter derselben NAT-IP blockieren. keyGenerator=nodeId ist
 *      NAT-transparent und verhindert diesen Seiteneffekt.
 *    - keyGenerator: (req) => req.params.id  (nodeId aus dem URL-Parameter)
 *    - Prod-Default: 60 Heartbeats/Minute pro nodeId (entspricht 1/s, großzügig)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ERWARTETE CONFIG-KEYS (backend/src/config/index.js, alle via process.env)
 *
 *   provisioning: {
 *     enroll: {
 *       windowMs:           parseInt(process.env.PROV_ENROLL_WINDOW_MS          || '900000', 10), // 15 min
 *       max:                parseInt(process.env.PROV_ENROLL_MAX                || '5',      10),
 *       skipSuccessful:     (process.env.PROV_ENROLL_SKIP_SUCCESSFUL            || 'true') === 'true',
 *     },
 *     heartbeat: {
 *       nodeWindowMs:       parseInt(process.env.PROV_HEARTBEAT_WINDOW_MS       || '60000',  10), // 1 min
 *       maxPerNode:         parseInt(process.env.PROV_HEARTBEAT_MAX_PER_NODE    || '60',     10),
 *       failWindowMs:       parseInt(process.env.PROV_HEARTBEAT_FAIL_WINDOW_MS  || '900000', 10),
 *       failMaxPerIp:       parseInt(process.env.PROV_HEARTBEAT_FAIL_MAX_PER_IP || '20',     10),
 *     },
 *   }
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AKTIVIERUNG IM TEST vs. PROD
 *
 * Problem: NODE_ENV==='test' — der loginLimiter in app.js skippt in dieser
 * Umgebung. Für die Provisioning-Limiter darf das NICHT gelten, weil sonst
 * diese Test-Suite nichts testen kann.
 *
 * Lösung (Lead implementiert in app.js):
 *   - Die Provisioning-Limiter dürfen KEINEN NODE_ENV-skip haben.
 *   - Stattdessen: sehr niedrige Limits via ENV-Variablen konfigurierbar.
 *   - Diese Test-Suite setzt die ENV-Variablen auf Minimalwerte (max=3/max=2)
 *     in beforeAll, BEVOR app.js geladen wird.
 *
 * WICHTIG FÜR DEN LEAD: app.js cached das config-Objekt zum Ladezeitpunkt.
 * Damit die Test-ENV-Variablen wirken, muss die App-Konfiguration zur
 * Laufzeit aus process.env lesen (nicht aus einem einmalig geladenen Objekt).
 * Alternativ: Die Limiter-Instanzen in einer Fabrik-Funktion erstellen, die
 * beim Mount (nicht beim Modulload) aufgerufen wird.
 *
 * TEST-ENV-VARIABLEN, die diese Suite setzt:
 *   PROV_ENROLL_MAX=3                    (statt 5 in Prod)
 *   PROV_ENROLL_WINDOW_MS=60000          (1 Minute für schnelle Tests)
 *   PROV_ENROLL_SKIP_SUCCESSFUL=true
 *   PROV_HEARTBEAT_MAX_PER_NODE=5        (statt 60 in Prod)
 *   PROV_HEARTBEAT_WINDOW_MS=60000
 *   PROV_HEARTBEAT_FAIL_MAX_PER_IP=3     (statt 20 in Prod)
 *   PROV_HEARTBEAT_FAIL_WINDOW_MS=60000
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RED-ERWARTUNG:
 *   Alle Tests MÜSSEN fehlschlagen, solange die Provisioning-Limiter
 *   noch nicht in app.js/config/index.js eingebaut sind.
 *   Nach der Implementierung (GREEN) müssen alle Tests bestehen.
 *
 * EXPRESS-RATE-LIMIT v8 HINWEIS:
 *   keyGenerator, der req.ip direkt zurückgibt, löst ERR_ERL_KEY_GEN_IPV6
 *   aus. Der Lead muss ipKeyGenerator aus express-rate-limit importieren
 *   und nutzen:
 *     const { ipKeyGenerator } = require('express-rate-limit');
 *     keyGenerator: ipKeyGenerator
 *   Für nodeId-basierten Limiter: keyGenerator = (req) => req.params.id
 *   (keine IP-Auflösung nötig → kein IPv6-Warning).
 */

// ─── ENV VOR dem App-Load setzen ────────────────────────────────────────────
// KRITISCH: process.env muss VOR require('../../src/app') gesetzt werden,
// damit die Limiter-Fabrik die Werte zur Erstellungszeit einliest.
// (Jest cached Module; daher: jest.resetModules() + re-require in beforeAll)

const BASE = '/api/v1/provisioning';

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

/**
 * Registriert einen Admin und gibt einen JWT zurück.
 * Nimmt app als Parameter, um die gecachte Instanz zu nutzen.
 */
async function mkAdminToken(app) {
  const request = require('supertest');
  const { authService } = require('../../src/services/AuthService');
  const email = `rl-admin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  return res.body.token;
}

/**
 * Mintet einen Enrollment-Token und enrollt eine Node.
 * Gibt { nodeId, nodeCredential } zurück.
 */
async function mkEnrolledNode(app, adminToken, name) {
  const request = require('supertest');

  const profileRes = await request(app)
    .post(`${BASE}/enrollment-profiles`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, role: 'normal_agent', capabilities: ['inventory', 'heartbeat'] });

  if (profileRes.status !== 201) {
    throw new Error(`Profil-Anlage fehlgeschlagen (${profileRes.status}): ${JSON.stringify(profileRes.body)}`);
  }

  const tokenRes = await request(app)
    .post(`${BASE}/enrollment-profiles/${profileRes.body.data.id}/token`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});

  if (tokenRes.status !== 201) {
    throw new Error(`Token-Mint fehlgeschlagen (${tokenRes.status}): ${JSON.stringify(tokenRes.body)}`);
  }

  const enrollRes = await request(app)
    .post(`${BASE}/enroll`)
    .send({ token: tokenRes.body.data.token, hostname: name, platform: 'Linux', ips: ['10.99.99.55'] });

  if (enrollRes.status !== 201) {
    throw new Error(`Enroll fehlgeschlagen (${enrollRes.status}): ${JSON.stringify(enrollRes.body)}`);
  }

  return {
    nodeId:         enrollRes.body.data.nodeId,
    nodeCredential: enrollRes.body.data.nodeCredential,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let app;
let request;
let adminToken;

beforeAll(async () => {
  // Test-Limits setzen VOR dem App-Load.
  // Der Lead muss sicherstellen, dass config/index.js diese ENV-Werte
  // zur Laufzeit des rateLimit()-Aufrufs liest (nicht gecacht).
  process.env.PROV_ENROLL_MAX                = '3';
  process.env.PROV_ENROLL_WINDOW_MS          = '60000';
  process.env.PROV_ENROLL_SKIP_SUCCESSFUL    = 'true';
  process.env.PROV_HEARTBEAT_MAX_PER_NODE    = '5';
  process.env.PROV_HEARTBEAT_WINDOW_MS       = '60000';
  process.env.PROV_HEARTBEAT_FAIL_MAX_PER_IP = '3';
  process.env.PROV_HEARTBEAT_FAIL_WINDOW_MS  = '60000';

  // Frischen Modul-Cache erzwingen, damit die ENVs wirken.
  jest.resetModules();
  app     = require('../../src/app');
  request = require('supertest');

  adminToken = await mkAdminToken(app);
});

afterAll(() => {
  delete process.env.PROV_ENROLL_MAX;
  delete process.env.PROV_ENROLL_WINDOW_MS;
  delete process.env.PROV_ENROLL_SKIP_SUCCESSFUL;
  delete process.env.PROV_HEARTBEAT_MAX_PER_NODE;
  delete process.env.PROV_HEARTBEAT_WINDOW_MS;
  delete process.env.PROV_HEARTBEAT_FAIL_MAX_PER_IP;
  delete process.env.PROV_HEARTBEAT_FAIL_WINDOW_MS;
});

// ══════════════════════════════════════════════════════════════════════════════
// ENROLL — Rate-Limit-Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Enroll — Rate-Limit (RED)', () => {

  /**
   * POSITIV: skipSuccessfulRequests=true schützt den legitimen Flow.
   * Ein Node mit gültigem Token muss 201 erhalten — auch nachdem
   * fehlgeschlagene Versuche von derselben IP gezählt wurden.
   *
   * ERWARTET NACH IMPLEMENTIERUNG: 201
   * AKTUELLER RED-GRUND: Limiter existiert nicht → Test führt 3 Fehlversuche
   * durch und prüft dann, dass ein legitimer Enroll trotzdem durch kommt.
   * Ohne skipSuccessfulRequests würde ein naiver Limiter den legitimen Enroll
   * nach den Fehlversuchen ebenfalls blockieren — der Test wäre also auch ein
   * Korrektheitsprüfer für skipSuccessfulRequests.
   */
  describe('Legitimer Enroll bleibt auch nach Fehlversuchen erreichbar', () => {
    it('ein gültiger Token liefert 201, obwohl Fehlversuche von derselben IP vorhanden sind', async () => {
      // Arrange: Profil + Token für den legitimen Enroll anlegen
      const profileRes = await request(app)
        .post(`${BASE}/enrollment-profiles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `legit-enroll-${Date.now()}`, role: 'normal_agent', capabilities: ['inventory'] });
      expect(profileRes.status).toBe(201);

      const tokenRes = await request(app)
        .post(`${BASE}/enrollment-profiles/${profileRes.body.data.id}/token`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(tokenRes.status).toBe(201);
      const validToken = tokenRes.body.data.token;

      // Zwei Fehlversuche von IP 192.0.2.100 vorher (unter dem Limit von 3)
      for (let i = 0; i < 2; i++) {
        await request(app)
          .post(`${BASE}/enroll`)
          .set('X-Forwarded-For', '192.0.2.100')
          .send({ token: 'enr_ungueltig_legit_test_xxxxxxxxxx', hostname: `pre-fail-${i}` });
      }

      // Act: legitimer Enroll von derselben IP — muss durchgehen (skipSuccessfulRequests)
      const res = await request(app)
        .post(`${BASE}/enroll`)
        .set('X-Forwarded-For', '192.0.2.100')
        .send({ token: validToken, hostname: 'legit-node-ok', platform: 'Linux', ips: ['10.99.99.2'] });

      // Assert: RED — ohne skipSuccessfulRequests oder ohne Limiter kein definiertes Verhalten
      // Mit korrekter Implementierung: 201
      expect(res.status).toBe(201);
    });
  });

  /**
   * NEGATIV: Nach N fehlgeschlagenen Enroll-Versuchen von derselben IP → 429.
   *
   * RED-GRUND: app.js hat keinen Provisioning-Enroll-Limiter → bleibt bei 401 statt 429.
   */
  describe('Nach zu vielen fehlgeschlagenen Enroll-Versuchen von einer IP → 429', () => {
    it('liefert 429 nach PROV_ENROLL_MAX Fehlversuchen', async () => {
      // Arrange: LIMIT Fehlversuche (jeder → 401) von IP 192.0.2.11
      const LIMIT = parseInt(process.env.PROV_ENROLL_MAX || '3', 10);
      const failToken = 'enr_brute_force_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      for (let i = 0; i < LIMIT; i++) {
        await request(app)
          .post(`${BASE}/enroll`)
          .set('X-Forwarded-For', '192.0.2.11')
          .send({ token: failToken, hostname: `bf-node-${i}` });
      }

      // Act: Ein weiterer Versuch — muss jetzt 429 auslösen
      const res = await request(app)
        .post(`${BASE}/enroll`)
        .set('X-Forwarded-For', '192.0.2.11')
        .send({ token: failToken, hostname: 'bf-extra' });

      // Assert: RED — aktuell 401 (kein Limiter), erwartet 429
      expect(res.status).toBe(429);
    });

    it('429-Response enthält Retry-After-Header (express-rate-limit standardHeaders)', async () => {
      // Arrange: Limit von IP 192.0.2.12 erschöpfen
      const LIMIT = parseInt(process.env.PROV_ENROLL_MAX || '3', 10);
      const failToken = 'enr_brute_force_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      for (let i = 0; i <= LIMIT; i++) {
        await request(app)
          .post(`${BASE}/enroll`)
          .set('X-Forwarded-For', '192.0.2.12')
          .send({ token: failToken, hostname: `bf2-node-${i}` });
      }

      // Act
      const res = await request(app)
        .post(`${BASE}/enroll`)
        .set('X-Forwarded-For', '192.0.2.12')
        .send({ token: failToken, hostname: 'bf2-extra' });

      // Assert: RED — aktuell kein Header vorhanden (kein Limiter)
      expect(res.status).toBe(429);
      // express-rate-limit standardHeaders=true setzt 'ratelimit-reset' (draft-7)
      // oder 'retry-after'. Mindestens eines muss vorhanden sein.
      expect(
        res.headers['retry-after'] || res.headers['ratelimit-reset']
      ).toBeDefined();
    });

    it('429-Body enthält error TOO_MANY_REQUESTS (maschinenlesbar)', async () => {
      const LIMIT = parseInt(process.env.PROV_ENROLL_MAX || '3', 10);
      const failToken = 'enr_brute_force_test_ccccccccccccccccccccccccccccccccccccccccccccccccc';

      for (let i = 0; i <= LIMIT; i++) {
        await request(app)
          .post(`${BASE}/enroll`)
          .set('X-Forwarded-For', '192.0.2.13')
          .send({ token: failToken, hostname: `bf3-node-${i}` });
      }

      const res = await request(app)
        .post(`${BASE}/enroll`)
        .set('X-Forwarded-For', '192.0.2.13')
        .send({ token: failToken, hostname: 'bf3-extra' });

      expect(res.status).toBe(429);
      // Assert: RED — ohne Limiter gibt es keinen error-Key mit diesem Wert
      expect(res.body.error).toBe('TOO_MANY_REQUESTS');
    });

    it('429-Response enthält keinen Enrollment-Token-Wert (kein Secret-Leak)', async () => {
      // Sicherheitsinvariante: Rate-Limit-Response darf niemals den gesendeten
      // Token reflektieren — weder im Body noch in den Headern.
      const LIMIT = parseInt(process.env.PROV_ENROLL_MAX || '3', 10);
      const sensitiveToken = 'enr_sensitive_must_not_appear_in_rate_limit_response_eeeeeeeeeeeee';

      for (let i = 0; i <= LIMIT; i++) {
        await request(app)
          .post(`${BASE}/enroll`)
          .set('X-Forwarded-For', '192.0.2.14')
          .send({ token: sensitiveToken, hostname: `sec-node-${i}` });
      }

      const res = await request(app)
        .post(`${BASE}/enroll`)
        .set('X-Forwarded-For', '192.0.2.14')
        .send({ token: sensitiveToken, hostname: 'sec-extra' });

      expect(res.status).toBe(429);

      const bodyStr   = JSON.stringify(res.body);
      const headerStr = JSON.stringify(res.headers);

      // Der Token-Wert darf nirgends auftauchen
      expect(bodyStr).not.toContain(sensitiveToken);
      expect(headerStr).not.toContain(sensitiveToken);
      // Auch kein 'enr_'-Fragment (generische Token-Form)
      expect(bodyStr).not.toMatch(/enr_[a-f0-9a-z_]+/i);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// HEARTBEAT — Rate-Limit-Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Heartbeat — Rate-Limit (RED)', () => {

  /**
   * NAT-Schutz: Zwei verschiedene Nodes hinter derselben simulierten NAT-IP
   * dürfen sich nicht gegenseitig blockieren.
   * keyGenerator muss req.params.id (nodeId) sein, nicht die IP.
   *
   * RED-GRUND: Ohne nodeId-basierten Limiter → kein 429 für Node A nach Flood.
   */
  describe('NAT-Schutz: pro-nodeId-Limit blockiert nicht andere Nodes hinter gleicher IP', () => {
    let nodeA; let nodeB;

    beforeAll(async () => {
      nodeA = await mkEnrolledNode(app, adminToken, `nat-a-${Date.now()}`);
      nodeB = await mkEnrolledNode(app, adminToken, `nat-b-${Date.now()}`);
    });

    it('Node A kann ihr nodeId-Limit erschöpfen → 429 für Node A', async () => {
      const LIMIT = parseInt(process.env.PROV_HEARTBEAT_MAX_PER_NODE || '5', 10);

      for (let i = 0; i < LIMIT; i++) {
        await request(app)
          .post(`${BASE}/nodes/${nodeA.nodeId}/heartbeat`)
          .set('Authorization', `Bearer ${nodeA.nodeCredential}`)
          .set('X-Forwarded-For', '203.0.113.1')
          .send({ status: 'healthy' });
      }

      // Act: Node A über Limit
      const resA = await request(app)
        .post(`${BASE}/nodes/${nodeA.nodeId}/heartbeat`)
        .set('Authorization', `Bearer ${nodeA.nodeCredential}`)
        .set('X-Forwarded-For', '203.0.113.1')
        .send({ status: 'healthy' });

      // Assert: RED — ohne Limiter gibt es kein 429
      expect(resA.status).toBe(429);
    });

    it('Node B hinter derselben NAT-IP bleibt nach Node-A-Block erreichbar (NAT-Schutz)', async () => {
      // Voraussetzung: nodeA ist aus dem vorherigen Test bereits geblockt.
      // Node B hat einen anderen nodeId-Zähler — muss trotzdem 200 liefern.
      const resB = await request(app)
        .post(`${BASE}/nodes/${nodeB.nodeId}/heartbeat`)
        .set('Authorization', `Bearer ${nodeB.nodeCredential}`)
        .set('X-Forwarded-For', '203.0.113.1') // gleiche NAT-IP wie Node A!
        .send({ status: 'healthy' });

      // Assert: RED — ohne nodeId-basierten keyGenerator würde Node B ebenfalls
      // blockiert (IP-basierter Zähler). Hier muss 200 kommen.
      expect(resB.status).toBe(200);
      expect(resB.body.data.accepted).toBe(true);
    });
  });

  /**
   * Pro-nodeId-Limit: Heartbeat-Flooding einer einzelnen Node → 429 + Retry-After.
   * RED-GRUND: kein Provisioning-Heartbeat-Limiter in app.js vorhanden.
   */
  describe('Heartbeat-Flood einer nodeId → 429 + Retry-After', () => {
    let floodNode;

    beforeAll(async () => {
      floodNode = await mkEnrolledNode(app, adminToken, `flood-${Date.now()}`);
    });

    it('liefert 429 nach PROV_HEARTBEAT_MAX_PER_NODE Heartbeats', async () => {
      const LIMIT = parseInt(process.env.PROV_HEARTBEAT_MAX_PER_NODE || '5', 10);

      for (let i = 0; i < LIMIT; i++) {
        await request(app)
          .post(`${BASE}/nodes/${floodNode.nodeId}/heartbeat`)
          .set('Authorization', `Bearer ${floodNode.nodeCredential}`)
          .send({ status: 'healthy' });
      }

      const res = await request(app)
        .post(`${BASE}/nodes/${floodNode.nodeId}/heartbeat`)
        .set('Authorization', `Bearer ${floodNode.nodeCredential}`)
        .send({ status: 'healthy' });

      // Assert: RED — aktuell 200 (kein Limiter), erwartet 429
      expect(res.status).toBe(429);
    });

    it('429 enthält Retry-After-Header', async () => {
      // floodNode ist aus dem vorherigen Test bereits erschöpft.
      const res = await request(app)
        .post(`${BASE}/nodes/${floodNode.nodeId}/heartbeat`)
        .set('Authorization', `Bearer ${floodNode.nodeCredential}`)
        .send({ status: 'healthy' });

      expect(res.status).toBe(429);
      expect(
        res.headers['retry-after'] || res.headers['ratelimit-reset']
      ).toBeDefined();
    });

    it('429-Body enthält error TOO_MANY_REQUESTS', async () => {
      const res = await request(app)
        .post(`${BASE}/nodes/${floodNode.nodeId}/heartbeat`)
        .set('Authorization', `Bearer ${floodNode.nodeCredential}`)
        .send({ status: 'healthy' });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('TOO_MANY_REQUESTS');
    });
  });

  /**
   * Heartbeat-Auth-Brute-Force: M fehlgeschlagene Auth-Versuche pro IP → 429.
   * Schützt Node-Credentials vor Brute-Force (skipSuccessfulRequests=true:
   * gültige Heartbeats zählen nicht gegen den IP-Zähler).
   *
   * RED-GRUND: kein Auth-Fail-Limiter auf Heartbeat in app.js vorhanden.
   */
  describe('Heartbeat-Auth-Brute-Force → 429 nach M Fehlversuchen pro IP', () => {
    let legitimateNode;

    beforeAll(async () => {
      legitimateNode = await mkEnrolledNode(app, adminToken, `bf-legit-${Date.now()}`);
    });

    it('liefert 429 nach PROV_HEARTBEAT_FAIL_MAX_PER_IP fehlgeschlagenen Auth-Versuchen', async () => {
      const LIMIT      = parseInt(process.env.PROV_HEARTBEAT_FAIL_MAX_PER_IP || '3', 10);
      const fakeNodeId = 'cccccccc-0000-0000-0000-000000000001';
      const badCred    = 'ncr_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      for (let i = 0; i < LIMIT; i++) {
        await request(app)
          .post(`${BASE}/nodes/${fakeNodeId}/heartbeat`)
          .set('Authorization', `Bearer ${badCred}`)
          .set('X-Forwarded-For', '192.0.2.30')
          .send({ status: 'healthy' });
      }

      const res = await request(app)
        .post(`${BASE}/nodes/${fakeNodeId}/heartbeat`)
        .set('Authorization', `Bearer ${badCred}`)
        .set('X-Forwarded-For', '192.0.2.30')
        .send({ status: 'healthy' });

      // Assert: RED — aktuell 401 (kein Limiter), erwartet 429
      expect(res.status).toBe(429);
      expect(
        res.headers['retry-after'] || res.headers['ratelimit-reset']
      ).toBeDefined();
    });

    it('legitime Node von anderer IP bleibt nach IP-Block ungestört erreichbar', async () => {
      // IP 192.0.2.30 ist geblockt (vorheriger Test).
      // Die legitime Node sendet von IP 10.99.99.55 — anderer IP-Zähler.
      const res = await request(app)
        .post(`${BASE}/nodes/${legitimateNode.nodeId}/heartbeat`)
        .set('Authorization', `Bearer ${legitimateNode.nodeCredential}`)
        .set('X-Forwarded-For', '10.99.99.55')
        .send({ status: 'healthy' });

      // Assert: 200 — die legitime Node ist nicht von der gesperrten IP betroffen
      expect(res.status).toBe(200);
      expect(res.body.data.accepted).toBe(true);
    });

    it('erfolgreiche Heartbeats von legitimer Node zählen nicht zum Auth-Fail-Limit (skipSuccessfulRequests)', async () => {
      // skipSuccessfulRequests=true: viele erfolgreiche Heartbeats von einer IP
      // dürfen den Auth-Fail-Zähler dieser IP nicht auffüllen.
      // FRISCHE Node: dieser Test prüft den IP-basierten Auth-Fail-Limiter, nicht
      // den per-nodeId Flood-Limiter. Eine wiederverwendete Node würde durch ihren
      // (test-übergreifend akkumulierten) Flood-Zähler verfälschen — daher isolieren.
      const skipNode = await mkEnrolledNode(app, adminToken, `skip-succ-${Date.now()}`);
      const FAIL_LIMIT = parseInt(process.env.PROV_HEARTBEAT_FAIL_MAX_PER_IP || '3', 10);

      for (let i = 0; i < FAIL_LIMIT + 2; i++) {
        const res = await request(app)
          .post(`${BASE}/nodes/${skipNode.nodeId}/heartbeat`)
          .set('Authorization', `Bearer ${skipNode.nodeCredential}`)
          .set('X-Forwarded-For', '10.99.99.56')
          .send({ status: 'healthy' });
        // Jeder erfolgreiche Heartbeat muss weiterhin 200 liefern
        expect(res.status).toBe(200);
      }
    });

    it('429-Body enthält kein Node-Credential (kein Secret-Leak in Rate-Limit-Response)', async () => {
      const LIMIT          = parseInt(process.env.PROV_HEARTBEAT_FAIL_MAX_PER_IP || '3', 10);
      const fakeNodeId     = 'dddddddd-0000-0000-0000-000000000002';
      const sensitiveCred  = 'ncr_secret_do_not_leak_in_response_ffffffffffffffffffffffffffffffff';

      for (let i = 0; i <= LIMIT; i++) {
        await request(app)
          .post(`${BASE}/nodes/${fakeNodeId}/heartbeat`)
          .set('Authorization', `Bearer ${sensitiveCred}`)
          .set('X-Forwarded-For', '192.0.2.40')
          .send({ status: 'healthy' });
      }

      const res = await request(app)
        .post(`${BASE}/nodes/${fakeNodeId}/heartbeat`)
        .set('Authorization', `Bearer ${sensitiveCred}`)
        .set('X-Forwarded-For', '192.0.2.40')
        .send({ status: 'healthy' });

      expect(res.status).toBe(429);

      const bodyStr   = JSON.stringify(res.body);
      const headerStr = JSON.stringify(res.headers);

      // Sicherheitsinvariante: Credential-Wert nie in der Response
      expect(bodyStr).not.toContain(sensitiveCred);
      expect(headerStr).not.toContain(sensitiveCred);
      expect(bodyStr).not.toMatch(/ncr_[a-f0-9]+/i);
    });
  });
});
