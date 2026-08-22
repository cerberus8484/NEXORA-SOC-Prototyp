'use strict';

// P_PROVISION_SECURITY_1 — Agent B: RED-Tests nur, KEINE Implementierung.
//
// Testet das vollständige Credential-Lifecycle: Revoke, Retirement, Listing,
// Secret-Redaction, Idempotenz, Cross-Node-Schutz und Repo-Parität für
// neue Methoden (listNodeCredentials, retireNode).
//
// Erwartete neue Methoden (vom Lead zu bauen):
//   - repo.listNodeCredentials(nodeId) → Promise<Array<CredentialJSON>>
//   - nodeEnrollmentService.retireNode(nodeId, reason?) → Promise<{ nodeId, revokedCredentials }>
//     (ruft intern repo.transitionNode(id, 'retired') + revokt alle aktiven Credentials)
//
// Bestehende Methoden (bereits grün):
//   - credentialService.revoke(credentialId, reason?) — schon grün
//   - credentialService.authenticate(rawCredential) — schon grün
//   - repo.revokeNodeCredential(id, reason) — schon grün

const { InMemoryProvisioningRepository } = require('../../src/repositories/InMemoryProvisioningRepository');
const { NodeCredential, AUDIT_EVENTS, SECRET_KEY: _SECRET_KEY } = require('../../src/provisioning/provisioningDomain');
const { NodeCredentialService } = require('../../src/services/NodeCredentialService');
const { EnrollmentTokenService } = require('../../src/services/EnrollmentTokenService');
const { NodeEnrollmentService } = require('../../src/services/NodeEnrollmentService');

// SECRET_KEY-Regex ist nicht direkt exportiert; wir replizieren die Regel lokal
// (Quelle: provisioningDomain.js:53 — verbotene Key-Pattern).
const SECRET_KEY_RE = /(password|secret|token|api[_-]?key|apikey|privatekey|private_key|bearer|credential)/i;

// ─── Wire-Hilfsfunktion (Muster aus nodeCredentialHandoff.test.js) ────────────
function wire() {
  const repo = new InMemoryProvisioningRepository();
  const tokenService = new EnrollmentTokenService({ repo });
  const credentialService = new NodeCredentialService({ repo });
  const enrollService = new NodeEnrollmentService({ repo, tokenService, credentialService });
  return { repo, tokenService, credentialService, enrollService };
}

// Hilfsfunktion: Enrollment durchführen und Credential + NodeId liefern.
async function enrollNode(repo, tokenService, enrollService, hostname = 'test-host') {
  const profile = await repo.createEnrollmentProfile({
    name: `ep-${hostname}`,
    role: 'normal_agent',
    capabilities: ['heartbeat', 'inventory'],
  });
  const { token } = await tokenService.mintToken({ enrollmentProfileId: profile.id });
  const result = await enrollService.enroll({ token, hostname, platform: 'Linux' });
  return result; // { nodeId, nodeCredential (Klartext), serverTime }
}

// Hilfsfunktion: rekursiv alle String-Werte eines Objekts prüfen, ob ein
// verbotener Key vorkommt.
function findSecretKeys(obj, path = '') {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).flatMap(([k, v]) => {
    const fullPath = path ? `${path}.${k}` : k;
    const hits = [];
    if (SECRET_KEY_RE.test(k)) hits.push(fullPath);
    if (v && typeof v === 'object') hits.push(...findSecretKeys(v, fullPath));
    return hits;
  });
}

// ─── 1. Revoke eines aktiven Credentials ─────────────────────────────────────

describe('1 — Revoke: Admin widerruft aktives Credential', () => {
  test('status wird revoked, revokedAt ist gesetzt', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId, nodeCredential } = await enrollNode(repo, tokenService, enrollService);

    // Das Credential ist aktiv; Authenticate liefert auth.
    const authBefore = await credentialService.authenticate(nodeCredential);
    expect(authBefore).not.toBeNull();
    expect(authBefore.nodeId).toBe(nodeId);

    // Revoke des Credentials über den Service (credentialId aus mint-Ergebnis).
    // Wir müssen die credentialId ermitteln — sie liegt im Audit-Trail.
    const audit = await repo.listAudit({ type: AUDIT_EVENTS.NODE_CREDENTIAL_ISSUED, subjectId: nodeId });
    const credentialId = audit.data[0].data.ref;
    expect(credentialId).toBeTruthy();

    const revoked = await credentialService.revoke(credentialId, 'admin-revoke');
    expect(revoked).not.toBeNull();
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBeTruthy();
    expect(revoked.revokedReason).toBe('admin-revoke');
  });

  test('nach Revoke: authenticate liefert null (Credential ungültig)', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId, nodeCredential } = await enrollNode(repo, tokenService, enrollService);

    const audit = await repo.listAudit({ type: AUDIT_EVENTS.NODE_CREDENTIAL_ISSUED, subjectId: nodeId });
    const credentialId = audit.data[0].data.ref;

    await credentialService.revoke(credentialId, 'test-revoke');

    const authAfter = await credentialService.authenticate(nodeCredential);
    expect(authAfter).toBeNull();
  });
});

// ─── 2. Idempotenz von Revoke ─────────────────────────────────────────────────

describe('2 — Revoke ist idempotent', () => {
  test('zweiter Revoke des gleichen Credentials wirft nicht; Endzustand bleibt revoked', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId } = await enrollNode(repo, tokenService, enrollService);

    const audit = await repo.listAudit({ type: AUDIT_EVENTS.NODE_CREDENTIAL_ISSUED, subjectId: nodeId });
    const credentialId = audit.data[0].data.ref;

    const first = await credentialService.revoke(credentialId, 'first');
    expect(first.status).toBe('revoked');

    // Zweiter Aufruf darf nicht werfen; liefert null oder revoked-Objekt.
    // Harte Invariante: kein Crash, kein falscher Status.
    let second;
    await expect(async () => {
      second = await credentialService.revoke(credentialId, 'second');
    }).not.toThrow();

    // Repo-Direktprüfung: der gespeicherte Status ist weiter 'revoked'.
    const stored = await repo.findNodeCredentialByHash(
      NodeCredential.hash('__this-will-not-exist__')
    );
    // Stored muss null sein (falscher Hash), aber das Credential im Store ist revoked.
    // Direkte Verifikation über listNodeCredentials (neue Methode — wird RED sein).
    const creds = await repo.listNodeCredentials(nodeId); // ERWARTET: RED (Methode fehlt)
    expect(creds.every((c) => c.status === 'revoked')).toBe(true);
  });
});

// ─── 3. Widerrufenes Credential → kein Heartbeat ─────────────────────────────

describe('3 — Revoked Credential akzeptiert keinen Heartbeat', () => {
  test('authenticate nach Revoke: null (kein Heartbeat möglich)', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId, nodeCredential } = await enrollNode(repo, tokenService, enrollService);

    const audit = await repo.listAudit({ type: AUDIT_EVENTS.NODE_CREDENTIAL_ISSUED, subjectId: nodeId });
    const credentialId = audit.data[0].data.ref;

    await credentialService.revoke(credentialId, 'security-revoke');

    // Auf Service-Ebene: authenticate prüft Status.
    const auth = await credentialService.authenticate(nodeCredential);
    expect(auth).toBeNull();

    // Heartbeat über NodeEnrollmentService schlägt fehl, weil authenticate null liefert.
    // Wir simulieren den Route-Guard: null → 401. Der Service selbst wirft bei null-auth
    // nicht (die Route prüft), aber wir können recordHeartbeat mit unverändertem Credential
    // aufrufen — es SOLLTE die Node finden. Der Sicherheitscheck liegt auf Route-Ebene.
    // Auf Service-Ebene (zukünftige Härtung): recordHeartbeat SOLLTE rejected Node ablehnen
    // — das ist Test 8 (retired Node). Hier sichern wir den authenticate-Pfad.
    expect(auth).toBeNull(); // Wiederholung zur Klarheit
  });
});

// ─── 4. Cross-Node-Schutz ─────────────────────────────────────────────────────

describe('4 — Cross-Node-Schutz: Credential einer anderen Node', () => {
  test('Credential von Node A authentifiziert NICHT für Node B', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();

    const resultA = await enrollNode(repo, tokenService, enrollService, 'node-A');
    const resultB = await enrollNode(repo, tokenService, enrollService, 'node-B');

    const authA = await credentialService.authenticate(resultA.nodeCredential);
    const authB = await credentialService.authenticate(resultB.nodeCredential);

    expect(authA.nodeId).toBe(resultA.nodeId);
    expect(authB.nodeId).toBe(resultB.nodeId);

    // Kreuz-Auth: A's Credential findet Node B NICHT.
    expect(authA.nodeId).not.toBe(resultB.nodeId);
    expect(authB.nodeId).not.toBe(resultA.nodeId);
  });

  test('Revoke von Node A betrifft Credential von Node B nicht', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();

    const resultA = await enrollNode(repo, tokenService, enrollService, 'alpha');
    const resultB = await enrollNode(repo, tokenService, enrollService, 'beta');

    const auditA = await repo.listAudit({ type: AUDIT_EVENTS.NODE_CREDENTIAL_ISSUED, subjectId: resultA.nodeId });
    const credIdA = auditA.data[0].data.ref;

    await credentialService.revoke(credIdA, 'revoke-alpha');

    // A's Credential: null
    expect(await credentialService.authenticate(resultA.nodeCredential)).toBeNull();
    // B's Credential: weiterhin aktiv
    const authB = await credentialService.authenticate(resultB.nodeCredential);
    expect(authB).not.toBeNull();
    expect(authB.nodeId).toBe(resultB.nodeId);
  });
});

// ─── 5. Secret-Redaction im Audit ─────────────────────────────────────────────

describe('5 — Audit: keine Klartext-Credentials, keine Secret-Keys', () => {
  test('NODE_CREDENTIAL_REVOKED enthält nur ref, kein Klartext/Hash', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId, nodeCredential } = await enrollNode(repo, tokenService, enrollService);

    const auditIssued = await repo.listAudit({ type: AUDIT_EVENTS.NODE_CREDENTIAL_ISSUED, subjectId: nodeId });
    const credentialId = auditIssued.data[0].data.ref;

    await credentialService.revoke(credentialId, 'sec-test');

    const auditRevoked = await repo.listAudit({ type: AUDIT_EVENTS.NODE_CREDENTIAL_REVOKED, subjectId: nodeId });
    expect(auditRevoked.data.length).toBeGreaterThan(0);

    const revokedEvent = auditRevoked.data[0];
    const dump = JSON.stringify(revokedEvent);

    // Kein Klartext-Credential im Audit
    expect(dump.includes(nodeCredential)).toBe(false);
    expect(dump).not.toMatch(/tokenHash/i);

    // Keine verbotenen Keys in den data-Feldern
    const secretKeys = findSecretKeys(revokedEvent.data);
    expect(secretKeys).toEqual([]);

    // data enthält ref (credentialId), aber kein Klartext
    expect(revokedEvent.data).toHaveProperty('ref');
    expect(typeof revokedEvent.data.ref).toBe('string');
  });

  test('gesamter Audit-Dump enthält nach Enroll + Revoke KEINEN Klartext-Credential', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId, nodeCredential } = await enrollNode(repo, tokenService, enrollService);

    const auditIssued = await repo.listAudit({ type: AUDIT_EVENTS.NODE_CREDENTIAL_ISSUED, subjectId: nodeId });
    const credentialId = auditIssued.data[0].data.ref;
    await credentialService.revoke(credentialId, 'full-audit-check');

    const allAudit = await repo.listAudit({});
    const fullDump = JSON.stringify(allAudit.data);

    expect(fullDump.includes(nodeCredential)).toBe(false);
    expect(fullDump).not.toMatch(/tokenHash/i);
    // Kein ncr_-Klartext
    expect(fullDump).not.toMatch(/ncr_[0-9a-f]{64}/);
  });
});

// ─── 6. Node-Retirement: retireNode widerruft ALLE aktiven Credentials ────────
//
// NEUE METHODE die der Lead bauen muss:
//   nodeEnrollmentService.retireNode(nodeId, reason?)
//     → Promise<{ nodeId, revokedCredentials: number }>
//   Intern: repo.listNodeCredentials(nodeId) → filtere active → revokeNodeCredential je
//           + repo.transitionNode(nodeId, 'retired')
//           + Audit NODE_RETIRED_REVOKE (oder NODE_CREDENTIAL_REVOKED je Credential)
//
// Tests sind RED bis retireNode + listNodeCredentials gebaut sind.

describe('6 — Node-Retirement: retireNode widerruft alle aktiven Credentials', () => {
  test('retireNode: Node-Status wird retired', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId } = await enrollNode(repo, tokenService, enrollService, 'retire-target');

    // ERWARTETE NEUE METHODE — wird RED sein bis Implementierung vorhanden.
    await enrollService.retireNode(nodeId, 'lifecycle-end'); // RED: retireNode fehlt

    const node = await repo.getNode(nodeId);
    expect(node.status).toBe('retired');
  });

  test('retireNode: alle aktiven Credentials dieses Nodes werden revoked', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId, nodeCredential } = await enrollNode(repo, tokenService, enrollService, 'retire-cred-target');

    // Credential ist aktiv
    const authBefore = await credentialService.authenticate(nodeCredential);
    expect(authBefore).not.toBeNull();

    await enrollService.retireNode(nodeId, 'security-retire'); // RED: retireNode fehlt

    // Nach Retirement: Credential abgelaufen
    const authAfter = await credentialService.authenticate(nodeCredential);
    expect(authAfter).toBeNull();

    // listNodeCredentials zeigt revoked
    const creds = await repo.listNodeCredentials(nodeId); // RED: listNodeCredentials fehlt
    expect(creds.length).toBeGreaterThan(0);
    expect(creds.every((c) => c.status === 'revoked')).toBe(true);
  });

  test('retireNode: Audit enthält Revoke-Events OHNE Klartext-Credentials', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId, nodeCredential } = await enrollNode(repo, tokenService, enrollService, 'retire-audit');

    await enrollService.retireNode(nodeId, 'audit-test'); // RED: retireNode fehlt

    const allAudit = await repo.listAudit({});
    const dump = JSON.stringify(allAudit.data);

    expect(dump.includes(nodeCredential)).toBe(false);
    expect(dump).not.toMatch(/tokenHash/i);
    expect(dump).not.toMatch(/ncr_[0-9a-f]{64}/);

    // Es muss mindestens ein NODE_CREDENTIAL_REVOKED-Event für diesen Node geben.
    const revokedEvents = allAudit.data.filter(
      (e) => e.type === AUDIT_EVENTS.NODE_CREDENTIAL_REVOKED && e.subjectId === nodeId
    );
    expect(revokedEvents.length).toBeGreaterThan(0);
  });
});

// ─── 7. Retired Node: kein Heartbeat mehr ────────────────────────────────────

describe('7 — Retired Node akzeptiert keinen Heartbeat', () => {
  test('recordHeartbeat nach retireNode → wirft oder lehnt ab', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId } = await enrollNode(repo, tokenService, enrollService, 'hb-retired');

    // Heartbeat vor Retirement: ok
    await expect(
      enrollService.recordHeartbeat(nodeId, { status: 'healthy' })
    ).resolves.toMatchObject({ accepted: true });

    await enrollService.retireNode(nodeId, 'test-retire'); // RED: retireNode fehlt

    // Heartbeat nach Retirement: soll abgelehnt werden.
    // NEUE VERHALTENS-ERWARTUNG: recordHeartbeat prüft Node-Status und lehnt
    // 'retired' ab (wirft NotFoundError oder einen 403-ähnlichen Fehler).
    // Aktuell prüft recordHeartbeat den Status NICHT — dieser Test ist RED bis
    // die Implementierung dies erzwingt.
    await expect(
      enrollService.recordHeartbeat(nodeId, { status: 'healthy' })
    ).rejects.toBeDefined(); // RED: aktuell wirft recordHeartbeat nicht bei retired
  });

  test('authenticate mit zuvor gültigem Credential nach retireNode → null', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId, nodeCredential } = await enrollNode(repo, tokenService, enrollService, 'auth-retired');

    expect(await credentialService.authenticate(nodeCredential)).not.toBeNull();

    await enrollService.retireNode(nodeId, 'auth-retire-test'); // RED: retireNode fehlt

    // Credentials wurden revoked: authenticate = null
    expect(await credentialService.authenticate(nodeCredential)).toBeNull();
  });
});

// ─── 8. listNodeCredentials — Status und Hash-Schutz ─────────────────────────
//
// NEUE REPO-METHODE: repo.listNodeCredentials(nodeId)
//   → Promise<Array<{ id, nodeId, prefix, status, issuedAt, lastUsedAt, revokedAt, revokedReason }>>
// Gibt NIE tokenHash/Klartext zurück.

describe('8 — listNodeCredentials: Status sichtbar, NIE Hash', () => {
  test('listNodeCredentials liefert alle Credentials dieses Nodes', async () => {
    const { repo, tokenService, enrollService } = wire();
    const { nodeId } = await enrollNode(repo, tokenService, enrollService, 'list-test');

    // NEUE METHODE — wird RED sein.
    const creds = await repo.listNodeCredentials(nodeId); // RED: Methode fehlt

    expect(Array.isArray(creds)).toBe(true);
    expect(creds.length).toBeGreaterThan(0);
  });

  test('listNodeCredentials: kein tokenHash, kein Klartext in Rückgabe', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId, nodeCredential } = await enrollNode(repo, tokenService, enrollService, 'list-safe');

    const creds = await repo.listNodeCredentials(nodeId); // RED: Methode fehlt

    const dump = JSON.stringify(creds);
    expect(dump.includes(nodeCredential)).toBe(false);
    expect(dump).not.toMatch(/tokenHash/i);
    expect(dump).not.toMatch(/ncr_[0-9a-f]{64}/);

    // Jedes Element hat id, nodeId, prefix, status — kein tokenHash
    for (const c of creds) {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('nodeId', nodeId);
      expect(c).toHaveProperty('prefix');
      expect(c).toHaveProperty('status');
      expect(c).not.toHaveProperty('tokenHash');
    }
  });

  test('listNodeCredentials: zeigt revoked-Status ehrlich', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId } = await enrollNode(repo, tokenService, enrollService, 'list-revoked');

    const auditIssued = await repo.listAudit({ type: AUDIT_EVENTS.NODE_CREDENTIAL_ISSUED, subjectId: nodeId });
    const credentialId = auditIssued.data[0].data.ref;

    await credentialService.revoke(credentialId, 'show-revoked');

    const creds = await repo.listNodeCredentials(nodeId); // RED: Methode fehlt
    expect(creds.some((c) => c.status === 'revoked')).toBe(true);
    expect(creds.some((c) => c.revokedAt != null)).toBe(true);
  });

  test('listNodeCredentials: fremder Node bekommt leere Liste', async () => {
    const { repo, tokenService, enrollService } = wire();
    await enrollNode(repo, tokenService, enrollService, 'list-own');

    const foreignNodeId = '00000000-0000-0000-0000-000000000000';
    const creds = await repo.listNodeCredentials(foreignNodeId); // RED: Methode fehlt

    expect(Array.isArray(creds)).toBe(true);
    expect(creds).toHaveLength(0);
  });
});

// ─── 9. Repo-Parität: listNodeCredentials muss in InMemory UND Postgres vorhanden sein ──

describe('9 — Repo-Parität: listNodeCredentials', () => {
  test('InMemoryProvisioningRepository.listNodeCredentials ist eine Funktion', () => {
    const { repo } = wire();
    // RED: Methode existiert noch nicht in InMemoryProvisioningRepository.
    expect(typeof repo.listNodeCredentials).toBe('function');
  });

  test('PostgresProvisioningRepository.listNodeCredentials ist eine Funktion', () => {
    // Postgres-Repo initialisieren (ohne DB — nur Methoden-Vertrag prüfen).
    const { PostgresProvisioningRepository } = require('../../src/repositories/PostgresProvisioningRepository');
    const pgRepo = new PostgresProvisioningRepository();

    // RED: Methode existiert noch nicht in PostgresProvisioningRepository.
    expect(typeof pgRepo.listNodeCredentials).toBe('function');
  });

  test('Methoden-Parität InMemory === Postgres (inkl. listNodeCredentials)', () => {
    const { PostgresProvisioningRepository } = require('../../src/repositories/PostgresProvisioningRepository');
    const pgRepo = new PostgresProvisioningRepository();
    const { repo } = wire();

    function publicMethods(obj) {
      return Object.getOwnPropertyNames(Object.getPrototypeOf(obj))
        .filter((m) => m !== 'constructor' && !m.startsWith('_') && typeof obj[m] === 'function')
        .sort();
    }

    const inmemMethods = publicMethods(repo);
    const pgMethods = publicMethods(pgRepo);

    // RED: listNodeCredentials fehlt in beiden → Parität erst grün wenn beide gebaut sind.
    expect(inmemMethods).toContain('listNodeCredentials');
    expect(pgMethods).toContain('listNodeCredentials');
    expect(pgMethods).toEqual(inmemMethods);
  });
});

// ─── 10. Postgres-Mapping: _toNodeCredential gibt keinen Hash nach außen ──────
//
// Diese Mapping-Tests laufen ohne DB (nur Schema-Prüfung) und sind nach dem Muster
// in postgresProvisioningMapping.test.js geschrieben.

describe('10 — Postgres _toNodeCredential Mapping (kein DB-Aufruf)', () => {
  const { PostgresProvisioningRepository } = require('../../src/repositories/PostgresProvisioningRepository');
  const pgRepo = new PostgresProvisioningRepository();
  const T = new Date('2026-06-19T10:00:00.000Z');

  test('_toNodeCredential: status=revoked, alle Felder korrekt gemappt', () => {
    const row = {
      id: 'cred-1',
      node_id: 'node-1',
      token_hash: 'deadbeef1234',
      prefix: 'ncr_1234...',
      status: 'revoked',
      issued_at: T,
      last_used_at: T,
      revoked_at: T,
      revoked_reason: 'manual',
    };

    const out = pgRepo._toNodeCredential(row);

    expect(out).toEqual({
      id: 'cred-1',
      nodeId: 'node-1',
      prefix: 'ncr_1234...',
      status: 'revoked',
      issuedAt: T.toISOString(),
      lastUsedAt: T.toISOString(),
      revokedAt: T.toISOString(),
      revokedReason: 'manual',
    });
    expect(out).not.toHaveProperty('tokenHash');
    expect(out).not.toHaveProperty('token_hash');
  });

  test('_toNodeCredential: status=active, revoked-Felder sind null', () => {
    const row = {
      id: 'cred-2',
      node_id: 'node-2',
      token_hash: 'abcdef',
      prefix: 'ncr_abcd...',
      status: 'active',
      issued_at: T,
      last_used_at: null,
      revoked_at: null,
      revoked_reason: null,
    };

    const out = pgRepo._toNodeCredential(row);

    expect(out.status).toBe('active');
    expect(out.revokedAt).toBeNull();
    expect(out.revokedReason).toBeNull();
    expect(out).not.toHaveProperty('tokenHash');
  });
});

// ─── 11. Referenzintegrität (dokumentiert als Erwartung) ─────────────────────
//
// Ohne echte DB ist vollständige FK-Prüfung nicht möglich. Dieser Test dokumentiert
// die Invariante und prüft, was im InMemory-Kontext testbar ist.

describe('11 — Referenzintegrität: kein verwaistes Credential', () => {
  test('Credential gehört immer einer existierenden Node (InMemory)', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const { nodeId, nodeCredential } = await enrollNode(repo, tokenService, enrollService, 'ref-int');

    // Credential des Nodes abrufen (via listNodeCredentials — RED).
    const creds = await repo.listNodeCredentials(nodeId); // RED: Methode fehlt
    for (const c of creds) {
      // Für jedes Credential muss die zugehörige Node existieren.
      const node = await repo.getNode(c.nodeId);
      expect(node).not.toBeNull();
      expect(node.id).toBe(nodeId);
    }
  });

  /*
   * ANMERKUNG AN DEN LEAD (nicht testbar ohne echte DB):
   * In der Postgres-Migration 035_node_credentials.sql sollte ein FK von
   * node_credentials.node_id → installed_nodes.id (ON DELETE CASCADE oder
   * ON DELETE RESTRICT) existieren. Bei retire_node-Pfad: Credentials NICHT
   * löschen (Audit-Trail erhalten), sondern revoken (status='revoked').
   * Orphan-Prevention = revoke vor oder beim Transition in 'retired'.
   */
});

// ─── 12. Kein Klartext-Credential in Fehlern und Responses ──────────────────

describe('12 — Kein Klartext-Credential in Fehlerpfaden', () => {
  test('revokeNodeCredential auf unbekannte ID liefert null — kein Credential in Fehler', async () => {
    const { repo } = wire();
    const result = await repo.revokeNodeCredential('non-existent-id', 'test');
    // Soll null sein, darf nicht werfen mit credential-Material.
    expect(result).toBeNull();
  });

  test('authenticate mit leerem/null String liefert null — kein Crash', async () => {
    const { credentialService } = wire();
    expect(await credentialService.authenticate('')).toBeNull();
    expect(await credentialService.authenticate(null)).toBeNull();
    expect(await credentialService.authenticate(undefined)).toBeNull();
    expect(await credentialService.authenticate(42)).toBeNull();
  });

  test('mintForNode: Rückgabe-nodeCredential (toJSON) hat keinen tokenHash', async () => {
    const { credentialService } = wire();
    const { credential, nodeCredential } = await credentialService.mintForNode('node-safe');
    expect(nodeCredential).not.toHaveProperty('tokenHash');
    // JSON-Stringify des gespeicherten Objekts darf den Klartext nicht enthalten.
    expect(JSON.stringify(nodeCredential)).not.toContain(credential);
  });
});
