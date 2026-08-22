import { describe, expect, test } from 'vitest';
import type { IntegrationStatus } from '../integrations/integrationsView';
import type { SourceActivity } from './collectorsStatusApi';
import { buildSourceHealthRows, summarizeSourceHealth } from './sourceHealthModel';

const integration = (overrides: Partial<IntegrationStatus> = {}): IntegrationStatus => ({
  id: 'wazuh',
  name: 'Wazuh',
  category: 'siem',
  configured: true,
  endpoint: 'wazuh.example.com:55000',
  status: 'configured',
  testable: true,
  ...overrides,
});

const activity = (overrides: Partial<SourceActivity> = {}): SourceActivity => ({
  source: 'wazuh',
  total: 42,
  recent: 5,
  lastSeen: '2026-07-05T09:00:00.000Z',
  ...overrides,
});

describe('buildSourceHealthRows', () => {
  test('zeigt konfigurierte Quelle mit aktuellen Tickets als gesund', () => {
    const rows = buildSourceHealthRows(
      [integration()],
      [activity()],
      new Date('2026-07-05T10:00:00.000Z'),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'wazuh',
      tone: 'success',
      statusLabel: 'Liefert Tickets',
      detail: '5 Tickets in den letzten 24h',
    });
  });

  test('markiert konfigurierte aber stille Quelle mit Still-seit-Hinweis', () => {
    const rows = buildSourceHealthRows(
      [integration({ id: 'splunk', name: 'Splunk', endpoint: 'splunk.example.com:8089' })],
      [activity({ source: 'splunk', recent: 0, total: 18, lastSeen: '2026-07-05T07:30:00.000Z' })],
      new Date('2026-07-05T10:00:00.000Z'),
    );

    expect(rows[0]).toMatchObject({
      source: 'splunk',
      tone: 'warning',
      statusLabel: 'Still seit 3h',
      detail: '18 gesamt, aktuell 0 in 24h',
    });
  });

  test('markiert konfigurierte Quelle ohne jemals gesehene Tickets als Problem', () => {
    const rows = buildSourceHealthRows(
      [integration({ id: 'qradar', name: 'QRadar', endpoint: 'qradar.example.com' })],
      [],
      new Date('2026-07-05T10:00:00.000Z'),
    );

    expect(rows[0]).toMatchObject({
      source: 'qradar',
      tone: 'danger',
      statusLabel: 'Noch nie gesehen',
      detail: 'Konfiguriert, aber bisher sind keine Tickets angekommen.',
    });
  });

  test('blendet nie konfigurierte, nie aktive Quellen als Platzhalter-Rauschen aus', () => {
    const rows = buildSourceHealthRows(
      [integration({ id: 'email', name: 'E-Mail (IMAP)', configured: false, endpoint: '', status: 'not_configured' })],
      [],
      new Date('2026-07-05T10:00:00.000Z'),
    );

    // QRadar/Splunk/Email, die nie eingerichtet wurden und nie Daten lieferten, sind kein
    // Health-Signal, sondern Rauschen — sie gehören auf die Integrations-Seite, nicht hierher.
    expect(rows).toEqual([]);
  });

  test('zeigt eine konfigurierte, aber stille Quelle weiterhin (echtes Health-Signal)', () => {
    const rows = buildSourceHealthRows(
      [integration({ id: 'email', name: 'E-Mail (IMAP)', configured: true, endpoint: 'imap.example.com:993' })],
      [],
      new Date('2026-07-05T10:00:00.000Z'),
    );

    expect(rows[0]).toMatchObject({ source: 'email', tone: 'danger', statusLabel: 'Noch nie gesehen' });
  });

  test('ignoriert Integrationen, die keine Ticket-Quelle sind', () => {
    const rows = buildSourceHealthRows(
      [integration({ id: 'ollama', name: 'Ollama (LLM)', category: 'llm', endpoint: 'ollama.example.com:11434' })],
      [],
      new Date('2026-07-05T10:00:00.000Z'),
    );

    expect(rows).toEqual([]);
  });
});

describe('summarizeSourceHealth', () => {
  test('zählt gesunde und auffällige Quellen (reine Platzhalter ausgeblendet)', () => {
    const rows = buildSourceHealthRows(
      [
        integration(),
        integration({ id: 'splunk', name: 'Splunk', endpoint: 'splunk.example.com:8089' }),
        integration({ id: 'email', name: 'E-Mail (IMAP)', configured: false, endpoint: '', status: 'not_configured' }),
      ],
      [
        activity(),
        activity({ source: 'splunk', recent: 0, total: 4, lastSeen: '2026-07-05T06:00:00.000Z' }),
      ],
      new Date('2026-07-05T10:00:00.000Z'),
    );

    // Email nie konfiguriert + nie aktiv → ausgeblendet. Nur echte Quellen zählen.
    expect(summarizeSourceHealth(rows)).toEqual({
      healthy: 1,
      attention: 1,
      notConfigured: 0,
      total: 2,
    });
  });
});
