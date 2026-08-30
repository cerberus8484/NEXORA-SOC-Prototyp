'use strict';

// Parität InMemory == Postgres + Restart-Festigkeit der Outbound-Export-Dedup.
//
// Der Outbound-Export (ServiceNow/OTRS) dedupliziert über findByDeduplicationKey.
// Solange ExternalLink NUR InMemory existierte, ging dieser Dedup-Index nach einem
// API-Neustart verloren → doppelte Exporte. Diese Tests erzwingen:
//   (1) beide Repos teilen exakt dieselben Public-Methoden (Vertrag),
//   (2) der Postgres-Pfad findet einen gespeicherten Link nach „Neustart"
//       (neue Repo-Instanz, gleicher Backing-Store) wieder.

const {
  ExternalLinkRepository,
  InMemoryExternalLinkRepository,
} = require('../../src/repositories/ExternalLinkRepository');
const { PostgresExternalLinkRepository } = require('../../src/repositories/PostgresExternalLinkRepository');
const { ExternalLink } = require('../../src/domain/ExternalLink');

// Minimaler, restart-fester Fake einer Postgres-Tabelle `external_links`.
// `rows` lebt AUSSERHALB der Repo-Instanz → eine neue Instanz mit demselben
// Store simuliert einen API-Neustart gegen dieselbe persistente DB.
function makeFakeStore() {
  return { rows: [] };
}

function makeQueryFn(store) {
  return async (sql, params = []) => {
    if (/^INSERT INTO external_links/i.test(sql)) {
      // ON CONFLICT (external_system, external_id) DO UPDATE — Upsert nach Dedup-Key.
      const [id, internalTicketId, externalSystem, externalId, externalUrl,
        syncDirection, syncStatus, lastSyncAt, lastSyncError, rawPayloadHash,
        createdAt, updatedAt] = params;
      const existing = store.rows.find(
        (r) => r.external_system === externalSystem && r.external_id === externalId);
      const next = {
        id, internal_ticket_id: internalTicketId, external_system: externalSystem,
        external_id: externalId, external_url: externalUrl, sync_direction: syncDirection,
        sync_status: syncStatus, last_sync_at: lastSyncAt, last_sync_error: lastSyncError,
        raw_payload_hash: rawPayloadHash, created_at: createdAt, updated_at: updatedAt,
      };
      if (existing) {
        Object.assign(existing, next, { id: existing.id, created_at: existing.created_at });
        return { rows: [existing] };
      }
      store.rows.push(next);
      return { rows: [next] };
    }
    if (/WHERE external_system = \$1 AND external_id = \$2/i.test(sql)) {
      const r = store.rows.find((row) => row.external_system === params[0] && row.external_id === params[1]);
      return { rows: r ? [r] : [] };
    }
    if (/WHERE internal_ticket_id = \$1/i.test(sql)) {
      return { rows: store.rows.filter((row) => row.internal_ticket_id === params[0]) };
    }
    return { rows: [] };
  };
}

function sampleLink(overrides = {}) {
  const link = ExternalLink.create({
    internalTicketId: 'INC000770',
    externalSystem: 'servicenow',
    externalId: 'INC0012345',
    externalUrl: 'https://snow.example/INC0012345',
    syncDirection: 'outbound',
    ...overrides,
  });
  link.markSynced();
  return link;
}

describe('ExternalLinkRepository — Parität InMemory/Postgres', () => {
  const abstractMethods = Object.getOwnPropertyNames(ExternalLinkRepository.prototype)
    .filter((m) => m !== 'constructor' && m !== '_ni');

  it('Postgres-Repo implementiert ALLE abstrakten Public-Methoden', () => {
    const pg = new PostgresExternalLinkRepository({ queryFn: makeQueryFn(makeFakeStore()) });
    for (const m of abstractMethods) {
      expect(typeof pg[m]).toBe('function');
    }
  });

  it('InMemory- und Postgres-Repo teilen dieselben Public-Methoden', () => {
    const im = new InMemoryExternalLinkRepository();
    const pg = new PostgresExternalLinkRepository({ queryFn: makeQueryFn(makeFakeStore()) });
    for (const m of abstractMethods) {
      expect(typeof im[m]).toBe('function');
      expect(typeof pg[m]).toBe('function');
    }
  });
});

describe.each([
  ['InMemory', () => new InMemoryExternalLinkRepository()],
  ['Postgres', () => {
    const store = makeFakeStore();
    const make = () => new PostgresExternalLinkRepository({ queryFn: makeQueryFn(store) });
    make._store = store;
    return make();
  }],
])('%s ExternalLinkRepository — Verhalten', (_name, makeRepo) => {
  it('save + findByDeduplicationKey findet den Link', async () => {
    const repo = makeRepo();
    const link = sampleLink();
    await repo.save(link);
    const found = await repo.findByDeduplicationKey(link.deduplicationKey);
    expect(found).not.toBeNull();
    expect(found.externalId).toBe('INC0012345');
    expect(found.externalSystem).toBe('servicenow');
  });

  it('findByDeduplicationKey liefert null bei unbekanntem Key', async () => {
    const repo = makeRepo();
    expect(await repo.findByDeduplicationKey('servicenow::nope')).toBeNull();
  });

  it('findByTicketId liefert alle Links eines Tickets', async () => {
    const repo = makeRepo();
    await repo.save(sampleLink({ externalSystem: 'servicenow', externalId: 'INC1' }));
    await repo.save(sampleLink({ externalSystem: 'otrs', externalId: 'OTRS-2' }));
    const links = await repo.findByTicketId('INC000770');
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.externalSystem).sort()).toEqual(['otrs', 'servicenow']);
  });
});

describe('Postgres-Dedup überlebt API-Neustart', () => {
  it('zweiter save mit gleichem Dedup-Key nach „Neustart" erzeugt KEINEN Duplikat-Eintrag', async () => {
    const store = makeFakeStore();
    // Erste Instanz speichert den Export-Link.
    const before = new PostgresExternalLinkRepository({ queryFn: makeQueryFn(store) });
    await before.save(sampleLink());

    // „Neustart": komplett neue Repo-Instanz, gleicher persistenter Store.
    const after = new PostgresExternalLinkRepository({ queryFn: makeQueryFn(store) });
    const found = await after.findByDeduplicationKey('servicenow::INC0012345');
    expect(found).not.toBeNull();

    // Re-Export desselben Tickets darf keine zweite Zeile anlegen (Upsert auf Dedup-Key).
    await after.save(sampleLink());
    expect(store.rows).toHaveLength(1);
  });
});
