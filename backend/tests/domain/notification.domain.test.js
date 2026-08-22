'use strict';

// ── TDD RED: Domain-Tests für Notification — laufen fehl bis Implementierung vorhanden ──

const { Notification, SEVERITIES, SOURCES } = require('../../src/domain/Notification');

describe('Notification Domain', () => {
  describe('create() — Happy-Path', () => {
    test('erzeugt Notification mit Pflichtfeldern', () => {
      const n = Notification.create({ userId: 'u1', title: 'Test-Alarm' });
      expect(n.id).toBeDefined();
      expect(n.userId).toBe('u1');
      expect(n.title).toBe('Test-Alarm');
      expect(n.severity).toBe('info');
      expect(n.body).toBe('');
      expect(n.source).toBe('system');
      expect(n.link).toBe('');
      expect(n.read).toBe(false);
      expect(n.createdAt).toBeDefined();
    });

    test('übernimmt alle optionalen Felder korrekt', () => {
      const n = Notification.create({
        userId: 'u2',
        severity: 'critical',
        title: 'Kritischer Vorfall',
        body: 'Host wurde kompromittiert',
        source: 'ticket',
        link: '/analysis?ticket=abc',
      });
      expect(n.severity).toBe('critical');
      expect(n.body).toBe('Host wurde kompromittiert');
      expect(n.source).toBe('ticket');
      expect(n.link).toBe('/analysis?ticket=abc');
      expect(n.read).toBe(false);
    });

    test('generiert immer neue eindeutige IDs', () => {
      const n1 = Notification.create({ userId: 'u1', title: 'A' });
      const n2 = Notification.create({ userId: 'u1', title: 'B' });
      expect(n1.id).not.toBe(n2.id);
    });
  });

  describe('Validierung — Pflichtfelder', () => {
    test('wirft Fehler wenn userId fehlt', () => {
      expect(() => Notification.create({ title: 'x' }))
        .toThrow(/userId/i);
    });

    test('wirft Fehler wenn title fehlt', () => {
      expect(() => Notification.create({ userId: 'u1' }))
        .toThrow(/title/i);
    });

    test('wirft Fehler wenn title leer ist', () => {
      expect(() => Notification.create({ userId: 'u1', title: '' }))
        .toThrow(/title/i);
    });
  });

  describe('Validierung — severity-Enum', () => {
    test('akzeptiert alle gültigen Severities', () => {
      for (const s of SEVERITIES) {
        expect(() => Notification.create({ userId: 'u1', title: 'T', severity: s }))
          .not.toThrow();
      }
    });

    test('wirft Fehler bei ungültigem severity', () => {
      expect(() => Notification.create({ userId: 'u1', title: 'T', severity: 'extreme' }))
        .toThrow(/severity/i);
    });

    test('SEVERITIES enthält die erwarteten Werte', () => {
      expect(SEVERITIES).toContain('critical');
      expect(SEVERITIES).toContain('high');
      expect(SEVERITIES).toContain('medium');
      expect(SEVERITIES).toContain('low');
      expect(SEVERITIES).toContain('info');
    });
  });

  describe('Validierung — source', () => {
    test('akzeptiert alle gültigen Sources', () => {
      for (const s of SOURCES) {
        expect(() => Notification.create({ userId: 'u1', title: 'T', source: s }))
          .not.toThrow();
      }
    });

    test('wirft Fehler bei ungültigem source', () => {
      expect(() => Notification.create({ userId: 'u1', title: 'T', source: 'unknown_source' }))
        .toThrow(/source/i);
    });

    test('SOURCES enthält ticket, agent, system', () => {
      expect(SOURCES).toContain('ticket');
      expect(SOURCES).toContain('agent');
      expect(SOURCES).toContain('system');
    });
  });

  describe('toJSON()', () => {
    test('serialisiert alle Felder korrekt', () => {
      const n = Notification.create({
        userId: 'u3',
        severity: 'high',
        title: 'Alert',
        body: 'Details',
        source: 'agent',
        link: '/foo',
      });
      const json = n.toJSON();
      expect(json).toMatchObject({
        userId: 'u3',
        severity: 'high',
        title: 'Alert',
        body: 'Details',
        source: 'agent',
        link: '/foo',
        read: false,
      });
      expect(typeof json.id).toBe('string');
      expect(typeof json.createdAt).toBe('string');
    });

    test('gibt flaches Objekt zurück, keine Instanz-Methoden', () => {
      const n = Notification.create({ userId: 'u1', title: 'T' });
      const json = n.toJSON();
      expect(typeof json.toJSON).toBe('undefined');
    });
  });

  describe('Konstruktor — Rekonstruktion aus gespeicherten Daten', () => {
    test('kann aus gespeicherten Daten rekonstruiert werden (z.B. aus DB-Row)', () => {
      const stored = {
        id: 'fixed-uuid',
        userId: 'u99',
        severity: 'medium',
        title: 'Wieder geladen',
        body: 'body',
        source: 'ticket',
        link: '/analysis?ticket=x',
        read: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const n = new Notification(stored);
      expect(n.id).toBe('fixed-uuid');
      expect(n.read).toBe(true);
      expect(n.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });
});
