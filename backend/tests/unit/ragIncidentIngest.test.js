'use strict';

/**
 * Tests für RagIncidentIngestService
 *
 * Abgedeckt:
 * 1. Dokument-Bau aus geschlossenem Ticket (buildDocFromTicket)
 * 2. Dokument-Bau aus genehmigter AgentSuggestion (buildDocFromSuggestion)
 * 3. Idempotenz: zweimal derselbe Eingang → ein Upsert, gleiche Doc-ID
 * 4. DSGVO-PII-Minimierung: Klartext-IPs/E-Mails/Hashes nicht im Payload
 * 5. Fehlerpfad: Embedding-Fehler → kein Still-Verschlucken, klarer Fehler
 * 6. Fehlerpfad: Qdrant-Upsert-Fehler → kein Still-Verschlucken, klarer Fehler
 * 7. Guard: nur 'approved' Suggestions werden akzeptiert
 * 8. Guard: fehlende Pflichtfelder (id) werden abgelehnt
 * 9. redactPii ersetzt alle IOC-Typen korrekt
 */

const {
  RagIncidentIngestService,
  buildDocFromTicket,
  buildDocFromSuggestion,
  redactPii,
  COLLECTION_INCIDENTS,
} = require('../../src/rag/RagIncidentIngestService');

// ─── Fakes ───────────────────────────────────────────────────────────────────

const dim = 4;

function fakeEmbedder(failWith = null) {
  return {
    async embed() {
      if (failWith) throw new Error(failWith);
      return new Array(dim).fill(0.25);
    },
  };
}

function fakeQdrant(failUpsert = false) {
  const calls = { ensure: [], upsert: [] };
  return {
    calls,
    async ensureCollection(c, size) { calls.ensure.push({ c, size }); },
    async upsert(c, points) {
      if (failUpsert) throw new Error('ECONNREFUSED');
      calls.upsert.push({ c, points });
    },
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const closedTicket = {
  id:          'ticket-abc-123',
  ticketNr:    'INC000042',
  title:       'Brute-Force Login von 192.0.2.99',
  description: 'Angreifer 10.0.0.5 versuchte Passwort für user max@corp.de. Hash: d41d8cd98f00b204e9800998ecf8427e',
  mitre:       'T1110',
  priority:    'high',
  closeReason: 'resolved',
  recommendation: 'Account sperren, IP 192.0.2.99 blockieren.',
  state:       'CLOSED',
};

const approvedSuggestion = {
  id:         'sugg-xyz-999',
  ticketId:   'ticket-abc-123',
  status:     'approved',
  verdict:    'confirmed_incident',
  rationale:  'Passwort-Spray erkannt',
  confidence: 0.92,
  analysis: {
    verdict:     'confirmed_incident',
    severity:    'high',
    mitreAttack: [{ id: 'T1110', name: 'Brute Force' }, { id: 'T1078', name: 'Valid Accounts' }],
    iocs:        ['192.0.2.99', 'max@corp.de', 'd41d8cd98f00b204e9800998ecf8427e'],
    assessment:  'Spray-Angriff von 203.0.113.5 auf 10 Accounts. Kontaktperson: admin@nexora.example',
  },
};

// ─── redactPii ───────────────────────────────────────────────────────────────

describe('redactPii()', () => {
  it('ersetzt IPv4 durch <ipv4> und meldet Typ', () => {
    const { text, iocTypes } = redactPii('Angriff von 192.168.241.1 erkannt');
    expect(text).not.toMatch(/192\.168\.241\.1/);
    expect(text).toContain('<ipv4>');
    expect(iocTypes).toContain('ipv4');
  });

  it('ersetzt E-Mail durch <email>', () => {
    const { text, iocTypes } = redactPii('User max@example.com war betroffen');
    expect(text).not.toMatch(/max@example\.com/);
    expect(text).toContain('<email>');
    expect(iocTypes).toContain('email');
  });

  it('ersetzt Hash (MD5/SHA256) durch <hash>', () => {
    const md5  = 'd41d8cd98f00b204e9800998ecf8427e';
    const sha  = 'a'.repeat(64);
    const { text, iocTypes } = redactPii(`Hash1: ${md5} Hash2: ${sha}`);
    expect(text).not.toMatch(/[a-f0-9]{32,64}/);
    expect(iocTypes).toContain('hash');
  });

  it('ersetzt URL durch <url>', () => {
    const { text, iocTypes } = redactPii('C2: http://evil.example.com/beacon');
    expect(text).not.toMatch(/http:\/\/evil\.example\.com/);
    expect(text).toContain('<url>');
    expect(iocTypes).toContain('url');
  });

  it('gibt leeren Text und leere iocTypes bei leerem Input zurück', () => {
    const { text, iocTypes } = redactPii('');
    expect(text).toBe('');
    expect(iocTypes).toHaveLength(0);
  });

  it('gibt leeren Text bei null/undefined zurück (kein Crash)', () => {
    expect(() => redactPii(null)).not.toThrow();
    expect(() => redactPii(undefined)).not.toThrow();
  });
});

// ─── buildDocFromTicket ───────────────────────────────────────────────────────

describe('buildDocFromTicket()', () => {
  it('baut ein gültiges Dokument aus einem Ticket', () => {
    const doc = buildDocFromTicket(closedTicket);
    expect(doc).toMatchObject({
      key:  'incident:ticket:ticket-abc-123',
      text: expect.any(String),
      payload: expect.objectContaining({
        source:     'ticket',
        incidentRef: 'INC000042',
        mitre:       'T1110',
        severity:    'high',
        closeReason: 'resolved',
      }),
    });
  });

  it('PII-Minimierung: keine Klartext-IP, E-Mail oder Hash im Payload', () => {
    const doc = buildDocFromTicket(closedTicket);
    const serialized = JSON.stringify(doc.payload);
    expect(serialized).not.toMatch(/192\.0\.2\.99/);
    expect(serialized).not.toMatch(/max@corp\.de/);
    expect(serialized).not.toMatch(/d41d8cd98f00b204e9800998ecf8427e/);
    expect(serialized).not.toMatch(/10\.0\.0\.5/);
  });

  it('IOC-Typen sind im Payload vorhanden', () => {
    const doc = buildDocFromTicket(closedTicket);
    expect(doc.payload.iocTypes).toEqual(expect.arrayContaining(['ipv4', 'email', 'hash']));
  });

  it('text enthält MITRE-Technik und Severity', () => {
    const doc = buildDocFromTicket(closedTicket);
    expect(doc.text).toContain('T1110');
    expect(doc.text).toContain('high');
  });

  it('wirft bei fehlendem ticket.id', () => {
    expect(() => buildDocFromTicket({ title: 'Foo' })).toThrow(/ticket\.id fehlt/);
  });

  it('wirft bei null-Eingabe', () => {
    expect(() => buildDocFromTicket(null)).toThrow();
  });

  it('nutzt ticketNr als incidentRef wenn vorhanden, sonst INC-Fallback', () => {
    const docA = buildDocFromTicket({ ...closedTicket, ticketNr: 'INC000099' });
    expect(docA.payload.incidentRef).toBe('INC000099');

    const docB = buildDocFromTicket({ ...closedTicket, ticketNr: '', id: 'abcdef12345678' });
    expect(docB.payload.incidentRef).toBe('INC-abcdef12');
  });
});

// ─── buildDocFromSuggestion ───────────────────────────────────────────────────

describe('buildDocFromSuggestion()', () => {
  it('baut ein gültiges Dokument aus einer genehmigten Suggestion', () => {
    const doc = buildDocFromSuggestion(approvedSuggestion);
    expect(doc).toMatchObject({
      key:  'incident:suggestion:sugg-xyz-999',
      text: expect.any(String),
      payload: expect.objectContaining({
        source:          'suggestion',
        suggestionId:    'sugg-xyz-999',
        verdict:         'confirmed_incident',
        severity:        'high',
        mitreTechniques: 'T1110, T1078',
        confidence:       0.92,
      }),
    });
  });

  it('PII-Minimierung: keine Klartext-IP, E-Mail oder Hash im Payload', () => {
    const doc = buildDocFromSuggestion(approvedSuggestion);
    const serialized = JSON.stringify(doc.payload);
    expect(serialized).not.toMatch(/192\.0\.2\.99/);
    expect(serialized).not.toMatch(/max@corp\.de/);
    expect(serialized).not.toMatch(/203\.0\.113\.5/);
    expect(serialized).not.toMatch(/d41d8cd98f00b204e9800998ecf8427e/);
    expect(serialized).not.toMatch(/admin@nexora\.example/);
  });

  it('IOC-Typen aus iocs und assessment sind im Payload', () => {
    const doc = buildDocFromSuggestion(approvedSuggestion);
    expect(doc.payload.iocTypes).toEqual(expect.arrayContaining(['ipv4', 'email', 'hash']));
  });

  it('text enthält MITRE-Techniken und Verdict', () => {
    const doc = buildDocFromSuggestion(approvedSuggestion);
    expect(doc.text).toContain('T1110');
    expect(doc.text).toContain('T1078');
    expect(doc.text).toContain('confirmed_incident');
  });

  it('lehnt pending-Suggestion ab', () => {
    expect(() => buildDocFromSuggestion({ ...approvedSuggestion, status: 'pending' }))
      .toThrow(/approved/);
  });

  it('lehnt rejected-Suggestion ab', () => {
    expect(() => buildDocFromSuggestion({ ...approvedSuggestion, status: 'rejected' }))
      .toThrow(/approved/);
  });

  it('wirft bei fehlendem suggestion.id', () => {
    expect(() => buildDocFromSuggestion({ status: 'approved', ticketId: 'x' }))
      .toThrow(/suggestion\.id fehlt/);
  });

  it('verarbeitet iocs als String (nicht nur Array)', () => {
    const suggStr = {
      ...approvedSuggestion,
      analysis: { ...approvedSuggestion.analysis, iocs: '192.0.2.1 und malware.exe' },
    };
    const doc = buildDocFromSuggestion(suggStr);
    expect(JSON.stringify(doc.payload)).not.toMatch(/192\.0\.2\.1/);
  });

  it('verarbeitet mitreAttack als String', () => {
    const suggStr = {
      ...approvedSuggestion,
      analysis: { ...approvedSuggestion.analysis, mitreAttack: 'T1059.001' },
    };
    const doc = buildDocFromSuggestion(suggStr);
    expect(doc.payload.mitreTechniques).toBe('T1059.001');
  });
});

// ─── RagIncidentIngestService ─────────────────────────────────────────────────

describe('RagIncidentIngestService', () => {
  // Konstruktor-Guards
  it('wirft wenn kein embedder übergeben wird', () => {
    expect(() => new RagIncidentIngestService({ qdrant: fakeQdrant() }))
      .toThrow(/embedder/);
  });

  it('wirft wenn kein qdrant übergeben wird', () => {
    expect(() => new RagIncidentIngestService({ embedder: fakeEmbedder() }))
      .toThrow(/qdrant/);
  });

  // ingestTicket
  describe('ingestTicket()', () => {
    it('gibt { ok: true, docId, collection } zurück', async () => {
      const qdrant = fakeQdrant();
      const svc = new RagIncidentIngestService({ embedder: fakeEmbedder(), qdrant });
      const result = await svc.ingestTicket(closedTicket);
      expect(result).toMatchObject({ ok: true, collection: COLLECTION_INCIDENTS });
      expect(result.docId).toMatch(/^[a-f0-9-]{36}$/);
    });

    it('ruft ensureCollection + upsert genau einmal auf', async () => {
      const qdrant = fakeQdrant();
      const svc = new RagIncidentIngestService({ embedder: fakeEmbedder(), qdrant });
      await svc.ingestTicket(closedTicket);
      expect(qdrant.calls.ensure).toHaveLength(1);
      expect(qdrant.calls.upsert).toHaveLength(1);
      expect(qdrant.calls.upsert[0].c).toBe(COLLECTION_INCIDENTS);
    });

    it('Idempotenz: zweimal dasselbe Ticket → identische docId, zwei Upserts (kein Duplikat im Vektor-Store)', async () => {
      const qdrant = fakeQdrant();
      const svc = new RagIncidentIngestService({ embedder: fakeEmbedder(), qdrant });
      const r1 = await svc.ingestTicket(closedTicket);
      const r2 = await svc.ingestTicket(closedTicket);
      // Qdrant upsert ist idempotent per Definition — gleiche UUID = Upsert, kein Duplikat
      expect(r1.docId).toBe(r2.docId);
      expect(qdrant.calls.upsert).toHaveLength(2); // beide Aufrufe gingen durch
      expect(qdrant.calls.upsert[0].points[0].id)
        .toBe(qdrant.calls.upsert[1].points[0].id);
    });

    it('Fehlerpfad: Embedding-Fehler wirft AppError mit status 502, nicht still verschluckt', async () => {
      const svc = new RagIncidentIngestService({
        embedder: fakeEmbedder('Ollama ECONNREFUSED'),
        qdrant:   fakeQdrant(),
      });
      await expect(svc.ingestTicket(closedTicket))
        .rejects.toMatchObject({ status: 502, message: expect.stringContaining('Embedding fehlgeschlagen') });
    });

    it('Fehlerpfad: Qdrant-Upsert-Fehler wirft AppError mit status 502', async () => {
      const svc = new RagIncidentIngestService({
        embedder: fakeEmbedder(),
        qdrant:   fakeQdrant(true), // failUpsert=true
      });
      await expect(svc.ingestTicket(closedTicket))
        .rejects.toMatchObject({ status: 502, message: expect.stringContaining('Qdrant-Upsert fehlgeschlagen') });
    });
  });

  // ingestSuggestion
  describe('ingestSuggestion()', () => {
    it('gibt { ok: true, docId, collection } zurück', async () => {
      const qdrant = fakeQdrant();
      const svc = new RagIncidentIngestService({ embedder: fakeEmbedder(), qdrant });
      const result = await svc.ingestSuggestion(approvedSuggestion);
      expect(result).toMatchObject({ ok: true, collection: COLLECTION_INCIDENTS });
      expect(result.docId).toMatch(/^[a-f0-9-]{36}$/);
    });

    it('Idempotenz: dieselbe Suggestion → identische docId', async () => {
      const qdrant = fakeQdrant();
      const svc = new RagIncidentIngestService({ embedder: fakeEmbedder(), qdrant });
      const r1 = await svc.ingestSuggestion(approvedSuggestion);
      const r2 = await svc.ingestSuggestion(approvedSuggestion);
      expect(r1.docId).toBe(r2.docId);
    });

    it('Ticket und Suggestion desselben Falls landen als UNTERSCHIEDLICHE Dokumente (verschiedene Keys)', async () => {
      const qdrant = fakeQdrant();
      const svc = new RagIncidentIngestService({ embedder: fakeEmbedder(), qdrant });
      const rT = await svc.ingestTicket(closedTicket);
      const rS = await svc.ingestSuggestion(approvedSuggestion);
      expect(rT.docId).not.toBe(rS.docId);
    });

    it('wirft bei pending-Suggestion (Guard schlägt durch)', async () => {
      const svc = new RagIncidentIngestService({ embedder: fakeEmbedder(), qdrant: fakeQdrant() });
      await expect(svc.ingestSuggestion({ ...approvedSuggestion, status: 'pending' }))
        .rejects.toThrow(/approved/);
    });

    it('Fehlerpfad: Embedding-Fehler → wirft mit status 502', async () => {
      const svc = new RagIncidentIngestService({
        embedder: fakeEmbedder('ECONNREFUSED'),
        qdrant:   fakeQdrant(),
      });
      await expect(svc.ingestSuggestion(approvedSuggestion))
        .rejects.toMatchObject({ status: 502 });
    });
  });

  // COLLECTION_INCIDENTS Konstante
  it('COLLECTION_INCIDENTS ist "incidents"', () => {
    expect(COLLECTION_INCIDENTS).toBe('incidents');
  });
});
