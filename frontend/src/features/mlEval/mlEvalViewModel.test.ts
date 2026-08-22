import { describe, expect, test } from 'vitest';
import { explainRoutingPolicy, explainSnapshot } from './mlEvalViewModel';

describe('explainRoutingPolicy', () => {
  test('erklaert eine inaktive Policy in Klartext', () => {
    expect(explainRoutingPolicy({ active: false, reason: 'unset' })).toEqual({
      tone: 'warning',
      title: 'Routing aktuell aus',
      body: 'Die KI darf im Moment keine Routing-Empfehlung aus der ML-Policy ableiten. Es passiert nichts automatisch.',
    });
  });

  test('erklaert eine aktive Policy als rein advisory', () => {
    const card = explainRoutingPolicy({ active: true, policyName: 'p', threshold: 0.8 });
    expect(card.tone).toBe('success');
    expect(card.title).toBe('Routing-Hinweis aktiv');
    expect(card.body).toMatch(/0.8/);
    expect(card.body).toMatch(/Menschen/);
  });
});

describe('explainSnapshot', () => {
  test('erklaert den Ausgangszustand ohne Snapshot', () => {
    expect(explainSnapshot(null)).toEqual({
      tone: 'muted',
      title: 'Noch kein Snapshot geladen',
      body: 'Erst nach Klick auf "Snapshot erzeugen" siehst du, wie viele reviewte ML-Daten aktuell fuer die Offline-Evaluation verfuegbar sind.',
    });
  });

  test('erklaert 0 Records ehrlich als keine Eval-Daten', () => {
    const card = explainSnapshot({
      schemaVersion: 'v1',
      generatedAt: '2026-07-05T10:00:00Z',
      recordSha256: 'abc',
      returned: 0,
      counts: {},
      labelSourceCounts: {},
      humanLabelCounts: {},
      exportLimit: 200,
      include: 'all',
    });
    expect(card.tone).toBe('warning');
    expect(card.title).toBe('Noch keine Eval-Daten');
  });

  test('warnt bei weniger als 20 Datensaetzen', () => {
    const card = explainSnapshot({
      schemaVersion: 'v1',
      generatedAt: '2026-07-05T10:00:00Z',
      recordSha256: 'abc',
      returned: 4,
      counts: {},
      labelSourceCounts: {},
      humanLabelCounts: {},
      exportLimit: 200,
      include: 'all',
    });
    expect(card.tone).toBe('warning');
    expect(card.title).toBe('Noch duenne Datenbasis');
    expect(card.body).toMatch(/4 Datensaetze/);
  });

  test('meldet ausreichende Daten als naechsten Check bereit', () => {
    const card = explainSnapshot({
      schemaVersion: 'v1',
      generatedAt: '2026-07-05T10:00:00Z',
      recordSha256: 'abc',
      returned: 24,
      counts: {},
      labelSourceCounts: {},
      humanLabelCounts: {},
      exportLimit: 200,
      include: 'all',
    });
    expect(card.tone).toBe('success');
    expect(card.title).toBe('Snapshot brauchbar fuer den naechsten Check');
  });
});
