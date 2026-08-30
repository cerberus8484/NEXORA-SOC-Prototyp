'use strict';

const { SocMetricsService }         = require('../../src/services/SocMetricsService');
const { InMemoryTicketRepository }  = require('../../src/repositories/InMemoryTicketRepository');

// ─── Test-Hilfsfunktionen ───────────────────────────────────────────────────

/**
 * Gibt einen ISO-Zeitstempel zurück, der `offsetMs` Millisekunden nach `base` liegt.
 * Positive offsetMs = später, negative = früher.
 */
function ts(base, offsetMs = 0) {
  return new Date(Date.parse(base) + offsetMs).toISOString();
}

const BASE = '2026-06-01T08:00:00.000Z';

/**
 * Legt ein Ticket mit Mindestfeldern im Repository ab und gibt es zurück.
 * Spiegelt die Produktion: ein CLOSED-Ticket trägt einen closedAt (in Prod via
 * create()/update()-Transition gesetzt). Wird `closedAt` explizit übergeben (auch
 * null), gilt exakt dieser Wert — so lassen sich Altbestand-/Defekt-Fälle testen.
 */
async function seed(repo, overrides = {}) {
  const { Ticket } = require('../../src/domain/Ticket');
  const base = {
    title:       'Test Ticket',
    state:       'OPEN',
    status:      'assigned',
    closeReason: '',
    analyst:     '',
    offenseId:   '',
    createdAt:   BASE,
    updatedAt:   BASE,
    ...overrides,
  };
  // CLOSED ohne expliziten closedAt → aus updatedAt ableiten (Prod-Default).
  if (base.state === 'CLOSED' && !('closedAt' in overrides)) {
    base.closedAt = base.updatedAt;
  }
  const t = new Ticket(base);
  return repo.save(t);
}

// ─── Konstruktor ────────────────────────────────────────────────────────────

describe('SocMetricsService — Konstruktor', () => {
  test('wirft ohne ticketRepo', () => {
    expect(() => new SocMetricsService()).toThrow('ticketRepo ist erforderlich');
  });

  test('initialisiert sich korrekt mit ticketRepo', () => {
    const repo = new InMemoryTicketRepository();
    expect(() => new SocMetricsService({ ticketRepo: repo })).not.toThrow();
  });

  test('topN default = 10', () => {
    const repo = new InMemoryTicketRepository();
    const svc  = new SocMetricsService({ ticketRepo: repo });
    expect(svc._topN).toBe(10);
  });

  test('topN ist konfigurierbar', () => {
    const repo = new InMemoryTicketRepository();
    const svc  = new SocMetricsService({ ticketRepo: repo, topN: 5 });
    expect(svc._topN).toBe(5);
  });
});

// ─── Leere Daten ────────────────────────────────────────────────────────────

describe('SocMetricsService.getMetrics() — leere Daten', () => {
  let svc;

  beforeEach(() => {
    svc = new SocMetricsService({ ticketRepo: new InMemoryTicketRepository() });
  });

  test('gibt alle KPI-Schlüssel zurück', async () => {
    const m = await svc.getMetrics();
    expect(m).toHaveProperty('mttr');
    expect(m).toHaveProperty('fpRate');
    expect(m).toHaveProperty('byState');
    expect(m).toHaveProperty('byStatus');
    expect(m).toHaveProperty('topRules');
    expect(m).toHaveProperty('analystLoad');
  });

  test('MTTR → null wenn keine geschlossenen Tickets', async () => {
    const m = await svc.getMetrics();
    expect(m.mttr.meanMs).toBeNull();
    expect(m.mttr.medianMs).toBeNull();
    expect(m.mttr.sampleSize).toBe(0);
  });

  test('FP-Rate → null wenn keine geschlossenen Tickets', async () => {
    const m = await svc.getMetrics();
    expect(m.fpRate.rate).toBeNull();
    expect(m.fpRate.fpCount).toBe(0);
    expect(m.fpRate.classifiedCount).toBe(0);
  });

  test('byState + byStatus sind leere Objekte', async () => {
    const m = await svc.getMetrics();
    expect(m.byState).toEqual({});
    expect(m.byStatus).toEqual({});
  });

  test('topRules + analystLoad sind leere Arrays', async () => {
    const m = await svc.getMetrics();
    expect(m.topRules).toEqual([]);
    expect(m.analystLoad).toEqual([]);
  });
});

// ─── MTTR ───────────────────────────────────────────────────────────────────

describe('SocMetricsService — MTTR', () => {
  let repo, svc;

  beforeEach(() => {
    repo = new InMemoryTicketRepository();
    svc  = new SocMetricsService({ ticketRepo: repo });
  });

  test('MTTR — einzelnes CLOSED-Ticket (1 Stunde)', async () => {
    // Arrange
    const ONE_HOUR = 60 * 60 * 1000;
    await seed(repo, {
      state:     'CLOSED',
      createdAt: BASE,
      updatedAt: ts(BASE, ONE_HOUR),
    });

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.mttr.sampleSize).toBe(1);
    expect(m.mttr.meanMs).toBe(ONE_HOUR);
    expect(m.mttr.medianMs).toBe(ONE_HOUR);
  });

  test('MTTR — Median bei gerader Anzahl (Durchschnitt der beiden mittleren)', async () => {
    // Arrange — 4 Tickets: 1h, 2h, 4h, 8h
    const H = 60 * 60 * 1000;
    for (const hours of [1, 2, 4, 8]) {
      await seed(repo, {
        state:     'CLOSED',
        createdAt: BASE,
        updatedAt: ts(BASE, hours * H),
      });
    }

    // Act
    const m = await svc.getMetrics();

    // Assert: Median = (2h + 4h) / 2 = 3h
    expect(m.mttr.sampleSize).toBe(4);
    expect(m.mttr.medianMs).toBe(3 * H);
    // Mean = (1+2+4+8)/4 * H = 3.75 * H
    expect(m.mttr.meanMs).toBe(Math.round(3.75 * H));
  });

  test('MTTR — Median bei ungerader Anzahl (mittleres Element)', async () => {
    // Arrange — 3 Tickets: 1h, 3h, 9h
    const H = 60 * 60 * 1000;
    for (const hours of [1, 3, 9]) {
      await seed(repo, {
        state:     'CLOSED',
        createdAt: BASE,
        updatedAt: ts(BASE, hours * H),
      });
    }

    // Act
    const m = await svc.getMetrics();

    // Assert: Median = 3h
    expect(m.mttr.medianMs).toBe(3 * H);
  });

  test('MTTR — offene Tickets werden ignoriert', async () => {
    // Arrange — 1 CLOSED + 1 OPEN
    const H = 60 * 60 * 1000;
    await seed(repo, {
      state:     'CLOSED',
      createdAt: BASE,
      updatedAt: ts(BASE, 2 * H),
    });
    await seed(repo, {
      state:     'OPEN',
      createdAt: BASE,
      updatedAt: ts(BASE, 10 * H), // würde MTTR stark verzerren
    });

    // Act
    const m = await svc.getMetrics();

    // Assert: nur das CLOSED-Ticket wird berücksichtigt
    expect(m.mttr.sampleSize).toBe(1);
    expect(m.mttr.meanMs).toBe(2 * H);
  });

  test('MTTR — Ticket mit ungültigem Zeitstempel (closedAt < createdAt) wird ignoriert', async () => {
    // Arrange — ein defektes Ticket (negativer Wert) + ein valides
    const H = 60 * 60 * 1000;
    await seed(repo, {
      state:     'CLOSED',
      createdAt: BASE,
      closedAt:  ts(BASE, -H), // closedAt VOR createdAt → ignorieren
    });
    await seed(repo, {
      state:     'CLOSED',
      createdAt: BASE,
      closedAt:  ts(BASE, 4 * H),
    });

    // Act
    const m = await svc.getMetrics();

    // Assert: nur das valide Ticket
    expect(m.mttr.sampleSize).toBe(1);
    expect(m.mttr.meanMs).toBe(4 * H);
  });

  test('MTTR — CLOSED ohne closedAt und fehlendes createdAt werden ignoriert', async () => {
    // Arrange — nach Audit #1 ist closedAt die Basis (nicht updatedAt).
    const H = 60 * 60 * 1000;
    await seed(repo, {
      state:     'CLOSED',
      createdAt: null,
      closedAt:  BASE,       // kein createdAt → ignorieren
    });
    await seed(repo, {
      state:     'CLOSED',
      createdAt: BASE,
      closedAt:  null,       // kein closedAt → ignorieren (Altbestand ohne Backfill)
    });
    await seed(repo, {
      state:     'CLOSED',
      createdAt: BASE,
      closedAt:  ts(BASE, 2 * H), // valides Ticket
    });

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.mttr.sampleSize).toBe(1);
    expect(m.mttr.meanMs).toBe(2 * H);
  });

  test('MTTR — spätere Edits (updatedAt springt) verschieben die MTTR nicht (Audit #1)', async () => {
    // Arrange — CLOSED-Ticket, danach mehrfach editiert → updatedAt weit nach closedAt.
    const H = 60 * 60 * 1000;
    await seed(repo, {
      state:     'CLOSED',
      createdAt: BASE,
      closedAt:  ts(BASE, 1 * H),   // echter Close nach 1h
      updatedAt: ts(BASE, 500 * H), // viel spätere Nachbearbeitung
    });

    // Act
    const m = await svc.getMetrics();

    // Assert: MTTR = 1h (closedAt), NICHT 500h (updatedAt)
    expect(m.mttr.sampleSize).toBe(1);
    expect(m.mttr.meanMs).toBe(1 * H);
  });
});

// ─── FP-Rate-Nenner: klassifiziert geschlossen (Audit #3) ───────────────────

describe('SocMetricsService — FP-Rate Nenner (klassifiziert)', () => {
  let repo, svc;

  beforeEach(() => {
    repo = new InMemoryTicketRepository();
    svc  = new SocMetricsService({ ticketRepo: repo });
  });

  test('CLOSED ohne close_reason zählt NICHT in den FP-Nenner', async () => {
    // Arrange — 1 FP + 1 resolved (klassifiziert) + 2 CLOSED ohne Grund
    await seed(repo, { state: 'CLOSED', closeReason: 'false_positive' });
    await seed(repo, { state: 'CLOSED', closeReason: 'resolved' });
    await seed(repo, { state: 'CLOSED', closeReason: '' });
    await seed(repo, { state: 'CLOSED', closeReason: '' });

    // Act
    const m = await svc.getMetrics();

    // Assert: Nenner = 2 (nur klassifiziert) → Rate 50 %
    expect(m.fpRate.classifiedCount).toBe(2);
    expect(m.fpRate.fpCount).toBe(1);
    expect(m.fpRate.rate).toBeCloseTo(0.5, 5);
  });

  test('nur unklassifiziert geschlossen → Rate null', async () => {
    await seed(repo, { state: 'CLOSED', closeReason: '' });
    const m = await svc.getMetrics();
    expect(m.fpRate.rate).toBeNull();
    expect(m.fpRate.classifiedCount).toBe(0);
  });
});

// ─── Zeitraumfilter (since) — Audit #2 ──────────────────────────────────────

describe('SocMetricsService — Zeitraumfilter (since)', () => {
  let repo, svc;

  beforeEach(() => {
    repo = new InMemoryTicketRepository();
    svc  = new SocMetricsService({ ticketRepo: repo });
  });

  test('since grenzt Aggregation auf createdAt >= since ein', async () => {
    await seed(repo, { state: 'OPEN', createdAt: '2026-06-01T00:00:00.000Z' }); // vor since
    await seed(repo, { state: 'OPEN', createdAt: '2026-06-20T00:00:00.000Z' }); // nach since

    const m = await svc.getMetrics({ since: '2026-06-10T00:00:00.000Z' });

    expect(m.byState).toEqual({ OPEN: 1 });
    expect(m.meta.since).toBe('2026-06-10T00:00:00.000Z');
  });

  test('ohne since → All-Time (meta.since = null)', async () => {
    await seed(repo, { state: 'OPEN', createdAt: '2026-01-01T00:00:00.000Z' });
    const m = await svc.getMetrics();
    expect(m.byState).toEqual({ OPEN: 1 });
    expect(m.meta.since).toBeNull();
  });
});

// ─── FP-Rate ────────────────────────────────────────────────────────────────

describe('SocMetricsService — FP-Rate', () => {
  let repo, svc;

  beforeEach(() => {
    repo = new InMemoryTicketRepository();
    svc  = new SocMetricsService({ ticketRepo: repo });
  });

  test('FP-Rate — 100% wenn alle CLOSED-Tickets false_positive sind', async () => {
    // Arrange
    for (let i = 0; i < 3; i++) {
      await seed(repo, { state: 'CLOSED', closeReason: 'false_positive' });
    }

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.fpRate.rate).toBe(1);
    expect(m.fpRate.fpCount).toBe(3);
    expect(m.fpRate.classifiedCount).toBe(3);
  });

  test('FP-Rate — 0% wenn kein CLOSED-Ticket false_positive ist', async () => {
    // Arrange
    for (let i = 0; i < 4; i++) {
      await seed(repo, { state: 'CLOSED', closeReason: 'resolved' });
    }

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.fpRate.rate).toBe(0);
    expect(m.fpRate.fpCount).toBe(0);
    expect(m.fpRate.classifiedCount).toBe(4);
  });

  test('FP-Rate — gemischter Bestand (2 von 5 = 40%)', async () => {
    // Arrange
    for (let i = 0; i < 2; i++) {
      await seed(repo, { state: 'CLOSED', closeReason: 'false_positive' });
    }
    for (let i = 0; i < 3; i++) {
      await seed(repo, { state: 'CLOSED', closeReason: 'resolved' });
    }

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.fpRate.rate).toBeCloseTo(0.4, 5);
    expect(m.fpRate.fpCount).toBe(2);
    expect(m.fpRate.classifiedCount).toBe(5);
  });

  test('FP-Rate — OPEN-Tickets zählen nicht mit', async () => {
    // Arrange — offene FP-ähnliche Tickets sollen Rate nicht verzerren
    await seed(repo, { state: 'OPEN', closeReason: 'false_positive' });
    await seed(repo, { state: 'CLOSED', closeReason: 'false_positive' });
    await seed(repo, { state: 'CLOSED', closeReason: 'resolved' });

    // Act
    const m = await svc.getMetrics();

    // Assert: nur 2 CLOSED-Tickets → 1 FP → 50%
    expect(m.fpRate.classifiedCount).toBe(2);
    expect(m.fpRate.fpCount).toBe(1);
    expect(m.fpRate.rate).toBeCloseTo(0.5, 5);
  });
});

// ─── byState / byStatus ────────────────────────────────────────────────────

describe('SocMetricsService — byState / byStatus', () => {
  let repo, svc;

  beforeEach(() => {
    repo = new InMemoryTicketRepository();
    svc  = new SocMetricsService({ ticketRepo: repo });
  });

  test('byState — zählt OPEN und CLOSED korrekt', async () => {
    // Arrange
    await seed(repo, { state: 'OPEN' });
    await seed(repo, { state: 'OPEN' });
    await seed(repo, { state: 'CLOSED' });

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.byState).toEqual({ OPEN: 2, CLOSED: 1 });
  });

  test('byStatus — zählt Workflow-Status korrekt', async () => {
    // Arrange
    await seed(repo, { status: 'assigned' });
    await seed(repo, { status: 'assigned' });
    await seed(repo, { status: 'in_progress' });
    await seed(repo, { status: 'on_hold' });

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.byStatus.assigned).toBe(2);
    expect(m.byStatus.in_progress).toBe(1);
    expect(m.byStatus.on_hold).toBe(1);
  });

  test('byState — fehlendes state-Feld → "_unset"', async () => {
    // Arrange — direkt ein Objekt ohne state injizieren (Edge-Case)
    const { Ticket } = require('../../src/domain/Ticket');
    const t = new Ticket({ title: 'defekt' });
    // state auf undefined setzen (bypass Domain-Default)
    t.state = undefined;
    await repo.save(t);

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.byState['_unset']).toBe(1);
  });
});

// ─── Top-Rules ──────────────────────────────────────────────────────────────

describe('SocMetricsService — topRules', () => {
  let repo, svc;

  beforeEach(() => {
    repo = new InMemoryTicketRepository();
    svc  = new SocMetricsService({ ticketRepo: repo, topN: 3 });
  });

  test('topRules — zählt nach offenseId und sortiert absteigend', async () => {
    // Arrange — rule:100205 = 3x, rule:100300 = 2x, rule:100400 = 1x
    for (let i = 0; i < 3; i++) await seed(repo, { offenseId: 'rule:100205:agent:win10' });
    for (let i = 0; i < 2; i++) await seed(repo, { offenseId: 'rule:100300:agent:dc01' });
    await seed(repo, { offenseId: 'rule:100400:agent:wec01' });

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.topRules[0]).toEqual({ key: 'rule:100205', count: 3 });
    expect(m.topRules[1]).toEqual({ key: 'rule:100300', count: 2 });
    expect(m.topRules[2]).toEqual({ key: 'rule:100400', count: 1 });
  });

  test('topRules — Tickets ohne offenseId werden übersprungen', async () => {
    // Arrange
    await seed(repo, { offenseId: '' });
    await seed(repo, { offenseId: null });
    await seed(repo, { offenseId: 'rule:100205:agent:win10' });

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.topRules).toHaveLength(1);
    expect(m.topRules[0].key).toBe('rule:100205');
  });

  test('topRules — topN begrenzt die Ausgabe', async () => {
    // Arrange — 5 verschiedene Regeln
    for (let i = 1; i <= 5; i++) {
      await seed(repo, { offenseId: `rule:1000${i}:agent:host` });
    }

    // Act
    const m = await svc.getMetrics();

    // Assert: topN=3 → maximal 3 Einträge
    expect(m.topRules.length).toBeLessThanOrEqual(3);
  });

  test('topRules — blanke offenseId ohne Wazuh-Präfix wird als Rohwert gespeichert', async () => {
    // Arrange — QRadar-Format: blanke numerische ID
    await seed(repo, { offenseId: '99876' });
    await seed(repo, { offenseId: '99876' });

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.topRules[0]).toEqual({ key: '99876', count: 2 });
  });
});

// ─── Analyst-Last ───────────────────────────────────────────────────────────

describe('SocMetricsService — analystLoad', () => {
  let repo, svc;

  beforeEach(() => {
    repo = new InMemoryTicketRepository();
    svc  = new SocMetricsService({ ticketRepo: repo, topN: 5 });
  });

  test('zählt total + open je Analyst', async () => {
    // Arrange
    await seed(repo, { analyst: 'alice', state: 'OPEN' });
    await seed(repo, { analyst: 'alice', state: 'OPEN' });
    await seed(repo, { analyst: 'alice', state: 'CLOSED' });
    await seed(repo, { analyst: 'bob',   state: 'OPEN' });

    // Act
    const m = await svc.getMetrics();
    const alice = m.analystLoad.find((a) => a.analyst === 'alice');
    const bob   = m.analystLoad.find((a) => a.analyst === 'bob');

    // Assert
    expect(alice).toEqual({ analyst: 'alice', total: 3, open: 2 });
    expect(bob).toEqual({ analyst: 'bob',   total: 1, open: 1 });
  });

  test('sortiert nach total absteigend', async () => {
    // Arrange
    await seed(repo, { analyst: 'carol', state: 'OPEN' });
    for (let i = 0; i < 5; i++) await seed(repo, { analyst: 'dave', state: 'OPEN' });
    for (let i = 0; i < 3; i++) await seed(repo, { analyst: 'eve',  state: 'OPEN' });

    // Act
    const m = await svc.getMetrics();

    // Assert
    expect(m.analystLoad[0].analyst).toBe('dave');
    expect(m.analystLoad[1].analyst).toBe('eve');
    expect(m.analystLoad[2].analyst).toBe('carol');
  });

  test('Tickets ohne analyst landen unter "_unassigned"', async () => {
    // Arrange
    await seed(repo, { analyst: '',   state: 'OPEN' });
    await seed(repo, { analyst: null, state: 'OPEN' });

    // Act
    const m = await svc.getMetrics();
    const unassigned = m.analystLoad.find((a) => a.analyst === '_unassigned');

    // Assert
    expect(unassigned).toBeDefined();
    expect(unassigned.total).toBe(2);
  });

  test('topN begrenzt die Analyst-Liste', async () => {
    // Arrange — 10 verschiedene Analysten
    for (let i = 1; i <= 10; i++) {
      await seed(repo, { analyst: `analyst${i}`, state: 'OPEN' });
    }

    // Act
    const m = await svc.getMetrics();

    // Assert: topN=5 → maximal 5 Einträge
    expect(m.analystLoad.length).toBeLessThanOrEqual(5);
  });

  test('open-Zähler = 0 wenn alle Tickets eines Analysten CLOSED sind', async () => {
    // Arrange
    for (let i = 0; i < 3; i++) {
      await seed(repo, { analyst: 'frank', state: 'CLOSED' });
    }

    // Act
    const m = await svc.getMetrics();
    const frank = m.analystLoad.find((a) => a.analyst === 'frank');

    // Assert
    expect(frank.open).toBe(0);
    expect(frank.total).toBe(3);
  });
});

// ─── Integrationstest (echter Paging-Pfad) ──────────────────────────────────

describe('SocMetricsService — Paging (_loadAll)', () => {
  test('aggregiert korrekt wenn mehr Tickets als eine Seite (501 Tickets)', async () => {
    // Arrange
    const repo = new InMemoryTicketRepository();
    const svc  = new SocMetricsService({ ticketRepo: repo, topN: 10 });
    const H    = 60 * 60 * 1000;

    // 300 CLOSED (1h MTTR) + 201 OPEN
    for (let i = 0; i < 300; i++) {
      await seed(repo, {
        state:       'CLOSED',
        closeReason: i % 3 === 0 ? 'false_positive' : 'resolved',
        analyst:     `analyst${i % 5}`,
        offenseId:   `rule:100${i % 10}:agent:host`,
        createdAt:   BASE,
        updatedAt:   ts(BASE, H),
      });
    }
    for (let i = 0; i < 201; i++) {
      await seed(repo, {
        state:    'OPEN',
        analyst:  `analyst${i % 5}`,
        offenseId: `rule:100${i % 10}:agent:host`,
      });
    }

    // Act
    const m = await svc.getMetrics();

    // Assert: alle 501 Tickets wurden geladen
    expect(m.byState.OPEN).toBe(201);
    expect(m.byState.CLOSED).toBe(300);
    expect(m.mttr.sampleSize).toBe(300);
    expect(m.mttr.meanMs).toBe(H);
    expect(m.fpRate.classifiedCount).toBe(300);
    // Jedes 3. von 300 → 100 FPs → rate ≈ 1/3
    expect(m.fpRate.rate).toBeCloseTo(1 / 3, 2);
    // topRules: 10 verschiedene Regeln
    expect(m.topRules.length).toBe(10);
    // analystLoad: 5 Analysten
    expect(m.analystLoad.length).toBe(5);
  }, 15000); // großes Dataset → großzügiges Timeout
});

// ─── meta.capped — Schutz vor stillen Datenverlusten bei >5000 Tickets ──────
describe('SocMetricsService — Scan-Cap-Transparenz (meta.capped)', () => {
  test('capped=true wenn total das Scan-Cap (5000) übersteigt', async () => {
    // Fake-Repo: meldet total=6000, liefert volle Seiten → Service lädt bis Cap.
    const fakeRepo = {
      findAll: async ({ limit, offset }) => ({
        data: Array.from({ length: limit }, (_, i) => ({ id: `t${offset + i}`, state: 'OPEN' })),
        total: 6000,
      }),
    };
    const m = await new SocMetricsService({ ticketRepo: fakeRepo }).getMetrics();
    expect(m.meta.capped).toBe(true);
    expect(m.meta.totalTickets).toBe(6000);
    expect(m.meta.sampledTickets).toBe(5000);
  });

  test('capped=false bei kleiner Datenmenge', async () => {
    const repo = new InMemoryTicketRepository();
    await seed(repo);
    const m = await new SocMetricsService({ ticketRepo: repo }).getMetrics();
    expect(m.meta.capped).toBe(false);
    expect(m.meta.totalTickets).toBe(1);
    expect(m.meta.sampledTickets).toBe(1);
  });
});
