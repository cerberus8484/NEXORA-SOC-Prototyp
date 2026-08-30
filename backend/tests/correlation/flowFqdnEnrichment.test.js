'use strict';

// CE-5.3 — Tests für flowFqdnEnrichment.js (noch nicht implementiert → RED expected)
// Modul-Kontrakt:
//   async function enrichFlowsWithDnsFqdn(flows, { resolveFqdn, domain, enabled, now })
//   → gibt ein NEUES flows-Array zurück (immutabel; Input-Flows dürfen NICHT mutiert werden).
//
// resolveFqdn: injizierte async-Funktion (kein echter DNS in Tests):
//   ({ ip, candidateName }) => Promise<{ fqdn, source, confidence, provenance, missingReason }>
//   source ist immer 'dns_forward_confirm'
//
// Logik je Flow, für BEIDE Seiten (source / destination):
//   candidateName = host hat Punkt → host direkt; sonst domain vorhanden → `${host}.${domain}`; sonst null
//   - Wenn <side>Fqdn bereits non-empty → überspringen (kein resolveFqdn-Call)
//   - Wenn enabled === false → gar keine Änderung, kein Call
//   - Wenn host + ip vorhanden UND candidateName != null → resolveFqdn aufrufen
//       r.fqdn truthy  → <side>Fqdn setzen; provenance[<side>Fqdn] befüllen; missingReason[<side>Fqdn] löschen
//       r.fqdn falsy   → missingReason[<side>Fqdn] = r.missingReason; <side>Fqdn bleibt null
//   - Sonst (host/ip fehlt, candidateName null) → keine Änderung

const { enrichFlowsWithDnsFqdn, candidateNameFor } = require('../../src/correlation/flowFqdnEnrichment');

const NOW = '2026-06-17T14:00:00.000Z';

// ─── Fabrik: minimales Flow-Objekt das alle benötigten Felder trägt ───────────
function makeFlow(overrides = {}) {
  return {
    sourceIp: null,
    sourceHost: null,
    sourceFqdn: null,
    destinationIp: null,
    destinationHost: null,
    destinationFqdn: null,
    provenance: {},
    missingReason: {
      sourceFqdn: 'threat_intel_pending',
      destinationFqdn: 'threat_intel_pending',
    },
    ...overrides,
    provenance: { ...(overrides.provenance || {}) },
    missingReason: {
      sourceFqdn: 'threat_intel_pending',
      destinationFqdn: 'threat_intel_pending',
      ...(overrides.missingReason || {}),
    },
  };
}

// ─── Stub-Helpers ─────────────────────────────────────────────────────────────
function fakeResolveSuccess(fqdn) {
  return jest.fn().mockResolvedValue({
    fqdn,
    source: 'dns_forward_confirm',
    confidence: 'high',
    provenance: {
      query: fqdn,
      expectedIp: '10.99.99.10',
      resolvedIps: ['10.99.99.10'],
      dnsServer: '10.99.99.10',
    },
    missingReason: null,
  });
}

function fakeResolveFailure(missingReason) {
  return jest.fn().mockResolvedValue({
    fqdn: null,
    source: 'dns_forward_confirm',
    confidence: null,
    provenance: null,
    missingReason,
  });
}

// ─── Test 1: Event-Computer gewinnt — sourceFqdn bereits gesetzt ──────────────
describe('CE-5.3 Test 1: Event-Computer wins — sourceFqdn already set', () => {
  test('resolveFqdn wird fuer source NICHT aufgerufen; Wert bleibt unveraendert', async () => {
    const resolveFqdn = jest.fn();
    const flow = makeFlow({
      sourceIp: '10.99.99.10',
      sourceHost: 'DC01',
      sourceFqdn: 'DC01.nexora.example',   // bereits gesetzt → gewinnt
      destinationIp: null,
      destinationHost: null,
    });
    delete flow.missingReason.sourceFqdn; // keinen missingReason wenn Wert gesetzt

    const result = await enrichFlowsWithDnsFqdn([flow], {
      resolveFqdn,
      domain: 'nexora.example',
      enabled: true,
      now: NOW,
    });

    expect(resolveFqdn).not.toHaveBeenCalledWith(
      expect.objectContaining({ ip: '10.99.99.10' })
    );
    expect(result[0].sourceFqdn).toBe('DC01.nexora.example');
  });
});

// ─── Test 2: DNS setzt sourceFqdn (kurzer Host + domain) ─────────────────────
describe('CE-5.3 Test 2: DNS sets sourceFqdn from short host + domain', () => {
  test('sourceFqdn gesetzt; provenance.source = dns_forward_confirm; missingReason.sourceFqdn undefined', async () => {
    const resolveFqdn = fakeResolveSuccess('DC01.nexora.example');
    const flow = makeFlow({
      sourceIp: '10.99.99.10',
      sourceHost: 'DC01',    // kein Punkt → candidateName = 'DC01.nexora.example'
      sourceFqdn: null,
    });

    const result = await enrichFlowsWithDnsFqdn([flow], {
      resolveFqdn,
      domain: 'nexora.example',
      enabled: true,
      now: NOW,
    });

    expect(result[0].sourceFqdn).toBe('DC01.nexora.example');
    expect(result[0].provenance.sourceFqdn).toMatchObject({
      source: 'dns_forward_confirm',
      confidence: 'high',
      collectedAt: NOW,
    });
    expect(result[0].missingReason.sourceFqdn).toBeUndefined();

    // candidateName korrekt gebildet
    expect(resolveFqdn).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '10.99.99.10', candidateName: 'DC01.nexora.example' })
    );
  });
});

// ─── Test 3: dns_no_record — FQDN bleibt null ─────────────────────────────────
describe('CE-5.3 Test 3: dns_no_record — sourceFqdn bleibt null', () => {
  test('sourceFqdn ist null; missingReason.sourceFqdn === dns_no_record', async () => {
    const resolveFqdn = fakeResolveFailure('dns_no_record');
    const flow = makeFlow({
      sourceIp: '10.99.99.10',
      sourceHost: 'DC01',
      sourceFqdn: null,
    });

    const result = await enrichFlowsWithDnsFqdn([flow], {
      resolveFqdn,
      domain: 'nexora.example',
      enabled: true,
      now: NOW,
    });

    expect(result[0].sourceFqdn).toBeNull();
    expect(result[0].missingReason.sourceFqdn).toBe('dns_no_record');
  });
});

// ─── Test 4: dns_unconfirmed — kein Fake-Wert ────────────────────────────────
describe('CE-5.3 Test 4: dns_unconfirmed — kein Fake, korrekte missingReason', () => {
  test('sourceFqdn null; missingReason.sourceFqdn === dns_unconfirmed', async () => {
    const resolveFqdn = fakeResolveFailure('dns_unconfirmed');
    const flow = makeFlow({
      sourceIp: '10.99.99.10',
      sourceHost: 'DC01',
      sourceFqdn: null,
    });

    const result = await enrichFlowsWithDnsFqdn([flow], {
      resolveFqdn,
      domain: 'nexora.example',
      enabled: true,
      now: NOW,
    });

    expect(result[0].sourceFqdn).toBeNull();
    expect(result[0].missingReason.sourceFqdn).toBe('dns_unconfirmed');
  });
});

// ─── Test 5: disabled — keine Änderungen, kein DNS-Call ──────────────────────
describe('CE-5.3 Test 5: enabled=false — keine Flows veraendert, kein resolveFqdn-Call', () => {
  test('Output-Flows sind deep-equal zum Input; resolveFqdn nie aufgerufen', async () => {
    const resolveFqdn = jest.fn();
    const flow = makeFlow({
      sourceIp: '10.99.99.10',
      sourceHost: 'DC01',
      sourceFqdn: null,
      destinationIp: '10.99.99.72',
      destinationHost: 'osb',
      destinationFqdn: null,
    });
    const snapshot = JSON.parse(JSON.stringify(flow));

    const result = await enrichFlowsWithDnsFqdn([flow], {
      resolveFqdn,
      domain: 'nexora.example',
      enabled: false,
      now: NOW,
    });

    expect(resolveFqdn).not.toHaveBeenCalled();
    expect(result[0]).toEqual(snapshot);
  });
});

// ─── Test 6: destination side — destinationFqdn aus DNS gesetzt ──────────────
describe('CE-5.3 Test 6: destination side gesetzt wenn leer', () => {
  test('destinationFqdn aus Fake gesetzt; provenance.destinationFqdn = dns_forward_confirm', async () => {
    const resolveFqdn = jest.fn().mockResolvedValue({
      fqdn: 'osb.nexora.example',
      source: 'dns_forward_confirm',
      confidence: 'high',
      provenance: {
        query: 'osb.nexora.example',
        expectedIp: '10.99.99.72',
        resolvedIps: ['10.99.99.72'],
        dnsServer: '10.99.99.10',
      },
      missingReason: null,
    });
    const flow = makeFlow({
      sourceIp: null,
      sourceHost: null,
      sourceFqdn: null,
      destinationIp: '10.99.99.72',
      destinationHost: 'osb',
      destinationFqdn: null,
    });

    const result = await enrichFlowsWithDnsFqdn([flow], {
      resolveFqdn,
      domain: 'nexora.example',
      enabled: true,
      now: NOW,
    });

    expect(result[0].destinationFqdn).toBe('osb.nexora.example');
    expect(result[0].provenance.destinationFqdn).toMatchObject({
      source: 'dns_forward_confirm',
      confidence: 'high',
      collectedAt: NOW,
    });
    expect(result[0].missingReason.destinationFqdn).toBeUndefined();
    expect(resolveFqdn).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '10.99.99.72', candidateName: 'osb.nexora.example' })
    );
  });
});

// ─── Test 7: Immutabilität — Input-Flow-Objekt wird NICHT mutiert ─────────────
describe('CE-5.3 Test 7: immutability — Original-Flow-Objekt unveraendert', () => {
  test('sourceFqdn am Original bleibt null nach Anreicherung', async () => {
    const resolveFqdn = fakeResolveSuccess('DC01.nexora.example');
    const flow = makeFlow({
      sourceIp: '10.99.99.10',
      sourceHost: 'DC01',
      sourceFqdn: null,
    });
    const originalFqdnBefore = flow.sourceFqdn; // null

    await enrichFlowsWithDnsFqdn([flow], {
      resolveFqdn,
      domain: 'nexora.example',
      enabled: true,
      now: NOW,
    });

    // Original darf nicht veraendert worden sein
    expect(flow.sourceFqdn).toBe(originalFqdnBefore);
    expect(flow.sourceFqdn).toBeNull();
  });
});

// ─── Test 8: Host hat bereits Punkt → candidateName = host (kein Domain-Append) ─
describe('CE-5.3 Test 8: host bereits FQDN (enthaelt Punkt) — kein domain-Append', () => {
  test('candidateName === sourceHost ohne domain-Suffix', async () => {
    const resolveFqdn = fakeResolveSuccess('DC01.nexora.example');
    const flow = makeFlow({
      sourceIp: '10.99.99.10',
      sourceHost: 'DC01.nexora.example', // hat Punkt → direkt als candidateName nutzen
      sourceFqdn: null,
    });

    await enrichFlowsWithDnsFqdn([flow], {
      resolveFqdn,
      domain: 'nexora.example', // wird NICHT angehängt, da Host schon einen Punkt hat
      enabled: true,
      now: NOW,
    });

    expect(resolveFqdn).toHaveBeenCalledWith(
      expect.objectContaining({ candidateName: 'DC01.nexora.example' })
    );
    // Sicherstellen, dass domain NICHT doppelt angehängt wurde
    const call = resolveFqdn.mock.calls[0][0];
    expect(call.candidateName).toBe('DC01.nexora.example');
    expect(call.candidateName).not.toBe('DC01.nexora.example.nexora.example');
  });
});

// ─── Test 9: kein domain + kurzer Host → candidateName null → kein resolveFqdn-Call ─
describe('CE-5.3 Test 9: kein domain + kurzer Host → candidateName null → kein Call', () => {
  test('sourceFqdn bleibt unveraendert; resolveFqdn nicht aufgerufen', async () => {
    const resolveFqdn = jest.fn();
    const flow = makeFlow({
      sourceIp: '10.99.99.10',
      sourceHost: 'DC01', // kein Punkt → braucht domain für candidateName
      sourceFqdn: null,
    });
    const snapshotFqdn = flow.sourceFqdn;
    const snapshotMissingReason = flow.missingReason.sourceFqdn;

    const result = await enrichFlowsWithDnsFqdn([flow], {
      resolveFqdn,
      domain: null,  // kein domain → candidateName nicht bildbar
      enabled: true,
      now: NOW,
    });

    expect(resolveFqdn).not.toHaveBeenCalled();
    expect(result[0].sourceFqdn).toBe(snapshotFqdn);
    expect(result[0].missingReason.sourceFqdn).toBe(snapshotMissingReason);
  });
});

// ─── Test 10 (Review-Fix): DNS-Miss schreibt Grund auch in provenance ─────────
describe('CE-5.3 Test 10: dns miss → provenance traegt missingReason (gap-sichtbar)', () => {
  test('provenance.sourceFqdn.missingReason === dns_no_record (collectGaps surfacet ihn)', async () => {
    const resolveFqdn = fakeResolveFailure('dns_no_record');
    const flow = makeFlow({ sourceIp: '10.99.99.10', sourceHost: 'DC01', sourceFqdn: null });
    const result = await enrichFlowsWithDnsFqdn([flow], { resolveFqdn, domain: 'nexora.example', enabled: true, now: NOW });
    expect(result[0].provenance.sourceFqdn).toMatchObject({ source: 'dns_forward_confirm', missingReason: 'dns_no_record' });
    expect(result[0].missingReason.sourceFqdn).toBe('dns_no_record');
  });
});

// ─── Test 11 (Review-Fix): unsichere Hostnamen werden nicht abgefragt ─────────
describe('CE-5.3 Test 11: candidateNameFor verwirft unsichere Namen', () => {
  test('Host mit Injection-Zeichen → kein resolveFqdn-Call', async () => {
    const resolveFqdn = jest.fn();
    const flow = makeFlow({ sourceIp: '10.99.99.10', sourceHost: 'evil;name/x', sourceFqdn: null });
    await enrichFlowsWithDnsFqdn([flow], { resolveFqdn, domain: 'nexora.example', enabled: true, now: NOW });
    expect(resolveFqdn).not.toHaveBeenCalled();
  });
  test('candidateNameFor: valide bleibt, invalide → null', () => {
    expect(candidateNameFor('DC01', 'nexora.example')).toBe('DC01.nexora.example');
    expect(candidateNameFor('DC01.nexora.example', 'x')).toBe('DC01.nexora.example');
    expect(candidateNameFor('bad name', 'x')).toBeNull();
    expect(candidateNameFor('a;b/c', 'x')).toBeNull();
  });
});
