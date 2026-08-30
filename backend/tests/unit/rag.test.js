'use strict';

const { RagIngestionService, anonymizeIncident } = require('../../src/rag/RagIngestionService');
const { RagQueryService } = require('../../src/rag/RagQueryService');

const fakeEmbedder = (dim = 4) => ({
  model: 'nomic-embed-text',
  async embed() { return new Array(dim).fill(0.1); },
  async embedBatch(texts) { return texts.map(() => new Array(dim).fill(0.1)); },
});

describe('RagIngestionService', () => {
  it('ingestiert Hunts idempotent mit stabilen IDs', async () => {
    const calls = { ensure: [], upsert: [] };
    const qdrant = {
      async ensureCollection(c, size) { calls.ensure.push({ c, size }); },
      async upsert(c, points) { calls.upsert.push({ c, points }); },
    };
    const svc = new RagIngestionService({ embedder: fakeEmbedder(), qdrant });

    // ingestHunts batcht (RAG_INGEST_BATCH_SIZE) — ein Lauf kann mehrere upsert-Calls
    // erzeugen. Alle Batches eines Laufs flach einsammeln, sonst vergleicht der Test
    // Batch 0 vs Batch 1 desselben Laufs statt Lauf 1 vs Lauf 2.
    const n1 = await svc.ingestHunts();
    const ids1 = calls.upsert.flatMap((u) => u.points.map((p) => p.id));
    calls.upsert.length = 0;
    const n2 = await svc.ingestHunts();
    const ids2 = calls.upsert.flatMap((u) => u.points.map((p) => p.id));

    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(n1);
    expect(ids2).toEqual(ids1);
    expect(calls.ensure[0].c).toBe('hunt_catalog');
  });

  it('anonymisiert Incidents — kein Klartext-IP/Email, IOC-Typen erhalten', () => {
    const anon = anonymizeIncident({
      id: 'abc12345',
      title: 'Brute force von 203.0.113.55',
      description: 'User max@firma.de, C2 evil.example.com hash d41d8cd98f00b204e9800998ecf8427e',
      mitre: 'T1110',
      severity: 'high',
    });
    expect(anon.description).not.toMatch(/203\.0\.113\.55/);
    expect(anon.description).not.toMatch(/max@firma\.de/);
    expect(anon.iocTypes).toEqual(expect.arrayContaining(['ipv4', 'email', 'hash']));
    expect(anon.mitre).toBe('T1110');
  });
});

describe('RagQueryService', () => {
  it('findRelevant gibt Treffer zurück', async () => {
    const qdrant = {
      async search() {
        return [{ id: '1', score: 0.9, payload: { techniqueId: 'T1059.001', name: 'PowerShell', description: 'd' } }];
      },
    };
    const svc = new RagQueryService({ embedder: fakeEmbedder(), qdrant, enabled: true, topK: 3 });
    const hits = await svc.findRelevant('encoded powershell', 'mitre_attack');
    expect(hits).toHaveLength(1);
    expect(hits[0].payload.techniqueId).toBe('T1059.001');
  });

  it('FALLBACK: Qdrant-Ausfall crasht nicht — leeres Array + leerer Kontext', async () => {
    const qdrant = { async search() { throw new Error('ECONNREFUSED'); } };
    const svc = new RagQueryService({ embedder: fakeEmbedder(), qdrant, enabled: true });
    await expect(svc.findRelevant('text', 'mitre_attack')).resolves.toEqual([]);
    await expect(svc.buildContext('summary')).resolves.toBe('');
  });

  it('disabled → kein Embedding-Call, leeres Ergebnis', async () => {
    let searched = false;
    const qdrant = { async search() { searched = true; return []; } };
    const svc = new RagQueryService({ embedder: fakeEmbedder(), qdrant, enabled: false });
    expect(await svc.findRelevant('x', 'mitre_attack')).toEqual([]);
    expect(searched).toBe(false);
  });
});

describe('RagQueryService.buildContext — Multi-Collection (MITRE + Hunts + Incidents)', () => {
  // Qdrant-Mock, der je Collection eigene Treffer liefert.
  function multiQdrant(byCollection) {
    return {
      calls: [],
      async search(collection) {
        this.calls.push(collection);
        return byCollection[collection] || [];
      },
    };
  }

  const MITRE_HITS = [
    { payload: { techniqueId: 'T1059.001', name: 'PowerShell', description: 'Encoded PowerShell execution' } },
  ];
  const HUNT_HITS = [
    { payload: { huntKey: 'lsass_dump', label: 'LSASS Memory Dump', description: 'Credential theft via LSASS', category: 'credential-access', mitre: 'T1003.001' } },
  ];
  const INCIDENT_HITS = [
    { payload: { incidentRef: 'INC-12ab34cd', title: 'Brute force von <ipv4>', mitre: 'T1110', severity: 'high', iocTypes: ['ipv4'] } },
  ];

  it('mergt MITRE-, Hunt- und Incident-Kontext in einen strukturierten String', async () => {
    const qdrant = multiQdrant({
      mitre_attack:  MITRE_HITS,
      hunt_catalog:  HUNT_HITS,
      past_incidents: INCIDENT_HITS,
    });
    const svc = new RagQueryService({ embedder: fakeEmbedder(), qdrant, enabled: true, topK: 3 });

    const ctx = await svc.buildContext('encoded powershell credential dump');

    // Alle drei Collections wurden abgefragt
    expect(qdrant.calls).toEqual(expect.arrayContaining(['mitre_attack', 'hunt_catalog', 'past_incidents']));
    // MITRE bleibt erhalten (Rückwärtskompatibilität)
    expect(ctx).toMatch(/MITRE/);
    expect(ctx).toContain('T1059.001');
    expect(ctx).toContain('PowerShell');
    // Hunt-Kontext erscheint
    expect(ctx).toMatch(/Hunt/i);
    expect(ctx).toContain('LSASS Memory Dump');
    // Incident-Kontext erscheint
    expect(ctx).toMatch(/Incident/i);
    expect(ctx).toContain('INC-12ab34cd');
  });

  it('leere/fehlende Collections werden sauber übersprungen (kein leerer/abgeschnittener Abschnitt, kein Crash)', async () => {
    // Nur Hunts haben Treffer; MITRE + Incidents leer.
    const qdrant = multiQdrant({ hunt_catalog: HUNT_HITS });
    const svc = new RagQueryService({ embedder: fakeEmbedder(), qdrant, enabled: true });

    const ctx = await svc.buildContext('lateral movement');

    expect(ctx).toContain('LSASS Memory Dump');
    // Keine Abschnitts-Überschrift für leere Collections
    expect(ctx).not.toMatch(/MITRE/);
    expect(ctx).not.toMatch(/Incident/i);
  });

  it('alle Collections leer → leerer Kontext', async () => {
    const qdrant = multiQdrant({});
    const svc = new RagQueryService({ embedder: fakeEmbedder(), qdrant, enabled: true });
    expect(await svc.buildContext('nichts relevant')).toBe('');
  });

  it('Längenbudget greift: Gesamt-Kontext bleibt unter dem Cap', async () => {
    // Viele lange Hunt-Treffer erzeugen — würde ohne Budget das Kontextfenster sprengen.
    const longDesc = 'X'.repeat(4000);
    const many = Array.from({ length: 20 }, (_, i) => ({
      payload: { huntKey: `h${i}`, label: `Hunt ${i}`, description: longDesc, category: 'c', mitre: 'T1000' },
    }));
    const qdrant = multiQdrant({ hunt_catalog: many });
    const svc = new RagQueryService({ embedder: fakeEmbedder(), qdrant, enabled: true, topK: 3 });

    const ctx = await svc.buildContext('summary');

    // Gesamtbudget (großzügig 4000 Zeichen) darf nicht überschritten werden.
    expect(ctx.length).toBeLessThanOrEqual(4000);
  });

  it('eine fehlerhafte Collection crasht den Gesamt-Kontext nicht (fail-safe)', async () => {
    const qdrant = {
      async search(collection) {
        if (collection === 'past_incidents') throw new Error('boom');
        return collection === 'mitre_attack' ? MITRE_HITS : [];
      },
    };
    const svc = new RagQueryService({ embedder: fakeEmbedder(), qdrant, enabled: true });
    const ctx = await svc.buildContext('x');
    expect(ctx).toContain('T1059.001');
  });
});
