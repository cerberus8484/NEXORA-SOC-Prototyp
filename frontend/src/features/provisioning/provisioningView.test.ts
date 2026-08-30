import { describe, test, expect } from 'vitest';
import {
  nodeStatusTone, heartbeatTone, enrollmentTone, isHeartbeatStale, relativeTime, countByStatus,
  credentialStatusTone, canRevokeCredential, canRetireNode, revokeConfirmText, retireConfirmText,
} from './provisioningView';
import type { InstalledNode } from './provisioningApi';

describe('Status-Töne', () => {
  test('Node-Status', () => {
    expect(nodeStatusTone('active')).toBe('success');
    expect(nodeStatusTone('stale')).toBe('warning');
    expect(nodeStatusTone('retired')).toBe('muted');
  });
  test('Heartbeat-Status', () => {
    expect(heartbeatTone('healthy')).toBe('success');
    expect(heartbeatTone('degraded')).toBe('warning');
    expect(heartbeatTone('offline')).toBe('danger');
  });
  test('Enrollment-Status', () => {
    expect(enrollmentTone('active')).toBe('success');
    expect(enrollmentTone('revoked')).toBe('danger');
  });
});

describe('isHeartbeatStale', () => {
  const now = new Date('2026-06-18T12:00:00.000Z').getTime();
  test('null/leer → stale', () => {
    expect(isHeartbeatStale(null, now)).toBe(true);
  });
  test('frisch (< 5 min) → nicht stale', () => {
    expect(isHeartbeatStale(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });
  test('alt (> 5 min) → stale', () => {
    expect(isHeartbeatStale(new Date(now - 6 * 60_000).toISOString(), now)).toBe(true);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-06-18T12:00:00.000Z').getTime();
  test('null → nie', () => expect(relativeTime(null, now)).toBe('nie'));
  test('< 1 min → gerade eben', () => expect(relativeTime(new Date(now - 10_000).toISOString(), now)).toBe('gerade eben'));
  test('Minuten', () => expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('vor 5 min'));
  test('Stunden', () => expect(relativeTime(new Date(now - 3 * 3600_000).toISOString(), now)).toBe('vor 3 h'));
  test('Tage', () => expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('vor 2 d'));
});

describe('countByStatus', () => {
  test('zählt je Status', () => {
    const mk = (status: InstalledNode['status']): InstalledNode => ({
      id: 'x', name: 'x', role: 'normal_agent', profileId: null, fqdn: null, ip: null, os: null,
      version: null, status, lastSeenAt: null, createdAt: '', updatedAt: '', hostKeyPin: null,
    });
    const counts = countByStatus([mk('active'), mk('active'), mk('stale')]);
    expect(counts.active).toBe(2);
    expect(counts.stale).toBe(1);
    expect(counts.pending).toBe(0);
  });
});

// ── P_PROVISION_SECURITY_1: Credential- und Retire-Logik ─────────────────────

describe('credentialStatusTone', () => {
  test('active → success', () => {
    expect(credentialStatusTone('active')).toBe('success');
  });
  test('revoked → danger', () => {
    expect(credentialStatusTone('revoked')).toBe('danger');
  });
});

describe('canRevokeCredential', () => {
  test('admin + active → true', () => {
    expect(canRevokeCredential('admin', 'active')).toBe(true);
  });
  test('admin + revoked → false (bereits widerrufen)', () => {
    expect(canRevokeCredential('admin', 'revoked')).toBe(false);
  });
  test('analyst + active → false (kein Admin)', () => {
    expect(canRevokeCredential('analyst', 'active')).toBe(false);
  });
  test('viewer + active → false', () => {
    expect(canRevokeCredential('viewer', 'active')).toBe(false);
  });
  test('undefined role → false', () => {
    expect(canRevokeCredential(undefined, 'active')).toBe(false);
  });
});

describe('canRetireNode', () => {
  test('admin + active → true', () => {
    expect(canRetireNode('admin', 'active')).toBe(true);
  });
  test('admin + enrolled → true', () => {
    expect(canRetireNode('admin', 'enrolled')).toBe(true);
  });
  test('admin + retired → false (bereits retired)', () => {
    expect(canRetireNode('admin', 'retired')).toBe(false);
  });
  test('analyst + active → false (kein Admin)', () => {
    expect(canRetireNode('analyst', 'active')).toBe(false);
  });
  test('undefined role → false', () => {
    expect(canRetireNode(undefined, 'active')).toBe(false);
  });
});

describe('revokeConfirmText', () => {
  const mkNode = (name: string): InstalledNode => ({
    id: 'n-1', name, role: 'normal_agent', profileId: null, fqdn: null,
    ip: null, os: null, version: null, status: 'active', lastSeenAt: null,
    createdAt: '', updatedAt: '', hostKeyPin: null,
  });

  test('enthält den Node-Namen', () => {
    expect(revokeConfirmText(mkNode('sensor-42'))).toContain('sensor-42');
  });
  test('enthält Hinweis auf Heartbeat-Unterbrechung', () => {
    expect(revokeConfirmText(mkNode('x'))).toContain('Heartbeat');
  });
  test('enthält KEINE Token/Hash-Werte im Text', () => {
    const text = revokeConfirmText(mkNode('x'));
    // Das beschreibende Wort „Credential" ist okay — verboten sind nur echte
    // Geheimwerte (Token/Hash/Secret oder das ncr_-Präfix einer Node-Credential).
    expect(text).not.toMatch(/token|hash|secret|ncr_/i);
  });
});

describe('retireConfirmText', () => {
  const mkNode = (name: string): InstalledNode => ({
    id: 'n-2', name, role: 'normal_agent', profileId: null, fqdn: null,
    ip: null, os: null, version: null, status: 'active', lastSeenAt: null,
    createdAt: '', updatedAt: '', hostKeyPin: null,
  });

  test('enthält den Node-Namen', () => {
    expect(retireConfirmText(mkNode('gateway-01'))).toContain('gateway-01');
  });
  test('enthält Hinweis auf Credentials-Widerruf', () => {
    const text = retireConfirmText(mkNode('x'));
    // Warnung über Credentials im Klartext-Sinne ist okay — beschreibend, kein Wert
    expect(text).toContain('aktive');
  });
  test('enthält Hinweis auf Heartbeat-Ende', () => {
    expect(retireConfirmText(mkNode('x'))).toContain('Heartbeat');
  });
  test('enthält KEINE Token/Hash-Werte im Text', () => {
    const text = retireConfirmText(mkNode('x'));
    expect(text).not.toMatch(/token|hash|secret|ncr_/i);
  });
});
